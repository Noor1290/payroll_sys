// @vitest-environment jsdom

// "Import months to the dashboard" (lib/monthImport.js): this browser's months
// of the companies whose column setup was imported (Phase 2) go to the
// dashboard, once, each checked by reading it back and comparing every
// calculated figure. This browser's own copy is never changed. TEST data only.

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFakeSetupHub, installFakeBridge } from '../helpers/fakeSetupHub'
import { IMPORTED_KEY, connectDashboard, dashboardStore, forgetDashboardSetup } from '../../src/lib/dashboardSetup'
import { forgetDashboardMonths } from '../../src/lib/dashboardMonths'
import { defaultMonthChoices, hasMonthsToImport, planMonthImport, runMonthImport } from '../../src/lib/monthImport'
import { computeGridForEmployees } from '../../src/lib/formulaEngine'
import { getColumnsByKey, getEffectiveColumns } from '../../src/lib/model'
import { computeTotals } from '../../src/lib/totals'
import * as browserStore from '../../src/lib/storage'
import { identityFields, idFieldKey, globalColumns, company, octoberEmployees, septemberEmployees } from '../safetyNet/fixture'

const SHARED_ID = '30000000-0000-4000-8000-000000000001'
const A = { brn: 'C00000001', name: 'Fake Co Ltd', address: '1 Test Street\nPort Louis', role: 'admin' }
const B = { brn: 'TEST-BRN-B', name: 'TEST Co B', address: '2 Test Street', role: 'admin' }
const json = (value) => JSON.parse(JSON.stringify(value))

// This browser: Fake Co Ltd (imported in Phase 2) with September and October, an
// empty November, and TEST Co Local, never imported.
const local = { id: 'company-local', name: 'TEST Co Local', columns: [], columnWidths: {}, viewYear: 2026, viewMonth: 10, details: { address: '', brn: 'TEST-BRN-L', customFields: [] } }
const STATE = { identityFields, idFieldKey, globalColumns, companies: [company, local], activeCompanyId: company.id }

function seedBrowser() {
  localStorage.setItem('payroll_app_state_v1', JSON.stringify(STATE))
  localStorage.setItem('payroll_period_company-fake_2026-09', JSON.stringify({ employees: septemberEmployees }))
  localStorage.setItem('payroll_period_company-fake_2026-10', JSON.stringify({ employees: octoberEmployees }))
  localStorage.setItem('payroll_period_company-fake_2026-11', JSON.stringify({ employees: [] }))
  localStorage.setItem('payroll_period_company-local_2026-10', JSON.stringify({ employees: octoberEmployees.slice(0, 1) }))
  localStorage.setItem(IMPORTED_KEY, JSON.stringify({ companies: { 'company-fake': { brn: A.brn, company: A.name, revision: 1 } } }))
}

const browserText = () =>
  Object.fromEntries(
    Object.keys(localStorage)
      .filter((key) => key === 'payroll_app_state_v1' || key.startsWith('payroll_period_'))
      .sort()
      .map((key) => [key, localStorage.getItem(key)])
  )

function seed(more = {}) {
  return {
    companies: [A, B],
    selectedBrn: A.brn,
    shared: [{ id: SHARED_ID, name: 'Shared column setup', body: json({ identityFields, idFieldKey, globalColumns }), revision: 1 }],
    setups: {
      C00000001: { shared_setup_id: SHARED_ID, body: json({ columns: company.columns, customFields: company.details.customFields }), revision: 1 },
      'TEST-BRN-B': { shared_setup_id: SHARED_ID, body: { columns: [], customFields: [] }, revision: 1 },
    },
    monthsSupported: true,
    ...more,
  }
}

let hub
const writes = () => hub.state.log.filter((m) => m.type === 'send-data')

async function open(s = seed()) {
  hub = createFakeSetupHub(s)
  installFakeBridge(hub)
  return connectDashboard()
}

// Every figure of a month, as the app works it out with the given setup.
function figures(state, companyId, employees) {
  const own = state.companies.find((c) => c.id === companyId)
  const columns = getEffectiveColumns(own, state.globalColumns)
  const grid = computeGridForEmployees(employees, columns, getColumnsByKey(columns))
  return Object.fromEntries(Object.entries(grid).map(([id, row]) => [id, Object.fromEntries(Object.entries(row).map(([k, cell]) => [k, cell.value]))]))
}

beforeEach(() => {
  localStorage.clear()
  forgetDashboardSetup()
  forgetDashboardMonths()
  seedBrowser()
})

describe('the preview', () => {
  test('lists every company and month; a company not imported in Phase 2 is named, and left alone; nothing is written', async () => {
    await open()
    expect(hasMonthsToImport()).toBe(true)
    const plan = await planMonthImport()
    expect(plan.ok).toBe(true)
    const [fake, other] = plan.companies
    expect(fake).toMatchObject({ browserId: 'company-fake', brn: A.brn, reason: null })
    expect(fake.months.map((m) => [m.period, m.state, m.count])).toEqual([
      ['2026-09', 'new', septemberEmployees.length],
      ['2026-10', 'new', octoberEmployees.length],
      ['2026-11', 'empty', 0],
    ])
    expect(other).toMatchObject({ browserId: 'company-local', reason: expect.stringContaining('Import it to the dashboard first') })
    expect(other.months).toEqual([])
    expect(defaultMonthChoices(plan)).toEqual({ 'company-fake': { '2026-09': 'import', '2026-10': 'import' }, 'company-local': {} })
    expect(writes()).toEqual([])
  })

  test('refused while the dashboard is locked, before anything is read or written', async () => {
    await open(seed({ unlocked: false }))
    expect(await planMonthImport()).toMatchObject({ ok: false, code: 'locked' })
    expect(writes()).toEqual([])
  })

  test('a month the dashboard already has is a conflict, kept as it is unless "replace" is chosen', async () => {
    await open(seed({ months: { 'C00000001|2026-10': { employees: octoberEmployees.slice(0, 2) } } }))
    const plan = await planMonthImport()
    const october = plan.companies[0].months.find((m) => m.period === '2026-10')
    expect(october).toMatchObject({ state: 'conflict', existing: { revision: 1, employee_count: 2 } })
    expect(defaultMonthChoices(plan)['company-fake']['2026-10']).toBe('skip')
  })

  test('a month whose figures would not be the same with the dashboard\'s columns is not offered', async () => {
    const changed = json({ identityFields, idFieldKey, globalColumns })
    const formula = changed.globalColumns.find((c) => c.type === 'formula' && typeof c.formula === 'string')
    formula.formula = `(${formula.formula}) + 1`
    await open(seed({ shared: [{ id: SHARED_ID, name: 'Shared column setup', body: changed, revision: 1 }] }))
    const plan = await planMonthImport()
    const october = plan.companies[0].months.find((m) => m.period === '2026-10')
    expect(october.state).toBe('differs')
    expect(october.differences[0]).toEqual({ employee: 1, column: formula.name })
    expect(defaultMonthChoices(plan)['company-fake']).not.toHaveProperty('2026-10')
  })
})

describe('importing', () => {
  test('stores each month, checks every figure, notes it, and leaves this browser\'s copy untouched', async () => {
    const before = browserText()
    const browserState = browserStore.loadState()
    await open()
    const plan = await planMonthImport()
    const outcomes = await runMonthImport(plan, defaultMonthChoices(plan))
    expect(outcomes).toEqual([
      { ok: true, name: 'Fake Co Ltd, September 2026' },
      { ok: true, name: 'Fake Co Ltd, October 2026' },
    ])
    expect(hub.state.months.get('C00000001|2026-09').employees).toEqual(json(septemberEmployees))
    expect(hub.state.months.get('C00000001|2026-10').employees).toEqual(json(octoberEmployees))
    expect(hub.state.months.has('C00000001|2026-11')).toBe(false)
    expect(writes().map((w) => [w.action, w.period])).toEqual([
      ['save', '2026-09'],
      ['save', '2026-10'],
    ])
    expect(browserText()).toEqual(before)
    const notes = JSON.parse(localStorage.getItem(IMPORTED_KEY))
    expect(notes.months['company-fake']['2026-10']).toMatchObject({ brn: A.brn, revision: 1 })
    expect(JSON.stringify(notes)).not.toContain('F001')
    expect(hasMonthsToImport()).toBe(false)

    // Opened again inside the dashboard: the same months, and every figure identical to this browser's.
    forgetDashboardSetup()
    forgetDashboardMonths()
    await connectDashboard()
    const inside = dashboardStore.loadState()
    for (const [year, month, employees] of [
      [2026, 9, septemberEmployees],
      [2026, 10, octoberEmployees],
    ]) {
      const fromDashboard = (await dashboardStore.loadPeriod('company-fake', year, month)).employees
      expect(fromDashboard).toEqual(json(employees))
      expect(figures(inside, 'company-fake', fromDashboard)).toEqual(figures(browserState, 'company-fake', browserStore.loadPeriod('company-fake', year, month).employees))
    }

    // Totals across the imported months: the same as this browser's.
    const columns = getEffectiveColumns(company, globalColumns)
    const totalsOf = (periods) => computeTotals(periods, columns, getColumnsByKey(columns), idFieldKey)
    const range = async (load) => [
      { year: 2026, month: 9, employees: (await load('company-fake', 2026, 9)).employees },
      { year: 2026, month: 10, employees: (await load('company-fake', 2026, 10)).employees },
    ]
    expect(json(totalsOf(await range(dashboardStore.loadPeriod)))).toEqual(json(totalsOf(await range(browserStore.loadPeriod))))
  })

  test('a repeat imports nothing twice', async () => {
    await open()
    let plan = await planMonthImport()
    await runMonthImport(plan, defaultMonthChoices(plan))
    plan = await planMonthImport()
    expect(plan.companies[0].months.map((m) => m.state)).toEqual(['imported', 'imported', 'empty'])
    expect(await runMonthImport(plan, defaultMonthChoices(plan))).toEqual([])
  })

  test('"replace" stores this browser\'s month as a new revision; the dashboard\'s is kept in the month\'s history', async () => {
    await open(seed({ months: { 'C00000001|2026-10': { employees: octoberEmployees.slice(0, 2) } } }))
    const plan = await planMonthImport()
    const choices = defaultMonthChoices(plan)
    choices['company-fake']['2026-10'] = 'replace'
    const outcomes = await runMonthImport(plan, choices)
    expect(outcomes.every((o) => o.ok)).toBe(true)
    expect(hub.state.months.get('C00000001|2026-10')).toMatchObject({ revision: 2 })
    expect(hub.state.months.get('C00000001|2026-10').employees).toEqual(json(octoberEmployees))
    expect(hub.state.monthHistory.find((h) => h.key === 'C00000001|2026-10' && h.revision === 1).employees).toEqual(json(octoberEmployees.slice(0, 2)))
  })

  test('what the dashboard stored is not the same: NOT imported, not noted, and this browser\'s copy is still the one to use', async () => {
    const before = browserText()
    await open()
    const plan = await planMonthImport()
    hub.state.corruptNextSave = true
    const outcomes = await runMonthImport(plan, defaultMonthChoices(plan))
    expect(outcomes[0]).toEqual({ ok: false, name: 'Fake Co Ltd, September 2026', reason: expect.stringContaining("not the same as this browser's month") })
    expect(outcomes[1]).toEqual({ ok: true, name: 'Fake Co Ltd, October 2026' })
    const notes = JSON.parse(localStorage.getItem(IMPORTED_KEY))
    expect(Object.keys(notes.months['company-fake'])).toEqual(['2026-10'])
    expect(browserText()).toEqual(before)
    // The next preview shows September as a conflict, never merged.
    expect((await planMonthImport()).companies[0].months[0]).toMatchObject({ period: '2026-09', state: 'conflict' })
  })

  test('a refused month stays in this browser; the others are not affected', async () => {
    await open()
    const plan = await planMonthImport()
    hub.state.failNext = { action: 'save', code: 'too-large', error: 'The month is larger than the dashboard accepts (1 MB). Nothing was saved.' }
    const outcomes = await runMonthImport(plan, defaultMonthChoices(plan))
    expect(outcomes).toEqual([
      { ok: false, name: 'Fake Co Ltd, September 2026', reason: 'The month is larger than the dashboard accepts (1 MB). Nothing was saved.' },
      { ok: true, name: 'Fake Co Ltd, October 2026' },
    ])
    expect(hub.state.months.has('C00000001|2026-09')).toBe(false)
  })

  test('no answer, but it was stored: checked by reading it back, and imported once', async () => {
    await open()
    const plan = await planMonthImport()
    hub.state.failNext = { action: 'save', code: 'unavailable', store: true }
    const outcomes = await runMonthImport(plan, defaultMonthChoices(plan))
    expect(outcomes.every((o) => o.ok)).toBe(true)
    expect(hub.state.months.get('C00000001|2026-09').revision).toBe(1)
  })
})

test('not offered by a dashboard that does not keep months yet', async () => {
  await open(seed({ monthsSupported: false }))
  expect(hasMonthsToImport()).toBe(false)
  expect(await planMonthImport()).toMatchObject({ ok: false, code: 'unavailable' })
  vi.restoreAllMocks()
})
