// @vitest-environment jsdom

// Safety net, part 2: what leaves the app. Clicks the real "Export for PDF
// fill" dialog and the real "Send to dashboard" button (through the real,
// unmodified bridge, with a stand-in for the dashboard window) and compares
// exactly what they produce with the recorded result.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { expectRecorded } from './recorded'
import { identityFields, company, effectiveColumns, octoberEmployees, octoberGrid } from './fixture'
import PdfFillExportModal from '../../src/components/PdfFillExportModal'
import SendToDashboardButton from '../../src/components/SendToDashboardButton'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const HUB_ORIGIN = 'https://noor1290.github.io'

// Stand-in for the dashboard window that embeds the app.
const posted = []
const fakeDashboard = {
  postMessage(message, targetOrigin) {
    posted.push({ message, targetOrigin })
  },
}

// Downloads: capture the file instead of saving it.
const downloads = []
let lastBlob = null

beforeAll(async () => {
  Object.defineProperty(window, 'parent', { value: fakeDashboard, configurable: true })
  await import('../../src/payrollHubBridge.js')
  // Same call App makes on mount.
  window.PayrollHubBridge.init({ appId: 'payroll' })

  URL.createObjectURL = (blob) => {
    lastBlob = blob
    return 'blob:fake'
  }
  URL.revokeObjectURL = () => {}
  HTMLAnchorElement.prototype.click = function click() {
    downloads.push({ filename: this.download, blob: lastBlob })
  }
})

let root = null
let container = null

function render(element) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(element))
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  posted.length = 0
  downloads.length = 0
})

function readBlob(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.readAsText(blob)
  })
}

function buttonByText(scope, text) {
  const button = [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
  expect(button, `button "${text}"`).toBeTruthy()
  return button
}

// A checkbox in the dialog's "Company Details" section (a company field can
// share its label with an employee column, so the section matters).
function companyFieldCheckbox(scope, text) {
  const heading = [...scope.querySelectorAll('h3')].find((h) => h.textContent.trim() === 'Company Details')
  expect(heading, 'Company Details section').toBeTruthy()
  const label = [...heading.parentElement.querySelectorAll('label')].find((l) => l.textContent.trim() === text)
  expect(label, `company field "${text}"`).toBeTruthy()
  return label.querySelector('input')
}

async function exportFromDialog(format, tickCompanyFields) {
  const scope = render(
    <PdfFillExportModal
      format={format}
      identityFields={identityFields}
      effectiveColumns={effectiveColumns}
      employees={octoberEmployees}
      computedGrid={octoberGrid}
      companyName={company.name}
      companyDetails={company.details}
      year={2026}
      month={10}
      onClose={() => {}}
    />
  )
  for (const label of tickCompanyFields) act(() => companyFieldCheckbox(scope, label).click())
  act(() => buttonByText(scope, `Export ${format.toUpperCase()}`).click())
  expect(downloads).toHaveLength(1)
  const { filename, blob } = downloads[0]
  return { filename, mimeType: blob.type, content: await readBlob(blob) }
}

const ALL_COMPANY_FIELDS = ['Company Name', 'Address', 'BRN', 'VAT', 'Levy']

test('"Export for PDF fill (JSON)" as the dialog opens (all columns, no company details)', async () => {
  const file = await exportFromDialog('json', [])
  expectRecorded('pdf-fill-json-default', { filename: file.filename, mimeType: file.mimeType, json: JSON.parse(file.content) })
  // The exact bytes too: indentation and key order are part of the file.
  expectRecorded('pdf-fill-json-default-text', file.content)
})

test('"Export for PDF fill (JSON)" with every company details field ticked', async () => {
  const file = await exportFromDialog('json', ALL_COMPANY_FIELDS)
  expectRecorded('pdf-fill-json-everything', { filename: file.filename, mimeType: file.mimeType, json: JSON.parse(file.content) })
  expectRecorded('pdf-fill-json-everything-text', file.content)
})

test('"Export for PDF fill (CSV)" with every company details field ticked', async () => {
  const file = await exportFromDialog('csv', ALL_COMPANY_FIELDS)
  expectRecorded('pdf-fill-csv-everything', file)
})

function sendButtonProps(overrides = {}) {
  return {
    identityFields,
    effectiveColumns,
    employees: octoberEmployees,
    computedGrid: octoberGrid,
    companyName: company.name,
    companyDetails: company.details,
    year: 2026,
    month: 10,
    ...overrides,
  }
}

// The dashboard's answer, delivered the way the browser would deliver it.
async function dashboardReplies(id, payload) {
  const event = new MessageEvent('message', {
    data: { type: 'received', from: 'dashboard', to: 'payroll', version: 1, id, payload },
    origin: HUB_ORIGIN,
  })
  Object.defineProperty(event, 'source', { value: fakeDashboard })
  await act(async () => {
    window.dispatchEvent(event)
  })
}

async function clickSend(scope) {
  await act(async () => {
    buttonByText(scope, 'Send to dashboard').click()
  })
  expect(posted).toHaveLength(1)
  return posted[0]
}

// The message id is random by design; everything else must match exactly.
function withoutId(entry) {
  expect(entry.message.id).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
  return { targetOrigin: entry.targetOrigin, message: { ...entry.message, id: '<id>' } }
}

test('"Send to dashboard" posts the recorded message to the dashboard, and shows its reply', async () => {
  const scope = render(<SendToDashboardButton {...sendButtonProps()} />)
  const sent = await clickSend(scope)

  expect(sent.targetOrigin).toBe(HUB_ORIGIN)
  expectRecorded('send-to-dashboard-message', withoutId(sent))

  await dashboardReplies(sent.message.id, { ok: true })
  expect(scope.querySelector('[role="status"]').textContent).toContain('Sent to the dashboard')
})

test('"Send to dashboard" sends the same rows as the JSON export with everything ticked', async () => {
  const file = await exportFromDialog('json', ALL_COMPANY_FIELDS)
  act(() => root.unmount())
  downloads.length = 0

  const scope = render(<SendToDashboardButton {...sendButtonProps()} />)
  const sent = await clickSend(scope)
  expect(JSON.stringify(sent.message.payload.rows, null, 2)).toBe(file.content)
})

test('"Send to dashboard" shows the dashboard\'s error', async () => {
  const scope = render(<SendToDashboardButton {...sendButtonProps()} />)
  const sent = await clickSend(scope)
  await dashboardReplies(sent.message.id, { ok: false, error: 'Dashboard is locked.' })
  expect(scope.querySelector('[role="status"]').textContent).toContain('Not sent: Dashboard is locked.')
})

test('"Send to dashboard" conditions: disabled with a reason, and nothing is sent', () => {
  const states = {}
  for (const [name, overrides] of [
    ['ready', {}],
    ['no employees', { employees: [] }],
    ['no BRN', { companyDetails: { ...company.details, brn: '   ' } }],
    ['no company details at all', { companyDetails: undefined }],
  ]) {
    const scope = render(<SendToDashboardButton {...sendButtonProps(overrides)} />)
    const button = buttonByText(scope, 'Send to dashboard')
    states[name] = { disabled: button.disabled, tooltip: button.parentElement.getAttribute('title') }
    if (button.disabled) {
      act(() => button.click())
      expect(posted).toHaveLength(0)
    }
    act(() => root.unmount())
    container.remove()
  }
  expectRecorded('send-to-dashboard-conditions', states)
})
