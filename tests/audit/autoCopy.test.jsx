// @vitest-environment jsdom

// "When I open a month with no employees yet": Ask me (today's way), or copy
// from the previous month automatically (lib/autoCopy.js). The rules on their
// own, then the whole app on its own in this browser, then the whole app inside
// a stand-in for the dashboard that keeps the months (tests/helpers/fakeSetupHub.js).
// TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import App from '../../src/App'
import { resetDataStore } from '../../src/lib/dataStore'
import { companyBodyOf, forgetDashboardSetup, IMPORTED_KEY, PREFS_KEY } from '../../src/lib/dashboardSetup'
import { forgetDashboardMonths } from '../../src/lib/dashboardMonths'
import { autoCopyToKeep, chosenColumns, copyFromPrevious, defaultColumnKeys, isOneOffName, readAutoCopy, renameKeyInAutoCopy } from '../../src/lib/autoCopy'
import fs from 'node:fs'
import path from 'node:path'
import { createFakeSetupHub, installFakeBridge } from '../helpers/fakeSetupHub'
import { identityFields, idFieldKey, globalColumns, company, effectiveColumns, octoberEmployees } from '../safetyNet/fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const AUTO = { mode: 'auto', columns: ['basicSalary', 'govtIncrement', 'allowances'] }
const OCTOBER_KEY = `payroll_period_${company.id}_2026-10`
const NOVEMBER_KEY = `payroll_period_${company.id}_2026-11`
const json = (value) => JSON.parse(JSON.stringify(value))
/** What a copied employee holds: the identity fields, and Basic Salary, Govt Increment and Allowances. */
const copiedValues = (employees) =>
  employees.map((e) => ({
    id: e.values.id,
    surname: e.values.surname,
    otherNames: e.values.otherNames,
    basicSalary: e.values.basicSalary,
    govtIncrement: e.values.govtIncrement,
    allowances: e.values.allowances,
  }))

describe('the rules', () => {
  test('never chose (nothing stored) is ON with the default columns; anything else unreadable is Ask me', () => {
    expect(readAutoCopy(undefined)).toEqual({ mode: 'auto', columns: [], isDefault: true })
    expect(readAutoCopy(null)).toEqual({ mode: 'auto', columns: [], isDefault: true })
    expect(readAutoCopy({ mode: 'ask' })).toEqual({ mode: 'ask', columns: [], isDefault: false })
    expect(readAutoCopy({ mode: 'sometimes', columns: ['x'] })).toEqual({ mode: 'ask', columns: [], isDefault: false })
    expect(readAutoCopy('auto')).toEqual({ mode: 'ask', columns: [], isDefault: false })
    expect(readAutoCopy({ mode: 'auto', columns: ['a', 'a', '', 3] })).toEqual({ mode: 'auto', columns: ['a'], isDefault: false })
    // Reading what was read already gives the same answer (the app passes the read setting on).
    expect(readAutoCopy(readAutoCopy(undefined))).toEqual(readAutoCopy(undefined))
  })

  test('"Ask me" is kept on the company from now on, so it is never taken for "never chose"; never chose keeps nothing', () => {
    expect(autoCopyToKeep({ mode: 'ask', columns: ['a'] })).toEqual({ mode: 'ask' })
    expect(autoCopyToKeep({ mode: 'auto', columns: ['a'] })).toEqual({ mode: 'auto', columns: ['a'] })
    expect(autoCopyToKeep(undefined)).toBeUndefined()
    expect(autoCopyToKeep(readAutoCopy(undefined))).toBeUndefined()
  })

  test('the default columns leave out every name containing bonus, allowance, overtime, increment, arrears, commission or leave', () => {
    for (const name of ['Bonus', 'Annual BONUS', 'Allowances', 'Meal allowance', 'Overtime 1.5', 'Govt Increment', 'Arrears', 'Commission', 'Annual leave pay', 'Leave']) {
      expect(isOneOffName(name), name).toBe(true)
    }
    for (const name of ['Basic Salary', 'Travelling', 'EDF', 'Full time / Part time', 'Age 60+', 'Over time']) {
      expect(isOneOffName(name), name).toBe(false)
    }
    // Formulas are never copied; on the test setup:
    expect(defaultColumnKeys(effectiveColumns)).not.toContain('govtIncrement')
    expect(defaultColumnKeys(effectiveColumns)).not.toContain('allowances')
    expect(defaultColumnKeys(effectiveColumns)).not.toContain('emoluments')
    expect(chosenColumns(undefined, effectiveColumns).map((c) => c.key)).toEqual(defaultColumnKeys(effectiveColumns))
  })

  // The input columns of the owner's setup (column-setup-new.json, outside this repo), as
  // they are on 14 Nov 2026: names, keys and kinds only.
  const OWNER_INPUTS = [
    { key: 'basicSalary', name: 'Basic Salary', category: 'general', type: 'input', valueType: 'number' },
    { key: 'govtIncrement', name: 'Govt Increment', category: 'general', type: 'input', valueType: 'number' },
    { key: 'Fulltime', name: 'Full time / Part time', category: 'general', type: 'input', valueType: 'text' },
    { key: 'allowances', name: 'Allowances', category: 'general', type: 'input', valueType: 'number' },
    { key: 'travelling', name: 'Travelling', category: 'general', type: 'input', valueType: 'number' },
    { key: 'age60', name: 'Age 60+', category: 'general', type: 'input', valueType: 'checkbox' },
    { key: 'edf', name: 'EDF', category: 'otherDeductions', type: 'input', valueType: 'number' },
  ]
  const OWNER_DEFAULT = ['Basic Salary', 'Full time / Part time', 'Travelling', 'Age 60+', 'EDF']

  test("the owner's setup: Basic Salary, Full time / Part time, Travelling, Age 60+ and EDF are copied by default", () => {
    expect(chosenColumns(undefined, OWNER_INPUTS).map((c) => c.name)).toEqual(OWNER_DEFAULT)
  })

  const ownerFile = path.resolve(import.meta.dirname, '../../../column-setup-new.json')
  test.runIf(fs.existsSync(ownerFile))('the same list from column-setup-new.json itself, when it is on this laptop', () => {
    const setup = JSON.parse(fs.readFileSync(ownerFile, 'utf8'))
    expect(chosenColumns(undefined, setup.columns).map((c) => c.name)).toEqual(OWNER_DEFAULT)
  })

  test('only input columns still in the company are copied; a formula or a column gone is not', () => {
    const setting = { mode: 'auto', columns: ['allowances', 'emoluments', 'gone', 'basicSalary'] }
    expect(chosenColumns(setting, effectiveColumns).map((c) => c.key)).toEqual(['basicSalary', 'allowances'])
  })

  test('every employee is copied with the identity fields and the chosen columns only, as new records; the previous month is not changed', () => {
    const before = structuredClone(octoberEmployees)
    const { employees, columnNames } = copyFromPrevious({ previousEmployees: octoberEmployees, identityFields, setting: AUTO, effectiveColumns })
    expect(columnNames).toEqual(['Basic Salary', 'Govt Increment', 'Allowances'])
    expect(employees).toHaveLength(octoberEmployees.length)
    expect(employees.map((e) => e.values)).toEqual(copiedValues(octoberEmployees))
    for (const [i, e] of employees.entries()) expect(e.id).not.toBe(octoberEmployees[i].id)
    expect(octoberEmployees).toEqual(before)
  })

  test('a column whose key changes stays chosen under its new key', () => {
    expect(renameKeyInAutoCopy(AUTO, 'allowances', 'allowance')).toEqual({ mode: 'auto', columns: ['basicSalary', 'govtIncrement', 'allowance'] })
    expect(renameKeyInAutoCopy(undefined, 'a', 'b')).toBeUndefined()
  })

  test('inside the dashboard the setting is part of the company\'s column setup; a company that never chose keeps the body it always had', () => {
    expect(companyBodyOf(company)).toEqual({ columns: json(company.columns), customFields: company.details.customFields })
    expect(companyBodyOf({ ...company, autoCopy: AUTO })).toEqual({ columns: json(company.columns), customFields: company.details.customFields, autoCopy: AUTO })
    expect(companyBodyOf({ ...company, autoCopy: { mode: 'ask', columns: [] } })).toEqual({
      columns: json(company.columns),
      customFields: company.details.customFields,
      autoCopy: { mode: 'ask' },
    })
  })
})

// ---------- the whole app ----------

let root
let container
let hub

const text = () => container.textContent.replace(/\s+/g, ' ')
const all = (selector) => [...document.querySelectorAll(selector)]
const button = (label) => all('button').find((b) => b.textContent.trim() === label)
const rows = () => [...container.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('input'))
const stored = (key) => JSON.parse(localStorage.getItem(key))

async function click(target) {
  expect(target, 'the control').toBeTruthy()
  await act(async () => target.click())
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

afterEach(async () => {
  await stop()
  vi.restoreAllMocks()
  delete window.PayrollHubBridge
})

describe('on its own, in this browser', () => {
  /** November 2026 on screen, October saved with six employees. */
  function seed({ autoCopy, november, october = octoberEmployees } = {}) {
    localStorage.clear()
    const fake = { ...company, viewMonth: 11, ...(autoCopy ? { autoCopy } : {}) }
    localStorage.setItem('payroll_app_state_v1', JSON.stringify({ identityFields, idFieldKey, globalColumns, companies: [fake], activeCompanyId: fake.id }))
    localStorage.setItem(OCTOBER_KEY, JSON.stringify({ employees: october }))
    if (november) localStorage.setItem(NOVEMBER_KEY, JSON.stringify({ employees: november }))
  }

  async function start() {
    window.PayrollHubBridge = {
      isEmbedded: () => false,
      isConnected: () => false,
      init: () => false,
      onStatus: () => () => {},
      requestData: () => Promise.resolve({ ok: false, error: 'Not embedded.' }),
      sendToDashboard: () => Promise.resolve({ ok: false, error: 'Not embedded.' }),
    }
    await render()
    await vi.waitFor(() => expect(text()).toContain('November 2026'))
  }

  test('Ask me (stored): nothing is copied, and Copy from Previous Month is there as today', async () => {
    seed({ autoCopy: { mode: 'ask' } })
    await start()
    expect(rows()).toHaveLength(0)
    expect(text()).not.toContain('Copied')
    expect(button('Automatic copy: Off')).toBeTruthy()
    expect(button('Copy from Previous Month').disabled).toBe(false)
    await click(button('Copy from Previous Month'))
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]').textContent).toContain('Columns to copy'))
  })

  test('automatic: the first time the empty month is opened, every employee of October is copied with the chosen columns, the rest left empty', async () => {
    seed({ autoCopy: AUTO })
    const october = localStorage.getItem(OCTOBER_KEY)
    await start()
    await vi.waitFor(() => expect(rows()).toHaveLength(octoberEmployees.length))
    expect(text()).toContain('Copied 6 employees from October 2026 (Basic Salary, Govt Increment, Allowances).')
    expect(button('Undo')).toBeTruthy()
    await vi.waitFor(() => expect(stored(NOVEMBER_KEY).employees).toHaveLength(6))
    expect(stored(NOVEMBER_KEY).employees.map((e) => e.values)).toEqual(copiedValues(octoberEmployees))
    // Calculated columns are worked out as usual: New Basic Salary of the first employee.
    expect(rows()[0].textContent).toContain('18,115.00')
    // October is never changed.
    expect(localStorage.getItem(OCTOBER_KEY)).toBe(october)
  })

  test('never into a month that has employees, nor one already saved, even empty', async () => {
    seed({ autoCopy: AUTO, november: octoberEmployees.slice(0, 1) })
    await start()
    await vi.waitFor(() => expect(rows()).toHaveLength(1))
    expect(text()).not.toContain('Copied')
    await stop()

    seed({ autoCopy: AUTO, november: [] })
    await start()
    await act(async () => {})
    expect(rows()).toHaveLength(0)
    expect(text()).not.toContain('Copied')
    expect(stored(NOVEMBER_KEY).employees).toEqual([])
  })

  test('the previous month has no employees: a short note, and nothing is copied', async () => {
    seed({ autoCopy: AUTO, october: [] })
    await start()
    await vi.waitFor(() => expect(text()).toContain('Nothing was copied: October 2026 has no employees.'))
    expect(rows()).toHaveLength(0)
  })

  test('Undo empties the month again, and it is not copied again when opened next time', async () => {
    seed({ autoCopy: AUTO })
    await start()
    await vi.waitFor(() => expect(button('Undo')).toBeTruthy())
    await click(button('Undo'))
    expect(rows()).toHaveLength(0)
    expect(text()).toContain('The copy was undone: this month is empty again.')
    expect(stored(NOVEMBER_KEY).employees).toEqual([])

    await stop()
    await start()
    await act(async () => {})
    expect(rows()).toHaveLength(0)
    expect(text()).not.toContain('Copied')
  })

  test('Undo is offered only while nothing else has been typed', async () => {
    seed({ autoCopy: AUTO })
    await start()
    await vi.waitFor(() => expect(button('Undo')).toBeTruthy())
    const input = rows()[0].querySelector('[aria-label="Allowances"]') ?? rows()[0].querySelectorAll('input')[5]
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set
    await act(async () => {
      setter.call(input, '9999')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(button('Undo')).toBeUndefined()
    expect(text()).toContain('Copied 6 employees from October 2026')
  })

  test('never chose: ON with the default columns, saved like any copy, and the banner says it is the default', async () => {
    seed()
    await start()
    await vi.waitFor(() => expect(rows()).toHaveLength(octoberEmployees.length))
    const names = chosenColumns(undefined, effectiveColumns).map((c) => c.name).join(', ')
    expect(text()).toContain(
      `Copied 6 employees from October 2026 (${names}). Automatic copy is on by default for this company; change it with the Automatic copy button.`
    )
    expect(button('Automatic copy: On (default)')).toBeTruthy()
    expect(button('Undo')).toBeTruthy()
    // Nothing is written on the company for the default.
    expect(stored('payroll_app_state_v1').companies[0]).not.toHaveProperty('autoCopy')
    await vi.waitFor(() => expect(stored(NOVEMBER_KEY).employees).toHaveLength(6))
    expect(Object.keys(stored(NOVEMBER_KEY).employees[0].values)).not.toContain('allowances')
    expect(Object.keys(stored(NOVEMBER_KEY).employees[0].values)).not.toContain('govtIncrement')
  })

  test('the setting window on the default: the default columns ticked, the note, and Save keeps the choice', async () => {
    seed({ october: [] })
    await start()
    await click(button('Automatic copy: On (default)'))
    const dialog = () => document.querySelector('[role="dialog"]')
    expect(dialog().textContent).toContain(
      'These are the default columns: every input column except those whose name contains bonus, allowance, overtime, increment, arrears, commission or leave. Save to keep your own choice.'
    )
    const labelled = (name) => [...dialog().querySelectorAll('label')].find((l) => l.textContent.trim() === name || l.textContent.startsWith(name))
    expect(labelled('Basic Salary').querySelector('input').checked).toBe(true)
    expect(labelled('Travelling').querySelector('input').checked).toBe(true)
    expect(labelled('Allowances').querySelector('input').checked).toBe(false)
    expect(labelled('Govt Increment').querySelector('input').checked).toBe(false)
    await click(button('Save'))
    expect(button('Automatic copy: On')).toBeTruthy()
    await vi.waitFor(() =>
      expect(stored('payroll_app_state_v1').companies[0].autoCopy).toEqual({ mode: 'auto', columns: defaultColumnKeys(effectiveColumns) })
    )
  })

  test('the setting: Ask me or automatic, with the input columns ticked; kept on the company, in table order', async () => {
    seed({ autoCopy: { mode: 'ask' } })
    await start()
    await click(button('Automatic copy: Off'))
    const dialog = () => document.querySelector('[role="dialog"]')
    expect(dialog().textContent).toContain('When I open a month with no employees yet')
    const labelled = (name) => [...dialog().querySelectorAll('label')].find((l) => l.textContent.trim() === name || l.textContent.startsWith(name))
    // Columns can only be ticked once "automatically" is chosen; formulas are not offered.
    expect(labelled('Allowances').querySelector('input').disabled).toBe(true)
    expect(labelled('New Basic Salary')).toBeUndefined()
    await click(labelled('Copy from the previous month automatically').querySelector('input'))
    await click(labelled('Allowances').querySelector('input'))
    await click(labelled('Basic Salary').querySelector('input'))
    await click(button('Save'))
    expect(button('Automatic copy: On')).toBeTruthy()
    await vi.waitFor(() =>
      expect(stored('payroll_app_state_v1').companies[0].autoCopy).toEqual({ mode: 'auto', columns: ['basicSalary', 'allowances'] })
    )

    await click(button('Automatic copy: On'))
    expect(labelled('Basic Salary').querySelector('input').checked).toBe(true)
    await click(labelled('Ask me').querySelector('input'))
    await click(button('Save'))
    await vi.waitFor(() => expect(stored('payroll_app_state_v1').companies[0].autoCopy).toEqual({ mode: 'ask' }))
    expect(button('Automatic copy: Off')).toBeTruthy()
  })
})

describe('inside the dashboard, which keeps the months', () => {
  const SHARED_ID = '30000000-0000-4000-8000-000000000001'
  const A = { brn: 'C00000001', name: 'Fake Co Ltd', address: '1 Test Street\nPort Louis', role: 'admin' }
  const OCT = 'C00000001|2026-10'
  const NOV = 'C00000001|2026-11'

  function seed({ autoCopy = AUTO, role = 'admin', months = { [OCT]: { employees: octoberEmployees } } } = {}) {
    localStorage.clear()
    localStorage.setItem(PREFS_KEY, JSON.stringify({ [A.brn]: { columnWidths: {}, viewYear: 2026, viewMonth: 11 } }))
    localStorage.setItem(IMPORTED_KEY, JSON.stringify({ companies: {}, months: {} }))
    return {
      companies: [{ ...A, role }],
      selectedBrn: A.brn,
      shared: [{ id: SHARED_ID, name: 'Shared column setup', body: json({ identityFields, idFieldKey, globalColumns }), revision: 1 }],
      setups: {
        [A.brn]: {
          shared_setup_id: SHARED_ID,
          body: json({ columns: company.columns, customFields: company.details.customFields, ...(autoCopy ? { autoCopy } : {}) }),
          revision: 1,
        },
      },
      monthsSupported: true,
      months,
    }
  }

  async function start(seedValue) {
    hub = createFakeSetupHub(seedValue)
    installFakeBridge(hub)
    await render()
    await vi.waitFor(() => expect(text()).toContain('November 2026'))
  }

  test('the setting comes from the dashboard: the empty month is copied and saved there as a new month, October untouched', async () => {
    await start(seed())
    await vi.waitFor(() => expect(rows()).toHaveLength(6))
    expect(text()).toContain('Copied 6 employees from October 2026 (Basic Salary, Govt Increment, Allowances).')
    await vi.waitFor(() => expect(hub.state.months.get(NOV)?.revision).toBe(1), { timeout: 4000 })
    expect(hub.state.months.get(NOV).employees.map((e) => e.values)).toEqual(copiedValues(octoberEmployees))
    expect(hub.state.months.get(OCT).revision).toBe(1)

    // Undo: a new revision with no one in it (History and Restore as usual).
    await click(button('Undo'))
    await vi.waitFor(() => expect(hub.state.months.get(NOV)?.revision).toBe(2), { timeout: 4000 })
    expect(hub.state.months.get(NOV).employees).toEqual([])
  })

  test('a month the dashboard has saved, even empty, is never copied into', async () => {
    await start(seed({ months: { [OCT]: { employees: octoberEmployees }, [NOV]: { employees: [] } } }))
    await act(async () => {})
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(rows()).toHaveLength(0)
    expect(text()).not.toContain('Copied')
  })

  test('a member who is not an admin cannot change the setting, and nothing is copied for them', async () => {
    await start(seed({ role: 'member' }))
    await act(async () => {})
    expect(text()).not.toContain('Copied')
    expect(button('Automatic copy: On').disabled).toBe(true)
  })

  test('a company of the dashboard that never chose: ON by default, the copy saved there as month revision 1', async () => {
    await start(seed({ autoCopy: null }))
    await vi.waitFor(() => expect(rows()).toHaveLength(6))
    expect(text()).toContain('Automatic copy is on by default for this company')
    await vi.waitFor(() => expect(hub.state.months.get(NOV)?.revision).toBe(1), { timeout: 4000 })
    expect(hub.state.setups.get(A.brn).revision).toBe(1)
    expect(hub.state.setups.get(A.brn).body).not.toHaveProperty('autoCopy')
  })

  test('"Ask me" saved in the dashboard stays Off: nothing is copied', async () => {
    await start(seed({ autoCopy: { mode: 'ask' } }))
    await act(async () => {})
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(rows()).toHaveLength(0)
    expect(text()).not.toContain('Copied')
    expect(button('Automatic copy: Off')).toBeTruthy()
  })

  test('the setting is saved in the dashboard with the company\'s columns, as a new revision', async () => {
    await start(seed({ autoCopy: { mode: 'ask' }, months: {} }))
    await click(button('Automatic copy: Off'))
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog.textContent).toContain('Saved in the dashboard with this company\'s columns')
    const labelled = (name) => [...dialog.querySelectorAll('label')].find((l) => l.textContent.startsWith(name))
    await click(labelled('Copy from the previous month automatically').querySelector('input'))
    await click(labelled('Basic Salary').querySelector('input'))
    await click(button('Save'))
    await vi.waitFor(() => expect(hub.state.setups.get(A.brn).revision).toBe(2), { timeout: 4000 })
    expect(hub.state.setups.get(A.brn).body.autoCopy).toEqual({ mode: 'auto', columns: ['basicSalary'] })
    expect(hub.state.setups.get(A.brn).body.columns).toEqual(json(company.columns))
  })
})
