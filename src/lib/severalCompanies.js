// Several companies in one Excel file (inside the Payroll Hub dashboard, as an
// admin): one month of each company chosen, read from the dashboard one company
// at a time (dashboardBatch.js), worked out with that company's own column
// setup exactly as the Employee Table works it out, and written as:
//
//   "Read me"      what the file is, when it was exported, the month, how to import it back
//   "Companies"    one row per company chosen: its sheet, name, BRN, month, employees,
//                  or "No data for this month" (and no sheet)
//   one sheet per company with data, named after it (Excel's 31 characters, unique):
//                  the same table as the single-company Values export (writePlanSheet),
//                  under a header of the company's name, BRN and month
//   "_companies"   very hidden: for each company sheet its BRN, month, column keys by
//                  position, row count, the values of the columns left out of the export,
//                  and the company's column setup (columns and formulas; no people, no
//                  figures). An import reads this, never the headings.
//
// Nothing here talks to the dashboard or touches the browser's storage.

import ExcelJS from 'exceljs'
import { buildExportPlan, writePlanSheet } from './excelExport'
import { findErrorCells } from './exportErrors'
import { computeGridForEmployees } from './formulaEngine'
import { getColumnsByKey, getEffectiveColumns } from './model'
import { formatPeriodLabel, monthName, parsePeriodKey } from './periods'
import { normaliseBrn } from './hubWire'

export const README_SHEET = 'Read me'
export const COMPANIES_SHEET = 'Companies'
export const HIDDEN_SHEET = '_companies'
export const FILE_KIND = 'several-companies'
export const FILE_VERSION = 1
const GENERATOR = 'payroll-sys'
// Excel's own limits: a sheet name of 31 characters, a cell of 32,767.
const SHEET_NAME_MAX = 31
const CHUNK = 30_000
// Names Excel keeps for itself, and this file's own sheets (compared without capitals).
const RESERVED = [README_SHEET, COMPANIES_SHEET, HIDDEN_SHEET, 'History'].map((name) => name.toLowerCase())

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

const monthLabelOf = (period) => {
  const { year, month } = parsePeriodKey(period)
  return formatPeriodLabel(year, month)
}

// "25 October 2026 at 16:05", in this computer's time.
export function formatExportedAt(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getDate()} ${monthName(date.getMonth() + 1)} ${date.getFullYear()} at ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// "Payroll 2026-10 (12 companies).xlsx"
export function fileNameFor(period, count) {
  return `Payroll ${period} (${count} ${count === 1 ? 'company' : 'companies'}).xlsx`
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

// What the dashboard sent for one company must be usable as it is: nothing is
// filled in or guessed. Returns what is wrong, or null.
export function problemWithLoad(row) {
  if (!isObject(row) || typeof row.brn !== 'string' || typeof row.name !== 'string') return 'the company is not readable'
  if (row.month === null) return null
  const setup = row.setup
  if (!isObject(setup) || !isObject(setup.shared_body) || !isObject(setup.company_body)) return 'its column setup is not readable'
  if (!isList(setup.shared_body.identityFields) || !isList(setup.shared_body.globalColumns) || !isList(setup.company_body.columns)) {
    return 'its column setup is not readable'
  }
  if (!isObject(row.month) || !isList(row.month.employees)) return 'its month is not readable'
  if (row.month.employees.some((e) => !isObject(e) || typeof e.id !== 'string' || !isObject(e.values))) return 'its month is not readable'
  return null
}

// One company as it goes into the file: its sheet's export plan, worked out
// with its own column setup exactly as the Employee Table works it out, or
// "no data" when it has no month saved for that period.
//   { brn, name, status: 'sheet', plan, errors, keep } | { brn, name, status: 'no-data' }
export function companyForFile(row, period) {
  if (row.month === null) return { brn: row.brn, name: row.name, status: 'no-data' }
  const sharedBody = row.setup.shared_body
  const companyBody = row.setup.company_body
  const identityFields = sharedBody.identityFields
  const details = { address: row.address ?? '', brn: row.brn, customFields: companyBody.customFields ?? [] }
  const effectiveColumns = getEffectiveColumns({ columns: companyBody.columns }, sharedBody.globalColumns)
  const employees = row.month.employees
  const grid = computeGridForEmployees(employees, effectiveColumns, getColumnsByKey(effectiveColumns))
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
  // The sheet's header: the company's name (the title), then its BRN and the month.
  plan.exportDateLabel = `BRN: ${row.brn}   •   ${monthLabelOf(period)}`
  return {
    brn: row.brn,
    name: row.name,
    status: 'sheet',
    plan,
    employeeCount: employees.length,
    errors: findErrorCells(employees, plan.columns, grid, identityFields),
    // What the import needs, besides the sheet: columns and formulas only, no people or figures.
    setup: {
      shared_setup_id: row.setup.shared_setup_id,
      shared_name: row.setup.shared_name,
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
export function readMeLines({ period, exportedAt, companyCount }) {
  const month = monthLabelOf(period)
  const companies = `${companyCount} ${companyCount === 1 ? 'company' : 'companies'}`
  return [
    ['Payroll: several companies in one file', 'title'],
    [''],
    ['What this file is', 'heading'],
    [
      `The ${month} payroll of ${companies}, exported from Payroll System inside the Payroll Hub dashboard. Each company with data for that month has its own sheet, named on the "Companies" sheet, with the same table as the single-company Excel export (values): the identity fields, the columns by category and the TOTAL row.`,
    ],
    [`Exported: ${formatExportedAt(exportedAt)}`],
    [`Month: ${month}`],
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

function writeCompanies(wb, companies, sheetOf, period) {
  const ws = wb.addWorksheet(COMPANIES_SHEET)
  ws.columns = [{ width: 33 }, { width: 40 }, { width: 18 }, { width: 16 }, { width: 24 }]
  COMPANIES_HEADERS.forEach((title, i) => headerCell(ws.getCell(1, i + 1), title))
  companies.forEach((company, r) => {
    const row = r + 2
    const hasSheet = company.status === 'sheet'
    bodyCell(ws.getCell(row, 1), hasSheet ? sheetOf.get(company) : '')
    bodyCell(ws.getCell(row, 2), company.name)
    bodyCell(ws.getCell(row, 3), company.brn)
    bodyCell(ws.getCell(row, 4), monthLabelOf(period))
    bodyCell(ws.getCell(row, 5), hasSheet ? company.employeeCount : NO_DATA, hasSheet ? 'center' : 'left')
  })
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2' }]
}

// Long text over several cells of one row, each within Excel's cell limit.
function writeChunks(ws, row, firstColumn, text) {
  for (let i = 0, col = firstColumn; i < text.length || col === firstColumn; i += CHUNK, col++) {
    ws.getCell(row, col).value = text.slice(i, i + CHUNK)
  }
}

function writeHidden(wb, companies, sheetOf, { period, exportedAt }) {
  const ws = wb.addWorksheet(HIDDEN_SHEET)
  const withSheets = companies.filter((c) => c.status === 'sheet')
  ws.getCell(1, 1).value = JSON.stringify({
    generator: GENERATOR,
    kind: FILE_KIND,
    version: FILE_VERSION,
    period,
    exportedAt: exportedAt.toISOString(),
    sheets: withSheets.map((c) => sheetOf.get(c)),
  })
  withSheets.forEach((company, i) => {
    const row = i + 2
    ws.getCell(row, 1).value = sheetOf.get(company)
    ws.getCell(row, 2).value = company.brn
    ws.getCell(row, 3).value = period
    writeChunks(
      ws,
      row,
      4,
      JSON.stringify({
        name: company.name,
        address: company.plan.companyDetails?.address ?? '',
        columnKeys: company.plan.meta.columnKeys,
        rowCount: company.plan.rows.length,
        excludedValues: company.plan.meta.excludedValues,
        setup: company.setup,
      })
    )
  })
  ws.state = 'veryHidden'
}

// The workbook, as an ArrayBuffer, and the sheet each company got.
//   companies: what companyForFile gave, in the order chosen
export async function buildCompaniesWorkbook({ period, exportedAt, companies }) {
  const wb = new ExcelJS.Workbook()
  const withSheets = companies.filter((c) => c.status === 'sheet')
  const names = sheetNamesFor(withSheets.map((c) => c.name))
  const sheetOf = new Map(withSheets.map((c, i) => [c, names[i]]))

  writeReadMe(wb, { period, exportedAt, companyCount: companies.length })
  writeCompanies(wb, companies, sheetOf, period)
  for (const company of withSheets) writePlanSheet(wb, sheetOf.get(company), company.plan)
  writeHidden(wb, companies, sheetOf, { period, exportedAt })

  return { buffer: await wb.xlsx.writeBuffer(), sheets: companies.map((c) => sheetOf.get(c) ?? null) }
}
