import * as XLSX from 'xlsx'

const META_SHEET_NAME = '_meta'
const META_GENERATOR = 'payroll-sys'
// The exact 0-indexed row where the real column headers sit in a system
// export's fixed layout (title, subtitle, blank spacer, category-group
// header, THEN column headers - see excelExport.js's COLUMN_ROW). Only
// valid for meta.version 1's layout.
const SYSTEM_EXPORT_HEADER_ROW_INDEX = { 1: 4 }

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

  const rows = allRows
    .slice(headerRowIndex + 1)
    .filter((r) => r.some(isNonEmptyCell))

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

// Turns mapped rows into new employee records, defaulting unmapped/missing
// values (empty string for identity fields, 0 for input columns). Duplicate
// ID detection is computed live wherever the table is displayed (see
// EmployeeTable), so it stays correct even after rows are edited later.
export function buildImportedEmployees({ rows, systemFields, mapping, makeId }) {
  const projected = projectRows(rows, systemFields, mapping)

  return projected.map((row) => {
    const values = {}
    for (const field of systemFields) {
      const raw = row[field.key]
      // Text-based fields (identity fields, and Input columns explicitly
      // typed as Text) import the raw value as-is - never forced through a
      // numeric parser, so non-numeric text like "Full Time" survives
      // instead of silently becoming 0.
      if (field.kind === 'identity' || field.valueType === 'text') {
        values[field.key] = raw === undefined || raw === null ? '' : String(raw)
      } else {
        values[field.key] = raw === undefined || raw === null || raw === '' ? 0 : Number(raw) || 0
      }
    }
    return { id: makeId(), values }
  })
}
