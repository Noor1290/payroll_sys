// Several companies in one Excel file (inside the Payroll Hub dashboard, as an
// admin): one month, or a range of months, of each company chosen, read from the
// dashboard one company at a time (dashboardBatch.js), worked out with that
// company's column setup as it is now, exactly as the Employee Table and Totals
// work out every month, and written as:
//
//   "Read me"      what the file is, when it was exported, the months, how to import it back
//   "Companies"    one row per company chosen: its sheet, name, BRN, and its employees in
//                  each month, or "No data"; a company with no data in the whole range has
//                  no sheet
//   one sheet per company with data, named after it (Excel's 31 characters, unique), under
//                  a header of the company's name, BRN and months:
//                    one month   the same table as the single-company Values export
//                    a range     a "Month" column first, the months one after another,
//                                oldest first, a subtotal after each month and a TOTAL row
//   "_companies"   very hidden: for each company sheet its BRN, the months, the column keys by
//                  position, the month of every row, the setup revisions each month was saved
//                  with, the values of the columns left out of the export, and the company's
//                  column setup (columns and formulas; no people, no figures). An import reads
//                  this, never the headings.
//
// Nothing here talks to the dashboard or touches the browser's storage.

import ExcelJS from 'exceljs'
import { buildExportPlan, writePlanSheet } from './excelExport'
import { ERROR_TEXT, findErrorCells } from './exportErrors'
import { computeGridForEmployees } from './formulaEngine'
import { getColumnsByKey, getEffectiveColumns } from './model'
import { formatPeriodLabel, monthName, parsePeriodKey, periodKey } from './periods'
import { normaliseBrn } from './hubWire'

export const README_SHEET = 'Read me'
export const COMPANIES_SHEET = 'Companies'
export const HIDDEN_SHEET = '_companies'
export const FILE_KIND = 'several-companies'
export const FILE_VERSION = 1
const GENERATOR = 'payroll-sys'
// The most months one file holds (the dashboard's own limit for one question).
export const MAX_MONTHS = 24
// Excel's own limits: a sheet name of 31 characters, a cell of 32,767.
const SHEET_NAME_MAX = 31
const CHUNK = 30_000
// Names Excel keeps for itself, and this file's own sheets (compared without capitals).
const RESERVED = [README_SHEET, COMPANIES_SHEET, HIDDEN_SHEET, 'History'].map((name) => name.toLowerCase())
// The key of the "Month" column on a sheet of several months. Not a column key the app can make.
export const MONTH_COLUMN_KEY = '#month'
const MONTH_FORMAT = 'mmmm yyyy'

const FONT_NAME = 'Book Antiqua'
const HEADER_FILL = 'FFB4C6E7'
const BORDER_COLOR = { argb: 'FF999999' }
const THIN_BORDER = {
  top: { style: 'thin', color: BORDER_COLOR },
  left: { style: 'thin', color: BORDER_COLOR },
  bottom: { style: 'thin', color: BORDER_COLOR },
  right: { style: 'thin', color: BORDER_COLOR },
}

export const NO_DATA = 'No data for this month'
export const NO_DATA_MONTH = 'No data'

export const monthLabelOf = (period) => {
  const { year, month } = parsePeriodKey(period)
  return formatPeriodLabel(year, month)
}

// "October 2026", or "July 2026 to June 2027".
export const rangeLabelOf = (from, to) => (from === to ? monthLabelOf(from) : `${monthLabelOf(from)} to ${monthLabelOf(to)}`)

// Every month from `from` to `to`, both "YYYY-MM", oldest first.
export function monthsBetween(from, to) {
  const start = parsePeriodKey(from)
  const end = parsePeriodKey(to)
  const months = []
  for (let i = start.year * 12 + start.month - 1; i <= end.year * 12 + end.month - 1; i++) {
    months.push(periodKey(Math.floor(i / 12), (i % 12) + 1))
  }
  return months
}

// "25 October 2026 at 16:05", in this computer's time.
export function formatExportedAt(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getDate()} ${monthName(date.getMonth() + 1)} ${date.getFullYear()} at ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// "Payroll 2026-10 (12 companies).xlsx", or "Payroll 2026-07 to 2027-06 (4 companies).xlsx".
export function fileNameFor(from, to, count) {
  const months = from === to ? from : `${from} to ${to}`
  return `Payroll ${months} (${count} ${count === 1 ? 'company' : 'companies'}).xlsx`
}

// A sheet name for each company, in order: what Excel accepts (no : \ / ? * [ ],
// not starting or ending with an apostrophe, 31 characters at most), never one
// of this file's own sheets, and never the same as another's, whatever the
// capitals: "ABC Ltd", "ABC Ltd (2)", ... shortened so the number still fits.
export function sheetNamesFor(names) {
  const taken = new Set(RESERVED)
  const fit = (text, room) => text.slice(0, room).trimEnd()
  return names.map((name) => {
    const clean =
      String(name ?? '')
        .replace(/[:\\/?*[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^'+|'+$/g, '')
        .trim() || 'Company'
    let candidate = fit(clean, SHEET_NAME_MAX)
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
      const suffix = ` (${n})`
      candidate = `${fit(clean, SHEET_NAME_MAX - suffix.length)}${suffix}`
    }
    taken.add(candidate.toLowerCase())
    return candidate
  })
}

const isList = Array.isArray
const isObject = (value) => value !== null && typeof value === 'object' && !isList(value)
const isPeriod = (value) => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)

// What the dashboard sent for one company must be usable as it is: nothing is
// filled in or guessed. Returns what is wrong, or null.
export function problemWithLoad(row, from, to) {
  if (!isObject(row) || typeof row.brn !== 'string' || typeof row.name !== 'string') return 'the company is not readable'
  if (!isList(row.months)) return 'its months are not readable'
  if (row.months.length === 0) return null
  const setup = row.setup
  if (!isObject(setup) || !isObject(setup.shared_body) || !isObject(setup.company_body)) return 'its column setup is not readable'
  if (!isList(setup.shared_body.identityFields) || !isList(setup.shared_body.globalColumns) || !isList(setup.company_body.columns)) {
    return 'its column setup is not readable'
  }
  const wanted = new Set(monthsBetween(from, to))
  const seen = new Set()
  for (const month of row.months) {
    if (!isObject(month) || !isPeriod(month.period) || !wanted.has(month.period) || seen.has(month.period)) return 'its months are not readable'
    seen.add(month.period)
    if (!isList(month.employees) || month.employees.some((e) => !isObject(e) || typeof e.id !== 'string' || !isObject(e.values))) {
      return `its month ${monthLabelOf(month.period)} is not readable`
    }
  }
  return null
}

const isTextColumn = (col) => col.kind === 'identity' || col.valueType === 'text' || col.valueType === 'date'

// The TOTAL row of several months: every employee row of every month added up,
// as the single-month TOTAL row adds up one month (excelExport.js).
function grandTotalRow(columns, rows) {
  return columns.map((col, i) => {
    if (col.valueType === 'checkbox') return `${rows.filter((row) => row[i] === 'Yes').length} ticked`
    if (isTextColumn(col)) return ''
    if (rows.some((row) => row[i] === ERROR_TEXT)) return ERROR_TEXT
    return rows.reduce((sum, row) => sum + (typeof row[i] === 'number' && !Number.isNaN(row[i]) ? row[i] : 0), 0)
  })
}

// Several months on one sheet: a "Month" column first; each month's rows, then
// its subtotal (its own TOTAL row); then the TOTAL of every month. The columns
// are the same for every month: one column setup works them all out.
function rangePlan(months, header) {
  const base = months[0].plan
  const monthColumn = { key: MONTH_COLUMN_KEY, name: 'Month', kind: 'month', valueType: 'date', dateFormat: MONTH_FORMAT }
  const rows = []
  const rowKinds = []
  const rowMonths = []
  const employeeRows = []
  for (const { period, plan } of months) {
    for (const row of plan.rows) {
      rows.push([`${period}-01`, ...row])
      rowKinds.push('employee')
      rowMonths.push(period)
      employeeRows.push(row)
    }
    // The month's own TOTAL row, as its subtotal; "TOTAL" in the first identity field is left out.
    const subtotal = plan.totalsRow.map((value, i) => (i === 0 && base.columns[0]?.kind === 'identity' ? '' : value))
    rows.push([`Subtotal ${monthLabelOf(period)}`, ...subtotal])
    rowKinds.push('subtotal')
    rowMonths.push(`subtotal ${period}`)
  }
  const totals = grandTotalRow(base.columns, employeeRows)
  if (base.columns[0]?.kind === 'identity') totals[0] = ''
  return {
    ...base,
    exportDateLabel: header,
    columns: [monthColumn, ...base.columns],
    groups: [{ label: 'Month', count: 1 }, ...base.groups],
    rows,
    rowKinds,
    rowMonths: [...rowMonths, 'total'],
    totalsRow: ['TOTAL', ...totals],
    hiddenColumns: [],
    hiddenRows: [],
  }
}

// One company as it goes into the file: its sheet's export plan, worked out
// with its column setup as it is now, or "no data" when no month of the range
// is saved.
//   { brn, name, status: 'sheet', plan, months, employeeCount, errors, setup }
//   | { brn, name, status: 'no-data', months: [] }
//   months: [{ period, employeeCount, errors, savedWith, excludedValues }], oldest first
export function companyForFile(row, from, to) {
  const saved = [...row.months].sort((a, b) => (a.period < b.period ? -1 : 1))
  if (saved.length === 0) return { brn: row.brn, name: row.name, status: 'no-data', months: [] }
  const sharedBody = row.setup.shared_body
  const companyBody = row.setup.company_body
  const identityFields = sharedBody.identityFields
  const details = { address: row.address ?? '', brn: row.brn, customFields: companyBody.customFields ?? [] }
  const effectiveColumns = getEffectiveColumns({ columns: companyBody.columns }, sharedBody.globalColumns)
  const columnsByKey = getColumnsByKey(effectiveColumns)
  const months = saved.map((month) => {
    const employees = month.employees
    const grid = computeGridForEmployees(employees, effectiveColumns, columnsByKey)
    const plan = buildExportPlan({
      title: row.name,
      companyId: `dashboard_${normaliseBrn(row.brn)}`,
      companyDetails: details,
      kind: 'period',
      exportMode: 'values',
      employees,
      identityFields,
      effectiveColumns,
      computedGrid: grid,
    })
    return {
      period: month.period,
      plan,
      employeeCount: employees.length,
      errors: findErrorCells(employees, plan.columns, grid, identityFields),
      savedWith: { revision: month.revision, shared_revision: month.shared_revision, company_revision: month.company_revision },
    }
  })
  // The sheet's header: the company's name (the title), then its BRN and the months.
  const header = `BRN: ${row.brn}   •   ${rangeLabelOf(from, to)}`
  const single = from === to
  const plan = single ? { ...months[0].plan, exportDateLabel: header, rowMonths: [...months[0].plan.rows.map(() => from), 'total'] } : rangePlan(months, header)
  return {
    brn: row.brn,
    name: row.name,
    status: 'sheet',
    plan,
    employeeCount: months.reduce((n, m) => n + m.employeeCount, 0),
    errors: months.flatMap((m) => m.errors.map((e) => ({ ...e, period: m.period }))),
    months: months.map(({ period, plan: monthPlan, employeeCount, errors, savedWith }) => ({
      period,
      employeeCount,
      errors,
      savedWith,
      excludedValues: monthPlan.meta.excludedValues,
    })),
    // What the import needs, besides the sheet: columns and formulas only, no people or figures.
    // Every month was worked out with this one, the setup as it is now.
    setup: {
      shared_setup_id: row.setup.shared_setup_id,
      shared_name: row.setup.shared_name,
      shared_revision: row.setup.shared_revision,
      company_revision: row.setup.company_revision,
      shared: { identityFields: sharedBody.identityFields, idFieldKey: sharedBody.idFieldKey ?? null, globalColumns: sharedBody.globalColumns },
      company: { columns: companyBody.columns, customFields: companyBody.customFields ?? [] },
    },
  }
}

function headerCell(cell, value) {
  cell.value = value
  cell.font = { name: FONT_NAME, size: 10, bold: true, color: { argb: 'FF1F2933' } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  cell.border = THIN_BORDER
}

function bodyCell(cell, value, align = 'left') {
  cell.value = value
  cell.font = { name: FONT_NAME, size: 10 }
  cell.alignment = { horizontal: align }
  cell.border = THIN_BORDER
}

// The text of the "Read me" sheet, line by line: [text, style] with style 'title' | 'heading' | undefined.
export function readMeLines({ from, to, exportedAt, companyCount }) {
  const months = rangeLabelOf(from, to)
  const companies = `${companyCount} ${companyCount === 1 ? 'company' : 'companies'}`
  const what =
    from === to
      ? `The ${months} payroll of ${companies}, exported from Payroll System inside the Payroll Hub dashboard. Each company with data for that month has its own sheet, named on the "Companies" sheet, with the same table as the single-company Excel export (values): the identity fields, the columns by category and the TOTAL row.`
      : `The ${months} payroll of ${companies}, exported from Payroll System inside the Payroll Hub dashboard. Each company with data in those months has its own sheet, named on the "Companies" sheet: its months one after another, oldest first, each row starting with its month, a subtotal after each month and a TOTAL row for all of them. The other columns are those of the single-company Excel export (values), and every month is worked out with the company's column setup as it is now.`
  return [
    ['Payroll: several companies in one file', 'title'],
    [''],
    ['What this file is', 'heading'],
    [what],
    [`Exported: ${formatExportedAt(exportedAt)}`],
    [from === to ? `Month: ${months}` : `Months: ${months}`],
    [''],
    ['How to import it back', 'heading'],
    [
      'In Payroll System, inside the Payroll Hub dashboard, as an admin: "Several companies…" at the foot of the company list, then "Import", and choose this file. Each sheet is matched to a company by its BRN, and nothing is saved before you confirm the preview.',
    ],
    [
      'Keep the sheets and their names as they are, and do not change the BRNs: the import reads what it needs from them and from a hidden part of this file, not from the headings.',
    ],
    [''],
    ['Keep it safe', 'heading'],
    ['This file holds national IDs and salaries. Keep it where the payroll itself is kept.'],
  ]
}

function writeReadMe(wb, info) {
  const ws = wb.addWorksheet(README_SHEET)
  ws.columns = [{ width: 110 }]
  readMeLines(info).forEach(([text, style], i) => {
    const cell = ws.getCell(i + 1, 1)
    cell.value = text
    cell.alignment = { wrapText: true, vertical: 'top' }
    cell.font =
      style === 'title'
        ? { name: FONT_NAME, size: 14, bold: true }
        : style === 'heading'
          ? { name: FONT_NAME, size: 11, bold: true }
          : { name: FONT_NAME, size: 10 }
  })
}

export const COMPANIES_HEADERS = ['Sheet', 'Company', 'BRN', 'Month', 'Employees']

// One month: Sheet, Company, BRN, Month, Employees (or "No data for this month").
// A range: Sheet, Company, BRN, then one column per month with its employees, or "No data".
function writeCompanies(wb, companies, sheetOf, from, to) {
  const ws = wb.addWorksheet(COMPANIES_SHEET)
  const single = from === to
  const months = monthsBetween(from, to)
  const headers = single ? COMPANIES_HEADERS : [...COMPANIES_HEADERS.slice(0, 3), ...months.map(monthLabelOf)]
  ws.columns = [{ width: 33 }, { width: 40 }, { width: 18 }, ...(single ? [{ width: 16 }, { width: 24 }] : months.map(() => ({ width: 16 })))]
  headers.forEach((title, i) => headerCell(ws.getCell(1, i + 1), title))
  companies.forEach((company, r) => {
    const row = r + 2
    const hasSheet = company.status === 'sheet'
    bodyCell(ws.getCell(row, 1), hasSheet ? sheetOf.get(company) : '')
    bodyCell(ws.getCell(row, 2), company.name)
    bodyCell(ws.getCell(row, 3), company.brn)
    if (single) {
      bodyCell(ws.getCell(row, 4), monthLabelOf(from))
      bodyCell(ws.getCell(row, 5), hasSheet ? company.employeeCount : NO_DATA, hasSheet ? 'center' : 'left')
      return
    }
    const byMonth = new Map(company.months.map((m) => [m.period, m.employeeCount]))
    months.forEach((period, i) => {
      const count = byMonth.get(period)
      bodyCell(ws.getCell(row, 4 + i), count ?? NO_DATA_MONTH, count === undefined ? 'left' : 'center')
    })
  })
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 1, topLeftCell: 'D2' }]
}

// Long text over several cells of one row, each within Excel's cell limit.
function writeChunks(ws, row, firstColumn, text) {
  for (let i = 0, col = firstColumn; i < text.length || col === firstColumn; i += CHUNK, col++) {
    ws.getCell(row, col).value = text.slice(i, i + CHUNK)
  }
}

function writeHidden(wb, companies, sheetOf, { from, to, exportedAt }) {
  const ws = wb.addWorksheet(HIDDEN_SHEET)
  const withSheets = companies.filter((c) => c.status === 'sheet')
  ws.getCell(1, 1).value = JSON.stringify({
    generator: GENERATOR,
    kind: FILE_KIND,
    version: FILE_VERSION,
    from,
    to,
    months: monthsBetween(from, to),
    exportedAt: exportedAt.toISOString(),
    sheets: withSheets.map((c) => sheetOf.get(c)),
  })
  withSheets.forEach((company, i) => {
    const row = i + 2
    ws.getCell(row, 1).value = sheetOf.get(company)
    ws.getCell(row, 2).value = company.brn
    ws.getCell(row, 3).value = from === to ? from : `${from} to ${to}`
    const columns = company.plan.columns.filter((c) => c.key !== MONTH_COLUMN_KEY)
    writeChunks(
      ws,
      row,
      4,
      JSON.stringify({
        name: company.name,
        address: company.plan.companyDetails?.address ?? '',
        // Where the columns are: after the "Month" column when there is one.
        monthColumn: from !== to,
        columnKeys: columns.map((c) => c.key),
        // The month of every row under the headings, in order: "YYYY-MM" for an employee,
        // "subtotal YYYY-MM" after each month (several months only), "total" last.
        rows: company.plan.rowMonths,
        months: company.months.map(({ period, employeeCount, savedWith, excludedValues }) => ({
          period,
          rowCount: employeeCount,
          savedWith,
          excludedValues,
        })),
        setup: company.setup,
      })
    )
  })
  ws.state = 'veryHidden'
}

// The workbook, as an ArrayBuffer, and the sheet each company got.
//   companies: what companyForFile gave, in the order chosen
export async function buildCompaniesWorkbook({ from, to, exportedAt, companies }) {
  const wb = new ExcelJS.Workbook()
  const withSheets = companies.filter((c) => c.status === 'sheet')
  const names = sheetNamesFor(withSheets.map((c) => c.name))
  const sheetOf = new Map(withSheets.map((c, i) => [c, names[i]]))

  writeReadMe(wb, { from, to, exportedAt, companyCount: companies.length })
  writeCompanies(wb, companies, sheetOf, from, to)
  for (const company of withSheets) writePlanSheet(wb, sheetOf.get(company), company.plan)
  writeHidden(wb, companies, sheetOf, { from, to, exportedAt })

  return { buffer: await wb.xlsx.writeBuffer(), sheets: companies.map((c) => sheetOf.get(c) ?? null) }
}
