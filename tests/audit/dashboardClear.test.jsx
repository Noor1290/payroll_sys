// @vitest-environment jsdom

// "Clear the column setup…" inside a stand-in for the dashboard
// (tests/helpers/fakeSetupHub.js): the column setup is exported first, CLEAR
// is typed, and the identity fields, the Global columns and this company's
// columns are saved in ONE save, one new revision of each with no columns.
// Nothing is deleted: no month, no earlier revision, and Restore brings back
// the identical setup. Not for someone who may not change the shared setup.
// On its own, the app keeps its own "Clear this browser's data…". TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../../src/App'
import { resetDataStore } from '../../src/lib/dataStore'
import { clearDashboardColumns, forgetDashboardSetup, IMPORTED_KEY, PREFS_KEY, restoreSetupRevision } from '../../src/lib/dashboardSetup'
import { forgetDashboardMonths } from '../../src/lib/dashboardMonths'
import { createFakeSetupHub, installFakeBridge } from '../helpers/fakeSetupHub'
import { identityFields, idFieldKey, globalColumns, company, octoberEmployees, septemberEmployees } from '../safetyNet/fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SHARED_ID = '30000000-0000-4000-8000-000000000001'
const A = { brn: 'C00000001', name: 'Fake Co Ltd', address: '1 Test Street\nPort Louis', role: 'admin' }
const json = (value) => JSON.parse(JSON.stringify(value))
const SHARED_1 = json({ identityFields, idFieldKey, globalColumns })
const OWN_1 = json({ columns: company.columns, customFields: company.details.customFields })

function hubSeed(more = {}) {
  return {
    companies: [A],
    selectedBrn: A.brn,
    shared: [{ id: SHARED_ID, name: 'Shared column setup', body: SHARED_1, revision: 1 }],
    setups: { [A.brn]: { shared_setup_id: SHARED_ID, body: OWN_1, revision: 1 } },
    monthsSupported: true,
    months: { 'C00000001|2026-10': { employees: octoberEmployees }, 'C00000001|2026-09': { employees: septemberEmployees } },
    ...more,
  }
}

let root
let container
let hub


const text = () => document.body.textContent.replace(/\s+/g, ' ')
const all = (selector, within = document) => [...within.querySelectorAll(selector)]
const button = (label, within = document) => all('button', within).find((b) => b.textContent.trim() === label)
const topDialog = () => all('[role="dialog"]').pop()
const saves = () => hub.state.log.filter((m) => m.type === 'send-data')
const monthsHeld = () => json([...hub.state.months])
const sharedNow = () => hub.state.shared.get(SHARED_ID)
const ownNow = () => hub.state.setups.get(A.brn)

async function click(target) {
  expect(target, 'the control').toBeTruthy()
  await act(async () => target.click())
}

async function type(el, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  await act(async () => {
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<App />))
}

async function startInDashboard(seed = hubSeed()) {
  hub = createFakeSetupHub(seed)
  installFakeBridge(hub)
  await render()
  await vi.waitFor(() => expect(text()).toContain('kept in the dashboard'))
}

function catchDownloads() {
  const names = []
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    names.push(this.download)
  })
  return names
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(PREFS_KEY, JSON.stringify({ [A.brn]: { columnWidths: {}, viewYear: 2026, viewMonth: 10 } }))
  localStorage.setItem(IMPORTED_KEY, JSON.stringify({ companies: {}, months: {} }))
  forgetDashboardSetup()
  forgetDashboardMonths()
})

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  root = null
  container?.remove()
  document.body.innerHTML = ''
  resetDataStore()
  forgetDashboardSetup()
  forgetDashboardMonths()
  vi.restoreAllMocks()
})

describe('inside the dashboard, for an admin of every company using the Global columns', () => {
  test('exports first, needs CLEAR, then ONE save: one new revision of each with no columns, no month deleted; Restore brings back the identical setup', async () => {
    await startInDashboard()
    const downloads = catchDownloads()
    const monthsBefore = monthsHeld()
    const historyBefore = hub.state.history.length
    const savesBefore = saves().length

    expect(button("Clear this browser's data…")).toBeUndefined()
    await click(button('Clear the column setup…'))
    const dialog = topDialog()
    // The "Export Column Setup" files of the setup in use were downloaded by that click.
    expect(downloads).toEqual([expect.stringMatching(/^column-setup-global-\d{4}-\d{2}-\d{2}\.json$/), expect.stringMatching(/^column-setup-fakeCoLtd-\d{4}-\d{2}-\d{2}\.json$/)])
    expect(dialog.textContent).toContain(`Downloaded: ${downloads[0]} and ${downloads[1]}.`)
    expect(dialog.textContent).toContain('the months stay, but their calculated figures will be empty until columns exist again')
    expect(dialog.textContent).toContain('restore the previous version')
    expect(dialog.textContent).not.toContain('Clear everything')

    const clear = () => button('Clear the column setup', dialog)
    expect(clear().disabled).toBe(true)
    await type(dialog.querySelector('input'), 'clear')
    expect(clear().disabled).toBe(true)
    await type(dialog.querySelector('input'), 'CLEAR')
    expect(clear().disabled).toBe(false)
    expect(saves().length).toBe(savesBefore)

    await click(clear())
    await vi.waitFor(() => expect(topDialog().textContent).toContain('Column setup cleared'))

    // ONE save, carrying both: the shared setup and this company's, one new revision each.
    expect(saves().slice(savesBefore).map((m) => m.action)).toEqual(['save-shared'])
    expect(sharedNow().revision).toBe(2)
    expect(ownNow().revision).toBe(2)
    expect(sharedNow().body).toEqual({ identityFields: [], idFieldKey: null, globalColumns: [] })
    expect(ownNow().body).toEqual({ columns: [], customFields: OWN_1.customFields })
    // Nothing deleted: every earlier revision kept, every month still there.
    expect(hub.state.history.length).toBe(historyBefore + 2)
    expect(hub.state.history.filter((h) => h.revision === 1).map((h) => h.body)).toEqual(expect.arrayContaining([SHARED_1, OWN_1]))
    expect(monthsHeld()).toEqual(monthsBefore)
    // The screen shows the setup with no columns.
    await click(button('OK', topDialog()))
    await click(button('Global Columns'))
    expect(text()).not.toContain('Gross Pay')

    // History > Restore of revision 1, for each: the identical setup again.
    expect(await restoreSetupRevision('shared', SHARED_1)).toEqual({ ok: true, revision: 3 })
    expect(await restoreSetupRevision('company', OWN_1)).toEqual({ ok: true, revision: 3 })
    expect(sharedNow().body).toEqual(SHARED_1)
    expect(ownNow().body).toEqual(OWN_1)
    expect(monthsHeld()).toEqual(monthsBefore)
  })

  test('Cancel sends nothing', async () => {
    await startInDashboard()
    catchDownloads()
    const savesBefore = saves().length
    await click(button('Clear the column setup…'))
    await click(button('Cancel', topDialog()))
    expect(saves().length).toBe(savesBefore)
    expect(sharedNow().revision).toBe(1)
  })
})

describe('for someone who may not change the shared setup', () => {
  test('the button is disabled with the reason, and clearing is refused with nothing sent', async () => {
    await startInDashboard(hubSeed({ othersAttached: [{ brn: 'C00000099', role: null, shared_setup_id: SHARED_ID }] }))
    const clearButton = button('Clear the column setup…')
    expect(clearButton.disabled).toBe(true)
    expect(text()).toContain('Only someone who is an admin of every company using these Global columns can clear them.')

    const savesBefore = saves().length
    expect(await clearDashboardColumns()).toMatchObject({ ok: false, code: 'forbidden' })
    expect(saves().length).toBe(savesBefore)
    expect(sharedNow()).toMatchObject({ revision: 1, body: SHARED_1 })
    expect(ownNow()).toMatchObject({ revision: 1, body: OWN_1 })
  })
})

describe('on its own', () => {
  test('"Clear this browser\'s data…" is there as before, and the dashboard\'s button is not', async () => {
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
    expect(button("Clear this browser's data…")).toBeTruthy()
    expect(button('Clear the column setup…')).toBeUndefined()
  })
})
