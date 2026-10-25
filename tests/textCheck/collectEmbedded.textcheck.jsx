// @vitest-environment jsdom

// Text check, collector for the app running INSIDE the dashboard (a stand-in
// parent window), where the "Send to dashboard" button exists. Same output
// format as collect.textcheck.jsx; see scripts/text-check.mjs.
//
// The stand-in answers the app's questions about its column setup the way the
// dashboard live today does ("not registered": it does not keep them), so the
// screens up to 64 are the ones the app has always shown there. From 65 on it
// is a dashboard that keeps them (tests/helpers/fakeSetupHub.js); from 76 on,
// one that keeps the months too (its migration 0014).

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, expect, test, vi } from 'vitest'
import { identityFields, idFieldKey, globalColumns, company, octoberEmployees } from '../safetyNet/fixture'
import { createFakeSetupHub } from '../helpers/fakeSetupHub'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SRC = process.env.TEXT_CHECK_SRC ?? path.resolve(import.meta.dirname, '../../src')
const OUT = process.env.TEXT_CHECK_OUT_EMBEDDED
const HUB_ORIGIN = 'https://noor1290.github.io'
const load = (file) => import(/* @vite-ignore */ pathToFileURL(path.join(SRC, file)).href)

const collected = {}
const posted = []
// null: the dashboard as it is live today, which does not keep payroll setups.
let setupHub = null
const fakeDashboard = {
  postMessage: (message) => {
    posted.push(message)
    setTimeout(() => void answerSetup(message), 0)
  },
}
let App
let root
let container

beforeAll(async () => {
  Object.defineProperty(window, 'parent', { value: fakeDashboard, configurable: true })
  await load('payrollHubBridge.js')
  App = (await load('App.jsx')).default
})

const squash = (s) => s.replace(/\s+/g, ' ').trim()

function textOf(within) {
  const out = []
  const walker = document.createTreeWalker(within, NodeFilter.SHOW_ELEMENT)
  for (let el = walker.currentNode; el; el = walker.nextNode()) {
    const own = squash([...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(''))
    if (own) out.push(`text: ${own}`)
    for (const attr of ['title', 'aria-label', 'placeholder', 'alt']) {
      const value = el.getAttribute?.(attr)
      if (value && squash(value)) out.push(`${attr}: ${squash(value)}`)
    }
  }
  return out
}

function snap(name) {
  collected[name] = textOf(document.body)
}

// Only what is in the dialog on top: the page under it is collected on its own screen.
const topDialog = () => [...document.querySelectorAll('[role="dialog"]')].at(-1)
function snapDialog(name) {
  const dialog = topDialog()
  expect(dialog, `dialog for ${name}`).toBeTruthy()
  collected[name] = textOf(dialog)
}

// The wording only, for the History and the offline copy: the tables there show the fake
// payroll itself (columns, formulas, figures), which is data, not wording; and a date and
// time that depend on when and where the check runs are written as [date] and [time].
function wordingOf(within) {
  const copy = within.cloneNode(true)
  for (const table of copy.querySelectorAll('table')) table.remove()
  return textOf(copy).map((line) =>
    line
      .replace(/\b\d{1,2} [A-Z][a-z]+ \d{4} at \d{2}:\d{2}\b/g, '[date] at [time]')
      .replace(/\b\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}\b/g, '[date], [time]')
  )
}
function snapWording(name, within = topDialog()) {
  expect(within, `what to collect for ${name}`).toBeTruthy()
  collected[name] = wordingOf(within)
}

function reply(type, id, payload) {
  const event = new MessageEvent('message', { data: { type, from: 'dashboard', to: 'payroll', version: 1, id, payload }, origin: HUB_ORIGIN })
  Object.defineProperty(event, 'source', { value: fakeDashboard })
  return act(async () => window.dispatchEvent(event))
}

async function answerSetup(message) {
  const dataType = message.payload?.dataType
  if (
    (message.type !== 'request-data' && message.type !== 'send-data') ||
    (dataType !== 'payroll-setup' && dataType !== 'payroll-month' && dataType !== 'payroll-batch')
  )
    return
  const answer = setupHub
    ? await setupHub.handle(message.type, structuredClone(message.payload))
    : { ok: false, error: `This app is not registered to ${message.type === 'request-data' ? 'receive' : 'send'} this kind of data.` }
  if (answer !== undefined) await reply(message.type === 'request-data' ? 'response-data' : 'received', message.id, answer)
}

async function start({ october = octoberEmployees, details = company.details, waitFor = 'October 2026', hub = null } = {}) {
  setupHub = hub
  if (root) {
    await act(async () => root.unmount())
    container.remove()
  }
  // As a page reload does: nothing held in memory from the screen before.
  if (KNOWS_MONTHS) (await load('lib/dashboardMonths.js')).forgetDashboardMonths()
  localStorage.clear()
  localStorage.setItem(
    'payroll_app_state_v1',
    JSON.stringify({ identityFields, idFieldKey, globalColumns, companies: [{ ...company, details }], activeCompanyId: company.id })
  )
  localStorage.setItem(`payroll_period_${company.id}_2026-10`, JSON.stringify({ employees: october }))
  // Inside a dashboard that keeps setups, this browser's company was imported into it:
  // the note the import leaves, so the dashboard company works on its months.
  if (hub && hub.state.setups.has('C00000001')) {
    localStorage.setItem('payroll_dashboard_imported_v1', JSON.stringify({ companies: { [company.id]: { brn: 'C00000001', company: 'Fake Co Ltd' } } }))
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(App)))
  await vi.waitFor(() => expect(document.body.textContent).toContain(waitFor))
}

const button = (label, within = document) => [...within.querySelectorAll('button')].find((b) => squash(b.textContent) === label)
async function click(label, within) {
  const target = button(label, within)
  expect(target, `button "${label}"`).toBeTruthy()
  await act(async () => target.click())
}
const sendButton = () => button('Send to dashboard')

async function sendAndReply(payload, askedFirst = null) {
  posted.length = 0
  await act(async () => sendButton().click())
  // Since rehearsal fix F4 the app asks first when the month lacks names the dashboard or the
  // payslip app look for (the fake setup does). The base version sends at once.
  const asked = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.textContent.includes('Send to the dashboard?'))
  if (asked) {
    if (askedFirst) snapDialog(askedFirst)
    await click('Send anyway', asked)
  }
  const sent = posted.find((m) => m.type === 'send-data')
  expect(sent, 'send-data message').toBeTruthy()
  await reply('received', sent.id, payload)
}

const SHARED_ID = '30000000-0000-4000-8000-000000000001'
const FAKE = { brn: 'C00000001', name: 'Fake Co Ltd', address: '1 Test Street\nPort Louis', role: 'admin' }
const OTHER = { brn: 'TEST-BRN-B', name: 'TEST Co B', address: '2 Test Street', role: 'admin' }
const attachedHub = (more = {}) =>
  createFakeSetupHub({
    companies: [FAKE, OTHER],
    selectedBrn: FAKE.brn,
    shared: [{ id: SHARED_ID, name: 'Shared column setup', body: structuredClone({ identityFields, idFieldKey, globalColumns }), revision: 1 }],
    setups: { C00000001: { shared_setup_id: SHARED_ID, body: structuredClone({ columns: company.columns, customFields: company.details.customFields }), revision: 1 } },
    ...more,
  })
const openDetails = () => act(async () => document.querySelector('[aria-label="Fake Co Ltd details"]').click())

// The base version of the app never asks the dashboard for its column setup. For a
// screen that is a page, it shows the same page as it would on its own, so what
// differs is exactly what the dashboard changes; screens that exist only inside a
// dashboard that keeps setups (dialogs, the start screens) are not collected for it.
const KNOWS_SETUPS = fs.existsSync(path.join(SRC, 'lib/dashboardSetup.js'))
const KNOWS_MONTHS = fs.existsSync(path.join(SRC, 'lib/dashboardMonths.js'))

// "Import months to the dashboard", from this browser's October (and a September added
// to it), started again so the button is offered.
async function startMonthsImport(hub) {
  await start({ hub, waitFor: 'Import months to the dashboard' })
  localStorage.setItem('payroll_period_company-fake_2026-09', JSON.stringify({ employees: octoberEmployees.slice(0, 2) }))
  await click('Import months to the dashboard')
  snapDialog('80 embedded: import months, backup first')
  await click('Download a backup file', topDialog())
  await click('Continue', topDialog())
  await vi.waitFor(() => expect(topDialog().textContent).toContain('Nothing has been written'))
  snapDialog('81 embedded: import months, what it will do')
  await click('Import 2 months', topDialog())
  await vi.waitFor(() => expect(topDialog().textContent).toContain('every figure checked'))
  snapDialog('82 embedded: import months, done')
  await click('Close', topDialog())
}
const startDashboard = (hub, waitFor) => (KNOWS_SETUPS ? start({ hub, waitFor }) : start())

test('collect every visible string (inside the dashboard)', async () => {
  await start()
  snap('60 embedded: employee table with Send to dashboard')

  await sendAndReply({ ok: true }, '60b embedded: send, asked first')
  snap('61 embedded: sent')

  await sendAndReply({ ok: false, error: 'Dashboard is locked.' })
  snap('62 embedded: not sent')

  await start({ october: [] })
  snap('63 embedded: no employees')

  await start({ details: { ...company.details, brn: '' } })
  snap('64 embedded: no BRN')

  // ---------- a dashboard that keeps the column setup (its migration 0013) ----------
  URL.createObjectURL = () => 'blob:fake'
  URL.revokeObjectURL = () => {}
  HTMLAnchorElement.prototype.click = () => {}

  await startDashboard(attachedHub(), 'kept in the dashboard')
  await vi.waitFor(() => expect(document.body.textContent).toContain('October 2026'))
  snap('65 embedded: column setup kept in the dashboard')

  if (KNOWS_SETUPS) {
    await openDetails()
    snapDialog('66 embedded: company details from the dashboard')
    await click('Cancel', topDialog())
  }

  await startDashboard(attachedHub({ othersAttached: [{ brn: 'TEST-BRN-Z', role: null, shared_setup_id: SHARED_ID }] }), 'kept in the dashboard')
  await click('Global Columns')
  snap('67 embedded: Global columns read-only, shared with a company you are not an admin of')

  await startDashboard(attachedHub({ companies: [{ ...FAKE, role: 'member' }, OTHER] }), 'kept in the dashboard')
  await click('Company Columns')
  snap('68 embedded: a company you are not an admin of')

  if (!KNOWS_SETUPS) {
    await start()
    snap('69 embedded: saving')
    snap('70 embedded: NOT saved, someone else changed it')
  } else {
    const hub = attachedHub()
    await start({ hub, waitFor: 'kept in the dashboard' })
    // Another admin saves this company's details meanwhile.
    hub.state.setups.get('C00000001').revision += 1
    await openDetails()
    const value = topDialog().querySelectorAll('[aria-label="Value"]')[0]
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    await act(async () => {
      setter.call(value, 'VAT-FAKE-2')
      value.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('Save', topDialog())
    snap('69 embedded: saving')
    await vi.waitFor(() => expect(document.body.textContent).toContain('NOT saved'), { timeout: 4000 })
    snap('70 embedded: NOT saved, someone else changed it')
  }

  if (KNOWS_SETUPS) {
    const hub = createFakeSetupHub({ companies: [FAKE], selectedBrn: FAKE.brn })
    await start({ hub, waitFor: 'no column setup in the dashboard yet' })
    await vi.waitFor(() => expect(document.body.textContent).toContain('Start with new, empty Global columns'))
    snap('71 embedded: no column setup in the dashboard yet')

    await click('Import to the dashboard')
    snapDialog('72 embedded: import, backup first')
    await click('Download a backup file', topDialog())
    await click('Continue', topDialog())
    await vi.waitFor(() => expect(topDialog().textContent).toContain('Nothing has been written'))
    snapDialog('73 embedded: import, what it will do')
    await click('Import 1 company', topDialog())
    await vi.waitFor(() => expect(topDialog().textContent).toContain('imported and checked'))
    snapDialog('74 embedded: import, done')
    await click('Close', topDialog())
  }

  if (KNOWS_SETUPS) {
    const hub = createFakeSetupHub({ companies: [FAKE], selectedBrn: FAKE.brn })
    hub.state.down = true
    await start({ hub, waitFor: 'could not be loaded' })
    snap('75 embedded: column setup could not be loaded')
  }

  // ---------- a dashboard that keeps the months too (its migration 0014) ----------
  // The base version shows its own page for the page screens (as for 65 to 70); the
  // import's dialogs exist only here and are not collected for it.
  if (!KNOWS_MONTHS) {
    await start()
    for (const name of [
      '76 embedded: months kept in the dashboard',
      '77 embedded: locked, the month covered, what was typed NOT saved',
      '78 embedded: a month NOT saved, someone else saved it',
      '79 embedded: months of a company you are not an admin of',
      '83 embedded: opened while the dashboard is locked',
    ])
      snap(name)
  } else {
    const monthsHub = (more = {}) =>
      attachedHub({ monthsSupported: true, months: { 'C00000001|2026-10': { employees: octoberEmployees } }, ...more })
    const gate = (unlocked) => reply('send-data', `gate-${String(Date.now()).padStart(13, '0')}`, { dataType: 'payroll-month', rows: [{ action: 'gate', unlocked }] })

    let hub = monthsHub()
    await start({ hub, waitFor: 'months of Fake Co Ltd, kept in the dashboard' })
    await vi.waitFor(() => expect(document.querySelector('tbody input')).toBeTruthy())
    snap('76 embedded: months kept in the dashboard')

    // Typed, then the dashboard locks before it is saved.
    const salary = document.querySelector('tbody [aria-label="Basic Salary"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    await act(async () => {
      setter.call(salary, '19115')
      salary.dispatchEvent(new Event('input', { bubbles: true }))
    })
    hub.state.unlocked = false
    await gate(false)
    await vi.waitFor(() => expect(document.body.textContent).toContain('NOT saved'), { timeout: 4000 })
    snap('77 embedded: locked, the month covered, what was typed NOT saved')

    hub = monthsHub()
    await start({ hub, waitFor: 'months of Fake Co Ltd, kept in the dashboard' })
    await vi.waitFor(() => expect(document.querySelector('tbody input')).toBeTruthy())
    hub.changeMonthElsewhere('C00000001', '2026-10', octoberEmployees.slice(0, 2))
    const again = document.querySelector('tbody [aria-label="Basic Salary"]')
    await act(async () => {
      setter.call(again, '19115')
      again.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await vi.waitFor(() => expect(document.body.textContent).toContain('Save mine over it'), { timeout: 4000 })
    snap('78 embedded: a month NOT saved, someone else saved it')

    await start({ hub: monthsHub({ companies: [{ ...FAKE, role: 'member' }, OTHER] }), waitFor: 'Only an admin can see the employees' })
    snap('79 embedded: months of a company you are not an admin of')

    await startMonthsImport(monthsHub({ months: {} }))

    await start({ hub: monthsHub({ unlocked: false }), waitFor: 'Unlock the dashboard to continue' })
    snap('83 embedded: opened while the dashboard is locked')
  }

  // ---------- Phase 3 follow-ups: History and restore, the offline copy ----------
  // The History dialogs exist only in a version that has them, and are not collected for
  // the base. The pages are collected for both: the base shows its own page there.
  const KNOWS_HISTORY = fs.existsSync(path.join(SRC, 'lib/dashboardHistory.js'))
  const KNOWS_OFFLINE = fs.existsSync(path.join(SRC, 'lib/offlineCopy.js'))
  const revised = () => {
    const hub = attachedHub({ monthsSupported: true, months: { 'C00000001|2026-10': { employees: octoberEmployees, shared_revision: 2 } } })
    const body = structuredClone({ identityFields, idFieldKey, globalColumns })
    body.globalColumns = body.globalColumns.map((c) => (c.key === 'netPay' ? { ...c, formula: 'grossPay - totalDeductions - 100' } : c))
    hub.changeSharedElsewhere(SHARED_ID, body)
    return hub
  }
  const selectRevision = async (n) => {
    const item = [...topDialog().querySelectorAll('[aria-label="Saved versions"] button')].find((b) => squash(b.textContent).startsWith(`Revision ${n}`))
    expect(item, `revision ${n}`).toBeTruthy()
    await act(async () => item.click())
  }
  const gateTo = (unlocked) =>
    reply('send-data', `gate-history-${String(Date.now()).padStart(13, '0')}`, { dataType: 'payroll-month', rows: [{ action: 'gate', unlocked }] })
  const typeSalary = async (value) => {
    const input = document.querySelector('tbody [aria-label="Basic Salary"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    await act(async () => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  if (KNOWS_HISTORY) {
    let hub = revised()
    await start({ hub, waitFor: 'months of Fake Co Ltd, kept in the dashboard' })
    await click('Global Columns')
    await click('History of the Global columns')
    await vi.waitFor(() => expect(topDialog().textContent).toContain('Revision 1'))
    await selectRevision(1)
    await vi.waitFor(() => expect(topDialog().textContent).toContain('What restoring it would change'))
    snapWording('84 embedded: History of the Global columns, an earlier version')
    await click('Restore this version', topDialog())
    await vi.waitFor(() => expect(topDialog().textContent).toContain('would be worked out differently'))
    snapWording('85 embedded: History of the Global columns, restore asked')
    await click('Restore', topDialog())
    await vi.waitFor(() => expect(topDialog().textContent).toContain('Restored.'))
    // The list of versions is read again after the restore, a moment after "Restored." shows.
    await vi.waitFor(() => expect(topDialog().textContent).toContain('Revision 3 (current)'))
    snapWording('86 embedded: History of the Global columns, restored')

    hub = revised()
    hub.state.unlocked = false
    await start({ hub, waitFor: 'Unlock the dashboard to continue' })
    await click('Global Columns')
    await click('History of the Global columns')
    await vi.waitFor(() => expect(topDialog().textContent).toContain('Revision 1'))
    await selectRevision(1)
    await vi.waitFor(() => expect(button('Restore this version', topDialog())).toBeTruthy())
    await click('Restore this version', topDialog())
    await vi.waitFor(() => expect(topDialog().textContent).toContain('could not be checked'))
    snapWording('87 embedded: History of the Global columns, the months could not be checked (locked)')

    await start({ hub: attachedHub({ companies: [{ ...FAKE, role: 'member' }, OTHER] }), waitFor: 'kept in the dashboard' })
    await click('Company Columns')
    await click('History of the columns of Fake Co Ltd')
    await vi.waitFor(() => expect(topDialog().textContent).toContain('Revision 1'))
    snapWording('88 embedded: History of a company\'s columns, the version in use, not an admin')

    hub = attachedHub({ monthsSupported: true, months: { 'C00000001|2026-10': { employees: octoberEmployees } } })
    await start({ hub, waitFor: 'months of Fake Co Ltd, kept in the dashboard' })
    await vi.waitFor(() => expect(document.querySelector('tbody input')).toBeTruthy())
    await typeSalary('19115')
    await vi.waitFor(() => expect(hub.state.months.get('C00000001|2026-10').revision).toBe(2), { timeout: 4000 })
    await typeSalary('20115')
    await vi.waitFor(() => expect(hub.state.months.get('C00000001|2026-10').revision).toBe(3), { timeout: 4000 })
    await vi.waitFor(() => expect(button('History of this month').disabled).toBe(false))
    await click('History of this month')
    await vi.waitFor(() => expect(topDialog().textContent).toContain('Revision 1'))
    await selectRevision(1)
    await vi.waitFor(() => expect(topDialog().textContent).toContain('Testeur'))
    snapWording('89 embedded: History of a month, an earlier version')
    await click('Restore this version', topDialog())
    snapWording('90 embedded: History of a month, restore asked')
    await selectRevision(2)
    snapWording('91 embedded: History of a month, only the record of a save kept')
    hub.state.unlocked = false
    await gateTo(false)
    await vi.waitFor(() => expect(topDialog().textContent).toContain('Unlock it to see'))
    snapWording('92 embedded: History of a month, the dashboard locked')
  }

  if (KNOWS_OFFLINE) {
    // A setup loaded once, then the dashboard cannot be reached.
    const hub = attachedHub({ monthsSupported: true, months: { 'C00000001|2026-10': { employees: octoberEmployees } } })
    await start({ hub, waitFor: 'kept in the dashboard' })
    const kept = localStorage.getItem('payroll_dashboard_offline_v1')
    hub.state.down = true
    await start({ hub, waitFor: 'could not be loaded' })
    // start() clears this browser's storage, as a new profile would: the copy is put back,
    // and the dashboard is asked again.
    localStorage.setItem('payroll_dashboard_offline_v1', kept)
    await click('Try again')
    await vi.waitFor(() => expect(document.body.textContent).toContain('Open the read-only copy'))
    snapWording('93 embedded: column setup could not be loaded, a read-only copy offered', document.body)
    const offer = [...document.querySelectorAll('button')].find((b) => squash(b.textContent).startsWith('Open the read-only copy'))
    await act(async () => offer.click())
    await vi.waitFor(() => expect(document.body.textContent).toContain('Offline: read-only copy from'))
    await click('Global Columns')
  } else {
    // The base: the Global columns as it shows them, to compare the read-only copy with.
    await startDashboard(attachedHub(), 'kept in the dashboard')
    await click('Global Columns')
  }
  snapWording('94 embedded: the read-only copy, Global columns', document.body)
  if (KNOWS_OFFLINE) {
    await click('Employee Table')
    const cover = document.querySelector('[aria-label="Not in the offline copy"]')
    expect(cover, 'the months cover').toBeTruthy()
    snapWording('95 embedded: the read-only copy, Employee Table (the cover)', cover)
  }

  // ---------- Clear the column setup ----------
  // Only the dialogs: the base version has no such button.
  const KNOWS_CLEAR = fs.existsSync(path.join(SRC, 'components/ClearColumnSetupModal.jsx'))
  if (KNOWS_CLEAR) {
    // The exported files are named by the day: always the same day here.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-13T08:05:00.000Z'))
    URL.createObjectURL = () => 'blob:fake'
    URL.revokeObjectURL = () => {}
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const openClear = async () => {
      await startDashboard(attachedHub(), 'kept in the dashboard')
      await click('Clear the column setup…')
      const dialog = topDialog()
      const input = dialog.querySelector('input')
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'CLEAR')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      return dialog
    }
    await openClear()
    snapDialog('96 embedded: clear the column setup, exported and CLEAR typed')
    await click('Clear the column setup', topDialog())
    await vi.waitFor(() => expect(topDialog().textContent).toContain('Column setup cleared'))
    snapDialog('96b embedded: column setup cleared')
    await openClear()
    setupHub.state.down = true
    await click('Clear the column setup', topDialog())
    await vi.waitFor(() => expect(topDialog().textContent).toContain('Nothing was cleared'), { timeout: 15000 })
    snapDialog('96c embedded: column setup NOT cleared')
    setupHub.state.down = false
    anchorClick.mockRestore()
    vi.useRealTimers()
  }

  // ---------- Several companies in one Excel file ----------
  // Only the dialogs: the base version has no such button (its page is screen 76).
  const KNOWS_SEVERAL = fs.existsSync(path.join(SRC, 'components/SeveralCompaniesModal.jsx'))
  if (KNOWS_SEVERAL) {
    URL.createObjectURL = () => 'blob:fake'
    URL.revokeObjectURL = () => {}
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const severalHub = (more = {}) =>
      attachedHub({
        monthsSupported: true,
        months: { 'C00000001|2026-10': { employees: octoberEmployees } },
        setups: {
          C00000001: { shared_setup_id: SHARED_ID, body: structuredClone({ columns: company.columns, customFields: company.details.customFields }), revision: 1 },
        },
        ...more,
      })
    const openSeveral = async (hub) => {
      await start({ hub, waitFor: 'months of Fake Co Ltd, kept in the dashboard' })
      await click('Several companies…')
      await vi.waitFor(() => expect(topDialog().textContent).toMatch(/Companies where you are an admin|cannot export|could not/))
    }
    await openSeveral(severalHub())
    snapDialog('97 embedded: several companies, nothing chosen')
    await click('Select all', topDialog())
    snapDialog('97b embedded: several companies, all chosen')
    setupHub.state.delayMs = 300
    await click('Export 2 companies', topDialog())
    snapDialog('97c embedded: several companies, waiting for the answer in the dashboard')
    await vi.waitFor(() => expect(topDialog().textContent).toContain('Reading'))
    snapDialog('97d embedded: several companies, reading one company')
    await vi.waitFor(() => expect(topDialog().textContent).toContain('Downloaded'), { timeout: 10000 })
    setupHub.state.delayMs = 0
    snapWording('97e embedded: several companies, downloaded')

    await openSeveral(severalHub())
    setupHub.state.batchAnswer = 'deny'
    await click('Select all', topDialog())
    await click('Export 2 companies', topDialog())
    await vi.waitFor(() => expect(topDialog().textContent).toContain('declined'))
    snapDialog('97f embedded: several companies, turned down in the dashboard')

    await openSeveral(severalHub())
    setupHub.state.unlocked = false
    setupHub.state.unlockAnswer = 'deny'
    await click('Select all', topDialog())
    await click('Export 2 companies', topDialog())
    await vi.waitFor(() => expect(topDialog().textContent).toContain('locked'))
    snapDialog('97g embedded: several companies, the dashboard locked')

    await openSeveral(severalHub({ batchSupported: false }))
    snapDialog('97h embedded: several companies, a dashboard that cannot export them')
    anchorClick.mockRestore()
  }

  expect(OUT, 'TEXT_CHECK_OUT_EMBEDDED').toBeTruthy()
  fs.writeFileSync(OUT, JSON.stringify(collected, null, 2))
}, 120000)
