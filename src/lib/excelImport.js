import * as XLSX from 'xlsx'

const META_SHEET_NAME = '_meta'
const META_GENERATOR = 'payroll-sys'
// The exact 0-indexed row where the real column headers sit in a system
// export's fixed layout (title, subtitle, [company-details line], blank
// spacer, category-group header, THEN column headers - see excelExport.js's
// COLUMN_ROW). Version 1 had no company-details row; version 2 added one
// (always reserved, even when left blank), shifting everything down by 1.
const SYSTEM_EXPORT_HEADER_ROW_INDEX = { 1: 4, 2: 5 }

function isNonEmptyCell(cell) {
  return cell !== '' && cell !== undefined && cell !== null
}

// Reads the hidden _meta sheet a system export embeds (see excelExport.js),
// if present. Returns null for any file that isn't a recognized system
// export - including genuinely external files and ones from some other
// generator entirely.
function extractSystemMeta(workbook) {
  const sheet = workbook.Sheets[META_SHEET_NAME]
  if (!sheet) return null
  const cell = sheet.A1
  if (!cell || typeof cell.v !== 'string') return null
  try {
    const meta = JSON.parse(cell.v)
    if (meta?.generator !== META_GENERATOR || !Array.isArray(meta.columnKeys)) return null
    return meta
  } catch {
    return null
  }
}

// Real spreadsheets often have a title/banner row (e.g. a company name
// spanning one cell) before the actual column headers, sometimes with a
// blank row in between. A genuine header row for a multi-column table has
// several cells filled in; a banner row typically has just one. Scan for
// the first row with at least 2 non-empty cells and treat that as the
// header row, instead of assuming row 0.
//
// NOTE: this heuristic is only used for genuinely external files. A
// system export's own category-group row (e.g. "Identifiers" | "General")
// also has several non-empty cells and would otherwise be mistaken for
// the real header row - system exports use the known fixed row index
// instead (see SYSTEM_EXPORT_HEADER_ROW_INDEX below).
function findHeaderRowIndex(rows) {
  const scanLimit = Math.min(rows.length, 20)
  for (let i = 0; i < scanLimit; i++) {
    const nonEmptyCount = (rows[i] ?? []).filter(isNonEmptyCell).length
    if (nonEmptyCount >= 2) return i
  }
  return 0
}

// Reads an uploaded .xlsx File into a header row + the remaining data rows,
// both as plain arrays (no XLSX objects survive past this point). `headers`
// is index-aligned with each row in `rows` (blank header cells get a
// generated placeholder label rather than being dropped, so column
// positions never shift out of alignment with the data).
export async function parseWorkbookFile(file) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const meta = extractSystemMeta(workbook)
  const sheetName = workbook.SheetNames.find((n) => n !== META_SHEET_NAME) ?? workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })

  const headerRowIndex = meta ? (SYSTEM_EXPORT_HEADER_ROW_INDEX[meta.version] ?? findHeaderRowIndex(allRows)) : findHeaderRowIndex(allRows)
  const headerRow = allRows[headerRowIndex] ?? []
  const headers = headerRow.map((h, i) => {
    const label = String(h ?? '').trim()
    return label.length > 0 ? label : `Column ${i + 1}`
  })

  // A system export always ends with its own trailing totals row (see
  // excelExport.js), whose very first cell is the literal string "TOTAL" -
  // real employee data, never that. Only filtered for a RECOGNIZED system
  // export (meta truthy): a genuinely external file could coincidentally
  // have an employee literally named/ID'd "TOTAL", and this must never
  // silently eat a real row from one of those.
  const rows = allRows
    .slice(headerRowIndex + 1)
    .filter((r) => r.some(isNonEmptyCell))
    .filter((r) => !(meta && r[0] === 'TOTAL'))

  if (import.meta.env.DEV) {
    const sample = rows.slice(0, 3).map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])))
    console.debug('[excelImport] header row index:', headerRowIndex, 'headers:', headers)
    console.debug('[excelImport] first parsed rows (as objects):', sample)
  }

  return { headers, rows, meta }
}

// Builds the system-field list a company can import into: every identity
// field, plus every input column (global + company-specific) it can see.
// Formula columns are computed, not importable.
export function getImportableSystemFields(identityFields, effectiveColumns) {
  return [
    ...identityFields.map((f) => ({ key: f.key, name: f.name, kind: 'identity' })),
    ...effectiveColumns
      .filter((c) => c.type === 'input')
      .map((c) => ({ key: c.key, name: c.name, kind: 'input', valueType: c.valueType ?? 'number' })),
  ]
}

// Best-effort auto-mapping: matches a system field to a file column with the
// same header text, case/whitespace-insensitively. Mapping values are
// column INDEXES (not header strings), so duplicate header names never
// cause ambiguity.
export function guessMapping(systemFields, headers) {
  const mapping = {}
  for (const field of systemFields) {
    const index = headers.findIndex((h) => h.toLowerCase() === field.name.toLowerCase())
    mapping[field.key] = index >= 0 ? index : null
  }
  return mapping
}

// True only when `meta` is a system export whose company matches AND every
// column key it recorded still corresponds to a real column in the system
// today. Any drift at all (wrong company, or ANY column - even a deleted
// formula column - since removed) falls back to manual review instead of
// silently auto-importing against a structure that's since changed.
// Totals exports are never auto-recognized: re-importing summed
// multi-month figures as one month's raw input data would be wrong.
export function isRecognizedExport(meta, companyId, allCurrentKeys) {
  if (!meta) return false
  if (meta.kind !== 'period') return false
  if (meta.companyId !== companyId) return false
  return meta.columnKeys.every((k) => allCurrentKeys.has(k))
}

// Best-effort explanation of why a system export wasn't fully recognized,
// for the fallback mapping screen's banner.
export function describeUnrecognizedMeta(meta, companyId, allCurrentKeys) {
  if (!meta) return null
  if (meta.kind !== 'period') {
    return 'This file is a Totals export (aggregated across months), not a single month’s data — please review the mapping below.'
  }
  if (meta.companyId !== companyId) {
    return 'This file was exported from a different company — please review the mapping below.'
  }
  const missing = meta.columnKeys.filter((k) => !allCurrentKeys.has(k))
  if (missing.length > 0) {
    return `This looks like a previous export, but ${missing.length} column${
      missing.length > 1 ? 's have' : ' has'
    } since been removed from this company — please review the mapping below.`
  }
  return null
}

// Resolves the mapping to start the mapping screen with: prefer the exact
// key-for-position match recorded in a system export's metadata (works
// even across differently-worded headers, since it's by internal key, not
// name), falling back to name-based guessing for any field the metadata
// doesn't cover (e.g. a column added since export, or a genuinely external
// file with no metadata at all).
export function resolveImportMapping(systemFields, headers, meta) {
  const nameGuess = guessMapping(systemFields, headers)
  if (!meta) return nameGuess

  const mapping = {}
  for (const field of systemFields) {
    const idx = meta.columnKeys.indexOf(field.key)
    mapping[field.key] = idx >= 0 ? idx : nameGuess[field.key]
  }
  return mapping
}

// Projects raw file rows into { [systemFieldKey]: rawCellValue } using the
// current mapping (column indexes), for the mapping screen's live preview.
export function projectRows(rows, systemFields, mapping) {
  return rows.map((row) => {
    const projected = {}
    for (const field of systemFields) {
      const colIndex = mapping[field.key]
      projected[field.key] = colIndex !== null && colIndex !== undefined ? row[colIndex] : undefined
    }
    return projected
  })
}

// Interprets a checkbox cell's raw value as ticked/unticked. Recognizes
// Yes/No, Y/N, True/False, 1/0, X/blank, case-insensitively; anything
// missing or unrecognized defaults to unticked.
export function parseCheckboxValue(raw) {
  if (raw === undefined || raw === null || raw === '') return false
  const s = String(raw).trim().toLowerCase()
  return s === 'yes' || s === 'y' || s === 'true' || s === '1' || s === 'x'
}

// Reads one cell meant for a Number column. Real payroll files often hold
// figures as TEXT: "18,115.00", "Rs 18115", "Rs. 18 115.50", "(1,200.00)".
// Those are read as the numbers they are. Returns:
//   { ok: true, value }   a number (a blank cell is 0, as it always was)
//   { ok: false }         text that is not a number, e.g. "n/a"
export function parseNumberCell(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: 0 }
  if (typeof raw === 'number') return Number.isFinite(raw) ? { ok: true, value: raw } : { ok: false }
  if (typeof raw !== 'string') return { ok: false }

  // Ordinary and non-breaking spaces are only ever separators in a figure.
  let text = raw.replace(/[\s\u00a0\u202f]+/g, ' ').trim()
  if (text === '') return { ok: true, value: 0 }

  // Accounting style: (1,200.00) is minus 1,200.00.
  let negative = false
  const bracketed = text.match(/^\((.*)\)$/)
  if (bracketed) {
    negative = true
    text = bracketed[1].trim()
  }

  // A currency label before or after the figure: "Rs", "Rs.", "MUR", "$".
  text = text.replace(/^(?:[A-Za-z]{1,4}\.?|[$€£₨])\s*(?=[-+.\d])/, '').replace(/(?<=\d)\s*(?:[A-Za-z]{1,4}\.?|[$€£₨])$/, '')
  text = text.replace(/ /g, '')

  if (/^[-+]/.test(text)) {
    if (text[0] === '-') negative = !negative
    text = text.slice(1)
  }

  const grouped = /^\d{1,3}(,\d{3})+(\.\d*)?$/.test(text)
  const plain = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)
  if (!grouped && !plain) return { ok: false }

  const value = Number(grouped ? text.replace(/,/g, '') : text)
  if (!Number.isFinite(value)) return { ok: false }
  return { ok: true, value: negative ? -value : value }
}

// The value one file cell becomes for one system field, plus whether it was
// a Number cell that could not be read. This one function decides both what
// the import preview shows and what is stored, so the two always match.
//
// Text-based fields (identity fields, and Input columns explicitly typed as
// Text) keep the raw value as-is - never forced through a numeric parser, so
// non-numeric text like "Full Time" survives instead of becoming 0. A Number
// cell that cannot be read is left BLANK and reported, never written as 0.
export function convertImportValue(field, raw) {
  if (field.kind === 'identity' || field.valueType === 'text') {
    return { value: raw === undefined || raw === null ? '' : String(raw), unreadable: false }
  }
  if (field.valueType === 'checkbox') return { value: parseCheckboxValue(raw), unreadable: false }
  const parsed = parseNumberCell(raw)
  return parsed.ok ? { value: parsed.value, unreadable: false } : { value: '', unreadable: true }
}

// `meta` (a recognized system export's hidden _meta, if any) supplies
// values for fields excluded from export - they were never written as a
// visible/mapped column, so `mapping`/`projectRows` alone can't see them;
// this falls back to the value the exporter stashed for that exact row.
function rawValuesForRow(row, rowIndex, systemFields, mapping, meta) {
  const raw = {}
  for (const field of systemFields) {
    raw[field.key] = row[field.key]
    if (mapping[field.key] === null && meta?.excludedValues?.[field.key]) {
      raw[field.key] = meta.excludedValues[field.key][rowIndex]
    }
  }
  return raw
}

// Every Number cell in the file that cannot be read as a number, as
// [{ rowIndex, employee, field, raw }] - shown in the import preview before
// anything is imported, and again in the summary afterwards.
export function findUnreadableValues({ rows, systemFields, mapping, meta }) {
  const identity = systemFields.filter((f) => f.kind === 'identity')
  const found = []
  projectRows(rows, systemFields, mapping).forEach((row, rowIndex) => {
    const raw = rawValuesForRow(row, rowIndex, systemFields, mapping, meta)
    const who = identity
      .slice(0, 3)
      .map((f) => raw[f.key])
      .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
      .join(' ')
    for (const field of systemFields) {
      if (convertImportValue(field, raw[field.key]).unreadable) {
        found.push({ rowIndex, employee: who || `Row ${rowIndex + 1}`, field: field.name, raw: String(raw[field.key]) })
      }
    }
  })
  return found
}

// Turns mapped rows into new employee records, defaulting unmapped/missing
// values (empty string for identity fields, unticked for checkboxes, 0 for
// other input columns). Duplicate ID detection is computed live wherever
// the table is displayed (see EmployeeTable), so it stays correct even
// after rows are edited later.
export function buildImportedEmployees({ rows, systemFields, mapping, makeId, meta }) {
  const projected = projectRows(rows, systemFields, mapping)

  return projected.map((row, rowIndex) => {
    const raw = rawValuesForRow(row, rowIndex, systemFields, mapping, meta)
    const values = {}
    for (const field of systemFields) values[field.key] = convertImportValue(field, raw[field.key]).value
    return { id: makeId(), values }
  })
}