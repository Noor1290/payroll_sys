// @vitest-environment jsdom

// The whole app inside a stand-in for the dashboard that keeps the months
// (tests/helpers/fakeSetupHub.js, the rules of its migration 0014): every
// feature of the Employee Table and Totals on months kept in the dashboard,
// the password gate locking in the middle of work, two people saving the same
// month, and every export compared with what the app produces from this
// browser, or with the safety net's recordings of it. TEST data only.

import fs from 'node:fs'
import path from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../../src/App'
import { resetDataStore } from '../../src/lib/dataStore'
import { forgetDashboardSetup, IMPORTED_KEY, PREFS_KEY } from '../../src/lib/dashboardSetup'
import { forgetDashboardMonths } from '../../src/lib/dashboardMonths'
import { createFakeSetupHub, installFakeBridge } from '../helpers/fakeSetupHub'
import { identityFields, idFieldKey, globalColumns, company, octoberEmployees, septemberEmployees } from '../safetyNet/fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SHARED_ID = '30000000-0000-4000-8000-000000000001'
const A = { brn: 'C00000001', name: 'Fake Co Ltd', address: '1 Test Street\nPort Louis', role: 'admin' }
const B = { brn: 'TEST-BRN-B', name: 'TEST Co B', address: '2 Test Street', role: 'admin' }
const OCT = 'C00000001|2026-10'
const SEP = 'C00000001|2026-09'
const STATE = { identityFields, idFieldKey, globalColumns, companies: [company], activeCompanyId: company.id }
const json = (value) => JSON.parse(JSON.stringify(value))

/** This browser after both imports: the setup and both months are in the dashboard too. */
function seedBrowser({ october = octoberEmployees, september = septemberEmployees } = {}) {
  localStorage.clear()
  localStorage.setItem('payroll_app_state_v1', JSON.stringify(STATE))
  localStorage.setItem(`payroll_period_${company.id}_2026-10`, JSON.stringify({ employees: october }))
  localStorage.setItem(`payroll_period_${company.id}_2026-09`, JSON.stringify({ employees: september }))
  localStorage.setItem(
    IMPORTED_KEY,
    JSON.stringify({
      companies: { [company.id]: { brn: A.brn, company: A.name, revision: 1 } },
      months: { [company.id]: { '2026-09': { brn: A.brn, revision: 1 }, '2026-10': { brn: A.brn, revision: 1 } } },
    })
  )
  localStorage.setItem(PREFS_KEY, JSON.stringify({ [A.brn]: { columnWidths: {}, viewYear: 2026, viewMonth: 10 } }))
}

function hubSeed({ october = octoberEmployees, september = septemberEmployees, ...more } = {}) {
  return {
    companies: [A, B],
    selectedBrn: A.brn,
    shared: [{ id: SHARED_ID, name: 'Shared column setup', body: json({ identityFields, idFieldKey, globalColumns }), revision: 1 }],
    setups: {
      C00000001: { shared_setup_id: SHARED_ID, body: json({ columns: company.columns, customFields: company.details.customFields }), revision: 1 },
      'TEST-BRN-B': { shared_setup_id: SHARED_ID, body: { columns: [], customFields: [] }, revision: 1 },
    },
    monthsSupported: true,
    months: { [OCT]: { employees: october }, [SEP]: { employees: september } },
    ...more,
  }
}

let root
let container
let hub
let sent

const text = () => container.textContent.replace(/\s+/g, ' ')
const all = (selector) => [...document.querySelectorAll(selector)]
const button = (label) => all('button').find((b) => b.textContent.trim() === label)
const dialog = () => document.querySelector('[role="dialog"]')
const rows = () => [...container.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('input'))
const cell = (rowIndex, label) => rows()[rowIndex].querySelector(`[aria-label="${label}"]`)
const monthSaves = () => hub.state.log.filter((m) => m.type === 'send-data' && m.dataType === 'payroll-month')
const storedOctober = () => hub.state.months.get(OCT)

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

async function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<App />))
}

/** The app inside the stand-in dashboard. */
async function startInDashboard(seed = hubSeed()) {
  hub = createFakeSetupHub(seed)
  sent = installFakeBridge(hub)
  await render()
  await vi.waitFor(() => expect(text()).toMatch(/Column setup and months of Fake Co Ltd, kept in the dashboard\.|Column setup of/))
}

/** The same app opened on its own, from this browser. */
async function startOnItsOwn() {
  window.PayrollHubBridge = {
    isEmbedded: () => false,
    isConnected: () => false,
    init: () => false,
    onStatus: () => () => {},
    requestData: () => Promise.resolve({ ok: false, error: 'Not embedded.' }),
    sendToDashboard: () => Promise.resolve({ ok: false, error: 'Not embedded.' }),
  }
  await render()
  await vi.waitFor(() => expect(text()).toContain('+ New Company'))
}

async function stop() {
  if (root) await act(async () => root.unmount())
  root = null
  container?.remove()
  document.body.innerHTML = ''
  resetDataStore()
  forgetDashboardSetup()
  forgetDashboardMonths()
}

/** Everything the Employee Table shows: every input as it reads, and every figure as shown. */
async function tableShown() {
  await vi.waitFor(() => expect(rows().length).toBeGreaterThan(0))
  return {
    inputs: [...container.querySelectorAll('tbody input')].map((i) => (i.type === 'checkbox' ? i.checked : i.value)),
    text: container.querySelector('table').textContent,
  }
}

// Downloads: the file is captured instead of saved.
let downloads = []
let lastBlob = null
beforeEach(() => {
  seedBrowser()
  forgetDashboardSetup()
  forgetDashboardMonths()
  downloads = []
  URL.createObjectURL = (blob) => {
    lastBlob = blob
    return 'blob:fake'
  }
  URL.revokeObjectURL = () => {}
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    downloads.push({ filename: this.download, blob: lastBlob })
  })
})
afterEach(async () => {
  await stop()
  vi.restoreAllMocks()
  delete window.PayrollHubBridge
})

describe('the months, inside the dashboard', () => {
  test('the month on screen is the dashboard\'s, shown exactly as this browser shows its own copy', async () => {
    await startOnItsOwn()
    const alone = await tableShown()
    await stop()

    // The dashboard's October differs from this browser's, to be sure which one is shown.
    seedBrowser({ october: octoberEmployees.slice(0, 2) })
    await startInDashboard()
    expect(text()).toContain('Column setup and months of Fake Co Ltd, kept in the dashboard.')
    expect(await tableShown()).toEqual(alone)
    expect(text()).toContain('Saved')
  })

  test('typing, adding and deleting an employee and Delete All are saved to the dashboard a moment later, never to this browser', async () => {
    const browserBefore = localStorage.getItem(`payroll_period_${company.id}_2026-10`)
    await startInDashboard()
    await tableShown()
    await type(cell(0, 'Basic Salary'), '19115')
    expect(text()).toContain('Saving…')
    await vi.waitFor(() => expect(storedOctober().revision).toBe(2), { timeout: 3000 })
    expect(storedOctober().employees[0].values.basicSalary).toBe('19115')

    await click(button('+ Add Employee'))
    await vi.waitFor(() => expect(storedOctober().employees).toHaveLength(octoberEmployees.length + 1), { timeout: 3000 })
    await click([...rows().at(-1).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete'))
    await click([...dialog().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete'))
    await vi.waitFor(() => expect(storedOctober().employees).toHaveLength(octoberEmployees.length), { timeout: 3000 })

    await click(button('Delete All Employees'))
    await click(button('Delete All'))
    await vi.waitFor(() => expect(storedOctober().employees).toEqual([]), { timeout: 3000 })
    expect(monthSaves().every((m) => m.action === 'save' && m.period === '2026-10')).toBe(true)
    expect(localStorage.getItem(`payroll_period_${company.id}_2026-10`)).toBe(browserBefore)
    await vi.waitFor(() => expect(text()).toContain('Saved'))
  }, 20_000)

  test('duplicate IDs are flagged, checkbox columns tick, and the breakdown view opens, as on its own', async () => {
    await startInDashboard()
    await tableShown()
    expect(container.querySelectorAll('[aria-label="Duplicate ID"]')).toHaveLength(0)
    await type(cell(1, 'ID'), 'F001')
    expect(container.querySelectorAll('[aria-label="Duplicate ID"]').length).toBeGreaterThan(0)
    const aged = cell(0, 'Age 60+')
    expect(aged.checked).toBe(false)
    await click(aged)
    await vi.waitFor(() => expect(storedOctober().employees[0].values.aged60).toBe(true), { timeout: 3000 })
    expect(storedOctober().employees[1].values.id).toBe('F001')

    const formulaCell = rows()[0].querySelector('button[title="Click to see calculation breakdown"]')
    await click(formulaCell)
    expect(dialog()).toBeTruthy()
  })

  test('someone who is not an admin of the company sees no figures, and is told why', async () => {
    await startInDashboard(hubSeed({ companies: [{ ...A, role: 'member' }, B] }))
    await vi.waitFor(() => expect(text()).toContain('Only an admin can see the employees'))
    expect(rows()).toHaveLength(0)
    expect(text()).toContain('Only an admin of Fake Co Ltd can change them or see its employees.')
    expect(monthSaves()).toEqual([])
  })
})

describe('the password gate', () => {
  test('locking mid-entry covers the table; what was typed stays, NOT saved; unlocking from the app saves it', async () => {
    await startInDashboard()
    await tableShown()
    await type(cell(0, 'Basic Salary'), '25000')
    // The dashboard locks before the save goes out, and tells the app.
    await act(async () => hub.setGate(false))
    expect(text()).toContain('Unlock the dashboard to continue')
    expect(text()).toContain('What you typed is kept on this screen, NOT saved yet')
    expect(container.querySelector('table')).toBeNull()
    await vi.waitFor(() => expect(text()).toContain('NOT saved'), { timeout: 3000 })
    expect(monthSaves()).toEqual([])
    expect(storedOctober().revision).toBe(1)
    // The export and month tools are not there to use while covered.
    expect(button('Export to Excel').disabled).toBe(true)

    await click(all('button').find((b) => b.textContent.trim() === 'Unlock the dashboard' && b.closest('[aria-label="Locked"]')))
    await vi.waitFor(() => expect(storedOctober().revision).toBe(2), { timeout: 3000 })
    expect(storedOctober().employees[0].values.basicSalary).toBe('25000')
    await vi.waitFor(() => expect(container.querySelector('table')).toBeTruthy())
    expect(cell(0, 'Basic Salary').value).toBe('25000.00')
    await vi.waitFor(() => expect(text()).toContain('Saved'))
  })

  test('opened while locked: nothing is shown until it is unlocked', async () => {
    await startInDashboard(hubSeed({ unlocked: false }))
    await vi.waitFor(() => expect(text()).toContain('Unlock the dashboard to continue'))
    expect(container.querySelector('table')).toBeNull()
    expect(hub.state.log.filter((m) => m.dataType === 'payroll-month').map((m) => m.action)).toEqual(['gate'])
    await act(async () => hub.setGate(true))
    await tableShown()
    expect(cell(0, 'ID').value).toBe('F001')
  })
})

describe('two people saving the same month', () => {
  test('NOT saved, with both choices; "Save mine over it" stores mine as the newest revision', async () => {
    await startInDashboard()
    await tableShown()
    hub.changeMonthElsewhere(A.brn, '2026-10', octoberEmployees.slice(0, 3))
    await type(cell(0, 'Basic Salary'), '30000')
    await vi.waitFor(() => expect(text()).toContain('October 2026 was NOT saved in the dashboard.'), { timeout: 3000 })
    expect(text()).toContain('Someone else saved October 2026 of Fake Co Ltd in the dashboard since it was opened here.')
    await click(button('Save mine over it'))
    await vi.waitFor(() => expect(storedOctober()).toMatchObject({ revision: 3, by: 'me' }))
    expect(storedOctober().employees).toHaveLength(octoberEmployees.length)
    await vi.waitFor(() => expect(text()).toContain('Saved'))
  })

  test('"Use the dashboard\'s version" puts theirs on screen', async () => {
    await startInDashboard()
    await tableShown()
    hub.changeMonthElsewhere(A.brn, '2026-10', octoberEmployees.slice(0, 3))
    await type(cell(0, 'Basic Salary'), '30000')
    await vi.waitFor(() => expect(button("Use the dashboard's version")).toBeTruthy(), { timeout: 3000 })
    await click(button("Use the dashboard's version"))
    await vi.waitFor(() => expect(rows()).toHaveLength(3))
    expect(storedOctober()).toMatchObject({ revision: 2, by: 'other' })
    expect(text()).not.toContain('NOT saved')
  })
})

// ---------- the same as this browser: imports, copies and exports ----------

const EXPECTED = path.resolve(import.meta.dirname, '../safetyNet/expected')
/** The safety net's recording of what the app produces from this browser (key order aside: a database does not keep it). */
const recorded = (name) => JSON.parse(fs.readFileSync(path.join(EXPECTED, `${name}.json`), 'utf8'))
const withNewIds = (employees, knownIds = []) => employees.map((e) => ({ id: knownIds.includes(e.id) ? e.id : '<new>', values: e.values }))

async function chooseFile(bytes, name) {
  const input = document.querySelector('input[type="file"][accept=".xlsx"]')
  const file = { name, arrayBuffer: async () => bytes }
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  await vi.waitFor(() => expect(document.body.textContent).toContain('Preview (first'))
}
async function chooseOption(select, optionText) {
  const option = [...select.options].find((o) => o.textContent.trim() === optionText)
  await act(async () => {
    select.value = option.value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
const mappingSelectFor = (fieldName) =>
  all('span[title]')
    .find((s) => s.getAttribute('title') === fieldName)
    .parentElement.querySelector('select')

describe('the same as from this browser', () => {
  test('"Import from Excel" with a manual mapping stores what the safety net recorded', async () => {
    const rowsIn = [
      ['Fake Co Ltd - payroll input (fake data)'],
      [],
      ['id', 'Surname', 'Other Names', 'Salary', 'GOVT INCREMENT', 'Full time / Part time', 'Allowances', 'Travelling', 'Age 60+', 'EDF', 'Remarks'],
      ['F101', 'Importee', 'Uno Fake', 21000, '', 'Full time', 1500.5, 800, 'No', 390000, 'first'],
      ['F102', 'Importee, Jr', 'Dos "D" Fake', '34500.75', 250, 'Part time', '', 0, 'Yes', '', ''],
      ['F103', 'Importee', 'Tres Fake', 'n/a', 'abc', '', 0, '', 'x', 130000, 'not a number'],
      [],
      ['F104', 'Importee', 'Cuatro Fake', 60000, 0, 'Full time', 2500, 1200, 'TRUE', 500000, ''],
    ]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rowsIn), 'Payroll')
    await startInDashboard(hubSeed({ october: [] }))
    await vi.waitFor(() => expect(button('+ Add Employee')).toBeTruthy())
    await click(button('Import from Excel'))
    await chooseFile(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), 'fake-external.xlsx')
    const autoMapping = Object.fromEntries(
      all('span[title]')
        .filter((s) => s.parentElement.querySelector('select'))
        .map((s) => [s.getAttribute('title'), s.parentElement.querySelector('select').selectedOptions[0].textContent.trim()])
    )
    await chooseOption(mappingSelectFor('Basic Salary'), 'Salary')
    await chooseOption(mappingSelectFor('Internal Note'), 'Remarks')
    await click(button('Import 4 rows'))
    await vi.waitFor(() => expect(storedOctober().employees).toHaveLength(4), { timeout: 3000 })
    expect({ autoMapping, employees: withNewIds(storedOctober().employees) }).toEqual(recorded('import-external-workbook'))
  })

  test('"Copy from Previous Month" stores what the safety net recorded, and leaves September as it was', async () => {
    const october = [
      { id: 'oct-1', values: { id: 'F001', surname: 'Testeur', otherNames: 'Alpha Fake', basicSalary: '99999', allowances: '1', travelling: '77', aged60: true, fullTimePartTime: 'Part time', edf: '5' } },
      { id: 'oct-2', values: { id: 'F002', surname: 'Exemple, Jr', otherNames: 'Beta "B" Fake', basicSalary: '', allowances: '', travelling: '', aged60: false, fullTimePartTime: '', edf: '' } },
      { id: 'oct-9', values: { id: 'F009', surname: 'Stayer', otherNames: 'Iota Fake', basicSalary: '12345.67', allowances: '10', travelling: '20', aged60: false, fullTimePartTime: 'Full time', edf: '30' } },
    ]
    await startInDashboard(hubSeed({ october }))
    await tableShown()
    await vi.waitFor(() => expect(button('Copy from Previous Month').disabled).toBe(false))
    await click(button('Copy from Previous Month'))
    await vi.waitFor(() => expect(document.body.textContent).toContain('Employees in September 2026'))
    const employeeBox = (label) => all('label').find((l) => l.textContent.includes(label)).querySelector('input')
    for (const label of ['F001', 'F002', 'F007']) await click(employeeBox(label))
    const columnBox = (name) => all('label').find((l) => l.textContent.trim() === name).querySelector('input')
    for (const name of ['Basic Salary', 'Govt Increment', 'Full time / Part time', 'Allowances', 'Age 60+']) await click(columnBox(name))
    await click(button('Copy 3 Employees'))
    await click(button('Overwrite'))
    await vi.waitFor(() => expect(storedOctober().employees).toHaveLength(4), { timeout: 3000 })
    expect(withNewIds(storedOctober().employees, ['oct-1', 'oct-2', 'oct-9'])).toEqual(recorded('copy-from-previous-month'))
    expect(hub.state.months.get(SEP)).toMatchObject({ revision: 1, employees: json(septemberEmployees) })
  })

  test('"Send to dashboard" sends exactly the recorded message', async () => {
    await startInDashboard()
    await tableShown()
    await click(button('Send to dashboard'))
    const message = sent.find((m) => m.type === 'send-data' && m.payload.dataType === 'payroll-result')
    expect(message.payload).toEqual(recorded('send-to-dashboard-message').message.payload)
  })

  test('Export with Values, with Live Formulas, for PDF fill (CSV and JSON), and Totals: the same files as from this browser', async () => {
    async function readBlob(blob) {
      return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.readAsArrayBuffer(blob)
      })
    }
    async function workbook(blob) {
      const book = new ExcelJS.Workbook()
      await book.xlsx.load(await readBlob(blob))
      return book.worksheets.map((sheet) => {
        const cells = []
        sheet.eachRow({ includeEmpty: true }, (row, r) =>
          row.eachCell({ includeEmpty: true }, (c, n) => cells.push([r, n, c.value, c.numFmt ?? null, c.font?.bold ?? null]))
        )
        return { name: sheet.name, state: sheet.state, cells }
      })
    }
    async function lastDownload(count) {
      await vi.waitFor(() => expect(downloads).toHaveLength(count), { timeout: 5000 })
      const { filename, blob } = downloads.at(-1)
      return { filename, type: blob.type, content: filename.endsWith('.xlsx') ? await workbook(blob) : new TextDecoder().decode(await readBlob(blob)) }
    }
    async function everyExport() {
      const files = {}
      await tableShown()
      await click(button('Export to Excel'))
      await click(button('Download .xlsx'))
      files.values = await lastDownload(1)
      await click(container.querySelector('[aria-label="More export options"]'))
      await click(all('button').find((b) => b.textContent.startsWith('Export with Live Formulas')))
      await click(button('Download .xlsx'))
      files.formulas = await lastDownload(2)
      for (const [format, n] of [
        ['CSV', 3],
        ['JSON', 4],
      ]) {
        await click(container.querySelector('[aria-label="More export options"]'))
        await click(all('button').find((b) => b.textContent.startsWith(`Export for PDF fill (${format})`)))
        await click(button(`Export ${format}`))
        files[format] = await lastDownload(n)
      }
      await click(button('Totals'))
      const [from] = container.querySelectorAll('input[type="month"]')
      await type(from, '2026-09')
      await vi.waitFor(() => expect(text()).toContain('Summing September 2026 to October 2026'))
      await vi.waitFor(() => expect(container.querySelector('table')).toBeTruthy())
      files.totalsTable = container.querySelector('table').textContent
      await click(all('button').find((b) => b.textContent.trim() === 'Export to Excel' && !b.disabled))
      await click(button('Download .xlsx'))
      files.totals = await lastDownload(5)
      return files
    }

    await startOnItsOwn()
    const alone = await everyExport()
    await stop()
    downloads = []
    // This browser's months are made different, to be sure the dashboard's are the ones exported.
    seedBrowser({ october: [], september: [] })
    await startInDashboard()
    const inside = await everyExport()
    expect(inside).toEqual(alone)
    expect(alone.values.content[0].cells.length).toBeGreaterThan(50)
    expect(alone.totalsTable).toContain('F007')
  }, 30_000)
})

// Known issue 7: in Phase 2, a key changed inside the dashboard moved the values in
// this browser's months but not in this browser's own copy of the setup, so the app
// opened on its own lost them.
describe('known issue 7: a column\'s key changed inside the dashboard', () => {
  const browserCopy = () =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((key) => key === 'payroll_app_state_v1' || key.startsWith('payroll_period_'))
        .sort()
        .map((key) => [key, localStorage.getItem(key)])
    )

  test('moves the values in the dashboard with the setup, in one step; this browser\'s copy stays whole, and opened on its own shows the same figures', async () => {
    await startOnItsOwn()
    const before = await tableShown()
    await stop()
    const copyBefore = browserCopy()

    await startInDashboard()
    await tableShown()
    await click(button('Global Columns'))
    const row = all('tr').find((tr) => tr.querySelector('td')?.parentElement === tr && [...tr.querySelectorAll('td')].some((td) => td.textContent.trim() === 'Basic Salary'))
    await click([...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit'))
    await type(dialog().querySelector('[aria-label="Key"]'), 'basicPay')
    await click([...dialog().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save'))
    expect(document.body.textContent).toContain('Its saved figures will be moved in 2 months across 1 company.')
    await click(button('Change key'))

    await vi.waitFor(() => expect(hub.state.shared.get(SHARED_ID).revision).toBe(2), { timeout: 3000 })
    for (const key of [OCT, SEP]) {
      expect(hub.state.months.get(key).revision, key).toBe(2)
      expect(hub.state.months.get(key).employees.some((e) => 'basicSalary' in e.values), key).toBe(false)
    }
    expect(hub.state.months.get(OCT).employees[0].values.basicPay).toBe('18115')
    expect(hub.state.log.filter((m) => m.type === 'send-data').map((m) => m.action)).toEqual(['key-change'])
    // Inside the dashboard, the same figures as before.
    await click(button('Employee Table'))
    expect(await tableShown()).toEqual(before)
    // This browser's own copy: not touched at all.
    expect(browserCopy()).toEqual(copyBefore)

    await stop()
    await startOnItsOwn()
    expect(await tableShown()).toEqual(before)
  }, 20_000)
})
