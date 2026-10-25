// @vitest-environment jsdom

// Several companies in one Excel file (inside the dashboard, as an admin):
// the sheets and the hidden sheet, sheet names for long and duplicate company
// names, a company with no data, one month exactly like the single-company
// Values export, a range of months (12 months, months missing, a column setup
// changed within the range), dates as real dates, and the export itself against
// the stand-in dashboard (tests/helpers/fakeSetupHub.js): one question, one
// company per load, all or nothing, admins only. TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../../src/App'
import { resetDataStore } from '../../src/lib/dataStore'
import { forgetDashboardSetup, PREFS_KEY } from '../../src/lib/dashboardSetup'
import { forgetDashboardMonths } from '../../src/lib/dashboardMonths'
import { exportCompanies } from '../../src/lib/dashboardBatch'
import { isoToExcelSerial } from '../../src/lib/dates'
import { buildExportPlan, buildWorkbookBuffer } from '../../src/lib/excelExport'
import { computeGridForEmployees } from '../../src/lib/formulaEngine'
import { getColumnsByKey } from '../../src/lib/model'
import {
  buildCompaniesWorkbook,
  companyForFile,
  COMPANIES_HEADERS,
  fileNameFor,
  HIDDEN_SHEET,
  monthsBetween,
  NO_DATA,
  problemWithLoad,
  readMeLines,
  sheetNamesFor,
} from '../../src/lib/severalCompanies'
import { createFakeSetupHub, installFakeBridge } from '../helpers/fakeSetupHub'
import { company, globalColumns, identityFields, idFieldKey, octoberEmployees, octoberGrid, septemberEmployees } from '../safetyNet/fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const json = (value) => JSON.parse(JSON.stringify(value))
const SHARED_ID = '30000000-0000-4000-8000-000000000001'
const OTHER_SHARED_ID = '30000000-0000-4000-8000-000000000002'
const sharedBody = json({ identityFields, idFieldKey, globalColumns })
const companyBody = json({ columns: company.columns, customFields: company.details.customFields })

const savedMonth = (period, employees, revisions = {}) => ({
  period,
  revision: 1,
  shared_revision: 3,
  company_revision: 2,
  ...revisions,
  employee_count: employees.length,
  employees,
})

// One company as the dashboard's `load` answers it.
function loadRow({ brn, name, address = null, months, shared = sharedBody, own = companyBody, setupId = SHARED_ID, from = '2026-10', to = from }) {
  return {
    brn,
    name,
    address,
    from,
    to,
    setup: { shared_setup_id: setupId, shared_name: 'Shared column setup', shared_body: shared, shared_revision: 3, company_body: own, company_revision: 2 },
    months: months ?? [savedMonth('2026-10', octoberEmployees)],
  }
}
const october = (row) => companyForFile(row, '2026-10', '2026-10')

async function readBook(buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  return wb
}
const rowValues = (ws, row) => {
  const values = ws.getRow(row).values
  return Array.isArray(values) ? values.slice(1) : []
}
// What a hidden-sheet row holds, its long text put back together.
function hiddenRow(ws, row) {
  const cells = rowValues(ws, row)
  return { sheet: cells[0], brn: cells[1], months: cells[2], data: JSON.parse(cells.slice(3).join('')) }
}
// The single-company Values export of one month, as its sheet reads back.
async function singleSheet(employees, { shared = sharedBody, own = companyBody } = {}) {
  const effectiveColumns = [...shared.globalColumns, ...own.columns]
  const grid = computeGridForEmployees(employees, effectiveColumns, getColumnsByKey(effectiveColumns))
  const plan = buildExportPlan({
    title: company.name,
    companyId: company.id,
    companyDetails: company.details,
    kind: 'period',
    exportMode: 'values',
    employees,
    identityFields: shared.identityFields,
    effectiveColumns,
    computedGrid: grid,
  })
  return { plan, sheet: (await readBook(await buildWorkbookBuffer(plan))).getWorksheet('Payroll') }
}

describe('sheet names', () => {
  test("fit Excel's 31 characters, never repeat whatever the capitals, and keep clear of the file's own sheets", () => {
    const long = 'The Very Long Name Of A Fake Trading Company Ltd'
    expect(
      sheetNamesFor([long, long, long.toUpperCase(), 'ABC Ltd', 'abc ltd', 'Companies', 'Read me', 'A/B: Co [Test]?*', "'Quoted'", '   ', '_companies'])
    ).toEqual([
      'The Very Long Name Of A Fake Tr',
      'The Very Long Name Of A Fak (2)',
      'THE VERY LONG NAME OF A FAK (3)',
      'ABC Ltd',
      'abc ltd (2)',
      'Companies (2)',
      'Read me (2)',
      'A B Co Test',
      'Quoted',
      'Company',
      '_companies (2)',
    ])
    for (const name of sheetNamesFor([long, long, long])) expect(name.length).toBeLessThanOrEqual(31)
  })

  test('the file is named after the month, or the first and last months, and the number of companies', () => {
    expect(fileNameFor('2026-10', '2026-10', 12)).toBe('Payroll 2026-10 (12 companies).xlsx')
    expect(fileNameFor('2026-10', '2026-10', 1)).toBe('Payroll 2026-10 (1 company).xlsx')
    expect(fileNameFor('2026-07', '2027-06', 4)).toBe('Payroll 2026-07 to 2027-06 (4 companies).xlsx')
  })

  test('the months of a range, oldest first, across the end of a year', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
    expect(monthsBetween('2026-10', '2026-10')).toEqual(['2026-10'])
  })
})

describe('one month: the workbook', () => {
  const exportedAt = new Date(2026, 9, 25, 16, 5)
  const longA = 'Fake Holdings and Investments Company Ltd'
  const rows = [
    loadRow({ brn: 'C00000001', name: 'Fake Co Ltd', address: '1 Test Street\nPort Louis' }),
    loadRow({ brn: 'C00000002', name: 'Empty Fake Ltd', months: [] }),
    loadRow({ brn: 'C00000003', name: longA, months: [savedMonth('2026-10', octoberEmployees.slice(0, 2))] }),
    loadRow({ brn: 'C00000004', name: longA, months: [savedMonth('2026-10', octoberEmployees.slice(2, 3))], own: { columns: [], customFields: [] }, setupId: OTHER_SHARED_ID }),
  ]
  const build = () => buildCompaniesWorkbook({ from: '2026-10', to: '2026-10', exportedAt, companies: rows.map(october) })

  test('has "Read me", "Companies", one sheet per company with data, and the very hidden sheet last', async () => {
    const { buffer, sheets } = await build()
    const wb = await readBook(buffer)
    expect(wb.worksheets.map((ws) => [ws.name, ws.state])).toEqual([
      ['Read me', 'visible'],
      ['Companies', 'visible'],
      ['Fake Co Ltd', 'visible'],
      ['Fake Holdings and Investments C', 'visible'],
      ['Fake Holdings and Investmen (2)', 'visible'],
      [HIDDEN_SHEET, 'veryHidden'],
    ])
    expect(sheets).toEqual(['Fake Co Ltd', null, 'Fake Holdings and Investments C', 'Fake Holdings and Investmen (2)'])
  })

  test('"Read me" says what the file is, when it was exported, the month and how to import it back', async () => {
    const ws = (await readBook((await build()).buffer)).getWorksheet('Read me')
    const lines = readMeLines({ from: '2026-10', to: '2026-10', exportedAt, companyCount: 4 }).map(([line]) => line)
    expect(lines.map((_, i) => ws.getCell(i + 1, 1).value ?? '')).toEqual(lines)
    const all = lines.join('\n')
    expect(all).toContain('The October 2026 payroll of 4 companies')
    expect(all).toContain('Each company with data for that month has its own sheet')
    expect(all).toContain('Exported: 25 October 2026 at 16:05')
    expect(all).toContain('Month: October 2026')
    expect(all).toContain('"Several companies…"')
    expect(all).toContain('matched to a company by its BRN')
  })

  test('"Companies" lists every company chosen, with "No data for this month" and no sheet for one without', async () => {
    const ws = (await readBook((await build()).buffer)).getWorksheet('Companies')
    expect([1, 2, 3, 4, 5].map((r) => rowValues(ws, r))).toEqual([
      COMPANIES_HEADERS,
      ['Fake Co Ltd', 'Fake Co Ltd', 'C00000001', 'October 2026', 6],
      ['', 'Empty Fake Ltd', 'C00000002', 'October 2026', NO_DATA],
      ['Fake Holdings and Investments C', longA, 'C00000003', 'October 2026', 2],
      ['Fake Holdings and Investmen (2)', longA, 'C00000004', 'October 2026', 1],
    ])
  })

  test('the hidden sheet gives, for each company sheet, the BRN, the month, each column key by position, the month of every row and its column setup, with no person in the setup', async () => {
    const { buffer } = await build()
    const ws = (await readBook(buffer)).getWorksheet(HIDDEN_SHEET)
    expect(JSON.parse(ws.getCell(1, 1).value)).toEqual({
      generator: 'payroll-sys',
      kind: 'several-companies',
      version: 1,
      from: '2026-10',
      to: '2026-10',
      months: ['2026-10'],
      exportedAt: exportedAt.toISOString(),
      sheets: ['Fake Co Ltd', 'Fake Holdings and Investments C', 'Fake Holdings and Investmen (2)'],
    })
    const first = hiddenRow(ws, 2)
    const { plan } = october(rows[0])
    expect(first).toMatchObject({ sheet: 'Fake Co Ltd', brn: 'C00000001', months: '2026-10' })
    expect(first.data.monthColumn).toBe(false)
    expect(first.data.columnKeys).toEqual(plan.meta.columnKeys)
    expect(plan.columns.map((c) => c.key)).toEqual(first.data.columnKeys)
    expect(first.data.rows).toEqual([...octoberEmployees.map(() => '2026-10'), 'total'])
    expect(first.data.months).toEqual([
      { period: '2026-10', rowCount: 6, savedWith: { revision: 1, shared_revision: 3, company_revision: 2 }, excludedValues: plan.meta.excludedValues },
    ])
    expect(first.data.setup).toEqual({
      shared_setup_id: SHARED_ID,
      shared_name: 'Shared column setup',
      shared_revision: 3,
      company_revision: 2,
      shared: sharedBody,
      company: companyBody,
    })
    expect(JSON.stringify(first.data.setup)).not.toMatch(/F00[1-6]|Testeur|18115/)
    expect(hiddenRow(ws, 4)).toMatchObject({ sheet: 'Fake Holdings and Investmen (2)', brn: 'C00000004', data: { setup: { shared_setup_id: OTHER_SHARED_ID } } })
    // The company without data has no row.
    expect(ws.rowCount).toBe(4)
  })

  test("each company's sheet is today's single-company Values export, under a header of its name, BRN and month", async () => {
    const sheet = (await readBook((await build()).buffer)).getWorksheet('Fake Co Ltd')
    const { plan: single, sheet: alone } = await singleSheet(octoberEmployees)
    expect(sheet.getCell(1, 1).value).toBe('Fake Co Ltd')
    expect(sheet.getCell(2, 1).value).toBe('BRN: C00000001   •   October 2026')
    expect(alone.rowCount).toBe(5 + 1 + octoberEmployees.length + 1)
    expect(sheet.rowCount).toBe(alone.rowCount)
    for (let r = 5; r <= alone.rowCount; r++) {
      expect(rowValues(sheet, r), `row ${r}`).toEqual(rowValues(alone, r))
      for (let c = 1; c <= single.columns.length; c++) {
        expect(sheet.getCell(r, c).numFmt, `row ${r}, column ${c}`).toBe(alone.getCell(r, c).numFmt)
      }
    }
    expect(sheet.getCell(5 + 1 + octoberEmployees.length + 1, 1).value).toBe('TOTAL')
    // The same figures as the safety net's October.
    expect(octoberGrid['emp-oct-1'].netPay.value).toBeCloseTo(sheet.getCell(7, single.columns.findIndex((c) => c.key === 'netPay') + 1).value, 9)
  })

  test('a Date field is a real Excel date, shown DD/MM/YYYY', async () => {
    const dated = json({ ...sharedBody, identityFields: [...identityFields, { id: 'idf-date', name: 'Date of Employment', key: 'dateOfEmployment', valueType: 'date' }] })
    const employees = [{ id: 'e1', values: { id: 'F001', surname: 'Testeur', dateOfEmployment: '2026-08-01' } }]
    const { buffer } = await buildCompaniesWorkbook({
      from: '2026-10',
      to: '2026-10',
      exportedAt,
      companies: [october(loadRow({ brn: 'C00000001', name: 'Fake Co Ltd', months: [savedMonth('2026-10', employees)], shared: dated }))],
    })
    const book = XLSX.read(new Uint8Array(buffer), { type: 'array', cellNF: true })
    expect(book.Sheets['Fake Co Ltd'].D7).toMatchObject({ t: 'n', v: 46235, z: 'dd/mm/yyyy' })
  })

  test('a column setup longer than one Excel cell holds is split over several cells and comes back whole', async () => {
    const big = json({ ...companyBody, customFields: [{ id: 'cf-long', label: 'Notes', value: 'x'.repeat(70_000) }] })
    const { buffer } = await buildCompaniesWorkbook({
      from: '2026-10',
      to: '2026-10',
      exportedAt,
      companies: [october(loadRow({ brn: 'C00000001', name: 'Fake Co Ltd', own: big }))],
    })
    const ws = (await readBook(buffer)).getWorksheet(HIDDEN_SHEET)
    for (const value of rowValues(ws, 2)) expect(String(value).length).toBeLessThanOrEqual(32_767)
    expect(rowValues(ws, 2).length).toBeGreaterThan(5)
    expect(hiddenRow(ws, 2).data.setup.company).toEqual(big)
  })
})

// ---------- a range of months ----------

const YEAR = monthsBetween('2026-07', '2027-06')
// Fake months: each a few of the October employees with figures of their own, so no two months add up alike.
function monthOf(period, i) {
  return octoberEmployees.slice(0, 2 + (i % 4)).map((e) => ({
    id: `${e.id}-${period}`,
    values: { ...e.values, basicSalary: String(Number(e.values.basicSalary) + i * 100 || '') },
  }))
}

describe('a range of months: the workbook', () => {
  const exportedAt = new Date(2026, 9, 25, 16, 5)
  // Fake Co Ltd: every month but January 2027. Empty Fake Ltd: nothing. One Month Ltd: only March 2027.
  const fake = loadRow({
    brn: 'C00000001',
    name: 'Fake Co Ltd',
    from: '2026-07',
    to: '2027-06',
    months: YEAR.filter((p) => p !== '2027-01').map((p) => savedMonth(p, monthOf(p, YEAR.indexOf(p)))),
  })
  const empty = loadRow({ brn: 'C00000002', name: 'Empty Fake Ltd', from: '2026-07', to: '2027-06', months: [] })
  const one = loadRow({ brn: 'C00000003', name: 'One Month Ltd', from: '2026-07', to: '2027-06', months: [savedMonth('2027-03', septemberEmployees)] })
  const companies = () => [fake, empty, one].map((row) => companyForFile(row, '2026-07', '2027-06'))
  const build = () => buildCompaniesWorkbook({ from: '2026-07', to: '2027-06', exportedAt, companies: companies() })

  test('twelve months: a sheet for each company with data, none for the one without', async () => {
    const wb = await readBook((await build()).buffer)
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Read me', 'Companies', 'Fake Co Ltd', 'One Month Ltd', HIDDEN_SHEET])
  })

  test('"Companies": one row per company, its employees in each month, "No data" where a month is missing', async () => {
    const ws = (await readBook((await build()).buffer)).getWorksheet('Companies')
    expect(rowValues(ws, 1)).toEqual([
      'Sheet',
      'Company',
      'BRN',
      'July 2026',
      'August 2026',
      'September 2026',
      'October 2026',
      'November 2026',
      'December 2026',
      'January 2027',
      'February 2027',
      'March 2027',
      'April 2027',
      'May 2027',
      'June 2027',
    ])
    expect(rowValues(ws, 2)).toEqual(['Fake Co Ltd', 'Fake Co Ltd', 'C00000001', 2, 3, 4, 5, 2, 3, 'No data', 5, 2, 3, 4, 5])
    expect(rowValues(ws, 3)).toEqual(['', 'Empty Fake Ltd', 'C00000002', ...YEAR.map(() => 'No data')])
    expect(rowValues(ws, 4)).toEqual(['One Month Ltd', 'One Month Ltd', 'C00000003', ...YEAR.map((p) => (p === '2027-03' ? septemberEmployees.length : 'No data'))])
  })

  test('the months one after another, a "Month" column first, a subtotal after each month and a TOTAL at the end, each month as its single-month file', async () => {
    const sheet = (await readBook((await build()).buffer)).getWorksheet('Fake Co Ltd')
    expect(sheet.getCell(2, 1).value).toBe('BRN: C00000001   •   July 2026 to June 2027')
    const { plan: single } = await singleSheet(monthOf('2026-07', 0))
    expect(sheet.getCell(5, 1).value).toBe('Month')
    expect(rowValues(sheet, 6)).toEqual(['Month', ...single.columns.map((c) => (c.kind === 'formula' ? `${c.name} (calc)` : c.name))])

    let r = 7
    const numberColumns = single.columns.map((c, i) => [c, i]).filter(([c]) => c.kind !== 'identity' && !['text', 'date', 'checkbox'].includes(c.valueType))
    const grand = new Map(numberColumns.map(([, i]) => [i, 0]))
    for (const period of YEAR.filter((p) => p !== '2027-01')) {
      const { sheet: alone } = await singleSheet(monthOf(period, YEAR.indexOf(period)))
      const people = monthOf(period, YEAR.indexOf(period)).length
      for (let k = 0; k < people; k++, r++) {
        // A real date, the first of the month, shown as its month.
        expect(sheet.getCell(r, 1).value, `row ${r}`).toEqual(new Date(`${period}-01T00:00:00.000Z`))
        expect(sheet.getCell(r, 1).numFmt).toBe('mmmm yyyy')
        expect(rowValues(sheet, r).slice(1), `row ${r}`).toEqual(rowValues(alone, 7 + k))
        for (const [, i] of numberColumns) grand.set(i, grand.get(i) + (Number(sheet.getCell(r, i + 2).value) || 0))
      }
      // The subtotal: the month's own TOTAL row, under "Subtotal <month>".
      const label = new Date(`${period}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      expect(sheet.getCell(r, 1).value).toBe(`Subtotal ${label}`)
      expect(sheet.getCell(r, 1).font?.bold).toBe(true)
      expect(rowValues(sheet, r).slice(2)).toEqual(rowValues(alone, 7 + people).slice(1))
      r++
    }
    expect(sheet.getCell(r, 1).value).toBe('TOTAL')
    for (const [, i] of numberColumns) expect(sheet.getCell(r, i + 2).value, `TOTAL, column ${i + 2}`).toBeCloseTo(grand.get(i), 6)
    expect(sheet.rowCount).toBe(r)
  })

  test('the hidden sheet: the range, every month of it, the month of every row and each month saved', async () => {
    const ws = (await readBook((await build()).buffer)).getWorksheet(HIDDEN_SHEET)
    expect(JSON.parse(ws.getCell(1, 1).value)).toMatchObject({ from: '2026-07', to: '2027-06', months: YEAR, sheets: ['Fake Co Ltd', 'One Month Ltd'] })
    const row = hiddenRow(ws, 2)
    expect(row).toMatchObject({ sheet: 'Fake Co Ltd', brn: 'C00000001', months: '2026-07 to 2027-06' })
    expect(row.data.monthColumn).toBe(true)
    const expectedRows = YEAR.filter((p) => p !== '2027-01').flatMap((p) => [...monthOf(p, YEAR.indexOf(p)).map(() => p), `subtotal ${p}`])
    expect(row.data.rows).toEqual([...expectedRows, 'total'])
    expect(row.data.months.map((m) => [m.period, m.rowCount])).toEqual(YEAR.filter((p) => p !== '2027-01').map((p) => [p, monthOf(p, YEAR.indexOf(p)).length]))
    expect(hiddenRow(ws, 3).data.months.map((m) => m.period)).toEqual(['2027-03'])
  })

  test('a column setup changed within the range: every month is worked out with the setup as it is now; the hidden sheet says what each month was saved with', async () => {
    // The months up to December were saved with revision 1 of the shared setup, from January with
    // revision 2; today (revision 3) a "Bonus" Input column has been added to the Global columns.
    const bonus = { id: 'col-bonus', name: 'Bonus', key: 'bonus', type: 'input', category: 'general', decimals: 2 }
    const today = json({ ...sharedBody, globalColumns: [...globalColumns, bonus] })
    const row = loadRow({
      brn: 'C00000001',
      name: 'Fake Co Ltd',
      from: '2026-11',
      to: '2027-02',
      shared: today,
      months: ['2026-11', '2026-12', '2027-01', '2027-02'].map((p, i) =>
        savedMonth(p, monthOf(p, i), { shared_revision: p < '2027-01' ? 1 : 2, company_revision: 2 })
      ),
    })
    const file = companyForFile(row, '2026-11', '2027-02')
    expect(file.months.map((m) => m.savedWith.shared_revision)).toEqual([1, 1, 2, 2])
    expect(file.setup.shared_revision).toBe(3)
    // The Bonus column is on every month's rows, November's too.
    expect(file.plan.columns.map((c) => c.key)).toContain('bonus')
    const { buffer } = await buildCompaniesWorkbook({ from: '2026-11', to: '2027-02', exportedAt, companies: [file] })
    const wb = await readBook(buffer)
    const hidden = hiddenRow(wb.getWorksheet(HIDDEN_SHEET), 2).data
    expect(hidden.months.map((m) => m.savedWith)).toEqual([
      { revision: 1, shared_revision: 1, company_revision: 2 },
      { revision: 1, shared_revision: 1, company_revision: 2 },
      { revision: 1, shared_revision: 2, company_revision: 2 },
      { revision: 1, shared_revision: 2, company_revision: 2 },
    ])
    expect(hidden.setup).toMatchObject({ shared_revision: 3, shared: today })
    // November, worked out with today's setup, is today's single-month file of November.
    const { sheet: alone } = await singleSheet(monthOf('2026-11', 0), { shared: today })
    expect(rowValues(wb.getWorksheet('Fake Co Ltd'), 7).slice(1)).toEqual(rowValues(alone, 7))
  })

  test('the dashboard must answer only months of the range, each once', () => {
    expect(problemWithLoad(fake, '2026-07', '2027-06')).toBeNull()
    expect(problemWithLoad(fake, '2026-08', '2027-06')).toBe('its months are not readable')
    expect(problemWithLoad({ ...fake, months: [...fake.months, fake.months[0]] }, '2026-07', '2027-06')).toBe('its months are not readable')
    expect(problemWithLoad({ ...empty, setup: null }, '2026-07', '2027-06')).toBeNull()
  })

  test('"Read me" for a range says so', () => {
    const all = readMeLines({ from: '2026-07', to: '2027-06', exportedAt, companyCount: 3 })
      .map(([line]) => line)
      .join('\n')
    expect(all).toContain('The July 2026 to June 2027 payroll of 3 companies')
    expect(all).toContain('a subtotal after each month and a TOTAL row for all of them')
    expect(all).toContain("worked out with the company's column setup as it is now")
    expect(all).toContain('Months: July 2026 to June 2027')
  })
})

// ---------- against the stand-in dashboard ----------

const A = { brn: 'C00000001', name: 'Fake Co Ltd', address: '1 Test Street\nPort Louis', role: 'admin' }
const B = { brn: 'C00000002', name: 'Empty Fake Ltd', address: null, role: 'admin' }
const C = { brn: 'C00000003', name: 'Viewer Fake Ltd', address: null, role: 'member' }

function hubSeed(more = {}) {
  return {
    companies: [A, B, C],
    selectedBrn: A.brn,
    shared: [{ id: SHARED_ID, name: 'Shared column setup', body: sharedBody, revision: 1 }],
    setups: {
      [A.brn]: { shared_setup_id: SHARED_ID, body: companyBody, revision: 1 },
      [B.brn]: { shared_setup_id: SHARED_ID, body: { columns: [], customFields: [] }, revision: 1 },
      [C.brn]: { shared_setup_id: SHARED_ID, body: { columns: [], customFields: [] }, revision: 1 },
    },
    monthsSupported: true,
    months: {
      [`${A.brn}|2026-09`]: { employees: septemberEmployees },
      [`${A.brn}|2026-10`]: { employees: octoberEmployees },
      [`${C.brn}|2026-10`]: { employees: octoberEmployees },
    },
    ...more,
  }
}
const batchLog = (hub) => hub.state.log.filter((m) => m.dataType === 'payroll-batch')
const OCTOBER = { from: '2026-10', to: '2026-10' }

describe('the export, against the dashboard', () => {
  let hub
  beforeEach(() => {
    hub = createFakeSetupHub(hubSeed())
    installFakeBridge(hub)
  })

  test('asks the dashboard once, naming the month and every company, then reads one company at a time', async () => {
    const progress = []
    const result = await exportCompanies(OCTOBER, [A, B], (p) => progress.push(p))
    expect(result).toMatchObject({ ok: true, fileName: 'Payroll 2026-10 (2 companies).xlsx', sheets: ['Fake Co Ltd', null] })
    expect(hub.state.batchAsked).toEqual([{ from: '2026-10', to: '2026-10', companies: [A.brn, B.brn] }])
    expect(batchLog(hub).map((m) => [m.action, m.company_brn ?? null])).toEqual([
      ['ask', null],
      ['load', A.brn],
      ['load', B.brn],
    ])
    expect(progress.map((p) => p.step)).toEqual(['asking', 'reading', 'reading', 'writing'])
    expect(result.companies.map((c) => c.status)).toEqual(['sheet', 'no-data'])
  })

  test('a range: one question for the range, one load per company with all its months', async () => {
    const result = await exportCompanies({ from: '2026-07', to: '2027-06' }, [A, B])
    expect(result).toMatchObject({ ok: true, fileName: 'Payroll 2026-07 to 2027-06 (2 companies).xlsx' })
    expect(hub.state.batchAsked).toEqual([{ from: '2026-07', to: '2027-06', companies: [A.brn, B.brn] }])
    expect(batchLog(hub).filter((m) => m.action === 'load')).toHaveLength(2)
    expect(result.companies[0].months.map((m) => m.period)).toEqual(['2026-09', '2026-10'])
  })

  test('nothing is read when the question is turned down', async () => {
    hub.state.batchAnswer = 'deny'
    expect(await exportCompanies(OCTOBER, [A, B])).toMatchObject({ ok: false, code: 'denied' })
    expect(batchLog(hub).map((m) => m.action)).toEqual(['ask'])
  })

  test('a company where the user is not an admin is refused by the dashboard, even when the app is bypassed', async () => {
    expect(await exportCompanies(OCTOBER, [A, C])).toMatchObject({ ok: false, code: 'forbidden' })
    expect(batchLog(hub).map((m) => m.action)).toEqual(['ask'])
    // Asked for directly, without the question: not allowed, nothing read.
    const direct = await hub.handle('request-data', { dataType: 'payroll-batch', params: { action: 'load', ...OCTOBER, company_brn: C.brn } })
    expect(direct).toMatchObject({ ok: false, code: 'denied' })
  })

  test('if one company cannot be read, no file is made', async () => {
    let loads = 0
    const handle = hub.handle
    hub.handle = async (type, payload) => {
      if (payload.dataType === 'payroll-batch' && payload.params?.action === 'load' && ++loads === 2) {
        return { ok: false, code: 'unavailable', error: "Can't reach the database." }
      }
      return handle(type, payload)
    }
    installFakeBridge(hub)
    const result = await exportCompanies(OCTOBER, [A, B])
    expect(result).toEqual({ ok: false, code: 'unavailable', error: "Empty Fake Ltd could not be read: Can't reach the database. Nothing was exported." })
    expect(result.buffer).toBeUndefined()
  })

  test('the dashboard locked and not unlocked: nothing is read', async () => {
    hub.state.unlocked = false
    hub.state.unlockAnswer = 'deny'
    expect(await exportCompanies(OCTOBER, [A])).toMatchObject({ ok: false, code: 'locked' })
  })
})

// ---------- the screen ----------

let root
let container
const text = () => document.body.textContent.replace(/\s+/g, ' ')
const all = (selector) => [...document.querySelectorAll(selector)]
const button = (label) => all('button').find((b) => b.textContent.trim() === label)
const dialog = () => document.querySelector('[role="dialog"]')
const monthInput = (label) => all('[role="dialog"] label').find((l) => l.textContent.trim().startsWith(label))?.querySelector('input')

async function click(target) {
  expect(target, 'the control').toBeTruthy()
  await act(async () => target.click())
}

async function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function catchDownloads() {
  const files = []
  const names = []
  URL.createObjectURL = vi.fn((blob) => {
    files.push(blob)
    return 'blob:fake'
  })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    names.push(this.download)
  })
  return { files, names }
}

async function startInDashboard(seed) {
  localStorage.clear()
  localStorage.setItem(PREFS_KEY, JSON.stringify({ [A.brn]: { columnWidths: {}, viewYear: 2026, viewMonth: 10 } }))
  const hub = createFakeSetupHub(seed)
  installFakeBridge(hub)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<App />))
  await vi.waitFor(() => expect(text()).toMatch(/kept in the dashboard\./))
  return hub
}

describe('"Several companies…" inside the dashboard', () => {
  afterEach(async () => {
    await act(async () => root?.unmount())
    container?.remove()
    forgetDashboardSetup()
    forgetDashboardMonths()
    resetDataStore()
    vi.restoreAllMocks()
  })

  test('lists only the companies where the user is an admin, and downloads one file for those chosen', async () => {
    const hub = await startInDashboard(hubSeed())
    const downloads = catchDownloads()
    await click(button('Several companies…'))
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('Companies where you are an admin'))
    const listed = all('[role="dialog"] li').map((li) => li.textContent.replace(/\s+/g, ' ').trim())
    expect(listed).toEqual(['Fake Co Ltd · BRN C00000001 · selected in the dashboard', 'Empty Fake Ltd · BRN C00000002'])
    expect(monthInput('From').value).toBe('2026-10')
    expect(monthInput('To').value).toBe('2026-10')
    // The button, not the tab of the same name.
    expect(all('button:not([role="tab"])').find((b) => b.textContent.trim() === 'Export').disabled).toBe(true)

    await click(button('Select all'))
    expect(dialog().textContent).toContain('2 of 2 chosen')
    await click(button('Clear'))
    expect(dialog().textContent).toContain('0 of 2 chosen')
    await click(button('Select all'))
    await click(button('Export 2 companies'))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Downloaded Payroll 2026-10 (2 companies).xlsx: October 2026, 1 company with a sheet.'))
    expect(dialog().textContent).toContain('Fake Co Ltd · sheet "Fake Co Ltd", 6 employees')
    expect(dialog().textContent).toContain('Empty Fake Ltd · No data for this month: no sheet')
    expect(downloads.names).toEqual(['Payroll 2026-10 (2 companies).xlsx'])
    expect(hub.state.batchAsked).toEqual([{ from: '2026-10', to: '2026-10', companies: [A.brn, B.brn] }])
    const wb = await readBook(await downloads.files[0].arrayBuffer())
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Read me', 'Companies', 'Fake Co Ltd', HIDDEN_SHEET])
  })

  test('a range: From and To, checked before anything is asked, and the months each company has', async () => {
    const hub = await startInDashboard(hubSeed())
    const downloads = catchDownloads()
    await click(button('Several companies…'))
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('Companies where you are an admin'))
    await click(button('Select all'))
    await type(monthInput('To'), '2026-08')
    expect(dialog().textContent).toContain('"To" is before "From".')
    expect(button('Export 2 companies').disabled).toBe(true)
    await type(monthInput('From'), '2024-01')
    await type(monthInput('To'), '2026-01')
    expect(dialog().textContent).toContain('At most 24 months at a time.')
    expect(button('Export 2 companies').disabled).toBe(true)
    await type(monthInput('From'), '2026-07')
    await type(monthInput('To'), '2027-06')
    expect(dialog().textContent).toContain('12 months')
    expect(dialog().textContent).toContain('naming the months and the companies. A company with no data in those months is listed in the file, without a sheet.')
    // Moving "From" past "To" moves "To" with it.
    await type(monthInput('From'), '2027-08')
    expect(monthInput('To').value).toBe('2027-08')
    await type(monthInput('From'), '2026-07')
    await type(monthInput('To'), '2027-06')
    expect(hub.state.batchAsked).toEqual([])

    await click(button('Export 2 companies'))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Downloaded Payroll 2026-07 to 2027-06 (2 companies).xlsx: July 2026 to June 2027, 1 company with a sheet.'))
    expect(dialog().textContent).toContain(
      'Fake Co Ltd · sheet "Fake Co Ltd", 2 of 12 months (no data: July 2026, August 2026, November 2026, December 2026, January 2027, February 2027, March 2027, April 2027, May 2027, June 2027)'
    )
    expect(dialog().textContent).toContain('Empty Fake Ltd · No data in these months: no sheet')
    expect(downloads.names).toEqual(['Payroll 2026-07 to 2027-06 (2 companies).xlsx'])
    expect(hub.state.batchAsked).toEqual([{ from: '2026-07', to: '2027-06', companies: [A.brn, B.brn] }])
  })

  test('is not offered to a member of the selected company, nor by a dashboard that does not keep the months', async () => {
    await startInDashboard(hubSeed({ companies: [{ ...A, role: 'member' }, B] }))
    expect(button('Several companies…')).toBeUndefined()
    await act(async () => root.unmount())
    container.remove()
    forgetDashboardSetup()
    forgetDashboardMonths()
    resetDataStore()
    await startInDashboard(hubSeed({ monthsSupported: false }))
    expect(button('Several companies…')).toBeUndefined()
  })

  test('says so when the dashboard cannot export several companies yet', async () => {
    await startInDashboard(hubSeed({ batchSupported: false }))
    await click(button('Several companies…'))
    await vi.waitFor(() => expect(dialog()?.textContent).toContain('This dashboard cannot export several companies yet.'))
  })
})

// The month cell holds the first of the month as an Excel date.
test('a month is written as the Excel date of its first day', () => {
  expect(isoToExcelSerial('2026-07-01')).toBe(46204)
})
