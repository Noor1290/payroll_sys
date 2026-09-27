import ExcelJS from 'exceljs'
import { getOrderedEffectiveColumns, getCategoryGroups } from './categories'
import { excelNumberFormat } from './format'
import { translateFormulaToExcel, excelColumnLetter } from './excelFormulaTranslator'

const FONT_NAME = 'Book Antiqua'
// Approximates the reference file's header fill (Excel theme "Accent 1,
// Lighter 60%") as a concrete color, since a freshly-built workbook has no
// theme to reference by index.
const HEADER_FILL = 'FFB4C6E7'
const BANDING_FILL = 'FFF2F2F2'
// A distinct shade from both plain white rows and the banding gray, so the
// trailing totals row is visually set apart even before the bold text and
// medium top border register.
const TOTALS_FILL = 'FFDCE3EC'
// Light violet, matching the app's own violet-100/violet-700 "fx" badge
// used for formula cells in the live Employee Table.
const FORMULA_FILL = 'FFF3E8FF'
const BORDER_COLOR = { argb: 'FF999999' }
const THIN_BORDER = {
  top: { style: 'thin', color: BORDER_COLOR },
  left: { style: 'thin', color: BORDER_COLOR },
  bottom: { style: 'thin', color: BORDER_COLOR },
  right: { style: 'thin', color: BORDER_COLOR },
}
const MIN_COL_WIDTH = 10
const MAX_COL_WIDTH = 40
const GROUP_ROW = 4
const COLUMN_ROW = 5
const DATA_START_ROW = 6
const META_SHEET_NAME = '_meta'
const META_GENERATOR = 'payroll-sys'
const META_VERSION = 1

// Builds a plain-data "export plan" - independent of any spreadsheet
// library - describing exactly what will be exported: title text, the
// column list (every Identifier + Global/Company column currently defined
// for this company - nothing else, no phantom template columns), the
// category groups for the spanning header row, and every row's values.
// This same plan drives both the styled preview table and the real .xlsx
// file, so what you see in the preview is exactly what you get.
//
// `companyId` + `kind` ('period' | 'totals') are carried through into the
// hidden _meta sheet so a later import can recognize a file this system
// produced. Totals exports (aggregated across months) are intentionally
// marked distinctly - re-importing summed multi-month figures as a single
// month's raw input data would be wrong, so they're never auto-recognized.
//
// `exportMode` ('values' | 'formulas') controls what a Formula column's
// cells contain in the DOWNLOADED file only - the in-browser preview always
// shows computed values regardless, for readability. See
// buildWorkbookBuffer for the actual live-formula translation.
export function buildExportPlan({
  title,
  companyId,
  kind = 'period',
  exportMode = 'values',
  employees,
  identityFields,
  effectiveColumns,
  computedGrid,
}) {
  const identityColumns = identityFields.map((f) => ({ key: f.key, name: f.name, kind: 'identity' }))
  // Grouping must run on the RAW effective columns (which still carry
  // `.category`) - mapping them down to the plain {key,name,kind,...} shape
  // first (as the export column list needs) strips that field, and
  // getCategoryGroups silently treats every category-less column as
  // "General", collapsing Employee/Employer Contribution and Other
  // Deductions into it.
  const orderedEffectiveColumns = getOrderedEffectiveColumns(effectiveColumns)
  const orderedColumns = orderedEffectiveColumns.map((c) => ({
    key: c.key,
    name: c.name,
    kind: c.type,
    valueType: c.valueType,
    decimals: c.decimals ?? 2,
    // Only meaningful for kind==='formula' - the raw internal expression,
    // carried through so buildWorkbookBuffer can translate it to a live
    // Excel formula when exportMode is 'formulas'.
    formula: c.formula,
  }))
  const columns = [...identityColumns, ...orderedColumns]

  const groups = []
  if (identityColumns.length > 0) groups.push({ label: 'Identifiers', count: identityColumns.length })
  for (const group of getCategoryGroups(orderedEffectiveColumns)) {
    groups.push({ label: group.label, count: group.columns.length })
  }

  const isTextColumn = (col) => col.kind === 'identity' || col.valueType === 'text'

  const rows = employees.map((emp) =>
    columns.map((col) => {
      if (col.kind === 'identity') return emp.values?.[col.key] ?? ''
      const cell = computedGrid[emp.id]?.[col.key]
      const value = cell?.value
      if (isTextColumn(col)) return typeof value === 'string' ? value : (value ?? '')
      return typeof value === 'number' && !Number.isNaN(value) ? value : 0
    })
  )

  // A trailing totals row: sum of every numeric (Input or Formula) column
  // across all employees currently in the export. Text/identity columns
  // are left blank, except a "TOTAL" label in the first identity column.
  const totalsRow = columns.map((col, i) => {
    if (isTextColumn(col)) return i === 0 && col.kind === 'identity' ? 'TOTAL' : ''
    let sum = 0
    for (const row of rows) {
      const v = row[i]
      sum += typeof v === 'number' && !Number.isNaN(v) ? v : 0
    }
    return sum
  })

  const now = new Date()
  const exportDateLabel = `Exported ${now.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })}`

  const meta = {
    generator: META_GENERATOR,
    version: META_VERSION,
    kind,
    companyId,
    columnKeys: columns.map((c) => c.key),
  }

  return { companyName: title || 'Company', exportDateLabel, columns, groups, rows, totalsRow, meta, exportMode }
}

// Attempts to translate a Formula column's internal expression into a live
// Excel formula for one specific row. `value` is the already-computed
// static result, used both as the cached `result` (so viewers see a
// sensible number before any recalculation) and as the fallback if
// translation fails - per spec, an untranslatable formula degrades to its
// static value rather than producing a broken file.
function buildLiveFormulaCellValue(formula, columnKeyToLetter, excelRowNum, value) {
  try {
    const resolveCellRef = (key) => {
      const letter = columnKeyToLetter[key]
      return letter ? `${letter}${excelRowNum}` : null
    }
    const excelFormula = translateFormulaToExcel(formula, resolveCellRef)
    return { formula: excelFormula, result: typeof value === 'number' ? value : undefined }
  } catch (e) {
    console.warn(`Could not translate formula to Excel syntax, exporting static value instead: ${formula}`, e)
    return value
  }
}

function computeColumnWidths(plan) {
  return plan.columns.map((col, i) => {
    let maxLen = col.name.length
    for (const row of [...plan.rows, plan.totalsRow]) {
      const len = String(row[i] ?? '').length
      if (len > maxLen) maxLen = len
    }
    return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, maxLen + 2))
  })
}

// Builds the styled workbook (title rows, spanning category-group header,
// filled/bordered column header, frozen panes, number formats, row
// banding, formula-column tint) and returns it as an ArrayBuffer ready to
// be downloaded. Also embeds a hidden _meta sheet identifying this as a
// system export, for automatic recognition on re-import.
export async function buildWorkbookBuffer(plan) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Payroll')
  const colCount = plan.columns.length
  const widths = computeColumnWidths(plan)

  ws.columns = plan.columns.map((_, i) => ({ width: widths[i] }))

  const useLiveFormulas = plan.exportMode === 'formulas'
  const columnKeyToLetter = Object.fromEntries(plan.columns.map((c, i) => [c.key, excelColumnLetter(i + 1)]))

  ws.mergeCells(1, 1, 1, colCount)
  const titleCell = ws.getCell(1, 1)
  titleCell.value = plan.companyName
  titleCell.font = { name: FONT_NAME, size: 14, bold: true }
  titleCell.alignment = { horizontal: 'center' }
  ws.getRow(1).height = 22

  ws.mergeCells(2, 1, 2, colCount)
  const subtitleCell = ws.getCell(2, 1)
  subtitleCell.value = plan.exportDateLabel
  subtitleCell.font = { name: FONT_NAME, size: 11, italic: true }
  subtitleCell.alignment = { horizontal: 'center' }
  ws.getRow(2).height = 18

  // Spanning category-group header row (e.g. "Identifiers" | "General" |
  // "Employee Contribution" | ...), matching the live Employee Table.
  ws.getRow(GROUP_ROW).height = 20
  let colCursor = 1
  for (const group of plan.groups) {
    const startCol = colCursor
    const endCol = colCursor + group.count - 1
    if (endCol > startCol) ws.mergeCells(GROUP_ROW, startCol, GROUP_ROW, endCol)
    const cell = ws.getCell(GROUP_ROW, startCol)
    cell.value = group.label
    cell.font = { name: FONT_NAME, size: 10, bold: true, color: { argb: 'FF1F2933' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    for (let c = startCol; c <= endCol; c++) {
      ws.getCell(GROUP_ROW, c).border = THIN_BORDER
      ws.getCell(GROUP_ROW, c).fill = cell.fill
    }
    colCursor = endCol + 1
  }

  ws.getRow(COLUMN_ROW).height = 32
  plan.columns.forEach((col, i) => {
    const cell = ws.getCell(COLUMN_ROW, i + 1)
    cell.value = col.kind === 'formula' ? `${col.name} (calc)` : col.name
    cell.font = { name: FONT_NAME, size: 10, bold: true, color: { argb: 'FF1F2933' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = THIN_BORDER
  })

  plan.rows.forEach((row, rIdx) => {
    const excelRowNum = DATA_START_ROW + rIdx
    const isBanded = rIdx % 2 === 1
    row.forEach((value, cIdx) => {
      const col = plan.columns[cIdx]
      const isText = col.kind === 'identity' || col.valueType === 'text'
      const cell = ws.getCell(excelRowNum, cIdx + 1)
      cell.font = { name: FONT_NAME, size: 10 }
      cell.border = THIN_BORDER
      cell.alignment = { horizontal: isText ? 'left' : 'center' }
      if (!isText) cell.numFmt = excelNumberFormat(col.decimals ?? 2)

      if (col.kind === 'formula' && useLiveFormulas) {
        cell.value = buildLiveFormulaCellValue(col.formula, columnKeyToLetter, excelRowNum, value)
      } else {
        cell.value = value
      }

      if (col.kind === 'formula') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FORMULA_FILL } }
      } else if (isBanded) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BANDING_FILL } }
      }
    })
  })

  // Trailing totals row: bold, shaded, and set off from the data by a
  // medium top border rather than the thin grid lines used elsewhere. In
  // live-formula mode it's a real SUM() over the data range, not a
  // precomputed number, so it keeps recalculating if the sheet is edited.
  const totalsRowNum = DATA_START_ROW + plan.rows.length
  plan.totalsRow.forEach((value, cIdx) => {
    const col = plan.columns[cIdx]
    const isText = col.kind === 'identity' || col.valueType === 'text'
    const cell = ws.getCell(totalsRowNum, cIdx + 1)
    cell.font = { name: FONT_NAME, size: 10, bold: true }
    cell.border = { ...THIN_BORDER, top: { style: 'medium', color: BORDER_COLOR } }
    cell.alignment = { horizontal: isText ? 'left' : 'center' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTALS_FILL } }
    if (!isText) cell.numFmt = excelNumberFormat(col.decimals ?? 2)

    if (!isText && useLiveFormulas && plan.rows.length > 0) {
      const letter = columnKeyToLetter[col.key]
      const firstRow = DATA_START_ROW
      const lastRow = DATA_START_ROW + plan.rows.length - 1
      cell.value = { formula: `SUM(${letter}${firstRow}:${letter}${lastRow})`, result: value }
    } else {
      cell.value = value
    }
  })

  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: COLUMN_ROW, topLeftCell: `A${COLUMN_ROW + 1}` }]

  // Hidden metadata sheet: invisible in the normal Excel view (not just
  // scrolled off - "veryHidden" means it doesn't even show up in Excel's
  // own Unhide-sheet dialog), carrying enough for a later import to
  // recognize this exact file and know precisely which column key sits at
  // which position, without guessing from header text.
  const metaSheet = wb.addWorksheet(META_SHEET_NAME)
  metaSheet.getCell('A1').value = JSON.stringify(plan.meta)
  metaSheet.state = 'veryHidden'

  return wb.xlsx.writeBuffer()
}

function downloadBuffer(buffer, filename) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function downloadExportPlan(plan) {
  const buffer = await buildWorkbookBuffer(plan)
  const safeName = (plan.companyName || 'company').replace(/[^a-z0-9_\- ]/gi, '').trim() || 'company'
  downloadBuffer(buffer, `${safeName}-payroll.xlsx`)
}
