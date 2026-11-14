// @vitest-environment jsdom

// "Copy this month to…" (lib/copyToMonths.js, components/CopyToMonthsModal.jsx):
// the month on screen copied into months the user picks. The rules on their own,
// then the whole app inside a stand-in for the dashboard that keeps the months
// (tests/helpers/fakeSetupHub.js), then the app on its own in this browser.
// TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import App from '../../src/App'
import { resetDataStore } from '../../src/lib/dataStore'
import { forgetDashboardSetup, IMPORTED_KEY, PREFS_KEY } from '../../src/lib/dashboardSetup'
import { forgetDashboardMonths } from '../../src/lib/dashboardMonths'
import { doneMessage, employeesFor, monthsToWrite, planTargets, targetPeriods } from '../../src/lib/copyToMonths'
import { createFakeSetupHub, installFakeBridge } from '../helpers/fakeSetupHub'
import { identityFields, idFieldKey, globalColumns, company, effectiveColumns, octoberEmployees } from '../safetyNet/fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const json = (value) => JSON.parse(JSON.stringify(value))
const NOVEMBER = { year: 2026, month: 11 }
/** The keys a copy holds: the identity fields, and Basic Salary where the employee has one. */
const copiedKeys = (employees) =>
  employees.map((e) => [...identityFields.map((f) => f.key), ...(Object.hasOwn(e.values, 'basicSalary') ? ['basicSalary'] : [])])

describe('the rules', () => {
  test('the target months: one, or a range in either order, oldest first, never the month itself, at most 24', () => {
    expect(targetPeriods(NOVEMBER, { from: '2026-12' })).toEqual({ ok: true, periods: ['2026-12'] })
    expect(targetPeriods(NOVEMBER, { from: '2027-03', to: '2026-12' })).toEqual({ ok: true, periods: ['2026-12', '2027-01', '2027-02', '2027-03'] })
    expect(targetPeriods(NOVEMBER, { from: '2026-10', to: '2026-12' })).toEqual({ ok: true, periods: ['2026-10', '2026-12'] })
    expect(targetPeriods(NOVEMBER, { from: '2026-11' })).toEqual({ ok: false, problem: 'Choose a month other than this one.' })
    expect(targetPeriods(NOVEMBER, { from: '2026-12', to: '2028-11' }).ok).toBe(true)
    expect(targetPeriods(NOVEMBER, { from: '2026-12', to: '2028-12' })).toEqual({ ok: false, problem: 'Choose at most 24 months.' })
    expect(targetPeriods(NOVEMBER, { from: '' })).toEqual({ ok: false, problem: 'Choose a month.' })
    expect(targetPeriods(NOVEMBER, { from: '2026-13' })).toEqual({ ok: false, problem: 'Choose a month.' })
  })

  test('an approved month is never written; a saved one only when set to Replace', () => {
    const plan = planTargets(['2026-12', '2027-01', '2027-02'], {
      saved: [
        { period: '2026-12', revision: 3, employee_count: 2 },
        { period: '2027-02', revision: 1, employee_count: 5 },
      ],
      approved: ['2027-02'],
    })
    expect(plan.map((t) => t.action)).toEqual(['saved', 'add', 'approved'])
    expect(monthsToWrite(plan, new Set()).map((t) => t.period)).toEqual(['2027-01'])
    expect(monthsToWrite(plan, new Set(['2026-12', '2027-02'])).map((t) => t.period)).toEqual(['2026-12', '2027-01'])
  })

  test('each month gets new records with the identity fields and the ticked columns only; the month copied is not changed', () => {
    const before = structuredClone(octoberEmployees)
    const one = employeesFor({ employees: octoberEmployees, identityFields, columnKeys: ['basicSalary'], effectiveColumns })
    const two = employeesFor({ employees: octoberEmployees, identityFields, columnKeys: ['basicSalary'], effectiveColumns })
    expect(one.map((e) => Object.keys(e.values))).toEqual(copiedKeys(octoberEmployees))
    expect(one[0].id).not.toBe(two[0].id)
    expect(one[0].id).not.toBe(octoberEmployees[0].id)
    expect(octoberEmployees).toEqual(before)
  })

  test('the line shown at the end', () => {
    expect(doneMessage({ added: ['2027-01'], replaced: ['2026-12'], failed: [] }, 3)).toBe('Copied to 2 months; 1 skipped.')
    expect(doneMessage({ added: ['2027-01'], replaced: [], failed: [] }, 1)).toBe('Copied to 1 month.')
  })
})

// ---------- the whole app ----------

let root
let container
let hub

const text = () => document.body.textContent.replace(/\s+/g, ' ')
const all = (selector) => [...document.querySelectorAll(selector)]
const button = (label) => all('button').find((b) => b.textContent.trim() === label)
const dialogs = () => all('[role="dialog"]')
const topDialog = () => dialogs().at(-1)
const radio = (labelText, scope = document) => [...scope.querySelectorAll('label')].find((l) => l.textContent.trim() === labelText)?.querySelector('input')

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

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  root = null
  container?.remove()
  document.body.innerHTML = ''
  resetDataStore()
  forgetDashboardSetup()
  forgetDashboardMonths()
  vi.restoreAllMocks()
  delete window.PayrollHubBridge
})

/** Opens the window, picks December 2026 to February 2027, keeps only Basic Salary, and goes to the preview. */
async function chooseDecemberToFebruary() {
  await vi.waitFor(() => expect(button('Copy this month to…')?.disabled).toBe(false))
  await click(button('Copy this month to…'))
  expect(topDialog().textContent).toContain('Copy November 2026 to other months')
  await click(radio('A range of months', topDialog()))
  const [from, to] = topDialog().querySelectorAll('input[type="month"]')
  expect(from.value).toBe('2026-12')
  await type(to, '2027-02')
  await click(button('Untick all'))
  await click(radio('Basic Salary', topDialog()))
  await click(button('Next'))
  await vi.waitFor(() => expect(topDialog().textContent).toContain('January 2027'))
}

describe('inside the dashboard, which keeps the months', () => {
  const SHARED_ID = '30000000-0000-4000-8000-000000000001'
  const A = { brn: 'C00000001', name: 'Fake Co Ltd', address: '1 Test Street\nPort Louis', role: 'admin' }
  const NOV = 'C00000001|2026-11'
  const DEC = 'C00000001|2026-12'
  const JAN = 'C00000001|2027-01'
  const FEB = 'C00000001|2027-02'
  const december = octoberEmployees.slice(0, 2)

  function seed({ role = 'admin' } = {}) {
    localStorage.clear()
    localStorage.setItem(PREFS_KEY, JSON.stringify({ [A.brn]: { columnWidths: {}, viewYear: 2026, viewMonth: 11 } }))
    localStorage.setItem(IMPORTED_KEY, JSON.stringify({ companies: {}, months: {} }))
    return {
      companies: [{ ...A, role }],
      selectedBrn: A.brn,
      shared: [{ id: SHARED_ID, name: 'Shared column setup', body: json({ identityFields, idFieldKey, globalColumns }), revision: 1 }],
      setups: {
        [A.brn]: { shared_setup_id: SHARED_ID, body: json({ columns: company.columns, customFields: company.details.customFields, autoCopy: { mode: 'ask' } }), revision: 1 },
      },
      monthsSupported: true,
      months: { [NOV]: { employees: octoberEmployees }, [DEC]: { employees: december }, [FEB]: { employees: october3() } },
      approvedRuns: [FEB],
    }
  }
  const october3 = () => octoberEmployees.slice(0, 3)

  async function start(seedValue) {
    hub = createFakeSetupHub(seedValue)
    installFakeBridge(hub)
    await render()
    await vi.waitFor(() => expect(container.textContent).toContain('November 2026'))
  }

  test('the preview lists each month: added, saved (Skip by default), approved (never changed); only the empty month is saved', async () => {
    await start(seed())
    const november = structuredClone(hub.state.months.get(NOV))
    await chooseDecemberToFebruary()
    const preview = topDialog().textContent.replace(/\s+/g, ' ')
    expect(preview).toContain('December 2026Saved already (2 employees)')
    expect(preview).toContain('January 2027Will be added (6 employees)')
    expect(preview).toContain('February 2027Approved: never changed')
    expect(preview).toContain('6 employees into 1 month. 1 month skipped, 1 approved month left as it is.')
    expect(radio('Skip', topDialog()).checked).toBe(true)

    await click(button('Copy to 1 month'))
    await vi.waitFor(() => expect(topDialog().textContent).toContain('Copied to 1 month; 2 skipped.'))
    const jan = hub.state.months.get(JAN)
    expect(jan.revision).toBe(1)
    expect(jan.employees.map((e) => Object.keys(e.values))).toEqual(copiedKeys(octoberEmployees))
    expect(jan.employees.map((e) => e.values.basicSalary)).toEqual(octoberEmployees.map((e) => e.values.basicSalary))
    // December, February and November itself are exactly as they were.
    expect(hub.state.months.get(DEC).revision).toBe(1)
    expect(hub.state.months.get(DEC).employees).toEqual(json(december))
    expect(hub.state.months.get(FEB).revision).toBe(1)
    expect(hub.state.months.get(NOV)).toEqual(november)
    // One save of the import's kind, and no summary toast.
    expect(hub.state.log.filter((m) => m.action === 'company')).toHaveLength(1)
    expect(hub.state.importSummaries ?? []).toHaveLength(0)
  })

  test('Replace asks again, naming the months; the saved month becomes a new revision, its old one kept for History and Restore', async () => {
    await start(seed())
    await chooseDecemberToFebruary()
    await click(radio('Replace', topDialog()))
    await click(button('Replace 1 month and copy'))
    // Nothing is saved before the second confirmation.
    expect(hub.state.months.get(DEC).revision).toBe(1)
    expect(topDialog().textContent).toContain('Replace December 2026?')
    expect(topDialog().textContent).toContain('What is saved there now is kept in History, and Restore brings it back.')
    await click(button('Replace and copy'))
    await vi.waitFor(() => expect(text()).toContain('Copied to 2 months; 1 skipped.'))
    const dec = hub.state.months.get(DEC)
    expect(dec.revision).toBe(2)
    expect(dec.employees).toHaveLength(6)
    expect(hub.state.monthHistory.filter((h) => h.key === DEC).map((h) => h.revision)).toEqual([1, 2])
    expect(hub.state.monthHistory.find((h) => h.key === DEC && h.revision === 1).employees).toEqual(json(december))
    expect(hub.state.months.get(FEB).revision).toBe(1)
  })

  test('Cancel on the second confirmation saves nothing', async () => {
    await start(seed())
    await chooseDecemberToFebruary()
    await click(radio('Replace', topDialog()))
    await click(button('Replace 1 month and copy'))
    await click(all('button').filter((b) => b.textContent.trim() === 'Cancel').at(-1))
    expect(hub.state.months.get(DEC).revision).toBe(1)
    expect(hub.state.months.has(JAN)).toBe(false)
  })

  test('a month approved after the preview: the database refuses, and nothing at all is copied', async () => {
    await start(seed())
    await chooseDecemberToFebruary()
    await click(radio('Replace', topDialog()))
    hub.state.approvedRuns.add(DEC)
    await click(button('Replace 1 month and copy'))
    await click(button('Replace and copy'))
    await vi.waitFor(() => expect(topDialog().textContent).toContain('Nothing was copied. The month 2026-12 has an approved run in the dashboard'))
    expect(hub.state.months.has(JAN)).toBe(false)
    expect(hub.state.months.get(DEC).revision).toBe(1)
  })

  test('a member who is not an admin cannot use it', async () => {
    await start(seed({ role: 'member' }))
    await act(async () => {})
    expect(button('Copy this month to…').disabled).toBe(true)
    expect(button('Copy this month to…').title).toBe('Only an admin of this company can change this.')
  })
})

describe('on its own, in this browser', () => {
  const key = (period) => `payroll_period_${company.id}_${period}`

  async function start() {
    localStorage.clear()
    const fake = { ...company, viewMonth: 11, autoCopy: { mode: 'ask' } }
    localStorage.setItem('payroll_app_state_v1', JSON.stringify({ identityFields, idFieldKey, globalColumns, companies: [fake], activeCompanyId: fake.id }))
    localStorage.setItem(key('2026-11'), JSON.stringify({ employees: octoberEmployees }))
    localStorage.setItem(key('2026-12'), JSON.stringify({ employees: [] }))
    window.PayrollHubBridge = {
      isEmbedded: () => false,
      isConnected: () => false,
      init: () => false,
      onStatus: () => () => {},
      requestData: () => Promise.resolve({ ok: false, error: 'Not embedded.' }),
      sendToDashboard: () => Promise.resolve({ ok: false, error: 'Not embedded.' }),
    }
    await render()
    await vi.waitFor(() => expect(container.textContent).toContain('November 2026'))
  }

  test('only months never saved are added; a saved one (even empty) is skipped, and Replace is not offered', async () => {
    await start()
    const december = localStorage.getItem(key('2026-12'))
    await chooseDecemberToFebruary()
    const preview = topDialog().textContent.replace(/\s+/g, ' ')
    expect(preview).toContain('December 2026Saved already: skipped')
    expect(preview).toContain('On its own, this app never replaces a saved month: there is no History here to bring it back.')
    expect(radio('Replace', topDialog())).toBeUndefined()
    await click(button('Copy to 2 months'))
    await vi.waitFor(() => expect(topDialog().textContent).toContain('Copied to 2 months; 1 skipped.'))
    expect(localStorage.getItem(key('2026-12'))).toBe(december)
    for (const period of ['2027-01', '2027-02']) {
      const saved = JSON.parse(localStorage.getItem(key(period))).employees
      expect(saved.map((e) => e.values.basicSalary)).toEqual(octoberEmployees.map((e) => e.values.basicSalary))
      expect(Object.keys(saved[0].values)).not.toContain('allowances')
    }
    expect(JSON.parse(localStorage.getItem(key('2026-11'))).employees).toEqual(json(octoberEmployees))
  })

  test('a month with no employees has nothing to copy', async () => {
    await start()
    localStorage.setItem(key('2026-11'), JSON.stringify({ employees: [] }))
    await act(async () => root.unmount())
    await render()
    await vi.waitFor(() => expect(container.textContent).toContain('November 2026'))
    expect(button('Copy this month to…').disabled).toBe(true)
    expect(button('Copy this month to…').title).toBe('This month has no employees.')
  })
})
