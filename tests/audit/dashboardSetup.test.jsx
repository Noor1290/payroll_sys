// @vitest-environment jsdom

// Inside the dashboard, the column setup is kept there (lib/dashboardSetup.js),
// talking to a stand-in for the dashboard (tests/helpers/fakeSetupHub.js) that
// follows the rules of its migration 0013. TEST data only.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createFakeSetupHub, installFakeBridge } from '../helpers/fakeSetupHub'
import {
  IMPORTED_KEY,
  PREFS_KEY,
  connectDashboard,
  dashboardStore,
  forgetDashboardSetup,
  keepMine,
  periodIdFor,
  retrySaving,
  setupRevisions,
  setupStatus,
  sharedAccess,
  takeTheirs,
} from '../../src/lib/dashboardSetup'
import { identityFields, idFieldKey, globalColumns, company } from '../safetyNet/fixture'

const SHARED_ID = '30000000-0000-4000-8000-000000000001'
const A = { brn: 'TEST-BRN-A', name: 'TEST Co A', address: '1 Test Street', role: 'admin' }
const B = { brn: 'TEST-BRN-B', name: 'TEST Co B', address: '2 Test Street', role: 'admin' }
const sharedBody = () => structuredClone({ identityFields, idFieldKey, globalColumns })
const ownBody = () => structuredClone({ columns: company.columns, customFields: company.details.customFields })

function attachedSeed(more = {}) {
  return {
    companies: [A, B],
    selectedBrn: A.brn,
    shared: [{ id: SHARED_ID, name: 'Shared column setup', body: sharedBody(), revision: 1 }],
    setups: {
      'TEST-BRN-A': { shared_setup_id: SHARED_ID, body: ownBody(), revision: 1 },
      'TEST-BRN-B': { shared_setup_id: SHARED_ID, body: { columns: [], customFields: [] }, revision: 1 },
    },
    ...more,
  }
}

let hub
let sent
// What the app hands the store after a change: the state with that change made.
const change = (fn) => {
  const next = dashboardStore.loadState()
  fn(next)
  expect(dashboardStore.saveState(next)).toBe(true)
}
const saves = () => sent.filter((m) => m.type === 'send-data').map((m) => m.payload.rows[0])
const settle = () => vi.advanceTimersByTimeAsync(1100)

async function open(seed = attachedSeed()) {
  hub = createFakeSetupHub(seed)
  sent = installFakeBridge(hub)
  return connectDashboard()
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  forgetDashboardSetup()
})
afterEach(() => vi.useRealTimers())

describe('loading', () => {
  test('a dashboard that does not keep payroll setups is "not supported": the app stays with this browser', async () => {
    expect(await open({ ...attachedSeed(), supported: false })).toMatchObject({ ok: false, code: 'not-supported' })
    expect(dashboardStore.loadState()).toBeNull()
  })

  test('a company with no setup in the dashboard yet is "empty"', async () => {
    expect(await open({ companies: [A], selectedBrn: A.brn })).toMatchObject({ ok: true, empty: true, company: { brn: A.brn, role: 'admin' } })
    expect(dashboardStore.loadState()).toBeNull()
    expect(dashboardStore.saveState({ companies: [] })).toBe(false)
  })

  test('the setup is what the dashboard holds, exactly; name, address and BRN are the dashboard\'s', async () => {
    expect(await open()).toMatchObject({ ok: true, empty: false })
    const state = dashboardStore.loadState()
    expect(state.identityFields).toEqual(identityFields)
    expect(state.idFieldKey).toBe(idFieldKey)
    expect(state.globalColumns).toEqual(JSON.parse(JSON.stringify(globalColumns)))
    const a = state.companies.find((c) => c.details.brn === A.brn)
    expect(a).toMatchObject({ name: 'TEST Co A', details: { address: '1 Test Street', brn: 'TEST-BRN-A', customFields: company.details.customFields } })
    expect(a.columns).toEqual(JSON.parse(JSON.stringify(company.columns)))
    expect(state.activeCompanyId).toBe(a.id)
    // Both attached companies are held, for the checks that look across companies.
    expect(state.companies.map((c) => c.details.brn).sort()).toEqual(['TEST-BRN-A', 'TEST-BRN-B'])
    expect(setupRevisions()).toEqual({ shared: 1, company: 1 })
    expect(setupStatus.get()).toEqual({ state: 'saved', problem: null })
  })

  test('a company imported from this browser keeps its months: its id is the browser company\'s', async () => {
    localStorage.setItem(IMPORTED_KEY, JSON.stringify({ companies: { 'company-fake': { brn: 'test-brn-a ', company: 'TEST Co A' } } }))
    localStorage.setItem(PREFS_KEY, JSON.stringify({ 'TEST-BRN-A': { columnWidths: { basicSalary: 140 }, viewYear: 2026, viewMonth: 10 } }))
    await open()
    const state = dashboardStore.loadState()
    const a = state.companies.find((c) => c.details.brn === A.brn)
    expect(a).toMatchObject({ id: 'company-fake', columnWidths: { basicSalary: 140 }, viewYear: 2026, viewMonth: 10 })
    expect(periodIdFor('TEST-BRN-B')).toBe('dashboard_TEST-BRN-B')
  })

  test('a setup that cannot be read as it is, is refused: nothing is filled in or guessed', async () => {
    const seed = attachedSeed()
    seed.shared[0].body = { identityFields: [] } // no Global columns at all
    expect(await open(seed)).toMatchObject({ ok: false, code: 'invalid' })
    expect(dashboardStore.loadState()).toBeNull()
  })

  test('a dashboard that does not answer is "no answer", after a short wait', async () => {
    hub = createFakeSetupHub(attachedSeed())
    hub.state.failNext = { action: 'load', silent: true }
    sent = installFakeBridge(hub)
    const result = connectDashboard()
    await vi.advanceTimersByTimeAsync(15_100)
    expect(await result).toMatchObject({ ok: false, code: 'no-answer' })
  })
})

describe('saving', () => {
  test('one save a moment after the last change, never one per change, and nothing written to this browser\'s copy', async () => {
    localStorage.setItem('payroll_app_state_v1', '{"the browser copy":"left as it is"}')
    await open()
    for (const name of ['B', 'Ba', 'Bas', 'Basic pay']) {
      change((s) => {
        s.globalColumns[0].name = name
      })
      await vi.advanceTimersByTimeAsync(300)
    }
    expect(setupStatus.get().state).toBe('saving')
    expect(saves()).toHaveLength(0)
    await settle()
    expect(saves()).toEqual([
      expect.objectContaining({ action: 'save-shared', brn: 'TEST-BRN-A', shared_setup_id: SHARED_ID, expected_revision: 1, companies: [] }),
    ])
    expect(saves()[0].body.globalColumns[0].name).toBe('Basic pay')
    expect(setupStatus.get()).toEqual({ state: 'saved', problem: null })
    expect(hub.state.shared.get(SHARED_ID).revision).toBe(2)
    expect(localStorage.getItem('payroll_app_state_v1')).toBe('{"the browser copy":"left as it is"}')
  })

  test('never two saves at once: a change made while one is on its way goes in the next', async () => {
    await open()
    hub.state.delayMs = 3000
    change((s) => {
      s.globalColumns[0].name = 'First'
    })
    await settle()
    change((s) => {
      s.globalColumns[0].name = 'Second'
    })
    await vi.advanceTimersByTimeAsync(8000)
    expect(hub.state.mostSavesAtOnce).toBe(1)
    expect(saves().map((r) => [r.body.globalColumns[0].name, r.expected_revision])).toEqual([
      ['First', 1],
      ['Second', 2],
    ])
    expect(setupStatus.get().state).toBe('saved')
  })

  test('a company\'s own columns are saved as that company\'s, and the shared setup is not touched', async () => {
    await open()
    change((s) => {
      s.companies.find((c) => c.details.brn === A.brn).columns[0].name = 'Renamed here'
    })
    await settle()
    expect(saves()).toEqual([expect.objectContaining({ action: 'save-company', company_brn: 'TEST-BRN-A', expected_revision: 1 })])
    expect(hub.state.shared.get(SHARED_ID).revision).toBe(1)
    expect(setupRevisions()).toEqual({ shared: 1, company: 2 })
  })

  test('a change that reaches companies\' own columns too is ONE save, all or nothing', async () => {
    await open()
    // As a change of a Global column's key does: the column and every formula that uses it.
    change((s) => {
      s.globalColumns[0].key = 'renamedKey'
      s.companies.find((c) => c.details.brn === A.brn).columns[0].formula = 'renamedKey * 2'
    })
    await settle()
    expect(saves()).toHaveLength(1)
    expect(saves()[0]).toMatchObject({ action: 'save-shared', companies: [{ company_brn: 'TEST-BRN-A', expected_revision: 1 }] })
    expect(hub.state.setups.get('TEST-BRN-A').revision).toBe(2)
    expect(setupStatus.get().state).toBe('saved')
  })

  test('column widths and the month viewed are this browser\'s, never sent', async () => {
    await open()
    change((s) => {
      const a = s.companies.find((c) => c.details.brn === A.brn)
      a.columnWidths = { basicSalary: 222 }
      a.viewMonth = 3
    })
    await settle()
    expect(saves()).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem(PREFS_KEY))['TEST-BRN-A']).toMatchObject({ columnWidths: { basicSalary: 222 }, viewMonth: 3 })
  })

  test('the name, address and BRN on screen are never sent: the dashboard\'s are kept', async () => {
    await open()
    change((s) => {
      const a = s.companies.find((c) => c.details.brn === A.brn)
      a.name = 'Something else'
      a.details.address = 'Elsewhere'
    })
    await settle()
    expect(saves()).toHaveLength(0)
  })
})

describe('when a save does not go through', () => {
  test('someone else saved since: NOT saved, both choices offered; "Save mine over it" saves over theirs as a new revision', async () => {
    await open()
    hub.changeSharedElsewhere(SHARED_ID, { ...sharedBody(), by: 'another admin' })
    change((s) => {
      s.globalColumns[0].name = 'Mine'
    })
    await settle()
    expect(setupStatus.get()).toMatchObject({ state: 'not-saved', problem: { code: 'stale' } })
    // What was typed is still there, in memory only.
    expect(dashboardStore.loadState().globalColumns[0].name).toBe('Mine')
    const writes = sent.filter((m) => m.type === 'send-data').length

    await keepMine()
    expect(setupStatus.get().state).toBe('saved')
    expect(sent.filter((m) => m.type === 'send-data').length).toBe(writes + 1)
    expect(hub.state.shared.get(SHARED_ID)).toMatchObject({ revision: 3 })
    expect(hub.state.shared.get(SHARED_ID).body.globalColumns[0].name).toBe('Mine')
  })

  test('"Use the dashboard\'s version" drops what is on screen and loads theirs', async () => {
    await open()
    hub.changeSharedElsewhere(SHARED_ID, { ...sharedBody(), globalColumns: [] })
    change((s) => {
      s.globalColumns[0].name = 'Mine'
    })
    await settle()
    expect(setupStatus.get().state).toBe('not-saved')
    expect(await takeTheirs()).toMatchObject({ ok: true })
    expect(dashboardStore.loadState().globalColumns).toEqual([])
    expect(setupStatus.get().state).toBe('saved')
  })

  test('no answer, but it WAS stored: seen by looking, and marked saved without saving twice', async () => {
    await open()
    hub.state.failNext = { action: 'save-shared', store: true, silent: true }
    change((s) => {
      s.globalColumns[0].name = 'Arrived'
    })
    await vi.advanceTimersByTimeAsync(12_000)
    expect(setupStatus.get().state).toBe('saved')
    expect(saves()).toHaveLength(1)
    expect(hub.state.shared.get(SHARED_ID).revision).toBe(2)
    expect(setupRevisions()).toEqual({ shared: 2, company: 1 })
  })

  test('no answer, and it was NOT stored: seen by looking, and NOT saved, never taken as saved', async () => {
    await open()
    hub.state.failNext = { action: 'save-shared', silent: true }
    change((s) => {
      s.globalColumns[0].name = 'Lost on the way'
    })
    await vi.advanceTimersByTimeAsync(12_000)
    expect(hub.state.shared.get(SHARED_ID).revision).toBe(1)
    expect(setupStatus.get()).toMatchObject({ state: 'not-saved', problem: { code: 'no-answer' } })
    expect(setupRevisions()).toEqual({ shared: 1, company: 1 })
  })

  test('unavailable and NOT stored: NOT saved, kept on screen, tried again by itself, and saved once the dashboard is back', async () => {
    await open()
    hub.state.down = true
    change((s) => {
      s.globalColumns[0].name = 'Waiting'
    })
    await settle()
    expect(setupStatus.get()).toMatchObject({ state: 'not-saved', problem: { code: 'unavailable' } })
    expect(hub.state.shared.get(SHARED_ID).revision).toBe(1)
    hub.state.down = false
    await vi.advanceTimersByTimeAsync(15_100)
    expect(setupStatus.get().state).toBe('saved')
    expect(hub.state.shared.get(SHARED_ID).body.globalColumns[0].name).toBe('Waiting')
  })

  test('"Try saving again" saves at once', async () => {
    await open()
    hub.state.failNext = { action: 'save-company', code: 'unavailable' }
    change((s) => {
      s.companies.find((c) => c.details.brn === A.brn).details.customFields = []
    })
    await settle()
    expect(setupStatus.get().state).toBe('not-saved')
    await retrySaving()
    expect(setupStatus.get().state).toBe('saved')
    expect(hub.state.setups.get('TEST-BRN-A').body.customFields).toEqual([])
  })
})

describe('who may change what', () => {
  test('an admin of some but not all companies using the Global columns sees them read-only, and nothing is sent', async () => {
    await open(attachedSeed({ othersAttached: [{ brn: 'TEST-BRN-Z', role: null, shared_setup_id: SHARED_ID }] }))
    expect(sharedAccess()).toMatchObject({ canChange: false, companies: 3, adminOf: 2 })
    change((s) => {
      s.globalColumns[0].name = 'Not allowed'
    })
    await settle()
    expect(saves()).toHaveLength(0)
    expect(setupStatus.get()).toMatchObject({ state: 'not-saved', problem: { code: 'forbidden' } })
  })

  test('a Global column changed by one admin is what the next admin loads, for every attached company', async () => {
    await open()
    change((s) => {
      s.globalColumns.push({ id: 'col-bonus', name: 'Bonus', key: 'bonus', type: 'input', category: 'general', valueType: 'number', decimals: 2 })
    })
    await settle()
    // The second admin, in another browser, with company B selected.
    forgetDashboardSetup()
    hub.state.selectedBrn = B.brn
    await connectDashboard()
    const state = dashboardStore.loadState()
    expect(state.globalColumns.map((c) => c.key)).toContain('bonus')
    expect(state.companies.find((c) => c.id === state.activeCompanyId).details.brn).toBe('TEST-BRN-B')
  })
})
