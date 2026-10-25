// @vitest-environment jsdom

// Several companies in one Excel file (inside the dashboard, as an admin):
// the sheets and the hidden sheet, sheet names for long and duplicate company
// names, a company with no data, each company's sheet exactly like the
// single-company Values export, dates as real dates, and the export itself
// against the stand-in dashboard (tests/helpers/fakeSetupHub.js): one question,
// one company per load, all or nothing, admins only. TEST data only.

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
import { buildExportPlan, buildWorkbookBuffer } from '../../src/lib/excelExport'
import {
  buildCompaniesWorkbook,
  companyForFile,
  COMPANIES_HEADERS,
  fileNameFor,
  HIDDEN_SHEET,
  NO_DATA,
  readMeLines,
  sheetNamesFor,
} from '../../src/lib/severalCompanies'
import { createFakeSetupHub, installFakeBridge } from '../helpers/fakeSetupHub'
import { company, globalColumns, identityFields, idFieldKey, octoberEmployees, octoberGrid } from '../safetyNet/fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const json = (value) => JSON.parse(JSON.stringify(value))
const SHARED_ID = '30000000-0000-4000-8000-000000000001'
const OTHER_SHARED_ID = '30000000-0000-4000-8000-000000000002'
const sharedBody = json({ identityFields, idFieldKey, globalColumns })
const companyBody = json({ columns: company.columns, customFields: company.details.customFields })

// One company as the dashboard's `load` answers it.
function loadRow({ brn, name, address = null, employees = octoberEmployees, shared = sharedBody, own = companyBody, setupId = SHARED_ID }) {
  return {
    brn,
    name,
    address,
    period: '2026-10',
    setup: { shared_setup_id: setupId, shared_name: 'Shared column setup', shared_body: shared, shared_revision: 3, company_body: own, company_revision: 2 },
    month: employees === null ? null : { revision: 1, shared_revision: 3, company_revision: 2, employee_count: employees.length, employees },
  }
}
const noMonth = (brn, name) => ({ ...loadRow({ brn, name }), month: null })

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
  return { sheet: cells[0], brn: cells[1], period: cells[2], data: JSON.parse(cells.slice(3).join('')) }
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

  test('the file is named after the month and the number of companies', () => {
    expect(fileNameFor('2026-10', 12)).toBe('Payroll 2026-10 (12 companies).xlsx')
    expect(fileNameFor('2026-10', 1)).toBe('Payroll 2026-10 (1 company).xlsx')
  })
})

describe('the workbook', () => {
  const exportedAt = new Date(2026, 9, 25, 16, 5)
  const longA = 'Fake Holdings and Investments Company Ltd'
  const rows = [
    loadRow({ brn: 'C00000001', name: 'Fake Co Ltd', address: '1 Test Street\nPort Louis' }),
    noMonth('C00000002', 'Empty Fake Ltd'),
    loadRow({ brn: 'C00000003', name: longA, employees: octoberEmployees.slice(0, 2) }),
    loadRow({ brn: 'C00000004', name: longA, employees: octoberEmployees.slice(2, 3), shared: sharedBody, own: { columns: [], customFields: [] }, setupId: OTHER_SHARED_ID }),
  ]
  const build = () => buildCompaniesWorkbook({ period: '2026-10', exportedAt, companies: rows.map((row) => companyForFile(row, '2026-10')) })

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
    const lines = readMeLines({ period: '2026-10', exportedAt, companyCount: 4 }).map(([line]) => line)
    expect(lines.map((_, i) => ws.getCell(i + 1, 1).value ?? '')).toEqual(lines)
    const all = lines.join('\n')
    expect(all).toContain('The October 2026 payroll of 4 companies')
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

  test('the hidden sheet gives, for each company sheet, the BRN, the month, each column key by position and its column setup, with no person in the setup', async () => {
    const { buffer } = await build()
    const ws = (await readBook(buffer)).getWorksheet(HIDDEN_SHEET)
    const head = JSON.parse(ws.getCell(1, 1).value)
    expect(head).toEqual({
      generator: 'payroll-sys',
      kind: 'several-companies',
      version: 1,
      period: '2026-10',
      exportedAt: exportedAt.toISOString(),
      sheets: ['Fake Co Ltd', 'Fake Holdings and Investments C', 'Fake Holdings and Investmen (2)'],
    })
    const first = hiddenRow(ws, 2)
    const plan = companyForFile(rows[0], '2026-10').plan
    expect(first).toMatchObject({ sheet: 'Fake Co Ltd', brn: 'C00000001', period: '2026-10' })
    expect(first.data.columnKeys).toEqual(plan.meta.columnKeys)
    expect(first.data.rowCount).toBe(6)
    expect(first.data.setup).toEqual({
      shared_setup_id: SHARED_ID,
      shared_name: 'Shared column setup',
      shared: sharedBody,
      company: companyBody,
    })
    expect(JSON.stringify(first.data.setup)).not.toMatch(/F00[1-6]|Testeur|18115/)
    // The company sheet's columns, in order, are exactly those keys.
    expect(plan.columns.map((c) => c.key)).toEqual(first.data.columnKeys)
    expect(hiddenRow(ws, 4)).toMatchObject({ sheet: 'Fake Holdings and Investmen (2)', brn: 'C00000004', data: { setup: { shared_setup_id: OTHER_SHARED_ID } } })
    // The company without data has no row.
    expect(ws.rowCount).toBe(4)
  })

  test("each company's sheet is today's single-company Values export, under a header of its name, BRN and month", async () => {
    const { buffer } = await build()
    const sheet = (await readBook(buffer)).getWorksheet('Fake Co Ltd')
    const single = buildExportPlan({
      title: company.name,
      companyId: company.id,
      companyDetails: company.details,
      kind: 'period',
      exportMode: 'values',
      employees: octoberEmployees,
      identityFields,
      effectiveColumns: [...globalColumns, ...company.columns],
      computedGrid: octoberGrid,
    })
    const alone = (await readBook(await buildWorkbookBuffer(single))).getWorksheet('Payroll')
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
    // The TOTAL row is there, after the employees.
    expect(sheet.getCell(5 + 1 + octoberEmployees.length + 1, 1).value).toBe('TOTAL')
  })

  test('a Date field is a real Excel date, shown DD/MM/YYYY', async () => {
    const dated = json({ ...sharedBody, identityFields: [...identityFields, { id: 'idf-date', name: 'Date of Employment', key: 'dateOfEmployment', valueType: 'date' }] })
    const employees = [{ id: 'e1', values: { id: 'F001', surname: 'Testeur', dateOfEmployment: '2026-08-01' } }]
    const { buffer } = await buildCompaniesWorkbook({
      period: '2026-10',
      exportedAt,
      companies: [companyForFile(loadRow({ brn: 'C00000001', name: 'Fake Co Ltd', employees, shared: dated }), '2026-10')],
    })
    const book = XLSX.read(new Uint8Array(buffer), { type: 'array', cellNF: true })
    const cell = book.Sheets['Fake Co Ltd'].D7
    expect(cell).toMatchObject({ t: 'n', v: 46235, z: 'dd/mm/yyyy' })
  })

  test('a column setup longer than one Excel cell holds is split over several cells and comes back whole', async () => {
    const big = json({ ...companyBody, customFields: [{ id: 'cf-long', label: 'Notes', value: 'x'.repeat(70_000) }] })
    const { buffer } = await buildCompaniesWorkbook({
      period: '2026-10',
      exportedAt,
      companies: [companyForFile(loadRow({ brn: 'C00000001', name: 'Fake Co Ltd', own: big }), '2026-10')],
    })
    const ws = (await readBook(buffer)).getWorksheet(HIDDEN_SHEET)
    for (const value of rowValues(ws, 2)) expect(String(value).length).toBeLessThanOrEqual(32_767)
    expect(rowValues(ws, 2).length).toBeGreaterThan(5)
    expect(hiddenRow(ws, 2).data.setup.company).toEqual(big)
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
    months: { [`${A.brn}|2026-10`]: { employees: octoberEmployees }, [`${C.brn}|2026-10`]: { employees: octoberEmployees } },
    ...more,
  }
}
const batchLog = (hub) => hub.state.log.filter((m) => m.dataType === 'payroll-batch')

describe('the export, against the dashboard', () => {
  let hub
  beforeEach(() => {
    hub = createFakeSetupHub(hubSeed())
    installFakeBridge(hub)
  })

  test('asks the dashboard once, naming the month and every company, then reads one company at a time', async () => {
    const progress = []
    const result = await exportCompanies('2026-10', [A, B], (p) => progress.push(p))
    expect(result).toMatchObject({ ok: true, fileName: 'Payroll 2026-10 (2 companies).xlsx', sheets: ['Fake Co Ltd', null] })
    expect(hub.state.batchAsked).toEqual([{ period: '2026-10', companies: [A.brn, B.brn] }])
    expect(batchLog(hub).map((m) => [m.action, m.company_brn ?? null])).toEqual([
      ['ask', null],
      ['load', A.brn],
      ['load', B.brn],
    ])
    expect(progress.map((p) => p.step)).toEqual(['asking', 'reading', 'reading', 'writing'])
    expect(result.companies.map((c) => c.status)).toEqual(['sheet', 'no-data'])
  })

  test('nothing is read when the question is turned down', async () => {
    hub.state.batchAnswer = 'deny'
    expect(await exportCompanies('2026-10', [A, B])).toMatchObject({ ok: false, code: 'denied' })
    expect(batchLog(hub).map((m) => m.action)).toEqual(['ask'])
  })

  test('a company where the user is not an admin is refused by the dashboard, even when the app is bypassed', async () => {
    expect(await exportCompanies('2026-10', [A, C])).toMatchObject({ ok: false, code: 'forbidden' })
    expect(batchLog(hub).map((m) => m.action)).toEqual(['ask'])
    // Asked for directly, without the question: not allowed, nothing read.
    const direct = await hub.handle('request-data', { dataType: 'payroll-batch', params: { action: 'load', period: '2026-10', company_brn: C.brn } })
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
    const result = await exportCompanies('2026-10', [A, B])
    expect(result).toEqual({ ok: false, code: 'unavailable', error: "Empty Fake Ltd could not be read: Can't reach the database. Nothing was exported." })
    expect(result.buffer).toBeUndefined()
  })

  test('the dashboard locked and not unlocked: nothing is read', async () => {
    hub.state.unlocked = false
    hub.state.unlockAnswer = 'deny'
    expect(await exportCompanies('2026-10', [A])).toMatchObject({ ok: false, code: 'locked' })
  })
})

// ---------- the screen ----------

let root
let container
const text = () => document.body.textContent.replace(/\s+/g, ' ')
const all = (selector) => [...document.querySelectorAll(selector)]
const button = (label) => all('button').find((b) => b.textContent.trim() === label)
const dialog = () => document.querySelector('[role="dialog"]')

async function click(target) {
  expect(target, 'the control').toBeTruthy()
  await act(async () => target.click())
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
    expect(dialog().querySelector('input[type="month"]').value).toBe('2026-10')
    expect(button('Export').disabled).toBe(true)

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
    expect(hub.state.batchAsked).toEqual([{ period: '2026-10', companies: [A.brn, B.brn] }])
    const wb = await readBook(await downloads.files[0].arrayBuffer())
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Read me', 'Companies', 'Fake Co Ltd', HIDDEN_SHEET])
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
