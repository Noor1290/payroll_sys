// @vitest-environment jsdom

// Inside the dashboard, the months are kept there too (lib/dashboardMonths.js),
// behind its password gate, talking to a stand-in for the dashboard
// (tests/helpers/fakeSetupHub.js) that follows the rules of its migration 0014.
// TEST data only.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createFakeSetupHub, installFakeBridge } from '../helpers/fakeSetupHub'
import { connectDashboard, dashboardStore, forgetDashboardSetup, setupStatus } from '../../src/lib/dashboardSetup'
import {
  forgetDashboardMonths,
  gateChanged,
  keepMyMonth,
  monthStatus,
  monthsSupported,
  onMonthsChanged,
  takeTheirMonth,
} from '../../src/lib/dashboardMonths'
import { identityFields, idFieldKey, globalColumns, company, octoberEmployees, septemberEmployees } from '../safetyNet/fixture'

const SHARED_ID = '30000000-0000-4000-8000-000000000001'
const A = { brn: 'TEST-BRN-A', name: 'TEST Co A', address: '1 Test Street', role: 'admin' }
const B = { brn: 'TEST-BRN-B', name: 'TEST Co B', address: '2 Test Street', role: 'admin' }
// The app's id for each dashboard company (nothing imported from this browser).
const A_ID = 'dashboard_TEST-BRN-A'
const B_ID = 'dashboard_TEST-BRN-B'

const json = (value) => JSON.parse(JSON.stringify(value))

function seed(more = {}) {
  return {
    companies: [A, B],
    selectedBrn: A.brn,
    shared: [{ id: SHARED_ID, name: 'Shared column setup', body: json({ identityFields, idFieldKey, globalColumns }), revision: 1 }],
    setups: {
      'TEST-BRN-A': { shared_setup_id: SHARED_ID, body: json({ columns: company.columns, customFields: company.details.customFields }), revision: 1 },
      'TEST-BRN-B': { shared_setup_id: SHARED_ID, body: { columns: [], customFields: [] }, revision: 1 },
    },
    monthsSupported: true,
    months: {
      'TEST-BRN-A|2026-10': { employees: octoberEmployees },
      'TEST-BRN-A|2026-09': { employees: septemberEmployees },
      'TEST-BRN-B|2026-10': { employees: octoberEmployees.slice(0, 2) },
    },
    ...more,
  }
}

let hub
let sent
const monthMessages = () => sent.filter((m) => m.payload.dataType === 'payroll-month')
const monthSaves = () => monthMessages().filter((m) => m.type === 'send-data').map((m) => m.payload.rows[0])
const settle = () => vi.advanceTimersByTimeAsync(1100)
const stored = (key) => hub.state.months.get(key)

async function open(s = seed()) {
  hub = createFakeSetupHub(s)
  sent = installFakeBridge(hub)
  // Same call App makes on mount: the dashboard's gate notices reach the app.
  window.PayrollHubBridge.init({ appId: 'payroll', onData: (payload) => gateChanged(payload.rows[0].unlocked) })
  return connectDashboard()
}

/** A month, read as the app reads it: at once when held, or after the dashboard answers. */
async function load(id, year, month) {
  return await dashboardStore.loadPeriod(id, year, month)
}

/** What the app hands the store after a change in the Employee Table. */
async function typeInto(id, year, month, change) {
  const { employees } = await load(id, year, month)
  const next = json(employees)
  change(next)
  expect(dashboardStore.savePeriod(id, year, month, { employees: next })).toBe(true)
  return next
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  forgetDashboardSetup()
  forgetDashboardMonths()
})
afterEach(() => vi.useRealTimers())

describe('which store keeps the months', () => {
  test('a dashboard that does not keep months yet: they stay in this browser, as in Phase 2', async () => {
    localStorage.setItem(`payroll_period_${A_ID}_2026-10`, JSON.stringify({ employees: octoberEmployees }))
    await open(seed({ monthsSupported: false }))
    expect(monthsSupported()).toBe(false)
    expect(dashboardStore.loadPeriod(A_ID, 2026, 10)).toEqual({ employees: octoberEmployees })
    expect(monthSaves()).toEqual([])
  })

  test('a dashboard that keeps them: the month is read from it, exactly as stored, and never from this browser', async () => {
    localStorage.setItem(`payroll_period_${A_ID}_2026-10`, JSON.stringify({ employees: [{ id: 'browser-only', values: {} }] }))
    await open()
    expect(monthsSupported()).toBe(true)
    const pending = dashboardStore.loadPeriod(A_ID, 2026, 10)
    expect(typeof pending.then).toBe('function')
    expect(await pending).toEqual({ employees: json(octoberEmployees) })
    // Held now: read again at once, without asking.
    const asked = monthMessages().length
    expect(dashboardStore.loadPeriod(A_ID, 2026, 10)).toEqual({ employees: json(octoberEmployees) })
    expect(monthMessages()).toHaveLength(asked)
  })

  test('months asked for together are read in one load (a Totals range)', async () => {
    await open()
    const before = monthMessages().filter((m) => m.payload.params?.action === 'load').length
    const months = await Promise.all([9, 10, 11].map((m) => dashboardStore.loadPeriod(A_ID, 2026, m)))
    expect(months.map((m) => m.employees.length)).toEqual([septemberEmployees.length, octoberEmployees.length, 0])
    const loads = monthMessages().filter((m) => m.payload.params?.action === 'load')
    expect(loads).toHaveLength(before + 1)
    expect(loads.at(-1).payload.params.periods).toEqual(['2026-09', '2026-10', '2026-11'])
  })
})

describe('saving a month', () => {
  test('one save a moment after the last change, with the revision it replaces and the setup revisions; nothing in this browser', async () => {
    await open()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    for (const salary of ['1', '19', '191', '19115']) {
      await typeInto(A_ID, 2026, 10, (e) => {
        e[0].values.basicSalary = salary
      })
    }
    expect(monthStatus.get().state).toBe('saving')
    await settle()
    expect(monthSaves()).toEqual([
      expect.objectContaining({ action: 'save', brn: A.brn, period: '2026-10', expected_revision: 1, shared_revision: 1, company_revision: 1 }),
    ])
    expect(monthSaves()[0]).not.toHaveProperty('company_brn')
    expect(stored('TEST-BRN-A|2026-10').employees[0].values.basicSalary).toBe('19115')
    expect(stored('TEST-BRN-A|2026-10').revision).toBe(2)
    expect(monthStatus.get()).toMatchObject({ state: 'saved', problem: null })
    expect(setItem.mock.calls.filter(([key]) => String(key).startsWith('payroll_'))).toEqual([])
    setItem.mockRestore()
  })

  test('a month the dashboard does not have yet is saved as new (revision 0 last seen), only once something is typed', async () => {
    await open()
    expect(await load(A_ID, 2026, 12)).toEqual({ employees: [] })
    expect(dashboardStore.savePeriod(A_ID, 2026, 12, { employees: [] })).toBe(true)
    await settle()
    expect(monthSaves()).toEqual([])
    await typeInto(A_ID, 2026, 12, (e) => e.push({ id: 'emp-new', values: { id: 'F100' } }))
    await settle()
    expect(monthSaves()).toEqual([expect.objectContaining({ period: '2026-12', expected_revision: 0 })])
    expect(stored('TEST-BRN-A|2026-12')).toMatchObject({ revision: 1, employees: [{ id: 'emp-new', values: { id: 'F100' } }] })
  })

  test('a month that was not read is never saved blind over the dashboard\'s', async () => {
    await open()
    expect(dashboardStore.savePeriod(A_ID, 2026, 10, { employees: [] })).toBe(false)
    await settle()
    expect(monthSaves()).toEqual([])
  })

  test('never two saves at once for a month: a change made while one is on its way goes in the next', async () => {
    await open()
    await load(A_ID, 2026, 10)
    hub.state.delayMs = 3000
    await typeInto(A_ID, 2026, 10, (e) => {
      e[0].values.basicSalary = '1'
    })
    await settle()
    await typeInto(A_ID, 2026, 10, (e) => {
      e[0].values.basicSalary = '2'
    })
    await vi.advanceTimersByTimeAsync(8000)
    expect(hub.state.mostSavesAtOnce).toBe(1)
    expect(monthSaves().map((r) => r.expected_revision)).toEqual([1, 2])
    expect(stored('TEST-BRN-A|2026-10').employees[0].values.basicSalary).toBe('2')
  })

  test('no answer, but it WAS stored: seen by looking, and marked saved without saving twice', async () => {
    await open()
    hub.state.failNext = { action: 'save', code: 'unavailable', store: true }
    await typeInto(A_ID, 2026, 10, (e) => {
      e[0].values.basicSalary = '7'
    })
    await settle()
    expect(monthStatus.get()).toMatchObject({ state: 'saved', problem: null })
    expect(stored('TEST-BRN-A|2026-10').revision).toBe(2)
  })

  test('unavailable and NOT stored: NOT saved, kept in memory, tried again by itself', async () => {
    await open()
    hub.state.failNext = { action: 'save', code: 'unavailable' }
    await typeInto(A_ID, 2026, 10, (e) => {
      e[0].values.basicSalary = '8'
    })
    await settle()
    expect(monthStatus.get()).toMatchObject({ state: 'not-saved', problem: { code: 'unavailable', period: '2026-10' } })
    expect((await load(A_ID, 2026, 10)).employees[0].values.basicSalary).toBe('8')
    await vi.advanceTimersByTimeAsync(15_100)
    expect(monthStatus.get().state).toBe('saved')
    expect(stored('TEST-BRN-A|2026-10').employees[0].values.basicSalary).toBe('8')
  })
})

describe('the password gate', () => {
  test('locked when the app opens: nothing is read, the month is blocked as locked', async () => {
    await open(seed({ unlocked: false }))
    expect(dashboardStore.loadPeriod(A_ID, 2026, 10)).toEqual({ employees: [], blocked: expect.objectContaining({ code: 'locked' }) })
    expect(monthMessages().map((m) => m.payload.params?.action ?? m.payload.rows[0].action)).toEqual(['gate'])
  })

  test('locking mid-entry: nothing is sent, what was typed stays in memory as NOT saved, and is saved on unlocking', async () => {
    await open()
    await typeInto(A_ID, 2026, 10, (e) => {
      e[0].values.basicSalary = '20000'
    })
    // The dashboard locks before the save goes out (it tells the app).
    hub.setGate(false)
    expect(monthStatus.get().gate).toBe('locked')
    await settle()
    expect(monthSaves()).toEqual([])
    expect(monthStatus.get()).toMatchObject({ state: 'not-saved', problem: { code: 'locked' } })
    expect(stored('TEST-BRN-A|2026-10').employees[0].values.basicSalary).toBe(octoberEmployees[0].values.basicSalary)
    // Still on screen, in memory only.
    expect((await load(A_ID, 2026, 10)).employees[0].values.basicSalary).toBe('20000')
    expect(Object.keys(localStorage).filter((k) => k.startsWith('payroll_period'))).toEqual([])

    hub.setGate(true)
    await settle()
    expect(monthStatus.get()).toMatchObject({ state: 'saved', problem: null, gate: 'open' })
    expect(stored('TEST-BRN-A|2026-10')).toMatchObject({ revision: 2 })
    expect(stored('TEST-BRN-A|2026-10').employees[0].values.basicSalary).toBe('20000')
  })

  test('a save refused as locked (the notice not yet arrived) is kept and saved on unlocking', async () => {
    await open()
    await typeInto(A_ID, 2026, 10, (e) => {
      e[0].values.basicSalary = '21000'
    })
    hub.state.unlocked = false // locked, without telling the app
    await settle()
    expect(monthSaves()).toHaveLength(1)
    expect(monthStatus.get()).toMatchObject({ state: 'not-saved', gate: 'locked', problem: { code: 'locked' } })
    expect(stored('TEST-BRN-A|2026-10').revision).toBe(1)
    hub.setGate(true)
    await settle()
    expect(stored('TEST-BRN-A|2026-10')).toMatchObject({ revision: 2 })
  })

  test('someone who is not an admin of the company: the months are blocked, without asking', async () => {
    await open(seed({ companies: [{ ...A, role: 'member' }, B] }))
    expect(dashboardStore.loadPeriod(A_ID, 2026, 10)).toEqual({ employees: [], blocked: expect.objectContaining({ code: 'forbidden' }) })
    expect(monthMessages().filter((m) => m.payload.params?.action === 'load')).toEqual([])
  })
})

describe('someone else saved the same month first', () => {
  test('NOT saved, both choices offered; "Save mine over it" saves over theirs, keeping theirs in the history', async () => {
    await open()
    await load(A_ID, 2026, 10)
    hub.changeMonthElsewhere(A.brn, '2026-10', octoberEmployees.slice(0, 1))
    await typeInto(A_ID, 2026, 10, (e) => {
      e[1].values.basicSalary = '49000'
    })
    await settle()
    expect(monthStatus.get()).toMatchObject({
      state: 'not-saved',
      problem: { code: 'stale', period: '2026-10', error: 'Someone else saved October 2026 of TEST Co A in the dashboard since it was opened here.' },
    })
    expect(stored('TEST-BRN-A|2026-10')).toMatchObject({ revision: 2, by: 'other' })

    await keepMyMonth()
    expect(monthStatus.get()).toMatchObject({ state: 'saved', problem: null })
    expect(stored('TEST-BRN-A|2026-10')).toMatchObject({ revision: 3, by: 'me' })
    expect(stored('TEST-BRN-A|2026-10').employees[1].values.basicSalary).toBe('49000')
    expect(monthSaves().at(-1)).toMatchObject({ expected_revision: 2, keep_previous: true })
    // Theirs is kept in the month's history.
    expect(hub.state.monthHistory.find((h) => h.key === 'TEST-BRN-A|2026-10' && h.revision === 2).employees).toEqual(json(octoberEmployees.slice(0, 1)))
  })

  test('"Use the dashboard\'s version" drops what is on screen for that month and takes theirs', async () => {
    await open()
    await load(A_ID, 2026, 10)
    hub.changeMonthElsewhere(A.brn, '2026-10', octoberEmployees.slice(0, 1))
    await typeInto(A_ID, 2026, 10, (e) => {
      e[1].values.basicSalary = '49000'
    })
    await settle()
    const told = vi.fn()
    const stop = onMonthsChanged(told)
    await takeTheirMonth()
    stop()
    expect(told).toHaveBeenCalledWith({ reason: 'replaced', brn: A.brn, period: '2026-10' })
    expect(monthStatus.get()).toMatchObject({ state: 'saved', problem: null })
    expect(await load(A_ID, 2026, 10)).toEqual({ employees: json(octoberEmployees.slice(0, 1)) })
    expect(stored('TEST-BRN-A|2026-10')).toMatchObject({ revision: 2, by: 'other' })
  })
})

describe('a change of key', () => {
  const renameGlobal = (state, from, to) => {
    const column = state.globalColumns.find((c) => c.key === from)
    column.key = to
  }

  test('the counts the question shows come from the dashboard\'s list of months, without reading them', async () => {
    await open()
    expect(dashboardStore.countPeriodsHoldingKey([A_ID, B_ID], 'basicSalary')).toEqual({ periods: 3, companies: 2 })
    expect(dashboardStore.countPeriodsHoldingKey([A_ID], 'basicSalary')).toEqual({ periods: 2, companies: 1 })
    expect(monthMessages().filter((m) => m.payload.params?.action === 'load')).toEqual([])
  })

  test('a Global key: ONE save of the setup and every month it reaches, in both companies; this browser untouched', async () => {
    localStorage.setItem('payroll_app_state_v1', '{"the browser copy":"left as it is"}')
    await open()
    await load(A_ID, 2026, 10)
    expect(dashboardStore.renameValueKeyInPeriods([A_ID, B_ID], 'basicSalary', 'basicPay')).toBe(true)
    // The app then renames the column itself, and the month on screen.
    const state = dashboardStore.loadState()
    renameGlobal(state, 'basicSalary', 'basicPay')
    dashboardStore.saveState(state)
    await typeInto(A_ID, 2026, 10, () => {})
    await settle()
    await settle()

    const keyChanges = monthSaves().filter((r) => r.action === 'key-change')
    expect(keyChanges).toEqual([
      expect.objectContaining({ moves: [{ old_key: 'basicSalary', new_key: 'basicPay', company_brn: null }], shared: expect.objectContaining({ expected_revision: 1 }) }),
    ])
    expect(monthSaves().filter((r) => r.action === 'save')).toEqual([])
    expect(sent.filter((m) => m.payload.dataType === 'payroll-setup' && m.type === 'send-data')).toEqual([])
    for (const key of ['TEST-BRN-A|2026-10', 'TEST-BRN-A|2026-09', 'TEST-BRN-B|2026-10']) {
      const month = stored(key)
      expect(month.revision, key).toBe(2)
      expect(month.employees.some((e) => 'basicSalary' in e.values), key).toBe(false)
      expect(month.employees[0].values.basicPay, key).toBeDefined()
    }
    expect(hub.state.shared.get(SHARED_ID).revision).toBe(2)
    expect(setupStatus.get()).toMatchObject({ state: 'saved' })
    expect(monthStatus.get()).toMatchObject({ state: 'saved' })
    expect(localStorage.getItem('payroll_app_state_v1')).toBe('{"the browser copy":"left as it is"}')

    // The month on screen follows the dashboard's revision: the next change is not refused.
    await typeInto(A_ID, 2026, 10, (e) => {
      e[0].values.basicPay = '1'
    })
    await settle()
    expect(monthSaves().at(-1)).toMatchObject({ action: 'save', expected_revision: 2, shared_revision: 2 })
    expect(monthStatus.get()).toMatchObject({ state: 'saved' })
  })

  test('refused (someone changed the setup): nothing moves anywhere, and it is NOT saved', async () => {
    await open()
    hub.changeSharedElsewhere(SHARED_ID, json({ identityFields, idFieldKey, globalColumns }))
    dashboardStore.renameValueKeyInPeriods([A_ID, B_ID], 'basicSalary', 'basicPay')
    const state = dashboardStore.loadState()
    renameGlobal(state, 'basicSalary', 'basicPay')
    dashboardStore.saveState(state)
    await settle()
    await settle()
    expect(setupStatus.get()).toMatchObject({ state: 'not-saved', problem: { code: 'stale' } })
    expect(stored('TEST-BRN-A|2026-10')).toMatchObject({ revision: 1 })
    expect(stored('TEST-BRN-A|2026-10').employees[0].values.basicSalary).toBe(octoberEmployees[0].values.basicSalary)
  })

  test('while the dashboard is locked: refused as locked, then stored on unlocking', async () => {
    await open()
    hub.state.unlocked = false
    dashboardStore.renameValueKeyInPeriods([A_ID, B_ID], 'basicSalary', 'basicPay')
    const state = dashboardStore.loadState()
    renameGlobal(state, 'basicSalary', 'basicPay')
    dashboardStore.saveState(state)
    await settle()
    expect(setupStatus.get()).toMatchObject({ state: 'not-saved', problem: { code: 'locked' } })
    expect(stored('TEST-BRN-A|2026-10').revision).toBe(1)
    hub.setGate(true)
    await settle()
    await settle()
    expect(setupStatus.get()).toMatchObject({ state: 'saved' })
    expect(stored('TEST-BRN-A|2026-10').employees[0].values.basicPay).toBe(octoberEmployees[0].values.basicSalary)
  })
})
