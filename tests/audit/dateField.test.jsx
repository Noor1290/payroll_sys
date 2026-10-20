// @vitest-environment jsdom

// The "Date" type, for an Input column and for an identity field: typed and shown DD/MM/YYYY with
// a calendar, saved "YYYY-MM-DD", only real dates accepted; Excel date cells imported; exported as a
// real Excel date, as DD/MM/YYYY for PDF fill and as YYYY-MM-DD to the dashboard; never added up;
// never in a formula; kept by Copy from Previous Month, Back up / Restore, History and Restore and
// the dashboard's saves. Every test here fails on the code before the Date type. TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../../src/App'
import { dataStore, resetDataStore } from '../../src/lib/dataStore'
import { forgetDashboardSetup, IMPORTED_KEY, PREFS_KEY } from '../../src/lib/dashboardSetup'
import { forgetDashboardMonths } from '../../src/lib/dashboardMonths'
import { newColumn, getEffectiveColumns, getColumnsByKey } from '../../src/lib/model'
import { computeGridForEmployees } from '../../src/lib/formulaEngine'
import { readDate, excelSerialToIso, isoToExcelSerial, showDate, checkSavedDates } from '../../src/lib/dates'
import { convertImportValue, findUnreadableValues, getImportableSystemFields, parseWorkbookFile, planMonthImport } from '../../src/lib/excelImport'
import { buildExportPlan, buildWorkbookBuffer } from '../../src/lib/excelExport'
import { buildPdfFillColumns, buildPdfFillRows } from '../../src/lib/pdfFillExport'
import { computeTotals } from '../../src/lib/totals'
import { buildBackup, parseBackupText, restoreBackup } from '../../src/lib/backup'
import { createFakeSetupHub, installFakeBridge } from '../helpers/fakeSetupHub'
import { identityFields, idFieldKey, globalColumns, company, octoberEmployees, septemberEmployees } from '../safetyNet/fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// ---------- the fake setup, with a Date identity field and a Date Global column ----------

const DOE = { id: 'idf-doe', name: 'Date of Employment', key: 'dateOfEmployment', valueType: 'date' }
const JOINED = { ...newColumn({ name: 'Date joined', key: 'dateJoined', type: 'input', valueType: 'date' }), id: 'col-dateJoined' }
const IDENTITY = [...identityFields, DOE]
const GLOBAL = [...globalColumns, JOINED]
const EFFECTIVE = getEffectiveColumns(company, GLOBAL)
const BY_KEY = getColumnsByKey(EFFECTIVE)

// F001: dates saved as YYYY-MM-DD. F002: a date saved day first, as text, before the field was a
// Date. F003: something saved as text that is not a date. The rest: none.
const withDates = (employees) =>
  employees.map((e) => {
    const extra =
      e.values.id === 'F001'
        ? { dateOfEmployment: '2021-03-15', dateJoined: '2021-03-15' }
        : e.values.id === 'F002'
          ? { dateOfEmployment: '04/11/2019', dateJoined: '04/11/2019' }
          : e.values.id === 'F003'
            ? { dateOfEmployment: 'since 2018', dateJoined: '' }
            : {}
    return { ...e, values: { ...e.values, ...extra } }
  })
const OCTOBER = withDates(octoberEmployees)
// September: F001 started on another date, to tell the months apart.
const SEPTEMBER = withDates(septemberEmployees).map((e) =>
  e.values.id === 'F001' ? { ...e, values: { ...e.values, dateOfEmployment: '2020-01-02', dateJoined: '2020-01-02' } } : e
)

const json = (value) => JSON.parse(JSON.stringify(value))

// ---------- reading dates ----------

describe('reading a date', () => {
  test.each([
    ['01/08/2026', '2026-08-01'],
    ['1/8/2026', '2026-08-01'],
    ['2026-08-01', '2026-08-01'],
    ['29/02/2024', '2024-02-29'],
  ])('%s is %s', (raw, iso) => expect(readDate(raw)).toEqual({ value: iso }))

  test.each(['31/02/2026', '13/13/2020', '29/02/2026', '2026-02-30'])('%s is written like a date but is not one', (raw) =>
    expect(readDate(raw)).toEqual({ unreadable: true, wellFormed: true })
  )

  test.each(['abc', '01/08/26', '46235', 'since 2018'])('%s is not a date', (raw) => expect(readDate(raw)).toEqual({ unreadable: true, wellFormed: false }))

  test('an Excel date cell: 46235 is 01/08/2026, and back', () => {
    expect(excelSerialToIso(46235)).toBe('2026-08-01')
    expect(isoToExcelSerial('2026-08-01')).toBe(46235)
    // A time of day is dropped.
    expect(excelSerialToIso(46235.75)).toBe('2026-08-01')
    // Excel counts a 29 February 1900 that never was: day 60 is not a date, the days around it are.
    expect(excelSerialToIso(59)).toBe('1900-02-28')
    expect(excelSerialToIso(60)).toBeNull()
    expect(excelSerialToIso(61)).toBe('1900-03-01')
    for (const iso of ['1900-01-01', '1900-02-28', '1900-03-01', '2021-03-15', '2100-12-31']) expect(excelSerialToIso(isoToExcelSerial(iso))).toBe(iso)
    expect(excelSerialToIso(0)).toBeNull()
    expect(excelSerialToIso(99999999)).toBeNull()
  })

  test('what a saved value is shown as', () => {
    expect(showDate('2021-03-15')).toBe('15/03/2021')
    expect(showDate('04/11/2019')).toBe('04/11/2019')
    expect(showDate('')).toBe('')
    expect(showDate('since 2018')).toBe('since 2018')
  })
})

// ---------- Import from Excel ----------

describe('Import from Excel', () => {
  const fields = getImportableSystemFields(IDENTITY, EFFECTIVE)
  const doeField = fields.find((f) => f.key === 'dateOfEmployment')
  const joinedField = fields.find((f) => f.key === 'dateJoined')

  test.each([
    [46235, '2026-08-01'],
    ['01/08/2026', '2026-08-01'],
    ['2026-08-01', '2026-08-01'],
    ['', ''],
  ])('a Date field takes %j as %j', (raw, iso) => {
    expect(convertImportValue(doeField, raw)).toEqual({ value: iso, unreadable: false })
    expect(convertImportValue(joinedField, raw)).toEqual({ value: iso, unreadable: false })
  })

  test.each(['31/02/2026', '13/13/2020', 'abc', 99999999])('a Date field does not import %j', (raw) => {
    expect(convertImportValue(doeField, raw)).toEqual({ value: '', unreadable: true })
  })

  test('a real Excel date cell, "DD/MM/YYYY" and "YYYY-MM-DD" text are imported; anything else is listed and not imported', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sheet1')
    ws.addRow(['ID', 'Surname', 'Date of Employment', 'Date joined'])
    ws.addRow(['F001', 'Testeur', new Date(Date.UTC(2026, 7, 1)), '15/03/2021'])
    ws.addRow(['F002', 'Exemple, Jr', '2019-11-04', '31/02/2026'])
    ws.addRow(['F003', 'Specimen', 'abc', ''])
    ws.getCell('C2').numFmt = 'dd/mm/yyyy'
    const buffer = await wb.xlsx.writeBuffer()
    const parsed = await parseWorkbookFile({ arrayBuffer: async () => buffer }, fields.map((f) => f.name))
    // The Excel date cell arrives as its serial number.
    expect(parsed.rows[0][2]).toBe(46235)

    const mapping = Object.fromEntries(fields.map((f) => [f.key, parsed.headers.indexOf(f.name) >= 0 ? parsed.headers.indexOf(f.name) : null]))
    const unreadable = findUnreadableValues({ rows: parsed.rows, systemFields: fields, mapping, meta: null })
    expect(unreadable.map(({ employee, field, raw, date }) => ({ employee, field, raw, date }))).toEqual([
      { employee: 'F002 Exemple, Jr', field: 'Date joined', raw: '31/02/2026', date: true },
      { employee: 'F003 Specimen', field: 'Date of Employment', raw: 'abc', date: true },
    ])

    let n = 0
    const plan = planMonthImport({
      rows: parsed.rows,
      systemFields: fields,
      mapping,
      meta: null,
      existing: OCTOBER,
      idFieldKey,
      identityFields: IDENTITY,
      makeId: () => `new-${++n}`,
    })
    const patchOf = (id) => plan.updates.find((u) => u.employeeId === OCTOBER.find((e) => e.values.id === id).id).patch
    expect(patchOf('F001')).toMatchObject({ dateOfEmployment: '2026-08-01', dateJoined: '2021-03-15' })
    expect(patchOf('F002').dateOfEmployment).toBe('2019-11-04')
    // Not imported: the date already saved is kept.
    expect('dateJoined' in patchOf('F002')).toBe(false)
    expect('dateOfEmployment' in patchOf('F003')).toBe(false)
  })
})

// ---------- worked out, exported, added up ----------

describe('exports and Totals', () => {
  const grid = computeGridForEmployees(OCTOBER, EFFECTIVE, BY_KEY)

  test('the grid holds a Date column as YYYY-MM-DD, also when it was saved day first', () => {
    const f2 = OCTOBER.find((e) => e.values.id === 'F002')
    expect(grid[f2.id].dateJoined.value).toBe('2019-11-04')
    expect(grid[OCTOBER[0].id].dateJoined.value).toBe('2021-03-15')
  })

  test.each(['values', 'formulas'])('Excel (%s): a real Excel date shown DD/MM/YYYY; never in the totals row', async (exportMode) => {
    const plan = buildExportPlan({
      kind: 'period',
      companyId: company.id,
      title: company.name,
      companyDetails: company.details,
      exportMode,
      identityFields: IDENTITY,
      employees: OCTOBER,
      effectiveColumns: EFFECTIVE,
      computedGrid: grid,
    })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await buildWorkbookBuffer(plan))
    const ws = wb.getWorksheet('Payroll')
    const header = ws.getRow(6).values
    const at = (name, row) => ws.getCell(7 + row, header.indexOf(name))

    for (const name of ['Date of Employment', 'Date joined']) {
      const cell = at(name, 0)
      expect(cell.numFmt).toBe('dd/mm/yyyy')
      expect(cell.value).toBeInstanceOf(Date)
      expect(cell.value.toISOString().slice(0, 10)).toBe('2021-03-15')
      expect(at(name, 1).value.toISOString().slice(0, 10)).toBe('2019-11-04')
      // The totals row: nothing added up.
      expect(ws.getCell(7 + OCTOBER.length, header.indexOf(name)).value).toBe('')
    }
    // Saved text that is not a date is written as it is.
    expect(at('Date of Employment', 2).value).toBe('since 2018')
  })

  test('PDF fill writes DD/MM/YYYY; "Send to dashboard" writes YYYY-MM-DD', () => {
    const columns = buildPdfFillColumns(IDENTITY, EFFECTIVE)
    const rows = buildPdfFillRows(columns, OCTOBER, grid)
    expect(rows.slice(0, 4).map((r) => [r['Date of Employment'], r['Date joined']])).toEqual([
      ['15/03/2021', '15/03/2021'],
      ['04/11/2019', '04/11/2019'],
      ['since 2018', ''],
      ['', ''],
    ])
    const sent = buildPdfFillRows(columns, OCTOBER, grid, [], { isoDates: true })
    expect(sent.slice(0, 2).map((r) => [r['Date of Employment'], r['Date joined']])).toEqual([
      ['2021-03-15', '2021-03-15'],
      ['2019-11-04', '2019-11-04'],
    ])
  })

  test('Totals: a date is never added up; it is the first month\'s, like a text column', () => {
    const totals = computeTotals(
      [
        { year: 2026, month: 9, employees: SEPTEMBER },
        { year: 2026, month: 10, employees: OCTOBER },
      ],
      EFFECTIVE,
      BY_KEY,
      idFieldKey
    )
    expect(totals.computedGrid['id:F001'].dateJoined.value).toBe('2020-01-02')
    expect(totals.computedGrid['id:F002'].dateJoined.value).toBe('2019-11-04')
  })
})

// ---------- the app ----------

let root
let container
let hub
let sent

const text = () => document.body.textContent.replace(/\s+/g, ' ')
const all = (selector, within = document) => [...within.querySelectorAll(selector)]
const button = (label, within = document) => all('button', within).find((b) => b.textContent.trim() === label)
const startingWith = (label, within = document) => all('button', within).find((b) => b.textContent.trim().startsWith(label))
const dialog = () => document.querySelector('[role="dialog"]')
const rows = () => [...container.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('input'))
const cell = (rowIndex, label) => rows()[rowIndex].querySelector(`[aria-label="${label}"]`)
const refusals = () => document.querySelector('[data-testid="refused-dates"]')?.textContent.replace(/\s+/g, ' ') ?? ''

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

// What a user does in a Date cell: goes in, types, and leaves.
async function typeDate(input, value) {
  await act(async () => input.focus())
  await type(input, value)
  await act(async () => input.blur())
}

async function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<App />))
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

const STATE_KEY = 'payroll_app_state_v1'
const OCT_KEY = `payroll_period_${company.id}_2026-10`
const SEP_KEY = `payroll_period_${company.id}_2026-09`
const storedOctoberHere = () => JSON.parse(localStorage.getItem(OCT_KEY)).employees

function seedBrowser({ identity = IDENTITY, global = GLOBAL } = {}) {
  localStorage.clear()
  localStorage.setItem(STATE_KEY, JSON.stringify({ identityFields: identity, idFieldKey, globalColumns: global, companies: [company], activeCompanyId: company.id }))
  localStorage.setItem(OCT_KEY, JSON.stringify({ employees: OCTOBER }))
  localStorage.setItem(SEP_KEY, JSON.stringify({ employees: SEPTEMBER }))
}

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
  await vi.waitFor(() => expect(rows().length).toBeGreaterThan(0))
}

beforeEach(() => {
  seedBrowser()
  forgetDashboardSetup()
  forgetDashboardMonths()
  hub = null
})
afterEach(async () => {
  await stop()
  vi.restoreAllMocks()
  delete window.PayrollHubBridge
})

describe('the Employee Table', () => {
  test('a Date cell shows DD/MM/YYYY, with a calendar; typing a date saves it as YYYY-MM-DD', async () => {
    await startOnItsOwn()
    expect(cell(0, 'Date of Employment').value).toBe('15/03/2021')
    expect(cell(0, 'Date joined').value).toBe('15/03/2021')
    // Saved day first, as text: read as the date it is.
    expect(cell(1, 'Date joined').value).toBe('04/11/2019')
    expect(cell(0, 'Pick a date: Date of Employment')).toBeTruthy()
    expect(cell(0, 'Pick a date: Date joined')).toBeTruthy()

    await typeDate(cell(3, 'Date of Employment'), '1/8/2026')
    await typeDate(cell(3, 'Date joined'), '2026-08-01')
    await vi.waitFor(() => expect(storedOctoberHere()[3].values).toMatchObject({ dateOfEmployment: '2026-08-01', dateJoined: '2026-08-01' }))
    expect(cell(3, 'Date of Employment').value).toBe('01/08/2026')
    expect(cell(3, 'Date joined').value).toBe('01/08/2026')
    expect(refusals()).toBe('')
  })

  test('the calendar saves the date picked', async () => {
    await startOnItsOwn()
    const picker = rows()[4].querySelectorAll('input[data-date-picker]')[0]
    await type(picker, '2024-02-29')
    await vi.waitFor(() => expect(storedOctoberHere()[4].values.dateOfEmployment).toBe('2024-02-29'))
    expect(cell(4, 'Date of Employment').value).toBe('29/02/2024')
  })

  test.each([
    ['31/02/2026', '"31/02/2026" is not a real date. Type it as DD/MM/YYYY, for example 01/08/2026.'],
    ['13/13/2020', '"13/13/2020" is not a real date. Type it as DD/MM/YYYY, for example 01/08/2026.'],
    ['abc', '"abc" is not a date. Type it as DD/MM/YYYY, for example 01/08/2026.'],
  ])('%s is refused in the cell, with why; nothing is saved', async (typed, why) => {
    await startOnItsOwn()
    const before = localStorage.getItem(OCT_KEY)
    await typeDate(cell(0, 'Date of Employment'), typed)
    expect(refusals()).toBe(`Row 1, Date of Employment — not saved: ${why}`)
    const input = cell(0, 'Date of Employment')
    expect(input.value).toBe(typed)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(localStorage.getItem(OCT_KEY)).toBe(before)

    // Corrected: saved, and no longer listed.
    await typeDate(cell(0, 'Date of Employment'), '15/04/2021')
    await vi.waitFor(() => expect(storedOctoberHere()[0].values.dateOfEmployment).toBe('2021-04-15'))
    expect(refusals()).toBe('')
  })

  test('Esc puts back what is saved', async () => {
    await startOnItsOwn()
    const input = cell(0, 'Date of Employment')
    await typeDate(input, '31/02/2026')
    await act(async () => input.focus())
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(refusals()).toBe('')
    expect(cell(0, 'Date of Employment').value).toBe('15/03/2021')
  })

  test('something saved before the field was a Date, that is not a date, is shown as it was and kept', async () => {
    await startOnItsOwn()
    const input = cell(2, 'Date of Employment')
    expect(input.value).toBe('since 2018')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    // Going in and out changes nothing.
    await act(async () => input.focus())
    await act(async () => input.blur())
    expect(refusals()).toBe('')
    expect(storedOctoberHere()[2].values.dateOfEmployment).toBe('since 2018')
  })
})

describe('the forms', () => {
  async function openGlobalColumns() {
    await click(button('Global Columns'))
    await vi.waitFor(() => expect(text()).toContain('Identity Fields'))
  }

  test('an identity field can be a Date; a Date identity field is saved with its type, and back to text without', async () => {
    seedBrowser({ identity: identityFields })
    await startOnItsOwn()
    await openGlobalColumns()
    await click(button('+ Add Identity Field'))
    await type(dialog().querySelector('[aria-label="Name"]'), 'Date of Employment')
    await click(button('Date', dialog()))
    expect(dialog().textContent).toContain('Typed and shown as DD/MM/YYYY, with a calendar to pick from. Only real dates are accepted.')
    await click(button('Save', dialog()))
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem(STATE_KEY)).identityFields.at(-1)).toMatchObject({ name: 'Date of Employment', key: 'dateOfEmployment', valueType: 'date' }))

    const rowOf = all('tr').find((tr) => tr.textContent.includes('Date of Employment') && tr.textContent.includes('dateOfEmployment'))
    await click(button('Edit', rowOf))
    await click(button('Text', dialog()))
    await click(button('Save', dialog()))
    await vi.waitFor(() => expect('valueType' in JSON.parse(localStorage.getItem(STATE_KEY)).identityFields.at(-1)).toBe(false))
  })

  test('the ID field is always text', async () => {
    await startOnItsOwn()
    await openGlobalColumns()
    const idRow = all('tr').find((tr) => tr.textContent.includes('ID field ✓'))
    await click(button('Edit', idRow))
    expect(button('Date', dialog()).disabled).toBe(true)
    expect(dialog().textContent).toContain('The ID field is always text.')
  })

  test('an Input column can be a Date', async () => {
    await startOnItsOwn()
    await openGlobalColumns()
    await click(startingWith('+ Add Column'))
    await type(dialog().querySelector('[aria-label="Name"]'), 'Date left')
    await click(button('Date', dialog()))
    // A date has no decimal places.
    expect(dialog().querySelector('[aria-label="Decimal places"]')).toBeNull()
    await click(button('Save', dialog()))
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem(STATE_KEY)).globalColumns.at(-1)).toMatchObject({ name: 'Date left', type: 'input', valueType: 'date' }))
    expect(JSON.parse(localStorage.getItem(STATE_KEY)).globalColumns.at(-1).decimals).toBeUndefined()
  })

  test('a formula that uses a Date column is refused, and says why', async () => {
    await startOnItsOwn()
    await openGlobalColumns()
    await click(startingWith('+ Add Column'))
    await type(dialog().querySelector('[aria-label="Name"]'), 'Years')
    await click(button('Formula', dialog()))
    // A Date column is not offered to click into a formula.
    expect(all('button', dialog()).some((b) => b.textContent.includes('→ dateJoined'))).toBe(false)
    await type(dialog().querySelector('[aria-label="Formula expression"]'), 'basicSalary + dateJoined')
    await click(button('Save', dialog()))
    expect(dialog().textContent).toContain(
      'A date can\'t be used in a formula\'s arithmetic: "Date joined" is a Date column. Remove it from the formula.'
    )
    expect(JSON.parse(localStorage.getItem(STATE_KEY)).globalColumns.some((c) => c.key === 'years')).toBe(false)
  })

  test('a column a formula uses cannot become a Date', async () => {
    await startOnItsOwn()
    await openGlobalColumns()
    const rowOf = all('[draggable], tr, li, div').find((el) => el.querySelector?.('button') && /^Basic Salary/.test(el.textContent.trim()) && el.textContent.includes('basicSalary') && el.textContent.length < 200)
    await click(button('Edit', rowOf))
    await click(button('Date', dialog()))
    await click(button('Save', dialog()))
    expect(dialog().textContent).toMatch(/Can't make this column a Date: these formulas use it, and a date can't be used in a formula's arithmetic: .*New Basic Salary.*\. Change those formulas first\./)
    expect(JSON.parse(localStorage.getItem(STATE_KEY)).globalColumns.find((c) => c.key === 'basicSalary').valueType).toBe('number')
  })
})

describe('Copy from Previous Month and Back up / Restore', () => {
  test('Copy from Previous Month shows and copies the date', async () => {
    await startOnItsOwn()
    await click(button('Copy from Previous Month'))
    await vi.waitFor(() => expect(text()).toContain('Employees in September 2026'))
    const employeeBox = (label) => all('label').find((l) => l.textContent.includes(label)).querySelector('input')
    await click(employeeBox('F001'))
    const columnBox = (name) => all('label').find((l) => l.textContent.trim() === name).querySelector('input')
    await click(columnBox('Date of Employment'))
    await click(columnBox('Date joined'))
    expect(dialog().textContent).toContain('02/01/2020')
    await click(button('Copy 1 Employee'))
    await click(button('Overwrite'))
    await vi.waitFor(() => expect(storedOctoberHere()[0].values).toMatchObject({ dateOfEmployment: '2020-01-02', dateJoined: '2020-01-02' }))
    await vi.waitFor(() => expect(cell(0, 'Date of Employment').value).toBe('02/01/2020'))
  })

  test('Back up and Restore keep the Date fields and their dates', async () => {
    const backup = parseBackupText(JSON.stringify(buildBackup(new Date('2026-10-20T10:00:00Z')))).backup
    localStorage.clear()
    restoreBackup(backup)
    expect(JSON.parse(localStorage.getItem(STATE_KEY)).identityFields.at(-1)).toEqual(DOE)
    await startOnItsOwn()
    expect(cell(0, 'Date of Employment').value).toBe('15/03/2021')
    expect(cell(0, 'Pick a date: Date joined')).toBeTruthy()
  })
})

// ---------- inside the dashboard ----------

const SHARED_ID = '30000000-0000-4000-8000-000000000001'
const A = { brn: 'C00000001', name: 'Fake Co Ltd', address: '1 Test Street\nPort Louis', role: 'admin' }
const OCT = 'C00000001|2026-10'
const SEP = 'C00000001|2026-09'
const SHARED_DATES = json({ identityFields: IDENTITY, idFieldKey, globalColumns: GLOBAL })
// The same setup, saved by someone else with Date of Employment as text.
const SHARED_TEXT = json({ identityFields: [...identityFields, { id: DOE.id, name: DOE.name, key: DOE.key }], idFieldKey, globalColumns: GLOBAL })

function hubSeed(more = {}) {
  return {
    companies: [A],
    selectedBrn: A.brn,
    shared: [{ id: SHARED_ID, name: 'Shared column setup', body: SHARED_DATES, revision: 1 }],
    setups: { [A.brn]: { shared_setup_id: SHARED_ID, body: json({ columns: company.columns, customFields: company.details.customFields }), revision: 1 } },
    monthsSupported: true,
    months: { [OCT]: { employees: OCTOBER }, [SEP]: { employees: SEPTEMBER } },
    ...more,
  }
}

async function startInDashboard(seed = hubSeed()) {
  localStorage.clear()
  localStorage.setItem(PREFS_KEY, JSON.stringify({ [A.brn]: { columnWidths: {}, viewYear: 2026, viewMonth: 10 } }))
  localStorage.setItem(IMPORTED_KEY, JSON.stringify({ companies: {}, months: {} }))
  hub = hub ?? createFakeSetupHub(seed)
  sent = installFakeBridge(hub)
  await render()
  await vi.waitFor(() => expect(text()).toContain('kept in the dashboard'))
  await vi.waitFor(() => expect(rows().length).toBeGreaterThan(0))
}

const storedOctober = () => hub.state.months.get(OCT)
const sends = (dataType) => sent.filter((m) => m.type === 'send-data' && m.payload.dataType === dataType)

describe('inside the dashboard', () => {
  test('a date typed is saved to the dashboard as YYYY-MM-DD; a refused one is not sent', async () => {
    await startInDashboard()
    await typeDate(cell(3, 'Date of Employment'), '01/08/2026')
    await vi.waitFor(() => expect(storedOctober().revision).toBe(2), { timeout: 4000 })
    expect(storedOctober().employees[3].values.dateOfEmployment).toBe('2026-08-01')
    await vi.waitFor(() => expect(text()).toContain('Saved'))

    const saves = sends('payroll-month').length
    await typeDate(cell(3, 'Date joined'), '31/02/2026')
    expect(refusals()).toContain('Row 4, Date joined — not saved:')
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(sends('payroll-month')).toHaveLength(saves)
    expect(storedOctober().revision).toBe(2)
  }, 15_000)

  test('a Date identity field added inside the dashboard is saved with its type in the shared setup', async () => {
    await startInDashboard(hubSeed({ shared: [{ id: SHARED_ID, name: 'Shared column setup', body: json({ identityFields, idFieldKey, globalColumns }), revision: 1 }] }))
    await click(button('Global Columns'))
    await click(button('+ Add Identity Field'))
    await type(dialog().querySelector('[aria-label="Name"]'), 'Date of Employment')
    await click(button('Date', dialog()))
    await click(button('Save', dialog()))
    await vi.waitFor(() => expect(hub.state.shared.get(SHARED_ID).revision).toBe(2), { timeout: 4000 })
    expect(hub.state.shared.get(SHARED_ID).body.identityFields.at(-1)).toMatchObject({ name: 'Date of Employment', key: 'dateOfEmployment', valueType: 'date' })
  }, 15_000)

  test('"Send to dashboard" sends every date as YYYY-MM-DD', async () => {
    await startInDashboard()
    await click(button('Send to dashboard'))
    await click(button('Send anyway'))
    const rowsSent = sent.find((m) => m.type === 'send-data' && m.payload.dataType === 'payroll-result').payload.rows
    expect(rowsSent.slice(0, 2).map((r) => [r['Date of Employment'], r['Date joined']])).toEqual([
      ['2021-03-15', '2021-03-15'],
      ['2019-11-04', '2019-11-04'],
    ])
  })

  test('History of this month: "Restore this version" brings the date back, shown DD/MM/YYYY', async () => {
    await startInDashboard()
    await typeDate(cell(0, 'Date of Employment'), '01/08/2026')
    await vi.waitFor(() => expect(storedOctober().revision).toBe(2), { timeout: 4000 })
    await vi.waitFor(() => expect(text()).toContain('Saved'))

    await click(button('History of this month'))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Revision 1'))
    await click(startingWith('Revision 1', dialog()))
    await vi.waitFor(() => expect(button('Restore this version', dialog())).toBeTruthy())
    // The version looked at shows the date as the table does.
    expect(dialog().textContent).toContain('15/03/2021')
    await click(button('Restore this version', dialog()))
    await click(button('Restore', dialog()))
    await vi.waitFor(() => expect(storedOctober().revision).toBe(3))
    expect(storedOctober().employees[0].values.dateOfEmployment).toBe('2021-03-15')
    await click(dialog().querySelector('[aria-label="Close"]'))
    await vi.waitFor(() => expect(cell(0, 'Date of Employment').value).toBe('15/03/2021'))
  }, 20_000)

  test('History of the Global columns: restoring the revision where it was a Date names the change and brings the Date back', async () => {
    const seed = hubSeed({ shared: [{ id: SHARED_ID, name: 'Shared column setup', body: SHARED_DATES, revision: 1 }] })
    hub = createFakeSetupHub(seed)
    // Revision 2, saved by someone else: Date of Employment made text.
    hub.state.shared.set(SHARED_ID, { ...hub.state.shared.get(SHARED_ID), body: json(SHARED_TEXT), revision: 2, mine: false })
    hub.state.history.push({ target: `shared:${SHARED_ID}`, revision: 2, body: json(SHARED_TEXT), saved_at: '2026-10-02T09:00:00.000Z' })
    await startInDashboard(seed)
    expect(cell(0, 'Pick a date: Date of Employment')).toBeNull()

    await click(button('Global Columns'))
    await click(button('History of the Global columns'))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Revision 1'))
    await click(startingWith('Revision 1', dialog()))
    await vi.waitFor(() => expect(button('Restore this version', dialog())).toBeTruthy())
    await click(button('Restore this version', dialog()))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Other settings that change:'))
    expect(dialog().textContent).toContain('Date of Employment (dateOfEmployment)')
    await click(button('Restore', dialog()))
    await vi.waitFor(() => expect(hub.state.shared.get(SHARED_ID).revision).toBe(3), { timeout: 4000 })
    expect(hub.state.shared.get(SHARED_ID).body.identityFields.at(-1).valueType).toBe('date')
    await click(dialog().querySelector('[aria-label="Close"]'))
    await click(button('Employee Table'))
    await vi.waitFor(() => expect(cell(0, 'Pick a date: Date of Employment')).toBeTruthy())
    expect(cell(0, 'Date of Employment').value).toBe('15/03/2021')
  }, 20_000)
})

// ---------- stage B: a field that is text becomes a Date ----------

// "Date of employment" typed as text, as it is today: day first, YYYY-MM-DD, words, nothing.
const TEXT_DOE_COLUMN = { ...newColumn({ name: 'Date of employment', key: 'dateOfEmployment', type: 'input', valueType: 'text' }), id: 'col-doe' }
const TEXT_DOE_FIELD = { id: 'idf-doe', name: 'Date of Employment', key: 'dateOfEmployment' }
const typedAsText = (employees, byId) =>
  employees.map((e) => ({ ...e, values: { ...e.values, ...(e.values.id in byId ? { dateOfEmployment: byId[e.values.id] } : {}) } }))
const OCT_TEXT = typedAsText(octoberEmployees, { F001: '15/03/2021', F002: '2019-11-04', F003: 'since 2018', F004: '' })
const SEP_TEXT = typedAsText(septemberEmployees, { F001: '02/01/2020', F002: 'n/a' })

describe('a text field becomes a Date', () => {
  test('what the saved months hold, by company, month and row', () => {
    expect(
      checkSavedDates([
        { companyId: 'a', period: '2026-09', values: ['02/01/2020', 'n/a', undefined] },
        { companyId: 'a', period: '2026-10', values: ['15/03/2021', '2019-11-04', 'since 2018', ''] },
      ])
    ).toEqual({
      dates: 3,
      unreadable: [
        { companyId: 'a', period: '2026-09', row: 2 },
        { companyId: 'a', period: '2026-10', row: 3 },
      ],
    })
  })

  function seedText({ asColumn }) {
    localStorage.clear()
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({
        identityFields: asColumn ? identityFields : [...identityFields, TEXT_DOE_FIELD],
        idFieldKey,
        globalColumns: asColumn ? [...globalColumns, TEXT_DOE_COLUMN] : globalColumns,
        companies: [company],
        activeCompanyId: company.id,
      })
    )
    localStorage.setItem(OCT_KEY, JSON.stringify({ employees: OCT_TEXT }))
    localStorage.setItem(SEP_KEY, JSON.stringify({ employees: SEP_TEXT }))
  }

  const conversion = () => document.querySelector('[data-testid="date-conversion"]')?.textContent.replace(/\s+/g, ' ') ?? ''
  const EXPECTED =
    "3 saved values are dates: shown DD/MM/YYYY from now on.2 saved values can't be read as a date. They are kept exactly as they are, shown in red until corrected:September 2026, row 2October 2026, row 3No saved value is changed: a date is written as YYYY-MM-DD the next time its cell is changed."

  async function editToDate(name) {
    await click(button('Global Columns'))
    const rowOf = all('tr').find((tr) => [...tr.querySelectorAll('td')].some((td) => td.textContent.trim() === name) && button('Edit', tr))
    await click(button('Edit', rowOf))
    await click(button('Date', dialog()))
    await click(button('Save', dialog()))
  }

  test.each([
    ['an Input column', true],
    ['an identity field', false],
  ])('%s: the saved months are checked and listed by month and row; Make it a Date changes the setup only', async (_, asColumn) => {
    seedText({ asColumn })
    const monthsBefore = [localStorage.getItem(OCT_KEY), localStorage.getItem(SEP_KEY)]
    await startOnItsOwn()
    const name = asColumn ? 'Date of employment' : 'Date of Employment'
    await editToDate(name)
    await vi.waitFor(() => expect(conversion()).toContain('3 saved values'))
    expect(text()).toContain(`Make "${name}" a Date?`)
    expect(conversion()).toBe(`${EXPECTED}CancelMake it a Date`)
    // No name and no value is shown.
    expect(conversion()).not.toMatch(/Testeur|Specimen|since 2018|n\/a/)

    await click(button('Make it a Date'))
    await vi.waitFor(() => {
      const state = JSON.parse(localStorage.getItem(STATE_KEY))
      const saved = asColumn ? state.globalColumns.at(-1) : state.identityFields.at(-1)
      expect(saved).toMatchObject({ key: 'dateOfEmployment', valueType: 'date' })
    })
    // Not one saved value is rewritten.
    expect([localStorage.getItem(OCT_KEY), localStorage.getItem(SEP_KEY)]).toEqual(monthsBefore)

    await click(button('Employee Table'))
    await vi.waitFor(() => expect(cell(0, name).value).toBe('15/03/2021'))
    expect(cell(1, name).value).toBe('04/11/2019')
    expect(cell(2, name).value).toBe('since 2018')
    expect(cell(2, name).getAttribute('aria-invalid')).toBe('true')
    // Rewritten as YYYY-MM-DD only when its cell is changed.
    await typeDate(cell(2, name), '01/06/2018')
    await vi.waitFor(() => expect(storedOctoberHere()[2].values.dateOfEmployment).toBe('2018-06-01'))
    expect(storedOctoberHere()[0].values.dateOfEmployment).toBe('15/03/2021')
  })

  test('Cancel changes nothing', async () => {
    seedText({ asColumn: true })
    await startOnItsOwn()
    const before = JSON.parse(localStorage.getItem(STATE_KEY))
    await editToDate('Date of employment')
    await vi.waitFor(() => expect(button('Make it a Date')).toBeTruthy())
    await click(button('Cancel', document.querySelector('[data-testid="date-conversion"]')))
    expect(JSON.parse(localStorage.getItem(STATE_KEY)).globalColumns).toEqual(before.globalColumns)
  })

  describe('inside the dashboard', () => {
    const SHARED_TEXT_FIELD = json({ identityFields: [...identityFields, TEXT_DOE_FIELD], idFieldKey, globalColumns })
    const seed = () =>
      hubSeed({
        shared: [{ id: SHARED_ID, name: 'Shared column setup', body: SHARED_TEXT_FIELD, revision: 1 }],
        months: { [OCT]: { employees: OCT_TEXT }, [SEP]: { employees: SEP_TEXT } },
      })

    test('September is read from the dashboard too; the change is ONE new revision of the setup, no month is saved, and Restore undoes it', async () => {
      await startInDashboard(seed())
      await editToDate('Date of Employment')
      await vi.waitFor(() => expect(conversion()).toContain('3 saved values'), { timeout: 4000 })
      expect(conversion()).toBe(`${EXPECTED}CancelMake it a Date`)
      await click(button('Make it a Date'))
      await vi.waitFor(() => expect(hub.state.shared.get(SHARED_ID).revision).toBe(2), { timeout: 4000 })
      expect(hub.state.shared.get(SHARED_ID).body.identityFields.at(-1)).toMatchObject({ key: 'dateOfEmployment', valueType: 'date' })
      // No month was saved: their values stay exactly as they were.
      await new Promise((resolve) => setTimeout(resolve, 1200))
      expect([storedOctober().revision, hub.state.months.get(SEP).revision]).toEqual([1, 1])

      await click(button('History of the Global columns'))
      await vi.waitFor(() => expect(dialog().textContent).toContain('Revision 1'))
      await click(startingWith('Revision 1', dialog()))
      await vi.waitFor(() => expect(button('Restore this version', dialog())).toBeTruthy())
      await click(button('Restore this version', dialog()))
      await vi.waitFor(() => expect(dialog().textContent).toContain('Date of Employment (dateOfEmployment)'))
      await click(button('Restore', dialog()))
      await vi.waitFor(() => expect(hub.state.shared.get(SHARED_ID).revision).toBe(3), { timeout: 4000 })
      expect('valueType' in hub.state.shared.get(SHARED_ID).body.identityFields.at(-1)).toBe(false)
      expect([storedOctober().revision, hub.state.months.get(SEP).revision]).toEqual([1, 1])
    }, 20_000)

    test('with the dashboard locked, the months cannot be checked: it says so, and nothing is changed', async () => {
      await startInDashboard(seed())
      await act(async () => hub.setGate(false))
      await editToDate('Date of Employment')
      await vi.waitFor(() =>
        expect(conversion()).toContain('The saved months could not be checked: The dashboard is locked, so the saved months could not be read. Nothing was changed.')
      )
      expect(button('Make it a Date')).toBeUndefined()
      await new Promise((resolve) => setTimeout(resolve, 1200))
      expect(hub.state.shared.get(SHARED_ID).revision).toBe(1)
    }, 15_000)
  })
})

// ---------- "Move to identity fields" ----------

describe('Move to identity fields', () => {
  const moveDialog = () => document.querySelector('[data-testid="move-to-identity"]')
  const moveText = () => moveDialog()?.textContent.replace(/\s+/g, ' ') ?? ''

  function seedColumn(extraColumns = []) {
    localStorage.clear()
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({ identityFields, idFieldKey, globalColumns: [...globalColumns, TEXT_DOE_COLUMN, ...extraColumns], companies: [company], activeCompanyId: company.id })
    )
    localStorage.setItem(OCT_KEY, JSON.stringify({ employees: OCT_TEXT }))
    localStorage.setItem(SEP_KEY, JSON.stringify({ employees: SEP_TEXT }))
  }

  async function openMove() {
    await click(button('Global Columns'))
    const rowOf = all('tr').find((tr) => [...tr.querySelectorAll('td')].some((td) => td.textContent.trim() === 'Date of employment') && button('Edit', tr))
    await click(button('Move to identity fields', rowOf))
    await vi.waitFor(() => expect(moveText()).not.toContain('Checking the saved months'))
  }

  async function renameAndMove() {
    await type(moveDialog().querySelector('[aria-label="Name"]'), 'Date of Employment')
    await click(button('Date', moveDialog()))
    await click(button('Move', moveDialog()))
  }

  test('it becomes the identity field "Date of Employment" (a Date, same key); no saved value moves; it is in the Excel export and the PDF fill', async () => {
    seedColumn()
    const monthsBefore = [localStorage.getItem(OCT_KEY), localStorage.getItem(SEP_KEY)]
    await startOnItsOwn()
    await openMove()
    expect(text()).toContain('Move "Date of employment" to the identity fields?')
    expect(moveText()).toContain(
      'It becomes an identity field with the same key, dateOfEmployment: leftmost in the Employee Table, and always in the Excel exports (an identity field has no “Include in Excel export” setting).'
    )
    expect(moveText()).toContain('Its saved values stay where they are: 2 months hold one, in 1 company.')
    await click(button('Date', moveDialog()))
    expect(moveText()).toContain("3 saved values are dates: shown DD/MM/YYYY from now on.2 saved values can't be read as a date.")
    expect(moveText()).toContain('September 2026, row 2October 2026, row 3')
    await click(button('Text', moveDialog()))
    await renameAndMove()

    await vi.waitFor(() =>
      expect(JSON.parse(localStorage.getItem(STATE_KEY)).identityFields.at(-1)).toMatchObject({ name: 'Date of Employment', key: 'dateOfEmployment', valueType: 'date' })
    )
    expect(JSON.parse(localStorage.getItem(STATE_KEY)).globalColumns.some((c) => c.key === 'dateOfEmployment')).toBe(false)
    expect([localStorage.getItem(OCT_KEY), localStorage.getItem(SEP_KEY)]).toEqual(monthsBefore)

    await click(button('Employee Table'))
    await vi.waitFor(() => expect(cell(0, 'Date of Employment').value).toBe('15/03/2021'))
    expect(cell(0, 'Pick a date: Date of Employment')).toBeTruthy()

    // Identity fields are always in the Excel export.
    await click(button('Export to Excel'))
    await vi.waitFor(() => expect(dialog()).toBeTruthy())
    expect(dialog().querySelector('thead').textContent).toContain('Date of Employment')
    expect(dialog().textContent).toContain('15/03/2021')
    // And in the PDF fill, under exactly the name the other apps look for.
    const state = JSON.parse(localStorage.getItem(STATE_KEY))
    const effective = getEffectiveColumns(company, state.globalColumns)
    const columns = buildPdfFillColumns(state.identityFields, effective)
    const rows = buildPdfFillRows(columns, OCT_TEXT, computeGridForEmployees(OCT_TEXT, effective, getColumnsByKey(effective)))
    expect(rows[0]['Date of Employment']).toBe('15/03/2021')
    expect('Date of employment' in rows[0]).toBe(false)
  })

  test('a name an identity field already has is refused', async () => {
    seedColumn()
    await startOnItsOwn()
    await openMove()
    await type(moveDialog().querySelector('[aria-label="Name"]'), 'surname')
    await click(button('Move', moveDialog()))
    expect(moveText()).toContain('An identity field is already called "surname".')
    expect(JSON.parse(localStorage.getItem(STATE_KEY)).globalColumns.some((c) => c.key === 'dateOfEmployment')).toBe(true)
  })

  test('not while a formula uses the column', async () => {
    const user = { ...newColumn({ name: 'Uses it', key: 'usesIt', type: 'formula', builderMode: 'simple', formula: 'dateOfEmployment ? 1 : 0' }), id: 'col-usesIt' }
    seedColumn([user])
    await startOnItsOwn()
    await openMove()
    expect(moveText()).toContain("Can't move it: this formula uses it, and an identity field can't be used in a formula: Uses it. Change that formula first.")
    expect(button('Move', moveDialog())).toBeUndefined()
  })

  test('inside the dashboard: ONE new revision of the shared setup, no month saved, and Restore undoes it', async () => {
    const SHARED_TEXT_COLUMN = json({ identityFields, idFieldKey, globalColumns: [...globalColumns, TEXT_DOE_COLUMN] })
    await startInDashboard(
      hubSeed({
        shared: [{ id: SHARED_ID, name: 'Shared column setup', body: SHARED_TEXT_COLUMN, revision: 1 }],
        months: { [OCT]: { employees: OCT_TEXT }, [SEP]: { employees: SEP_TEXT } },
      })
    )
    await openMove()
    expect(moveText()).toContain('Its saved values stay where they are: 2 months hold one, in 1 company.')
    await renameAndMove()
    await vi.waitFor(() => expect(hub.state.shared.get(SHARED_ID).revision).toBe(2), { timeout: 4000 })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const body = hub.state.shared.get(SHARED_ID).body
    expect(hub.state.shared.get(SHARED_ID).revision).toBe(2)
    expect(body.identityFields.at(-1)).toMatchObject({ name: 'Date of Employment', key: 'dateOfEmployment', valueType: 'date' })
    expect(body.globalColumns.some((c) => c.key === 'dateOfEmployment')).toBe(false)
    expect([storedOctober().revision, hub.state.months.get(SEP).revision]).toEqual([1, 1])

    await click(button('History of the Global columns'))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Revision 1'))
    await click(startingWith('Revision 1', dialog()))
    await vi.waitFor(() => expect(button('Restore this version', dialog())).toBeTruthy())
    await click(button('Restore this version', dialog()))
    await vi.waitFor(() => expect(button('Restore', dialog())).toBeTruthy())
    await click(button('Restore', dialog()))
    await vi.waitFor(() => expect(hub.state.shared.get(SHARED_ID).revision).toBe(3), { timeout: 4000 })
    expect(hub.state.shared.get(SHARED_ID).body).toEqual(SHARED_TEXT_COLUMN)
    expect([storedOctober().revision, hub.state.months.get(SEP).revision]).toEqual([1, 1])
  }, 20_000)

  test('a company whose months only its admins may read is named by its name in the message', async () => {
    const B = { brn: 'TEST-BRN-B', name: 'TEST Co B', address: '2 Test Street', role: 'member' }
    await startInDashboard(
      hubSeed({
        companies: [A, B],
        setups: {
          [A.brn]: { shared_setup_id: SHARED_ID, body: json({ columns: company.columns, customFields: company.details.customFields }), revision: 1 },
          [B.brn]: { shared_setup_id: SHARED_ID, body: { columns: [], customFields: [] }, revision: 1 },
        },
      })
    )
    const companyB = dataStore.loadState().companies.find((c) => c.name === 'TEST Co B')
    expect(companyB).toBeTruthy()
    expect(await dataStore.readSavedValues([companyB.id], 'dateOfEmployment')).toEqual({
      ok: false,
      code: 'forbidden',
      error: 'Only an admin of TEST Co B can see its months, so they could not be read.',
    })
  })
})
