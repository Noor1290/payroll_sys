import ExcelJS from 'exceljs'
import { getOrderedEffectiveColumns, getCategoryGroups } from './categories'
import { excelNumberFormat } from './format'
import { translateFormulaToExcel, excelColumnLetter } from './excelFormulaTranslator'
import { getDependencies } from './formulaEngine'

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
// A row is always reserved for the optional company-details line (blank
// when the "Include company details in header" toggle is off), so the
// rest of the fixed layout never shifts based on that toggle.
const DETAILS_ROW = 3
const GROUP_ROW = 5
const COLUMN_ROW = 6
const DATA_START_ROW = 7
const META_SHEET_NAME = '_meta'
const META_GENERATOR = 'payroll-sys'
const META_VERSION = 2

// One line combining address + BRN for the export header, e.g.
// "123 Main St, Port Louis   •   BRN: C12345678". A multi-line address is
// flattened to commas - spreadsheet header rows don't wrap well.
export function formatCompanyDetailsLine(details) {
  if (!details) return ''
  const parts = []
  const address = (details.address ?? '').trim()
  const brn = (details.brn ?? '').trim()
  if (address) parts.push(address.replace(/\s*\n+\s*/g, ', '))
  if (brn) parts.push(`BRN: ${brn}`)
  return parts.join('   •   ')
}

// Builds a plain-data "export plan" - independent of any spreadsheet
// library - describing exactly what will be exported: title text, the
// column list (every Identifier + Global/Company column currently defined
// for this company that isn't marked "exclude from export" - nothing else,
// no phantom template columns), the category groups for the spanning
// header row, and every row's values. This same plan drives both the
// styled preview table and the real .xlsx file, so what you see in the
// preview is exactly what you get - a column excluded from export NEVER
// appears in `columns`/`rows`/`totalsRow`, regardless of export mode.
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
//
// Columns excluded from export never appear in the preview, but their
// values must still round-trip on re-import (see excelImport.js), and a
// LIVE FORMULA that depends on one still needs a real cell to reference -
// see `hiddenColumns`/`excludedValues` below and buildWorkbookBuffer.
export function buildExportPlan({
  title,
  companyId,
  companyDetails,
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
  const visibleSourceColumns = orderedEffectiveColumns.filter((c) => !c.excludeFromExport)
  const excludedSourceColumns = orderedEffectiveColumns.filter((c) => c.excludeFromExport)

  const toExportColumn = (c) => ({
    key: c.key,
    name: c.name,
    kind: c.type,
    valueType: c.valueType,
    decimals: c.decimals ?? 2,
    // Only meaningful for kind==='formula' - the raw internal expression,
    // carried through so buildWorkbookBuffer can translate it to a live
    // Excel formula when exportMode is 'formulas'.
    formula: c.formula,
  })

  const orderedColumns = visibleSourceColumns.map(toExportColumn)
  const columns = [...identityColumns, ...orderedColumns]

  const groups = []
  if (identityColumns.length > 0) groups.push({ label: 'Identifiers', count: identityColumns.length })
  for (const group of getCategoryGroups(visibleSourceColumns)) {
    groups.push({ label: group.label, count: group.columns.length })
  }

  const isTextColumn = (col) => col.kind === 'identity' || col.valueType === 'text'
  const isCheckboxColumn = (col) => col.valueType === 'checkbox'

  function cellValue(col, emp) {
    if (col.kind === 'identity') return emp.values?.[col.key] ?? ''
    const cell = computedGrid[emp.id]?.[col.key]
    const value = cell?.value
    if (isCheckboxColumn(col)) return value === 1 ? 'Yes' : 'No'
    if (isTextColumn(col)) return typeof value === 'string' ? value : (value ?? '')
    return typeof value === 'number' && !Number.isNaN(value) ? value : 0
  }

  // Like cellValue, but a checkbox stays the numeric 1/0 the compiled
  // formula actually compares against (e.g. "colKey === 1"), instead of
  // "Yes"/"No" text. Only for hidden helper columns, which exist purely so
  // a live Excel formula has a real cell to reference - Excel's "=" never
  // coerces text to a number, so a hidden "Yes"/"No" cell would make an
  // IF(hiddenCell=1, ...) formula silently always take the false branch.
  function hiddenCellValue(col, emp) {
    if (isCheckboxColumn(col)) {
      const cell = computedGrid[emp.id]?.[col.key]
      return cell?.value === 1 ? 1 : 0
    }
    return cellValue(col, emp)
  }

  const rows = employees.map((emp) => columns.map((col) => cellValue(col, emp)))

  // A trailing totals row: sum of every numeric (Input or Formula) column
  // across all employees currently in the export. Text/identity columns
  // are left blank, except a "TOTAL" label in the first identity column.
  // Checkbox columns aren't summed - a count of ticked rows instead.
  const totalsRow = columns.map((col, i) => {
    if (col.kind === 'identity') return i === 0 ? 'TOTAL' : ''
    if (isCheckboxColumn(col)) {
      const ticked = employees.reduce((n, emp) => (computedGrid[emp.id]?.[col.key]?.value === 1 ? n + 1 : n), 0)
      return `${ticked} ticked`
    }
    if (isTextColumn(col)) return ''
    let sum = 0
    for (const row of rows) {
      const v = row[i]
      sum += typeof v === 'number' && !Number.isNaN(v) ? v : 0
    }
    return sum
  })

  // Which excluded columns an exported (visible) Formula column's compiled
  // expression actually depends on - these need a real cell to reference
  // in Live-Formula mode, written as a HIDDEN Excel column rather than
  // omitted (see buildWorkbookBuffer). Excluded columns NOT referenced by
  // any exported formula are omitted from the sheet entirely.
  const allKeys = orderedEffectiveColumns.map((c) => c.key)
  const formulaDependencyKeys = new Set()
  for (const c of visibleSourceColumns) {
    if (c.type === 'formula' && c.formula) {
      for (const dep of getDependencies(c.formula, allKeys)) formulaDependencyKeys.add(dep)
    }
  }
  const hiddenColumns = excludedSourceColumns.filter((c) => formulaDependencyKeys.has(c.key)).map(toExportColumn)
  const hiddenRows = employees.map((emp) => hiddenColumns.map((col) => hiddenCellValue(col, emp)))

  // EVERY excluded column's values, regardless of whether a live formula
  // needs them - stashed in the hidden _meta sheet so a system-export
  // re-import can restore them even when exportMode is 'values' (no live
  // formulas/hidden columns involved at all) or the column isn't
  // referenced by anything currently exported.
  const excludedValues = {}
  for (const c of excludedSourceColumns) {
    const col = toExportColumn(c)
    excludedValues[col.key] = employees.map((emp) => cellValue(col, emp))
  }

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
    excludedValues,
    // Carried through so nothing's lost if this file is ever inspected or
    // re-imported later - not currently auto-applied by any import flow,
    // just preserved.
    companyDetails: companyDetails ?? null,
  }

  return {
    companyName: title || 'Company',
    exportDateLabel,
    companyDetails: companyDetails ?? null,
    showCompanyDetails: false,
    columns,
    groups,
    rows,
    totalsRow,
    hiddenColumns,
    hiddenRows,
    meta,
    exportMode,
  }
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

// Columns whose cells hold text (not a summable/formattable number) once
// written to the sheet - identity fields, Text columns, and Checkbox
// columns (written as "Yes"/"No"). Shared by the data rows, the totals
// row, and column-width sizing so all three treat these consistently.
function isTextLikeColumn(col) {
  return col.kind === 'identity' || col.valueType === 'text' || col.valueType === 'checkbox'
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

  const useLiveFormulas = plan.exportMode === 'formulas'
  // Excluded-but-formula-referenced columns only ever materialize as real
  // (hidden) sheet columns in Live-Formula mode - in Values mode nothing
  // needs a cell to point at, so they're never written to the visible
  // sheet at all (their values still round-trip via the _meta stash).
  const hiddenColumns = useLiveFormulas ? plan.hiddenColumns : []
  const hiddenRows = useLiveFormulas ? plan.hiddenRows : []
  const allSheetColumns = [...plan.columns, ...hiddenColumns]

  ws.columns = [
    ...plan.columns.map((_, i) => ({ width: widths[i] })),
    ...hiddenColumns.map(() => ({ width: MIN_COL_WIDTH, hidden: true })),
  ]

  const columnKeyToLetter = Object.fromEntries(allSheetColumns.map((c, i) => [c.key, excelColumnLetter(i + 1)]))

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

  // Company-details line (address / BRN) - always a reserved row so the
  // rest of the layout's row numbers never depend on this toggle, just
  // left blank when it's off.
  ws.mergeCells(DETAILS_ROW, 1, DETAILS_ROW, colCount)
  const detailsCell = ws.getCell(DETAILS_ROW, 1)
  detailsCell.value = plan.showCompanyDetails ? formatCompanyDetailsLine(plan.companyDetails) : ''
  detailsCell.font = { name: FONT_NAME, size: 9, italic: true, color: { argb: 'FF4B5563' } }
  detailsCell.alignment = { horizontal: 'center' }
  ws.getRow(DETAILS_ROW).height = detailsCell.value ? 16 : 6

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
      const isText = isTextLikeColumn(col)
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
    const isText = isTextLikeColumn(col)
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

  // Hidden helper columns: real cells (so a live formula elsewhere on the
  // sheet has something to point at), but Excel-hidden - never visible,
  // never part of the styled group-header spans above, just plumbing.
  hiddenColumns.forEach((col, hIdx) => {
    const colIdx = plan.columns.length + hIdx + 1
    const headerCell = ws.getCell(COLUMN_ROW, colIdx)
    headerCell.value = `${col.name} (hidden)`
    headerCell.font = { name: FONT_NAME, size: 10, bold: true, color: { argb: 'FF1F2933' } }
    headerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    headerCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    headerCell.border = THIN_BORDER

    hiddenRows.forEach((row, rIdx) => {
      const excelRowNum = DATA_START_ROW + rIdx
      const value = row[hIdx]
      // Checkbox hidden cells hold a real number here (see hiddenCellValue),
      // not "Yes"/"No" text - never text-like in this one spot, even though
      // isTextLikeColumn would normally say so for a checkbox column.
      const isText = col.valueType !== 'checkbox' && isTextLikeColumn(col)
      const cell = ws.getCell(excelRowNum, colIdx)
      cell.font = { name: FONT_NAME, size: 10 }
      cell.border = THIN_BORDER
      cell.alignment = { horizontal: isText ? 'left' : 'center' }
      if (!isText) cell.numFmt = col.valueType === 'checkbox' ? '0' : excelNumberFormat(col.decimals ?? 2)
      cell.value = col.kind === 'formula' ? buildLiveFormulaCellValue(col.formula, columnKeyToLetter, excelRowNum, value) : value
    })
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
