// "Several companies…" > Import: a file made by the export (severalCompanies.js)
// read back, and what importing it would do, company by company and month by
// month. Nothing here talks to the dashboard or changes anything: reading the
// file never changes it, and the plan is only a plan until the user confirms
// it (dashboardBatch.js runs it).
//
// The file is read by what its very hidden "_companies" sheet says, never by
// the headings: each company sheet's BRN, its months, the column key at each
// position, the month of every row, the values of the columns left out of the
// export, and the company's column setup. Each sheet is matched to a company
// by its BRN, never by its name.

import * as XLSX from 'xlsx'
import { convertImportValue, getImportableSystemFields } from './excelImport'
import { isoToExcelSerial } from './dates'
import { ERROR_TEXT, isErrorCell } from './exportErrors'
import { computeGridForEmployees } from './formulaEngine'
import { asJson, normaliseBrn, sameJson } from './hubWire'
import { getColumnsByKey, getEffectiveColumns, makeId } from './model'
import { FILE_KIND, FILE_VERSION, HIDDEN_SHEET, MAX_MONTHS, monthLabelOf, monthsBetween } from './severalCompanies'

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]
// Where a company sheet's column headings and first row are (excelExport.js): rows 6 and 7.
const HEADER_ROW = 5
const FIRST_ROW = 6
const isList = Array.isArray
const isObject = (value) => value !== null && typeof value === 'object' && !isList(value)
const isPeriod = (value) => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
const isFilled = (value) => value !== undefined && value !== null && String(value).trim() !== ''

export const NOT_OURS = 'This file was not made by "Several companies…": its hidden part is missing or cannot be read. Nothing was imported.'

// ---------- reading the file ----------

// Everything the hidden sheet says about one company sheet, checked for shape.
function readHiddenRow(cells) {
  const [sheet, brn, months, ...chunks] = cells.map((c) => (c === undefined || c === null ? '' : c))
  let data = null
  try {
    data = JSON.parse(chunks.map(String).join(''))
  } catch {
    data = null
  }
  const ok =
    isObject(data) &&
    isList(data.columnKeys) &&
    data.columnKeys.every((k) => typeof k === 'string') &&
    isList(data.rows) &&
    isList(data.months) &&
    data.months.every((m) => isObject(m) && isPeriod(m.period) && Number.isInteger(m.rowCount)) &&
    isObject(data.setup) &&
    isObject(data.setup.shared) &&
    isObject(data.setup.company) &&
    isList(data.setup.shared.identityFields) &&
    isList(data.setup.shared.globalColumns) &&
    isList(data.setup.company.columns)
  return { sheet: String(sheet), brn: String(brn).trim(), months: String(months), data: ok ? data : null }
}

// The sheet's rows exactly where the export put them, as raw cells (an Excel date is its serial number).
function sheetRows(workbook, name) {
  const sheet = workbook.Sheets[name]
  if (!sheet) return null
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: true })
}

// Whether a company sheet is still the one the hidden sheet describes: the BRN in its header,
// as many columns, the same rows in the same places (a month on each row of several months, a
// subtotal after each, a TOTAL last), and nothing added under it. Returns what is wrong, or null.
function sheetProblem(rows, entry, monthColumn) {
  const { data, brn } = entry
  const header = rows[HEADER_ROW] ?? []
  const width = (monthColumn ? 1 : 0) + data.columnKeys.length
  if (!String(rows[1]?.[0] ?? '').includes(`BRN: ${brn}`)) return 'its BRN on the sheet is not the one in the hidden part of the file'
  if (header.filter(isFilled).length < width) return 'it has fewer columns than the hidden part of the file says'
  const counted = new Map()
  for (const month of data.rows) if (isPeriod(month)) counted.set(month, (counted.get(month) ?? 0) + 1)
  if (data.months.some((m) => counted.get(m.period) !== m.rowCount) || counted.size !== data.months.length) {
    return 'its rows do not match the hidden part of the file'
  }
  for (let i = 0; i < data.rows.length; i++) {
    const row = rows[FIRST_ROW + i]
    const kind = data.rows[i]
    if (!row) return 'rows were removed from it'
    if (monthColumn) {
      const first = row[0]
      if (isPeriod(kind) && first !== isoToExcelSerial(`${kind}-01`)) return 'a row is not in the month the hidden part of the file says'
      if (String(kind).startsWith('subtotal ') && !String(first).startsWith('Subtotal')) return 'its rows do not match the hidden part of the file'
      if (kind === 'total' && first !== 'TOTAL') return 'its rows do not match the hidden part of the file'
    }
  }
  if (data.rows.at(-1) !== 'total') return 'its rows do not match the hidden part of the file'
  const after = rows.slice(FIRST_ROW + data.rows.length)
  if (after.some((row) => (row ?? []).some(isFilled))) return 'rows were added under its TOTAL row'
  return null
}

// Reads a file the export made. Never changes it.
//   { ok: true, from, to, months, companies: [...] } | { ok: false, error }
//   each company: { sheet, brn, name, address, setup, columnKeys, columnNames, months: [{ period,
//     cells: [[raw, ...], ...], excludedValues }], problems: [text] }
export function readCompaniesFile(buffer) {
  const bytes = new Uint8Array(ArrayBuffer.isView(buffer) ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : buffer)
  if (bytes.length < 4 || !ZIP_SIGNATURE.every((b, i) => bytes[i] === b)) {
    return { ok: false, error: 'Could not read that file. Please make sure it is a valid .xlsx file.' }
  }
  let workbook
  try {
    workbook = XLSX.read(bytes, { type: 'array' })
  } catch {
    return { ok: false, error: 'Could not read that file. Please make sure it is a valid .xlsx file.' }
  }
  const hidden = workbook.Sheets[HIDDEN_SHEET]
  if (!hidden) return { ok: false, error: NOT_OURS }
  const lines = XLSX.utils.sheet_to_json(hidden, { header: 1, raw: true, defval: '' })
  let head = null
  try {
    head = JSON.parse(String(lines[0]?.[0] ?? ''))
  } catch {
    head = null
  }
  if (
    !isObject(head) ||
    head.kind !== FILE_KIND ||
    head.version !== FILE_VERSION ||
    !isPeriod(head.from) ||
    !isPeriod(head.to) ||
    head.from > head.to ||
    monthsBetween(head.from, head.to).length > MAX_MONTHS
  ) {
    return { ok: false, error: NOT_OURS }
  }
  const range = new Set(monthsBetween(head.from, head.to))
  const monthColumn = head.from !== head.to
  const entries = lines.slice(1).filter((cells) => (cells ?? []).some(isFilled)).map(readHiddenRow)

  // A BRN on more than one sheet: none of them can be matched to one company.
  const brnCount = new Map()
  for (const entry of entries) if (entry.brn) brnCount.set(normaliseBrn(entry.brn), (brnCount.get(normaliseBrn(entry.brn)) ?? 0) + 1)

  const companies = entries.map((entry) => {
    const problems = []
    const name = entry.data?.name ? String(entry.data.name) : entry.sheet
    const company = { sheet: entry.sheet, brn: entry.brn, name, address: entry.data?.address ?? '', setup: entry.data?.setup ?? null, problems, months: [] }
    if (!entry.brn) problems.push('It has no BRN in the file.')
    else if (brnCount.get(normaliseBrn(entry.brn)) > 1) problems.push('Its BRN is on more than one sheet of the file.')
    if (!entry.data) {
      problems.push('Its part of the hidden sheet cannot be read.')
      return company
    }
    if (entry.data.months.some((m) => !range.has(m.period)) || entry.data.monthColumn !== monthColumn) {
      problems.push('Its months are not the months of the file.')
      return company
    }
    const rows = sheetRows(workbook, entry.sheet)
    if (!rows) {
      problems.push(`Its sheet "${entry.sheet}" is not in the file.`)
      return company
    }
    const wrong = sheetProblem(rows, entry, monthColumn)
    if (wrong) {
      problems.push(`Its sheet does not match the hidden part of the file: ${wrong}.`)
      return company
    }
    const offset = monthColumn ? 1 : 0
    company.columnKeys = entry.data.columnKeys
    company.columnNames = entry.data.columnKeys.map((key, j) => String(rows[HEADER_ROW][offset + j] ?? key).replace(/ \(calc\)$/, ''))
    company.months = entry.data.months.map((m) => ({ period: m.period, cells: [], excludedValues: isObject(m.excludedValues) ? m.excludedValues : {} }))
    const byPeriod = new Map(company.months.map((m) => [m.period, m]))
    entry.data.rows.forEach((kind, i) => {
      if (!isPeriod(kind)) return
      byPeriod.get(kind).cells.push(rows[FIRST_ROW + i].slice(offset, offset + entry.data.columnKeys.length))
    })
    return company
  })
  return { ok: true, from: head.from, to: head.to, months: monthsBetween(head.from, head.to), companies }
}

// ---------- the plan ----------

const kindLabel = (column) =>
  column.kind === 'identity' ? 'an identity field' : column.type === 'formula' ? 'Formula' : `Input (${column.valueType ?? 'number'})`

// The setup's columns by key: identity fields and every column, with what kind each is.
function setupColumns(shared, company) {
  const byKey = new Map()
  for (const f of shared.identityFields) byKey.set(f.key, { ...f, kind: 'identity' })
  for (const c of [...shared.globalColumns, ...company.columns]) byKey.set(c.key, c)
  return byKey
}

const sameKind = (a, b) =>
  (a.kind === 'identity') === (b.kind === 'identity') &&
  (a.kind === 'identity' || a.type === b.type) &&
  (a.valueType ?? (a.kind === 'identity' ? 'text' : 'number')) === (b.valueType ?? (b.kind === 'identity' ? 'text' : 'number'))

// The employees of one month of the file, read for the setup they will be worked out with: the
// identity fields and the Input columns, from the sheet, or from the hidden sheet for a column
// left out of the export. Checked as "Import from Excel" checks: no empty ID, no ID twice, no
// value that cannot be read.
function readMonth(month, company, fields, idFieldKey, identityFields) {
  const column = new Map(company.columnKeys.map((key, j) => [key, j]))
  const unreadable = []
  const employees = month.cells.map((cells, r) => {
    const values = {}
    for (const field of fields) {
      const j = column.get(field.key)
      const excluded = month.excludedValues[field.key]
      if (j === undefined && !isList(excluded)) continue
      const raw = j === undefined ? excluded[r] : cells[j]
      const converted = convertImportValue(field, raw)
      if (converted.unreadable) unreadable.push({ row: r + 1, field: field.label ?? field.name, raw: String(raw) })
      else values[field.key] = converted.value
    }
    return { id: makeId(), values }
  })
  const who = (employee, r) =>
    identityFields
      .slice(0, 2)
      .map((f) => employee.values[f.key])
      .filter(isFilled)
      .join(' ') || `row ${r + 1}`
  const noId = []
  const twice = []
  if (idFieldKey) {
    const seen = new Set()
    employees.forEach((employee, r) => {
      const id = isFilled(employee.values[idFieldKey]) ? String(employee.values[idFieldKey]).trim() : ''
      if (!id) noId.push(r + 1)
      else if (seen.has(id)) twice.push(id)
      seen.add(id)
    })
  }
  return { employees, unreadable: unreadable.map((u) => ({ ...u, who: who(employees[u.row - 1], u.row - 1) })), noId, twice }
}

// The figures of the file against the figures the setup works out from the same values: the
// columns whose figures would not be the same, by name.
function differingColumns(company, month, employees, effectiveColumns) {
  const grid = computeGridForEmployees(employees, effectiveColumns, getColumnsByKey(effectiveColumns))
  const differ = new Set()
  const byKey = getColumnsByKey(effectiveColumns)
  company.columnKeys.forEach((key, j) => {
    const col = byKey[key]
    if (!col || col.type !== 'formula' || ['text', 'date', 'checkbox'].includes(col.valueType)) return
    employees.forEach((employee, r) => {
      const inFile = month.cells[r][j]
      const cell = grid[employee.id]?.[key]
      if (inFile === ERROR_TEXT || isErrorCell(cell)) {
        if ((inFile === ERROR_TEXT) !== isErrorCell(cell)) differ.add(company.columnNames[j])
        return
      }
      const worked = typeof cell?.value === 'number' && !Number.isNaN(cell.value) ? cell.value : 0
      if (typeof inFile !== 'number' || Math.abs(inFile - worked) > 1e-6 * Math.max(1, Math.abs(worked))) differ.add(company.columnNames[j])
    })
  })
  return [...differ]
}

// What importing the file would do, from what the dashboard has (the `check` answer, one row
// per BRN) and the shared setup of the company selected in the dashboard.
//   selected: { shared_setup_id, shared_body, canChange } | null (no setup yet)
// Returns { from, to, months, companies, newCompanies } where each company is:
//   { key, brn, name, sheet, status: 'new' | 'existing' | 'problem', problems, warning,
//     setupUse: 'yours' | 'new' | null, months: [{ period, action, people }],
//     dashboardName, request (what the dashboard is sent, without the months' choices) }
export function planImport(file, checkRows, selected) {
  const byBrn = new Map(checkRows.map((row) => [normaliseBrn(row.brn), row]))
  // One new shared setup for the companies of the file that shared one, made by the first of them.
  const newShared = new Map()
  const companies = file.companies.map((fileCompany, index) => {
    const entry = {
      key: `${index}:${fileCompany.brn}`,
      brn: fileCompany.brn,
      name: fileCompany.name,
      sheet: fileCompany.sheet,
      status: 'problem',
      problems: [...fileCompany.problems],
      warning: null,
      notes: [],
      setupUse: null,
      months: [],
    }
    if (entry.problems.length > 0) return entry
    const there = byBrn.get(normaliseBrn(fileCompany.brn))
    if (!there) {
      entry.problems.push('The dashboard did not answer for it.')
      return entry
    }
    if (there.status === 'member') {
      entry.dashboardName = there.name
      entry.problems.push('You are not an admin of this company in the dashboard.')
      return entry
    }
    entry.dashboardName = there.status === 'admin' ? there.name : null
    const hasSetup = there.status === 'admin' && there.setup !== null
    const shared = hasSetup ? there.setup.shared_body : fileCompany.setup.shared
    const own = hasSetup ? there.setup.company_body : fileCompany.setup.company
    if (!isList(shared?.identityFields) || !isList(shared?.globalColumns) || !isList(own?.columns)) {
      entry.problems.push('Its column setup in the dashboard cannot be read.')
      return entry
    }

    // The columns of the file must be columns of the setup, of the same kind.
    const columns = setupColumns(shared, own)
    const fileColumns = setupColumns(fileCompany.setup.shared, fileCompany.setup.company)
    const missing = []
    const otherKind = []
    fileCompany.columnKeys.forEach((key, j) => {
      const here = columns.get(key)
      const inFile = fileColumns.get(key)
      if (!here) missing.push(fileCompany.columnNames[j])
      else if (inFile && !sameKind(here, inFile)) otherKind.push(`${fileCompany.columnNames[j]} (${kindLabel(inFile)} in the file, ${kindLabel(here)} here)`)
    })
    if (missing.length > 0) entry.problems.push(`These columns of the file are not in its column setup: ${missing.join(', ')}.`)
    if (otherKind.length > 0) entry.problems.push(`These columns are of another kind in its column setup: ${otherKind.join(', ')}.`)
    if (entry.problems.length > 0) return entry

    const effectiveColumns = getEffectiveColumns({ columns: own.columns }, shared.globalColumns)
    const fields = getImportableSystemFields(shared.identityFields, effectiveColumns)
    const inFile = new Set([...fileCompany.columnKeys, ...fileCompany.months.flatMap((m) => Object.keys(m.excludedValues))])
    const leftEmpty = fields.filter((f) => !inFile.has(f.key)).map((f) => f.label ?? f.name)
    if (leftEmpty.length > 0) entry.notes.push(`Not in the file, left empty: ${leftEmpty.join(', ')}.`)

    // Each month: read and checked; then what happens to it.
    const saved = new Map((there.months ?? []).map((m) => [m.period, m]))
    const approved = new Set(there.approved ?? [])
    const differ = new Set()
    for (const month of fileCompany.months) {
      const read = readMonth(month, fileCompany, fields, shared.idFieldKey ?? null, shared.identityFields)
      const label = monthLabelOf(month.period)
      if (read.noId.length > 0) entry.problems.push(`${label}: ${read.noId.length === 1 ? `row ${read.noId[0]} has` : `rows ${read.noId.join(', ')} have`} no ID.`)
      if (read.twice.length > 0) entry.problems.push(`${label}: these IDs are on more than one row: ${[...new Set(read.twice)].join(', ')}.`)
      if (read.unreadable.length > 0) {
        const first = read.unreadable[0]
        entry.problems.push(
          `${label}: ${read.unreadable.length} ${read.unreadable.length === 1 ? 'value cannot' : 'values cannot'} be read (first: ${first.who}, ${first.field}: “${first.raw}”).`
        )
      }
      for (const name of differingColumns(fileCompany, month, read.employees, effectiveColumns)) differ.add(name)
      const existing = saved.get(month.period)
      entry.months.push({
        period: month.period,
        employees: read.employees,
        people: read.employees.length,
        action: !existing ? 'add' : approved.has(month.period) ? 'approved' : 'saved',
        existing: existing ?? null,
      })
    }
    if (entry.problems.length > 0) return entry
    if (differ.size > 0) {
      entry.warning = `With its column setup, these figures would not be the same as in the file: ${[...differ].join(', ')}.`
    }

    // Its column setup, when it has none: the selected company's when the file's is the same, or a new one.
    if (!hasSetup) {
      const fileShared = fileCompany.setup.shared
      if (selected && sameJson(selected.shared_body, fileShared)) {
        if (!selected.canChange) {
          entry.problems.push('It would use your shared setup, but only someone who is an admin of every company using it can add a company to it.')
          return entry
        }
        entry.setupUse = 'yours'
        entry.setup = { shared_setup_id: selected.shared_setup_id, create: false, company_body: asJson(fileCompany.setup.company) }
      } else {
        const groupKey = String(fileCompany.setup.shared_setup_id ?? JSON.stringify(fileShared))
        if (!newShared.has(groupKey)) newShared.set(groupKey, { id: makeId(), name: fileCompany.setup.shared_name || 'Shared column setup', body: asJson(fileShared) })
        const group = newShared.get(groupKey)
        entry.setupUse = 'new'
        entry.newShared = group
        entry.setup = { shared_setup_id: group.id, create: true, name: group.name, shared_body: group.body, company_body: asJson(fileCompany.setup.company) }
      }
    } else {
      entry.expected = { shared_revision: there.setup.shared_revision, company_revision: there.setup.company_revision }
    }
    entry.status = there.status === 'absent' ? 'new' : 'existing'
    entry.address = fileCompany.address || null
    entry.idFieldKey = shared.idFieldKey ?? null
    return entry
  })
  return {
    from: file.from,
    to: file.to,
    months: file.months,
    companies,
    newCompanies: companies.filter((c) => c.status === 'new'),
  }
}

// What the user can choose, as first offered: every company without a problem ticked except one
// whose figures would differ; every month already saved kept (not replaced); no new company added.
export function defaultImportChoices(plan) {
  return {
    add: {},
    companies: Object.fromEntries(plan.companies.map((c) => [c.key, c.status !== 'problem' && !c.warning])),
    replace: {},
  }
}

// The months of one company the dashboard is sent, as chosen. Empty when nothing is to be done.
export function monthsToSend(company, choices) {
  return company.months
    .filter((m) => m.action === 'add' || (m.action === 'saved' && choices.replace[`${company.key}|${m.period}`] === true))
    .map((m) => ({
      period: m.period,
      employees: m.employees,
      expected_revision: m.existing ? m.existing.revision : 0,
      replace: m.action === 'saved',
    }))
}

// Whether a company is imported with these choices: ticked, and, if it is new, added.
export const isChosen = (company, choices) =>
  company.status !== 'problem' && choices.companies[company.key] === true && (company.status !== 'new' || choices.add[company.key] === true)
