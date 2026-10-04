// @vitest-environment jsdom

// Text check, collector for the app running INSIDE the dashboard (a stand-in
// parent window), where the "Send to dashboard" button exists. Same output
// format as collect.textcheck.jsx; see scripts/text-check.mjs.

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, expect, test, vi } from 'vitest'
import { identityFields, idFieldKey, globalColumns, company, octoberEmployees } from '../safetyNet/fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SRC = process.env.TEXT_CHECK_SRC ?? path.resolve(import.meta.dirname, '../../src')
const OUT = process.env.TEXT_CHECK_OUT_EMBEDDED
const HUB_ORIGIN = 'https://noor1290.github.io'
const load = (file) => import(/* @vite-ignore */ pathToFileURL(path.join(SRC, file)).href)

const collected = {}
const posted = []
const fakeDashboard = { postMessage: (message) => posted.push(message) }
let App
let root
let container

beforeAll(async () => {
  Object.defineProperty(window, 'parent', { value: fakeDashboard, configurable: true })
  await load('payrollHubBridge.js')
  App = (await load('App.jsx')).default
})

const squash = (s) => s.replace(/\s+/g, ' ').trim()

function snap(name) {
  const out = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  for (let el = walker.currentNode; el; el = walker.nextNode()) {
    const own = squash([...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(''))
    if (own) out.push(`text: ${own}`)
    for (const attr of ['title', 'aria-label', 'placeholder', 'alt']) {
      const value = el.getAttribute?.(attr)
      if (value && squash(value)) out.push(`${attr}: ${squash(value)}`)
    }
  }
  collected[name] = out
}

async function start({ october = octoberEmployees, details = company.details } = {}) {
  if (root) {
    await act(async () => root.unmount())
    container.remove()
  }
  localStorage.clear()
  localStorage.setItem(
    'payroll_app_state_v1',
    JSON.stringify({ identityFields, idFieldKey, globalColumns, companies: [{ ...company, details }], activeCompanyId: company.id })
  )
  localStorage.setItem(`payroll_period_${company.id}_2026-10`, JSON.stringify({ employees: october }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(App)))
  await vi.waitFor(() => expect(document.body.textContent).toContain('October 2026'))
}

const sendButton = () => [...document.querySelectorAll('button')].find((b) => squash(b.textContent) === 'Send to dashboard')

async function sendAndReply(payload) {
  posted.length = 0
  await act(async () => sendButton().click())
  const sent = posted.find((m) => m.type === 'send-data')
  expect(sent, 'send-data message').toBeTruthy()
  const event = new MessageEvent('message', {
    data: { type: 'received', from: 'dashboard', to: 'payroll', version: 1, id: sent.id, payload },
    origin: HUB_ORIGIN,
  })
  Object.defineProperty(event, 'source', { value: fakeDashboard })
  await act(async () => window.dispatchEvent(event))
}

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

  expect(OUT, 'TEXT_CHECK_OUT_EMBEDDED').toBeTruthy()
  fs.writeFileSync(OUT, JSON.stringify(collected, null, 2))
}, 60000)
