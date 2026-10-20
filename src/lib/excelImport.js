import * as XLSX from 'xlsx'
import { labelColumnsForHelper } from './categories'
import { readExcelDateCell } from './dates'

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

// A cell holding a figure, as a number or as text that reads as one
// ("18,115.00"). A header label is never one; a data row nearly always has one.
function isFigureCell(cell) {
  return isNonEmptyCell(cell) && parseNumberCell(cell).ok
}

const normalizeLabel = (value) => String(value ?? '').trim().toLowerCase()

// Real spreadsheets often have a title/banner row (e.g. a company name,
// sometimes with a month beside it) before the actual column headers,
// sometimes with a blank row in between. Within the first 20 rows:
//   1. the row with the most cells that are the name of a field this company
//      can import into is the header row (the earliest, on a tie);
//   2. if no row names any field, it is the fullest row (the earliest, on a
//      tie) before the first row holding a figure: banners and headers are
//      labels, data rows hold figures;
//   3. failing that, the first row with at least 2 filled cells, as before.
//
// NOTE: this is only used for genuinely external files. A system export's
// own category-group row (e.g. "Identifiers" | "General") would otherwise be
// a candidate - system exports use the known fixed row index instead (see
// SYSTEM_EXPORT_HEADER_ROW_INDEX above).
function findHeaderRowIndex(rows, knownNames = []) {
  const scanned = rows.slice(0, 20).map((row) => row ?? [])
  const known = new Set(knownNames.map(normalizeLabel))

  let best = -1
  let bestMatches = 0
  scanned.forEach((row, i) => {
    const matches = row.filter((cell) => isNonEmptyCell(cell) && known.has(normalizeLabel(cell))).length
    if (matches > bestMatches) [best, bestMatches] = [i, matches]
  })
  if (best >= 0) return best

  let fullest = -1
  let fullestCount = 1
  for (let i = 0; i < scanned.length && !scanned[i].some(isFigureCell); i++) {
    const count = scanned[i].filter(isNonEmptyCell).length
    if (count > fullestCount) [fullest, fullestCount] = [i, count]
  }
  if (fullest >= 0) return fullest

  const first = scanned.findIndex((row) => row.filter(isNonEmptyCell).length >= 2)
  return first >= 0 ? first : 0
}

// An .xlsx workbook is a ZIP file, which always starts with these 4 bytes.
// Anything else (a text or CSV file renamed .xlsx, for example) is refused
// before it is read, rather than turned into a one-column sheet.
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]

function isZipFile(buffer) {
  const bytes = ArrayBuffer.isView(buffer) ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) : new Uint8Array(buffer)
  return bytes.length >= ZIP_SIGNATURE.length && ZIP_SIGNATURE.every((byte, i) => bytes[i] === byte)
}

// Reads an uploaded .xlsx File into a header row + the remaining data rows,
// both as plain arrays (no XLSX objects survive past this point). `headers`
// is index-aligned with each row in `rows` (blank header cells get a
// generated placeholder label rather than being dropped, so column
// positions never shift out of alignment with the data).
//
// knownNames: the names of the fields the company can import into, used to
// find the header row of an external file (see findHeaderRowIndex).
// Throws for a file that is not a workbook at all.
export async function parseWorkbookFile(file, knownNames = []) {
  const buffer = await file.arrayBuffer()
  if (!isZipFile(buffer)) throw new Error('Not an .xlsx workbook: it does not start with the ZIP signature.')
  const workbook = XLSX.read(buffer, { type: 'array' })
  const meta = extractSystemMeta(workbook)
  const sheetName = workbook.SheetNames.find((n) => n !== META_SHEET_NAME) ?? workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })

  const headerRowIndex = (meta && SYSTEM_EXPORT_HEADER_ROW_INDEX[meta.version]) ?? findHeaderRowIndex(allRows, knownNames)
  const headerRow = allRows[headerRowIndex] ?? []
  const headers = headerRow.map((h, i) => {
    const label = String(h ?? '').trim()
    return label.length > 0 ? label : `Column ${i + 1}`
  })

  // A system export always ends with its own trailing totals row (see
  // excelExport.js), straight after its employee rows. Its _meta records how
  // many employee rows there are, so exactly those are read: with no
  // identity field there is no "TOTAL" label to recognise the totals row by.
  // A file written before that count was recorded is recognised as before,
  // by the literal "TOTAL" in its first cell - real employee data, never
  // that. Only for a RECOGNIZED system export (meta truthy): a genuinely
  // external file could coincidentally have an employee literally
  // named/ID'd "TOTAL", and this must never silently eat a real row from
  // one of those.
  const dataStart = headerRowIndex + 1
  const rowCount = Number.isInteger(meta?.rowCount) && meta.rowCount >= 0 ? meta.rowCount : null
  const rows = allRows
    .slice(dataStart, rowCount === null ? undefined : dataStart + rowCount)
    .filter((r) => r.some(isNonEmptyCell))
    .filter((r) => !(meta && rowCount === null && r[0] === 'TOTAL'))

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
//
// `label` is what the mapping screen shows: the name, or, when two input
// columns share a name, the name with its category, e.g.
// "Rate (Employer Contribution)" - the same label the column helper and
// "Export for PDF fill" use.
export function getImportableSystemFields(identityFields, effectiveColumns) {
  return [
    ...identityFields.map((f) => ({ key: f.key, name: f.name, label: f.name, kind: 'identity', ...(f.valueType === 'date' ? { valueType: 'date' } : {}) })),
    ...labelColumnsForHelper(effectiveColumns.filter((c) => c.type === 'input')).map((c) => ({
      key: c.key,
      name: c.name,
      label: c.helperLabel,
      kind: 'input',
      valueType: c.valueType ?? 'number',
    })),
  ]
}

// Best-effort auto-mapping: matches a system field to a file column with the
// same header text, case/whitespace-insensitively - first by its label (so
// "Rate (Employer Contribution)" finds its own column), then by its plain
// name. Each file column is given to one field at most: two fields with the
// same name are never both pointed at one column. Mapping values are column
// INDEXES (not header strings), so duplicate header names never cause
// ambiguity. `taken`: column indexes already given to other fields.
export function guessMapping(systemFields, headers, taken = new Set()) {
  const used = new Set(taken)
  const mapping = {}
  const claim = (field, text) => {
    const index = headers.findIndex((h, i) => !used.has(i) && normalizeLabel(h) === normalizeLabel(text))
    if (index < 0) return
    mapping[field.key] = index
    used.add(index)
  }
  for (const field of systemFields) if (field.label && field.label !== field.name) claim(field, field.label)
  for (const field of systemFields) if (mapping[field.key] === undefined) claim(field, field.name)
  for (const field of systemFields) mapping[field.key] ??= null
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
  if (!meta) return guessMapping(systemFields, headers)

  const byKey = {}
  for (const field of systemFields) {
    const idx = meta.columnKeys.indexOf(field.key)
    if (idx >= 0) byKey[field.key] = idx
  }
  // A guess never takes a column the metadata already gave to another field.
  const nameGuess = guessMapping(
    systemFields.filter((f) => byKey[f.key] === undefined),
    headers,
    new Set(Object.values(byKey))
  )
  const mapping = {}
  for (const field of systemFields) mapping[field.key] = byKey[field.key] ?? nameGuess[field.key]
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
//
// A Date field (an identity field or an Input column) takes an Excel date cell (a serial number such
// as 46235), "DD/MM/YYYY" text or "YYYY-MM-DD" text, and stores "YYYY-MM-DD". Anything else is left
// blank and reported, like a Number cell, never guessed.
export function convertImportValue(field, raw) {
  if (field.valueType === 'date') {
    const read = readExcelDateCell(raw)
    return read.unreadable ? { value: '', unreadable: true } : { value: read.value, unreadable: false }
  }
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
        found.push({
          rowIndex,
          employee: who || `Row ${rowIndex + 1}`,
          field: field.label ?? field.name,
          raw: String(raw[field.key]),
          ...(field.valueType === 'date' ? { date: true } : {}),
        })
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
    for (const field of systemFields) {
      const converted = convertImportValue(field, raw[field.key])
      // A date that cannot be read is not imported at all: an employee already in the month keeps the
      // date saved for them (see planMonthImport).
      if (converted.unreadable && field.valueType === 'date') continue
      values[field.key] = converted.value
    }
    return { id: makeId(), values }
  })
}

const isFilled = (value) => value !== undefined && value !== null && String(value).trim() !== ''

// The first filled cell of a file row says "TOTAL" (any capitals): a totals line, never a person.
function isTotalsRow(fileRow) {
  const first = (fileRow ?? []).find(isFilled)
  return first !== undefined && String(first).trim().toUpperCase() === 'TOTAL'
}

// How a person is named in the import summary: their first two identity fields, e.g. "E2E001 Test Employee One".
export function describeEmployee(values, identityFields) {
  return identityFields
    .slice(0, 2)
    .map((f) => values?.[f.key])
    .filter(isFilled)
    .map((v) => String(v).trim())
    .join(' ')
}

// "Import from Excel" into a month that may already hold employees (rehearsal fix F2). Works out,
// without changing anything:
//   - updates: people already in the month, matched by the ID field (`idFieldKey`), whose MAPPED
//     fields take the file's values (unmapped fields keep the month's values);
//   - additions: people with an ID the month does not have;
//   - removals: people of the month whose ID is not in the file (removed only if the user ticks it);
//   - skipped: file rows never imported - a totals line ("TOTAL" as first filled cell), a row with
//     no ID, or a second row with an ID used earlier in the file;
//   - notUpdated: IDs that are in the month twice already, so it is not clear which to update.
// Without an ID field nobody can be matched: every row is an addition (totals lines still skipped).
// Row numbers are the file rows' positions among the rows read (1 = first row under the headers).
export function planMonthImport({ rows, systemFields, mapping, meta, existing, idFieldKey, identityFields, makeId }) {
  const projected = projectRows(rows, systemFields, mapping)
  const imported = buildImportedEmployees({ rows, systemFields, mapping, makeId, meta })
  const mappedKeys = systemFields
    .filter((f) => (mapping[f.key] !== null && mapping[f.key] !== undefined) || meta?.excludedValues?.[f.key])
    .map((f) => f.key)
  const idOf = (values) => (idFieldKey && isFilled(values?.[idFieldKey]) ? String(values[idFieldKey]).trim() : '')
  const name = (values) => describeEmployee(values, identityFields)

  const monthById = new Map()
  for (const employee of existing) {
    const id = idOf(employee.values)
    if (id) monthById.set(id, [...(monthById.get(id) ?? []), employee])
  }

  const plan = { updates: [], additions: [], removals: [], skipped: [], notUpdated: [], mappedKeys }
  const seenInFile = new Map()
  imported.forEach((employee, rowIndex) => {
    const row = rowIndex + 1
    if (isTotalsRow(rows[rowIndex])) return plan.skipped.push({ row, reason: 'total', label: 'TOTAL' })
    if (!idFieldKey) return plan.additions.push({ row, employee, label: name(employee.values) || `Row ${row}` })
    const id = idOf(projected[rowIndex])
    if (!id) return plan.skipped.push({ row, reason: 'no-id', label: name(employee.values) || `Row ${row}` })
    if (seenInFile.has(id)) return plan.skipped.push({ row, reason: 'repeated', label: name(employee.values), firstRow: seenInFile.get(id) })
    seenInFile.set(id, row)
    const matches = monthById.get(id) ?? []
    if (matches.length === 0) return plan.additions.push({ row, employee, label: name(employee.values) })
    if (matches.length > 1) return plan.notUpdated.push({ row, id, label: name(matches[0].values), copies: matches.length })
    const patch = Object.fromEntries(mappedKeys.filter((key) => key in employee.values).map((key) => [key, employee.values[key]]))
    plan.updates.push({ row, employeeId: matches[0].id, patch, label: name(matches[0].values) })
  })
  if (idFieldKey) {
    for (const employee of existing) {
      const id = idOf(employee.values)
      if (!id || !seenInFile.has(id)) plan.removals.push({ employeeId: employee.id, label: name(employee.values) || 'an employee with no ID' })
    }
  }
  return plan
}

// Applies a plan from planMonthImport to the month's employees: updates in place (same people, same
// order), the removals only when `removeMissing`, the additions at the end.
export function applyMonthImport(existing, plan, { removeMissing = false } = {}) {
  const patches = new Map(plan.updates.map((u) => [u.employeeId, u.patch]))
  const removed = new Set(removeMissing ? plan.removals.map((r) => r.employeeId) : [])
  return [
    ...existing
      .filter((e) => !removed.has(e.id))
      .map((e) => (patches.has(e.id) ? { ...e, values: { ...e.values, ...patches.get(e.id) } } : e)),
    ...plan.additions.map((a) => a.employee),
  ]
}