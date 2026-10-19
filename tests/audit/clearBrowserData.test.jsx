// @vitest-environment jsdom

// "Clear this browser's data…": "Clear columns only" and "Clear everything"
// remove exactly what they say and nothing else (never another app's keys),
// a backup is downloaded before anything can be cleared, Restore from that
// backup brings back what was removed, and inside the dashboard the button is
// not there and clearing refuses. TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../../src/App'
import { buildBackup, clearBrowserData, parseBackupText, restoreBackup } from '../../src/lib/backup'
import { resetDataStore } from '../../src/lib/dataStore'
import { forgetDashboardSetup, IMPORTED_KEY, OFFLINE_KEY, PREFS_KEY } from '../../src/lib/dashboardSetup'
import { forgetDashboardMonths } from '../../src/lib/dashboardMonths'
import { createFakeSetupHub, installFakeBridge } from '../helpers/fakeSetupHub'
import { identityFields, idFieldKey, input, testColumns, testEmployees } from './build'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const STATE_KEY = 'payroll_app_state_v1'
const UNREADABLE_COPY = 'payroll_app_state_v1_unreadable_2026-10-16T09:00:00.000Z'
const MONTHS = [
  'payroll_period_test-co-a_2026-08',
  'payroll_period_test-co-a_2026-09',
  'payroll_period_test-co-b_2026-09',
  // Left behind by a company no longer in the list, and one month that cannot be read.
  'payroll_period_test-co-gone_2025-12',
  'payroll_period_test-co-b_2026-07',
]
// Another app at the same address, the theme, and the dashboard's notes on this browser.
const KEPT_ALWAYS = {
  'other-app_settings': '{"keep":true}',
  'payroll-hub-session': 'not ours',
  payroll_theme: 'light',
  [PREFS_KEY]: '{"C00000001":{"columnWidths":{},"viewYear":2026,"viewMonth":10}}',
  [IMPORTED_KEY]: '{"companies":{},"months":{}}',
  [UNREADABLE_COPY]: '{"companies": [ damaged',
}

const company = (letter, extra = {}) => ({
  id: `test-co-${letter.toLowerCase()}`,
  name: `TEST Co ${letter}`,
  columns: [input(`Own ${letter}`, `own${letter}`)],
  columnWidths: { basicSalary: 140 },
  viewYear: 2026,
  viewMonth: 9,
  details: { address: `${letter} Test Street`, brn: `TEST-BRN-${letter}`, customFields: [{ id: 'cf-1', label: 'VAT No', value: `TEST-VAT-${letter}` }] },
  ...extra,
})

function seed() {
  localStorage.clear()
  const state = {
    identityFields,
    idFieldKey,
    globalColumns: testColumns(),
    companies: [company('A'), company('B')],
    activeCompanyId: 'test-co-a',
  }
  const [first, second, third] = testEmployees()
  localStorage.setItem(STATE_KEY, JSON.stringify(state))
  localStorage.setItem(MONTHS[0], JSON.stringify({ employees: [first] }))
  localStorage.setItem(MONTHS[1], JSON.stringify({ employees: [first, second, third] }))
  localStorage.setItem(MONTHS[2], JSON.stringify({ employees: [third] }))
  localStorage.setItem(MONTHS[3], JSON.stringify({ employees: [second] }))
  localStorage.setItem(MONTHS[4], '{"employees": [ damaged')
  localStorage.setItem(OFFLINE_KEY, JSON.stringify({ C00000001: { brn: 'C00000001', label: 'Fake Co Ltd', loadedAt: '2026-10-15T18:22:00.000Z' } }))
  for (const [key, text] of Object.entries(KEPT_ALWAYS)) localStorage.setItem(key, text)
  return state
}

// Everything in the browser's storage, key by key, exactly as stored.
const everything = () => Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)]))
const without = (stored, keys) => Object.fromEntries(Object.entries(stored).filter(([key]) => !keys.includes(key)))
// What a user does: back up, save the file, choose it again later.
const throughAFile = (backup) => {
  const parsed = parseBackupText(JSON.stringify(backup, null, 2))
  expect(parsed.valid).toBe(true)
  return parsed.backup
}

// The app opened on its own, from this browser.
const onItsOwn = () => ({
  isEmbedded: () => false,
  isConnected: () => false,
  init: () => false,
  onStatus: () => () => {},
  requestData: () => Promise.resolve({ ok: false, error: 'Not embedded.' }),
  sendToDashboard: () => Promise.resolve({ ok: false, error: 'Not embedded.' }),
})

beforeEach(() => {
  window.PayrollHubBridge = onItsOwn()
  localStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

describe('Clear columns only', () => {
  test('removes the identity fields, the Global columns and every Company column, and nothing else', () => {
    const state = seed()
    const before = everything()

    expect(clearBrowserData('columns')).toBe(true)

    const after = everything()
    // Every key is still there; only the setup's text changed.
    expect(Object.keys(after)).toEqual(Object.keys(before))
    expect(without(after, [STATE_KEY])).toEqual(without(before, [STATE_KEY]))
    expect(JSON.parse(after[STATE_KEY])).toEqual({
      ...state,
      identityFields: [],
      idFieldKey: null,
      globalColumns: [],
      companies: state.companies.map((c) => ({ ...c, columns: [] })),
    })
  })

  test('Restore from the backup made before brings everything back identically', () => {
    seed()
    const before = everything()
    const backup = throughAFile(buildBackup())

    clearBrowserData('columns')
    expect(restoreBackup(backup)).toEqual({ ok: true })

    expect(everything()).toEqual(before)
  })

  test('changes nothing when the saved setup cannot be read', () => {
    seed()
    localStorage.setItem(STATE_KEY, '{"companies": [ damaged')
    const before = everything()
    expect(clearBrowserData('columns')).toBe(false)
    expect(everything()).toEqual(before)
  })
})

describe('Clear everything', () => {
  test('removes the setup, every company, every month and the offline copy, and nothing else', () => {
    seed()
    const before = everything()

    expect(clearBrowserData('everything')).toBe(true)

    expect(everything()).toEqual(without(before, [STATE_KEY, ...MONTHS, OFFLINE_KEY]))
  })

  test('the rescue copies of data that could not be read survive', () => {
    seed()
    localStorage.setItem('payroll_app_state_v1_unreadable_2026-10-17T10:30:00.000Z', 'second rescue copy')
    clearBrowserData('everything')
    expect(localStorage.getItem(UNREADABLE_COPY)).toBe('{"companies": [ damaged')
    expect(localStorage.getItem('payroll_app_state_v1_unreadable_2026-10-17T10:30:00.000Z')).toBe('second rescue copy')
  })

  test('Restore from the backup made before brings back everything it removed, except the offline copy', () => {
    seed()
    const before = everything()
    const backup = throughAFile(buildBackup())

    clearBrowserData('everything')
    expect(restoreBackup(backup)).toEqual({ ok: true })

    // The offline copy is not in a backup; the dashboard makes it again.
    expect(everything()).toEqual(without(before, [OFFLINE_KEY]))
  })
})

// ---------- on the screen, on its own ----------

let root
let container

const text = () => document.body.textContent.replace(/\s+/g, ' ')
const all = (selector, within = document) => [...within.querySelectorAll(selector)]
const button = (label, within = document) => all('button', within).find((b) => b.textContent.trim() === label)
const topDialog = () => all('[role="dialog"]').pop()

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

async function start() {
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
afterEach(stop)

// Catches the backup file the browser is asked to download.
function catchDownloads({ refuse = false } = {}) {
  const files = []
  URL.createObjectURL = vi.fn((blob) => {
    if (refuse) throw new Error('No room for the file.')
    files.push(blob)
    return `blob:fake-${files.length}`
  })
  URL.revokeObjectURL = vi.fn()
  const names = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    names.push(this.download)
  })
  return { files, names }
}

describe('the dialog', () => {
  test('downloads a backup first; Clear is enabled only after it, a choice, and CLEAR typed; then the app starts empty', async () => {
    seed()
    await start()
    await vi.waitFor(() => expect(text()).toContain('TEST Co B'))
    // As stored once the app has opened (it saves the setup it read).
    const before = everything()
    const downloads = catchDownloads()

    await click(button("Clear this browser's data…"))
    const dialog = topDialog()
    expect(dialog.textContent).toContain("Clear this browser's data")

    // The backup was downloaded by that click: the whole of what is stored, as "Back up" saves it.
    expect(downloads.names).toEqual([expect.stringMatching(/^payroll-backup-\d{4}-\d{2}-\d{2}\.json$/)])
    const backup = throughAFile(JSON.parse(await downloads.files[0].text()))
    expect(dialog.textContent).toContain(`A backup of everything here was downloaded: ${downloads.names[0]}.`)
    expect(dialog.textContent).toContain('"Restore" with that file brings it all back.')

    const clear = () => all('button', dialog).find((b) => b.className.includes('btn-danger'))
    const confirmBox = dialog.querySelector('input:not([type="radio"])')
    expect(clear().disabled).toBe(true)
    await type(confirmBox, 'CLEAR')
    expect(clear().disabled).toBe(true) // no choice yet
    await click(all('label', dialog).find((l) => l.textContent.startsWith('Clear everything')).querySelector('input'))
    await type(confirmBox, 'clear')
    expect(clear().disabled).toBe(true) // not CLEAR
    await type(confirmBox, 'CLEAR')
    expect(clear().textContent.trim()).toBe('Clear everything')
    expect(clear().disabled).toBe(false)
    // Nothing is removed before Clear is chosen.
    expect(everything()).toEqual(before)

    await click(clear())

    // The normal empty start, and a message saying how to bring it back.
    await vi.waitFor(() => expect(text()).toContain('No companies yet.'))
    expect(topDialog().textContent).toContain("This browser's data cleared")
    expect(topDialog().textContent).toContain('"Restore" with the backup file brings it all back.')
    for (const key of [...MONTHS, OFFLINE_KEY]) expect(localStorage.getItem(key)).toBeNull()
    for (const [key, value] of Object.entries(KEPT_ALWAYS)) expect(localStorage.getItem(key)).toBe(value)

    // And the downloaded file brings back what was there.
    expect(restoreBackup(backup)).toEqual({ ok: true })
    expect(everything()).toEqual(without(before, [OFFLINE_KEY]))
  })

  test('"Clear columns only" keeps the companies on screen, with no columns', async () => {
    seed()
    await start()
    await vi.waitFor(() => expect(text()).toContain('TEST Co B'))
    catchDownloads()

    await click(button("Clear this browser's data…"))
    const dialog = topDialog()
    await click(all('label', dialog).find((l) => l.textContent.startsWith('Clear columns only')).querySelector('input'))
    await type(dialog.querySelector('input:not([type="radio"])'), 'CLEAR')
    await click(button('Clear columns', dialog))

    await vi.waitFor(() => expect(topDialog().textContent).toContain('Columns cleared'))
    expect(text()).toContain('TEST Co A')
    expect(text()).toContain('TEST Co B')
    const stored = JSON.parse(localStorage.getItem(STATE_KEY))
    expect(stored.identityFields).toEqual([])
    expect(stored.globalColumns).toEqual([])
    expect(stored.companies.map((c) => c.columns)).toEqual([[], []])
    for (const key of MONTHS) expect(localStorage.getItem(key)).not.toBeNull()
  })

  test('when the backup cannot be downloaded, nothing can be cleared', async () => {
    seed()
    await start()
    await vi.waitFor(() => expect(text()).toContain('TEST Co B'))
    // As stored once the app has opened (it saves the setup it read).
    const before = everything()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    catchDownloads({ refuse: true })

    await click(button("Clear this browser's data…"))
    const dialog = topDialog()
    expect(dialog.textContent).toContain('The backup could not be downloaded, so nothing can be cleared.')
    await click(all('label', dialog).find((l) => l.textContent.startsWith('Clear everything')).querySelector('input'))
    await type(dialog.querySelector('input:not([type="radio"])'), 'CLEAR')
    const clear = button('Clear everything', dialog)
    expect(clear.disabled).toBe(true)
    await click(clear)
    expect(everything()).toEqual(before)
  })

  test('Cancel removes nothing', async () => {
    seed()
    await start()
    await vi.waitFor(() => expect(text()).toContain('TEST Co B'))
    // As stored once the app has opened (it saves the setup it read).
    const before = everything()
    catchDownloads()
    await click(button("Clear this browser's data…"))
    await click(button('Cancel', topDialog()))
    expect(all('[role="dialog"]')).toEqual([])
    expect(everything()).toEqual(before)
  })
})

// ---------- inside the dashboard ----------

describe('inside the dashboard', () => {
  const SHARED_ID = '30000000-0000-4000-8000-000000000001'
  const A = { brn: 'C00000001', name: 'Fake Co Ltd', address: '1 Test Street', role: 'admin' }

  test('there is no button, and clearing refuses: nothing in this browser or in the dashboard changes', async () => {
    seed()
    const hub = createFakeSetupHub({
      companies: [A],
      selectedBrn: A.brn,
      shared: [{ id: SHARED_ID, name: 'Shared column setup', body: { identityFields, idFieldKey, globalColumns: testColumns() }, revision: 1 }],
      setups: { [A.brn]: { shared_setup_id: SHARED_ID, body: { columns: [], customFields: [] }, revision: 1 }, },
      monthsSupported: true,
    })
    const sent = installFakeBridge(hub)
    await start()
    await vi.waitFor(() => expect(text()).toContain("This browser's own copy"))
    const before = everything()
    const dashboardBefore = structuredClone({ shared: hub.state.shared, setups: hub.state.setups, months: hub.state.months, history: hub.state.history })
    const sentBefore = sent.length

    expect(button("Clear this browser's data…")).toBeUndefined()
    expect(text()).not.toContain('Clear this browser')

    expect(clearBrowserData('columns')).toBe(false)
    expect(clearBrowserData('everything')).toBe(false)

    expect(everything()).toEqual(before)
    expect(structuredClone({ shared: hub.state.shared, setups: hub.state.setups, months: hub.state.months, history: hub.state.history })).toEqual(dashboardBefore)
    expect(sent.length).toBe(sentBefore)
  })
})
