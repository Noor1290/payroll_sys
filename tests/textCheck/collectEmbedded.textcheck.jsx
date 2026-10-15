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

function reply(type, id, payload) {
  const event = new MessageEvent('message', { data: { type, from: 'dashboard', to: 'payroll', version: 1, id, payload }, origin: HUB_ORIGIN })
  Object.defineProperty(event, 'source', { value: fakeDashboard })
  return act(async () => window.dispatchEvent(event))
}

async function answerSetup(message) {
  const dataType = message.payload?.dataType
  if ((message.type !== 'request-data' && message.type !== 'send-data') || (dataType !== 'payroll-setup' && dataType !== 'payroll-month')) return
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

async function sendAndReply(payload) {
  posted.length = 0
  await act(async () => sendButton().click())
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

  await sendAndReply({ ok: true })
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

  expect(OUT, 'TEXT_CHECK_OUT_EMBEDDED').toBeTruthy()
  fs.writeFileSync(OUT, JSON.stringify(collected, null, 2))
}, 60000)
