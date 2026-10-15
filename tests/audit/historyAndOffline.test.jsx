// @vitest-environment jsdom

// Phase 3 follow-ups, inside a stand-in for the dashboard (tests/helpers/fakeSetupHub.js,
// the rules of its migrations 0013 and 0014):
//   - the History of the shared column setup, of a company's own columns and of a month:
//     every revision with when and who, a look at one that changes nothing, and "Restore
//     this version", which asks first and saves a NEW revision. Restoring a setup names
//     the keys and formulas that change and the months saved with a later revision that
//     would be worked out differently;
//   - the read-only offline copy of the last column setup loaded, when the dashboard
//     cannot be reached, which never holds a month.
// TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../../src/App'
import { resetDataStore } from '../../src/lib/dataStore'
import { forgetDashboardSetup, IMPORTED_KEY, OFFLINE_KEY, PREFS_KEY } from '../../src/lib/dashboardSetup'
import { forgetDashboardMonths } from '../../src/lib/dashboardMonths'
import { sameJson } from '../../src/lib/hubWire'
import { createFakeSetupHub, installFakeBridge } from '../helpers/fakeSetupHub'
import { identityFields, idFieldKey, globalColumns, company, octoberEmployees } from '../safetyNet/fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SHARED_ID = '30000000-0000-4000-8000-000000000001'
const A = { brn: 'C00000001', name: 'Fake Co Ltd', address: '1 Test Street\nPort Louis', role: 'admin' }
const OCT = 'C00000001|2026-10'
const json = (value) => JSON.parse(JSON.stringify(value))
const SHARED_1 = json({ identityFields, idFieldKey, globalColumns })
const OWN_1 = json({ columns: company.columns, customFields: company.details.customFields })

// Revision 2 of the shared setup, saved by someone else: Travelling's key and two formulas changed.
const SHARED_2 = json({
  identityFields,
  idFieldKey,
  globalColumns: globalColumns.map((c) =>
    c.key === 'travelling'
      ? { ...c, key: 'travel' }
      : c.key === 'grossPay'
        ? { ...c, formula: 'emoluments + travel' }
        : c.key === 'netPay'
          ? { ...c, formula: 'grossPay - totalDeductions - 100' }
          : c
  ),
})

function seedBrowser() {
  localStorage.clear()
  localStorage.setItem(PREFS_KEY, JSON.stringify({ [A.brn]: { columnWidths: {}, viewYear: 2026, viewMonth: 10 } }))
  localStorage.setItem(IMPORTED_KEY, JSON.stringify({ companies: {}, months: {} }))
}

function hubSeed(more = {}) {
  return {
    companies: [A],
    selectedBrn: A.brn,
    shared: [{ id: SHARED_ID, name: 'Shared column setup', body: SHARED_1, revision: 1 }],
    setups: { [A.brn]: { shared_setup_id: SHARED_ID, body: OWN_1, revision: 1 } },
    monthsSupported: true,
    months: { [OCT]: { employees: octoberEmployees } },
    ...more,
  }
}

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
const sends = (dataType) => sent.filter((m) => m.type === 'send-data' && m.payload.dataType === dataType)

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

async function startInDashboard(seed = hubSeed(), waitFor = 'kept in the dashboard') {
  hub = hub ?? createFakeSetupHub(seed)
  sent = installFakeBridge(hub)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<App />))
  await vi.waitFor(() => expect(text()).toContain(waitFor))
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

async function openTab(label) {
  await click(button(label))
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

// ---------- the column setup ----------

describe('the History of the column setup', () => {
  async function openSharedHistory() {
    await openTab('Global Columns')
    await click(button('History of the Global columns'))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Revision 1'))
  }

  test('lists every revision newest first, with when and who; looking at one changes nothing', async () => {
    hub = createFakeSetupHub(hubSeed())
    hub.changeSharedElsewhere(SHARED_ID, SHARED_2)
    await startInDashboard()
    const before = { log: hub.state.log.length, shared: structuredClone(hub.state.shared.get(SHARED_ID)) }
    await openSharedHistory()

    const listed = all('[aria-label="Saved versions"] button', dialog()).map((b) => b.textContent.replace(/\s+/g, ' '))
    const titles = all('[aria-label="Saved versions"] button', dialog()).map((b) => b.querySelector('span').textContent)
    expect(titles).toEqual(['Revision 2 (current)', 'Revision 1'])
    for (const line of listed) expect(line).toMatch(/\d{4}, \d{2}:\d{2}, saved by you/)

    await click(startingWith('Revision 1', dialog()))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Global columns'))
    // Its columns, as they were: Travelling under its old key.
    expect(dialog().textContent).toContain('travelling')
    expect(dialog().textContent).toContain('emoluments + travelling')
    // Only reads were sent; nothing was saved.
    expect(sent.filter((m) => m.type === 'send-data')).toEqual([])
    expect(hub.state.shared.get(SHARED_ID)).toEqual(before.shared)
    expect(hub.state.log.slice(before.log).every((m) => m.type === 'request-data')).toBe(true)
  })

  test('restoring names the keys and formulas that change and the months that would be worked out differently, asks first, and saves a NEW revision', async () => {
    hub = createFakeSetupHub(hubSeed({ months: { [OCT]: { employees: octoberEmployees, shared_revision: 2 } } }))
    hub.changeSharedElsewhere(SHARED_ID, SHARED_2)
    await startInDashboard()
    await openSharedHistory()
    await click(startingWith('Revision 1', dialog()))
    await vi.waitFor(() => expect(dialog().textContent).toContain('What restoring it would change'))

    const shown = dialog().textContent.replace(/\s+/g, ' ')
    expect(shown).toContain('Travelling: travel becomes travelling')
    expect(shown).toContain('Gross Pay: emoluments + travel becomes emoluments + travelling')
    expect(shown).toContain('Net Pay: grossPay - totalDeductions - 100 becomes grossPay - totalDeductions')

    await click(button('Restore this version', dialog()))
    await vi.waitFor(() => expect(dialog().textContent).toContain('would be worked out differently'))
    const asked = dialog().textContent.replace(/\s+/g, ' ')
    expect(asked).toContain('Restore revision 1? It is saved as a new revision, and every earlier version is kept.')
    expect(asked).toMatch(/October 2026, Fake Co Ltd: \d+ figures in .*Net Pay/)
    // Nothing is saved before the answer.
    expect(sends('payroll-setup')).toEqual([])
    // The check read the month: names only reach the screen, never a figure.
    expect(asked).not.toContain('18,115')

    await click(button('Restore', dialog()))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Restored. It was saved as revision 3'))

    const setup = hub.state.shared.get(SHARED_ID)
    expect(setup.revision).toBe(3)
    expect(sameJson(setup.body, SHARED_1)).toBe(true)
    // Every earlier revision is still kept, unchanged.
    const kept = hub.state.history.filter((h) => h.target === `shared:${SHARED_ID}`).sort((a, b) => a.revision - b.revision)
    expect(kept.map((h) => h.revision)).toEqual([1, 2, 3])
    expect(sameJson(kept[1].body, SHARED_2)).toBe(true)
    // One save, of the shared setup, naming the revision it replaces.
    expect(sends('payroll-setup').map((m) => m.payload.rows[0])).toMatchObject([{ action: 'save-shared', expected_revision: 2 }])
    // The list now has the new revision as current, and the screen shows what was restored.
    await vi.waitFor(() => expect(dialog().textContent).toContain('Revision 3 (current)'))
    await click(dialog().querySelector('[aria-label="Close"]'))
    // The Global Columns tab shows the restored formula, by column names.
    expect(text()).toContain('Gross PaygrossPayformulaEmoluments + Travelling')
    await vi.waitFor(() => expect(text()).toContain('Saved'))
    // Nothing else is sent after it: what is on screen is what was saved.
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(sends('payroll-setup')).toHaveLength(1)
  }, 20_000)

  test('when no month was saved with a later revision, it says so', async () => {
    hub = createFakeSetupHub(hubSeed())
    hub.changeSharedElsewhere(SHARED_ID, SHARED_2)
    await startInDashboard()
    await openSharedHistory()
    await click(startingWith('Revision 1', dialog()))
    await vi.waitFor(() => expect(button('Restore this version', dialog())).toBeTruthy())
    await click(button('Restore this version', dialog()))
    await vi.waitFor(() => expect(dialog().textContent).toContain('No month was saved with a later revision.'))
  })

  test('the months cannot be checked while the dashboard is locked: it asks to unlock first, then checks', async () => {
    hub = createFakeSetupHub(hubSeed({ unlocked: false, months: { [OCT]: { employees: octoberEmployees, shared_revision: 2 } } }))
    hub.changeSharedElsewhere(SHARED_ID, SHARED_2)
    await startInDashboard()
    await openSharedHistory()
    await click(startingWith('Revision 1', dialog()))
    await vi.waitFor(() => expect(button('Restore this version', dialog())).toBeTruthy())
    await click(button('Restore this version', dialog()))
    await vi.waitFor(() => expect(dialog().textContent).toContain('so they could not be checked'))
    // No way to restore without the check.
    expect(button('Restore', dialog())).toBeUndefined()

    await click(button('Unlock the dashboard', dialog()))
    await vi.waitFor(() => expect(dialog().textContent).toContain('would be worked out differently'))
    expect(button('Restore', dialog())).toBeTruthy()
    expect(sends('payroll-setup')).toEqual([])
  })

  test('someone who may not change the Global columns sees their history, with no Restore', async () => {
    hub = createFakeSetupHub(hubSeed({ othersAttached: [{ brn: 'TEST-BRN-Z', role: null, shared_setup_id: SHARED_ID }] }))
    hub.changeSharedElsewhere(SHARED_ID, SHARED_2)
    await startInDashboard()
    await openSharedHistory()
    await click(startingWith('Revision 1', dialog()))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Only someone who is an admin of every company using these Global columns'))
    expect(button('Restore this version', dialog())).toBeUndefined()
  })

  test('a restore refused because someone else saved meanwhile changes nothing, and says so', async () => {
    hub = createFakeSetupHub(hubSeed())
    hub.changeSharedElsewhere(SHARED_ID, SHARED_2)
    await startInDashboard()
    await openSharedHistory()
    await click(startingWith('Revision 1', dialog()))
    await vi.waitFor(() => expect(button('Restore this version', dialog())).toBeTruthy())
    await click(button('Restore this version', dialog()))
    await vi.waitFor(() => expect(button('Restore', dialog())).toBeTruthy())

    const theirs = json({ ...SHARED_2, globalColumns: SHARED_2.globalColumns.slice(0, -1) })
    hub.changeSharedElsewhere(SHARED_ID, theirs)
    await click(button('Restore', dialog()))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Not restored.'))
    const setup = hub.state.shared.get(SHARED_ID)
    expect(setup.revision).toBe(3)
    expect(sameJson(setup.body, theirs)).toBe(true)
  })

  test("a company's own columns: their History, and a restore that is a new revision of that company's setup only", async () => {
    hub = createFakeSetupHub(hubSeed({ months: { [OCT]: { employees: octoberEmployees, company_revision: 2 } } }))
    const own2 = json({ ...OWN_1, columns: OWN_1.columns.map((c) => (c.key === 'prgf' ? { ...c, formula: 'emoluments * 0.05' } : c)) })
    await hub.handle('send-data', { dataType: 'payroll-setup', rows: [{ action: 'save-company', brn: A.brn, body: own2, expected_revision: 1 }] })
    await startInDashboard()
    await openTab('Company Columns')
    await click(button('History of the columns of Fake Co Ltd'))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Revision 2 (current)'))
    await click(startingWith('Revision 1', dialog()))
    await vi.waitFor(() => expect(dialog().textContent).toContain('What restoring it would change'))
    expect(dialog().textContent).toContain('becomes')

    await click(button('Restore this version', dialog()))
    await vi.waitFor(() => expect(dialog().textContent).toMatch(/October 2026, Fake Co Ltd: \d+ figures? in/))
    await click(button('Restore', dialog()))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Restored. It was saved as revision 3'))

    const own = hub.state.setups.get(A.brn)
    expect(own.revision).toBe(3)
    expect(sameJson(own.body, OWN_1)).toBe(true)
    expect(hub.state.shared.get(SHARED_ID).revision).toBe(1)
    expect(sends('payroll-setup').map((m) => m.payload.rows[0].action)).toEqual(['save-company'])
  })
})

// ---------- a month ----------

describe('the History of a month', () => {
  async function typeAndWaitFor(value, revision) {
    await vi.waitFor(() => expect(rows().length).toBeGreaterThan(0))
    await type(cell(0, 'Basic Salary'), value)
    await vi.waitFor(() => expect(hub.state.months.get(OCT).revision).toBe(revision), { timeout: 4000 })
    await vi.waitFor(() => expect(text()).toContain('Saved'))
  }

  async function openMonthHistory() {
    await click(button('History of this month'))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Revision 1'))
  }

  test('lists every save with when and who and how many employees; a kept one is shown, worked out, and changes nothing', async () => {
    await startInDashboard()
    await typeAndWaitFor('19115', 2)
    await openMonthHistory()

    const listed = all('[aria-label="Saved versions"] button', dialog()).map((b) => b.textContent.replace(/\s+/g, ' '))
    expect(listed[0]).toMatch(/^Revision 2 \(current\).*saved by you.*6 employees$/)
    // Revision 1 was saved by someone else: replaced, its content is kept.
    expect(listed[1]).toMatch(/^Revision 1.*saved by someone else.*6 employees$/)

    const savesBefore = sends('payroll-month').length
    await click(startingWith('Revision 1', dialog()))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Testeur'))
    // Its figures, worked out with the columns in use now; nothing to type into.
    expect(dialog().textContent).toContain('18,115.00')
    expect(dialog().querySelector('table input')).toBeNull()
    expect(sends('payroll-month')).toHaveLength(savesBefore)
  }, 15_000)

  test('"Restore this version" asks first, then saves a NEW revision that keeps the one it replaces; the table shows it', async () => {
    await startInDashboard()
    await typeAndWaitFor('19115', 2)
    await openMonthHistory()
    await click(startingWith('Revision 1', dialog()))
    await vi.waitFor(() => expect(button('Restore this version', dialog())).toBeTruthy())
    await click(button('Restore this version', dialog()))
    expect(dialog().textContent).toContain('Restore revision 1 of October 2026? It is saved as a new revision')
    expect(hub.state.months.get(OCT).revision).toBe(2)

    await click(button('Restore', dialog()))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Restored. It was saved as revision 3'))
    const month = hub.state.months.get(OCT)
    expect(month.revision).toBe(3)
    expect(sameJson(month.employees, octoberEmployees)).toBe(true)
    const restore = sends('payroll-month').at(-1).payload.rows[0]
    expect(restore).toMatchObject({ action: 'save', expected_revision: 2, keep_previous: true, restored_from: 1 })
    // Nothing earlier is rewritten or deleted: revision 2 is kept, with what was typed.
    const record2 = hub.state.monthHistory.find((h) => h.key === OCT && h.revision === 2)
    expect(record2.employees[0].values.basicSalary).toBe('19115')
    expect(hub.state.monthHistory.filter((h) => h.key === OCT).map((h) => h.revision)).toEqual([1, 2, 3])

    await click(dialog().querySelector('[aria-label="Close"]'))
    await vi.waitFor(() => expect(cell(0, 'Basic Salary').value).toBe('18115.00'))
    // The restored month is not sent again.
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(hub.state.months.get(OCT).revision).toBe(3)
  }, 15_000)

  test('a save whose content was not kept is listed, and cannot be shown or restored', async () => {
    await startInDashboard()
    await typeAndWaitFor('19115', 2)
    await typeAndWaitFor('20115', 3)
    await openMonthHistory()
    const second = all('[aria-label="Saved versions"] button', dialog())[1]
    expect(second.textContent).toContain('only the record kept')
    await click(second)
    expect(dialog().textContent).toContain('Only the record of this save was kept, not its content')
    expect(button('Restore this version', dialog())).toBeUndefined()
    expect(sent.filter((m) => m.payload.params?.action === 'revision' && m.payload.params?.revision === 2)).toEqual([])
  }, 15_000)

  test('when the dashboard locks, nothing of the month stays in the History; unlocking reads it again', async () => {
    await startInDashboard()
    await typeAndWaitFor('19115', 2)
    await openMonthHistory()
    await click(startingWith('Revision 1', dialog()))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Testeur'))

    await act(async () => hub.setGate(false))
    await vi.waitFor(() => expect(dialog().textContent).toContain("Unlock it to see this month's history"))
    expect(dialog().textContent).not.toContain('Testeur')
    expect(dialog().textContent).not.toContain('Revision 1')

    await click(button('Unlock the dashboard', dialog()))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Revision 1'))
    expect(dialog().textContent).not.toContain('Testeur')
  }, 15_000)

  test('is offered to an admin only, and only for months kept in the dashboard', async () => {
    await startInDashboard()
    await vi.waitFor(() => expect(rows().length).toBeGreaterThan(0))
    expect(button('History of this month')).toBeTruthy()
    await stop()
    hub = createFakeSetupHub(hubSeed({ monthsSupported: false }))
    await startInDashboard(undefined, 'Months are still kept in this browser')
    expect(button('History of this month')).toBeUndefined()
  })
})

// ---------- the offline copy ----------

describe('the read-only offline copy', () => {
  async function loadOnceThenGoOffline() {
    await startInDashboard()
    await vi.waitFor(() => expect(rows().length).toBeGreaterThan(0))
    await stop()
    hub.state.down = true
    await startInDashboard(undefined, 'could not be loaded')
  }

  test('when the dashboard cannot be reached, the last column setup loaded is offered, with when it was loaded', async () => {
    await loadOnceThenGoOffline()
    const offer = startingWith('Open the read-only copy of Fake Co Ltd from')
    expect(offer).toBeTruthy()
    expect(offer.textContent).toMatch(/from \d{1,2} \w+ \d{4} at \d{2}:\d{2}/)
    await click(offer)
    await vi.waitFor(() => expect(text()).toContain('Offline: read-only copy from'))
    expect(text()).toMatch(/Offline: read-only copy from \d{1,2} \w+ \d{4} at \d{2}:\d{2}\. Changes can't be saved\./)
    // The columns and formulas are there, to look at.
    expect(text()).toContain('Net Pay')
    expect(text()).toContain('Gross Pay - Total deductions')
  })

  test('nothing in it can be changed, and nothing is sent', async () => {
    await loadOnceThenGoOffline()
    await click(startingWith('Open the read-only copy of Fake Co Ltd from'))
    await vi.waitFor(() => expect(text()).toContain('Offline: read-only copy from'))
    const before = sent.length
    for (const tab of ['Global Columns', 'Company Columns']) {
      await openTab(tab)
      const labels = all('button').map((b) => `${b.textContent.trim()}|${b.getAttribute('aria-label') ?? ''}`)
      expect(labels.filter((l) => /^(\+ Add|Add |Edit|Delete|Import|Save|History)|\|(Edit|Delete)/.test(l)), tab).toEqual([])
    }
    expect(button('+ New Company')).toBeUndefined()
    expect(sent.length).toBe(before)
  })

  test('the months are not in it: the Employee Table and Totals say so, and nothing can be exported', async () => {
    await loadOnceThenGoOffline()
    await click(startingWith('Open the read-only copy of Fake Co Ltd from'))
    await vi.waitFor(() => expect(text()).toContain('Offline: read-only copy from'))
    await openTab('Employee Table')
    expect(text()).toContain('The months are not in this offline copy')
    expect(text()).not.toContain('Testeur')
    expect(button('Import from Excel').disabled).toBe(true)
    await openTab('Totals')
    expect(text()).toContain('The months are not in this offline copy')
  })

  test('it holds the column setup only: no month, salary or national ID is kept in this browser for it', async () => {
    await startInDashboard()
    await vi.waitFor(() => expect(rows().length).toBeGreaterThan(0))
    await type(cell(0, 'Basic Salary'), '19115')
    await vi.waitFor(() => expect(hub.state.months.get(OCT).revision).toBe(2), { timeout: 4000 })

    const copy = localStorage.getItem(OFFLINE_KEY)
    expect(copy).toContain('Net Pay')
    expect(Object.keys(JSON.parse(copy)[A.brn]).sort()).toEqual(['brn', 'company', 'label', 'loadedAt', 'shared'])
    for (const employee of octoberEmployees) {
      for (const value of [employee.id, employee.values.surname, employee.values.basicSalary].filter(Boolean)) {
        expect(copy, value).not.toContain(`"${value}"`)
      }
    }
    expect(copy).not.toContain('19115')
    // And no month of the dashboard reached this browser's storage under any key.
    const everything = Object.keys(localStorage).map((key) => `${key}=${localStorage.getItem(key)}`).join('\n')
    expect(everything).not.toContain('Testeur')
    expect(everything).not.toContain('19115')
  })

  test('"Try the dashboard again" goes back to the dashboard once it answers', async () => {
    await loadOnceThenGoOffline()
    await click(startingWith('Open the read-only copy of Fake Co Ltd from'))
    await vi.waitFor(() => expect(text()).toContain('Offline: read-only copy from'))
    hub.state.down = false
    await click(button('Try the dashboard again'))
    await vi.waitFor(() => expect(text()).toContain('Column setup and months of Fake Co Ltd, kept in the dashboard.'))
    expect(text()).not.toContain('Offline: read-only copy')
  })

  test('nothing is offered when this browser never loaded a setup from the dashboard', async () => {
    hub = createFakeSetupHub(hubSeed())
    hub.state.down = true
    await startInDashboard(undefined, 'could not be loaded')
    expect(startingWith('Open the read-only copy')).toBeUndefined()
  })
})
