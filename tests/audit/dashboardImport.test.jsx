// @vitest-environment jsdom

// "Import to the dashboard" (lib/dashboardImport.js): this browser's column
// setup and companies, copied once into a stand-in for the dashboard
// (tests/helpers/fakeSetupHub.js). TEST data only.

import { beforeEach, describe, expect, test } from 'vitest'
import { createFakeSetupHub, installFakeBridge } from '../helpers/fakeSetupHub'
import { IMPORTED_KEY, PREFS_KEY, connectDashboard, dashboardStore, forgetDashboardSetup } from '../../src/lib/dashboardSetup'
import { companiesNotImported, defaultChoices, linkableCompanies, planImport, readyToImport, runImport } from '../../src/lib/dashboardImport'
import { computeGridForEmployees } from '../../src/lib/formulaEngine'
import { getColumnsByKey, getEffectiveColumns } from '../../src/lib/model'
import { loadPeriod, loadState } from '../../src/lib/storage'
import { identityFields, idFieldKey, globalColumns, company, octoberEmployees, septemberEmployees } from '../safetyNet/fixture'

// This browser: the safety-net company (BRN "C00000001"), a second one with a BRN in
// other capitals, one with no BRN, one whose BRN the dashboard does not have.
const browserCompanies = () => [
  structuredClone({ ...company, columnWidths: { basicSalary: 150, surname: 210 } }),
  { id: 'browser-b', name: 'TEST Co B (browser name)', columns: [], columnWidths: {}, viewYear: 2026, viewMonth: 9, details: { address: 'Old address', brn: ' test-brn-b ', customFields: [] } },
  { id: 'browser-c', name: 'TEST Co C', columns: [], columnWidths: {}, viewYear: 2026, viewMonth: 9, details: { address: '', brn: '', customFields: [] } },
  { id: 'browser-d', name: 'TEST Co D', columns: [], columnWidths: {}, viewYear: 2026, viewMonth: 9, details: { address: '', brn: 'NOT-THERE', customFields: [] } },
]
const A = { brn: 'C00000001', name: 'Fake Co Ltd', address: '1 Test Street\nPort Louis', role: 'admin' }
const B = { brn: 'TEST-BRN-B', name: 'TEST Co B', address: '2 Test Street', role: 'admin' }
const E = { brn: 'TEST-BRN-E', name: 'TEST Co E', address: null, role: 'admin' }
const V = { brn: 'TEST-BRN-V', name: 'TEST Co Viewed', address: null, role: 'member' }

let hub
let snapshotBefore

function seedBrowser() {
  localStorage.clear()
  localStorage.setItem(
    'payroll_app_state_v1',
    JSON.stringify({ identityFields, idFieldKey, globalColumns, companies: browserCompanies(), activeCompanyId: company.id }),
  )
  localStorage.setItem('payroll_period_company-fake_2026-10', JSON.stringify({ employees: octoberEmployees }))
  localStorage.setItem('payroll_period_company-fake_2026-09', JSON.stringify({ employees: septemberEmployees }))
}

// Every key the app had in this browser before the import, as text.
const browserCopyText = () =>
  Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('payroll_app_') || k.startsWith('payroll_period_')).sort().map((k) => [k, localStorage.getItem(k)]))

async function openDashboard(seed) {
  hub = createFakeSetupHub({ companies: [A, B, E, V], selectedBrn: A.brn, ...seed })
  installFakeBridge(hub)
  return connectDashboard()
}

const writes = () => hub.state.log.filter((m) => m.type === 'send-data')

beforeEach(() => {
  forgetDashboardSetup()
  seedBrowser()
  snapshotBefore = browserCopyText()
})

describe('the plan', () => {
  test('matches by BRN among the companies the user is an admin of, says why the others do not match, and writes nothing', async () => {
    expect(await openDashboard()).toMatchObject({ ok: true, empty: true })
    const plan = await planImport()
    expect(plan.ok).toBe(true)
    expect(plan.items.map((i) => [i.company.name, i.match?.name ?? null, i.reason])).toEqual([
      ['Fake Co Ltd', 'Fake Co Ltd', null],
      ['TEST Co B (browser name)', 'TEST Co B', null],
      ['TEST Co C', null, 'no-brn'],
      ['TEST Co D', null, 'no-match'],
    ])
    // The dashboard's name and address are shown next to this browser's, never changed.
    expect(plan.items[1].differences).toEqual([
      { field: 'Name', browser: 'TEST Co B (browser name)', dashboard: 'TEST Co B' },
      { field: 'Address', browser: 'Old address', dashboard: '2 Test Street' },
    ])
    expect(plan.items[0].differences).toEqual([])
    // A company the user only views is never offered.
    expect(plan.dashboard.map((d) => d.brn)).toEqual(['C00000001', 'TEST-BRN-B', 'TEST-BRN-E'])
    expect(plan.shared).toEqual({ existing: null })
    expect(writes()).toHaveLength(0)
    expect(browserCopyText()).toEqual(snapshotBefore)
  })

  test('"Link this company to..." offers only free companies, and counts only once confirmed', async () => {
    await openDashboard()
    const plan = await planImport()
    const choices = defaultChoices(plan)
    expect(choices.companies['browser-c']).toMatchObject({ target: null, action: 'skip' })
    expect(linkableCompanies(plan, choices, 'browser-c').map((d) => d.brn)).toEqual(['TEST-BRN-E'])
    choices.companies['browser-c'] = { target: 'TEST-BRN-E', action: 'import', manual: true, confirmed: false }
    expect(readyToImport(plan, choices)).toBe(false)
    // Once chosen for one company, it is not offered for another.
    expect(linkableCompanies(plan, choices, 'browser-d')).toEqual([])
    choices.companies['browser-c'].confirmed = true
    expect(readyToImport(plan, choices)).toBe(true)
  })

  test('a dashboard company that already has columns is a conflict, never resolved by itself', async () => {
    const shared = { id: '30000000-0000-4000-8000-0000000000aa', name: 'Shared column setup', body: { identityFields, idFieldKey, globalColumns: [] }, revision: 4 }
    await openDashboard({ shared: [shared], setups: { 'TEST-BRN-B': { shared_setup_id: shared.id, body: { columns: [], customFields: [] }, revision: 2 } } })
    const plan = await planImport()
    expect(plan.items[1]).toMatchObject({ hasSetup: true })
    expect(plan.shared.existing).toMatchObject({ id: shared.id, revision: 4, usedBy: ['TEST Co B'], differs: true })
    const choices = defaultChoices(plan)
    expect(choices.companies['browser-b'].action).toBe('skip')
    expect(choices.shared).toBeNull()
    expect(readyToImport(plan, choices)).toBe(false)
  })
})

describe('the import', () => {
  test('makes the shared setup once, attaches every chosen company, checks each, and leaves this browser\'s copy as it was', async () => {
    await openDashboard()
    const plan = await planImport()
    const choices = defaultChoices(plan)
    choices.companies['browser-c'] = { target: 'TEST-BRN-E', action: 'import', manual: true, confirmed: true }
    const outcomes = await runImport(plan, choices)

    expect(outcomes).toEqual([
      { ok: true, name: 'Shared column setup' },
      { ok: true, name: 'Fake Co Ltd' },
      { ok: true, name: 'TEST Co B (browser name)' },
      { ok: true, name: 'TEST Co C' },
    ])
    // The shared setup first, then each company, each read back.
    expect(writes().map((m) => [m.action, m.company_brn ?? null])).toEqual([
      ['save-shared', null],
      ['attach-company', 'C00000001'],
      ['attach-company', 'TEST-BRN-B'],
      ['attach-company', 'TEST-BRN-E'],
    ])
    expect(hub.state.shared.size).toBe(1)
    // Exactly what the app works with when it opens this browser's copy on its own (as it
    // reads it: a checkbox column is given "decimals: 2" then, known issue L3, used by nothing).
    const asTheAppReadsIt = JSON.parse(JSON.stringify(loadState()))
    const [setup] = [...hub.state.shared.values()]
    expect(setup.body).toEqual({ identityFields: asTheAppReadsIt.identityFields, idFieldKey, globalColumns: asTheAppReadsIt.globalColumns })
    expect(hub.state.setups.get('C00000001').body).toEqual({ columns: asTheAppReadsIt.companies[0].columns, customFields: company.details.customFields })
    // Nothing of the dashboard's companies was changed: there is no message that could.
    expect(hub.state.companies.find((c) => c.brn === 'TEST-BRN-B').name).toBe('TEST Co B')

    // This browser's copy is exactly as it was.
    expect(browserCopyText()).toEqual(snapshotBefore)
    // The note of what went where: names, BRNs, dates and revisions, no figure.
    const note = JSON.parse(localStorage.getItem(IMPORTED_KEY))
    expect(Object.keys(note.companies)).toEqual(['company-fake', 'browser-b', 'browser-c'])
    expect(note.companies['browser-b']).toMatchObject({ brn: 'TEST-BRN-B', company: 'TEST Co B', browserName: 'TEST Co B (browser name)', revision: 1 })
    expect(JSON.stringify(note)).not.toMatch(/basicSalary|18115|TST/)
    // Column widths carry over to the dashboard company.
    expect(JSON.parse(localStorage.getItem(PREFS_KEY))['C00000001']).toEqual({ columnWidths: { basicSalary: 150, surname: 210 }, viewYear: 2026, viewMonth: 10 })
    // Only the company left unlinked is still to import.
    expect(companiesNotImported().map((c) => c.id)).toEqual(['browser-d'])
  })

  test('a second import imports nothing twice', async () => {
    await openDashboard()
    let plan = await planImport()
    await runImport(plan, defaultChoices(plan))
    const before = writes().length
    plan = await planImport()
    expect(plan.items.map((i) => i.company.id)).toEqual(['browser-c', 'browser-d'])
    expect(readyToImport(plan, defaultChoices(plan))).toBe(false)
    expect(writes().length).toBe(before)
  })

  test('a check that finds a difference leaves the company unmarked, and this browser\'s copy in use', async () => {
    await openDashboard()
    const plan = await planImport()
    hub.state.failNext = null
    // The shared setup is stored right; the first company comes back changed.
    let calls = 0
    const handle = hub.handle
    hub.handle = (type, payload) => {
      if (type === 'send-data' && payload.rows[0].action === 'attach-company' && calls++ === 0) hub.state.corruptNextSave = true
      return handle(type, payload)
    }
    const outcomes = await runImport(plan, defaultChoices(plan))
    expect(outcomes[0]).toMatchObject({ ok: false, name: 'Fake Co Ltd', reason: expect.stringMatching(/not the same as this browser's copy/) })
    expect(outcomes.find((o) => o.name === 'TEST Co B (browser name)')).toMatchObject({ ok: true })
    expect(Object.keys(JSON.parse(localStorage.getItem(IMPORTED_KEY)).companies)).toEqual(['browser-b'])
    expect(companiesNotImported().map((c) => c.id)).toContain('company-fake')
    expect(browserCopyText()).toEqual(snapshotBefore)
  })

  test('a refused save leaves that company in this browser only; the others are not affected', async () => {
    await openDashboard()
    const plan = await planImport()
    hub.state.companies.find((c) => c.brn === 'TEST-BRN-B').role = 'member' // lost admin rights meanwhile
    const outcomes = await runImport(plan, defaultChoices(plan))
    expect(outcomes.map((o) => [o.name, o.ok])).toEqual([
      ['Shared column setup', true],
      ['Fake Co Ltd', true],
      ['TEST Co B (browser name)', false],
    ])
    expect(hub.state.setups.has('TEST-BRN-B')).toBe(false)
  })

  test('into an existing shared setup: "replace" saves this browser\'s as a new revision; "keep" leaves it', async () => {
    const shared = { id: '30000000-0000-4000-8000-0000000000aa', name: 'Shared column setup', body: { identityFields, idFieldKey, globalColumns: [] }, revision: 4 }
    for (const choice of ['replace', 'keep']) {
      forgetDashboardSetup()
      seedBrowser()
      await openDashboard({ shared: [shared], setups: { 'TEST-BRN-E': { shared_setup_id: shared.id, body: { columns: [], customFields: [] }, revision: 1 } } })
      const plan = await planImport()
      const choices = defaultChoices(plan)
      choices.shared = choice
      const outcomes = await runImport(plan, choices)
      expect(outcomes.every((o) => o.ok), choice).toBe(true)
      const stored = hub.state.shared.get(shared.id)
      expect(stored.revision, choice).toBe(choice === 'replace' ? 5 : 4)
      expect(stored.body.globalColumns.length, choice).toBe(choice === 'replace' ? globalColumns.length : 0)
      expect(writes().filter((m) => m.action === 'save-shared'), choice).toHaveLength(choice === 'replace' ? 1 : 0)
    }
  })
})

describe('the months in this browser after the import', () => {
  test('keep working with the imported setup: same keys, formulas, ID field and widths, and every calculated figure identical', async () => {
    const grids = (state, companyId) => {
      const own = state.companies.find((c) => c.id === companyId)
      const columns = getEffectiveColumns(own, state.globalColumns)
      return ['2026-09', '2026-10'].map((period) => {
        const [year, month] = period.split('-').map(Number)
        const { employees } = loadPeriod(companyId, year, month)
        expect(employees.length, period).toBeGreaterThan(0)
        return computeGridForEmployees(employees, columns, getColumnsByKey(columns))
      })
    }
    // The browser's copy as the app opens it on its own, before the import.
    const before = loadState()
    const resultsBefore = grids(before, 'company-fake')

    await openDashboard()
    const plan = await planImport()
    await runImport(plan, defaultChoices(plan))
    forgetDashboardSetup()
    await connectDashboard()
    const after = dashboardStore.loadState()

    // The dashboard company works on the browser company's months.
    expect(after.activeCompanyId).toBe('company-fake')
    const own = after.companies.find((c) => c.id === 'company-fake')
    expect(after.idFieldKey).toBe(before.idFieldKey)
    expect(after.identityFields.map((f) => f.key)).toEqual(before.identityFields.map((f) => f.key))
    const keysAndFormulas = (columns) => columns.map((c) => [c.key, c.formula ?? null, c.decimals ?? null, c.valueType ?? null, c.category])
    expect(keysAndFormulas(after.globalColumns)).toEqual(keysAndFormulas(before.globalColumns))
    expect(keysAndFormulas(own.columns)).toEqual(keysAndFormulas(before.companies[0].columns))
    expect(own.columnWidths).toEqual(before.companies[0].columnWidths)

    const resultsAfter = grids(after, 'company-fake')
    const figures = (gridsOfMonths) => gridsOfMonths.map((grid) => Object.fromEntries(Object.entries(grid).map(([id, row]) => [id, Object.fromEntries(Object.entries(row).map(([k, cell]) => [k, cell.value]))])))
    expect(figures(resultsAfter)).toEqual(figures(resultsBefore))
    // And the same as from the text stored in this browser, untouched by any reading of it.
    expect(figures(resultsAfter)).toEqual(figures(grids(JSON.parse(snapshotBefore.payroll_app_state_v1), 'company-fake')))
    expect(Object.keys(resultsAfter[1]).length).toBe(octoberEmployees.length)
  })
})
