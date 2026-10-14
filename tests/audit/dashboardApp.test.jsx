// @vitest-environment jsdom

// The whole app inside a stand-in for the dashboard (tests/helpers/fakeSetupHub.js):
// what it shows, what it lets the user change, and what it saves where.
// Opened on its own it must be exactly as before. TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../../src/App'
import { resetDataStore } from '../../src/lib/dataStore'
import { forgetDashboardSetup, IMPORTED_KEY } from '../../src/lib/dashboardSetup'
import { createFakeSetupHub, installFakeBridge } from '../helpers/fakeSetupHub'
import { identityFields, idFieldKey, globalColumns, company, octoberEmployees } from '../safetyNet/fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SHARED_ID = '30000000-0000-4000-8000-000000000001'
const A = { brn: 'C00000001', name: 'Fake Co Ltd', address: '1 Test Street\nPort Louis', role: 'admin' }
const B = { brn: 'TEST-BRN-B', name: 'TEST Co B', address: '2 Test Street', role: 'admin' }
const STATE = { identityFields, idFieldKey, globalColumns, companies: [company], activeCompanyId: company.id }

function attachedSeed(more = {}) {
  return {
    companies: [A, B],
    selectedBrn: A.brn,
    shared: [{ id: SHARED_ID, name: 'Shared column setup', body: structuredClone({ identityFields, idFieldKey, globalColumns }), revision: 1 }],
    setups: {
      C00000001: { shared_setup_id: SHARED_ID, body: structuredClone({ columns: company.columns, customFields: company.details.customFields }), revision: 1 },
      'TEST-BRN-B': { shared_setup_id: SHARED_ID, body: { columns: [], customFields: [] }, revision: 1 },
    },
    ...more,
  }
}

let root
let container
let hub

const text = () => container.textContent.replace(/\s+/g, ' ')
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
const buttonIn = (scope, label) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
const dialog = () => document.querySelector('[role="dialog"]')

async function startApp() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<App />))
}

async function startInDashboard(seed = attachedSeed(), { waitFor = /kept in the dashboard|no column setup in the dashboard yet|could not be loaded/ } = {}) {
  hub = createFakeSetupHub(seed)
  installFakeBridge(hub)
  await startApp()
  await vi.waitFor(() => expect(text()).toMatch(waitFor))
}

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

beforeEach(() => {
  localStorage.clear()
  forgetDashboardSetup()
  localStorage.setItem('payroll_app_state_v1', JSON.stringify(STATE))
  localStorage.setItem(`payroll_period_${company.id}_2026-10`, JSON.stringify({ employees: octoberEmployees }))
})

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  root = null
  container?.remove()
  document.body.innerHTML = ''
  resetDataStore()
  delete window.PayrollHubBridge
})

describe('inside the dashboard', () => {
  test('shows the company selected there, from the dashboard, with nothing that adds, renames, deletes or restores', async () => {
    await startInDashboard()
    expect(text()).toContain('Column setup of Fake Co Ltd, kept in the dashboard.')
    expect(text()).toContain('Saved')
    const aside = container.querySelector('aside')
    expect(aside.textContent).toContain('Fake Co Ltd')
    expect(aside.textContent).not.toContain('TEST Co B') // held for the checks, not listed
    expect(buttonIn(aside, '+ New Company')).toBeUndefined()
    expect(buttonIn(aside, 'Restore')).toBeUndefined()
    expect(buttonIn(aside, 'Back up')).toBeTruthy()
    expect(aside.querySelector('[aria-label="Delete Fake Co Ltd"]')).toBeNull()
  })

  test('a change of company details is saved to the dashboard a moment later, and this browser\'s copy is left alone', async () => {
    await startInDashboard()
    await click(container.querySelector('[aria-label="Fake Co Ltd details"]'))
    const form = dialog()
    // Name, address and BRN are the dashboard's: shown, not editable.
    expect(form.querySelector('[aria-label="Company Name"]').readOnly).toBe(true)
    expect(form.querySelector('[aria-label="BRN"]').readOnly).toBe(true)
    expect(form.textContent).toContain("Name, address and BRN are the dashboard's.")
    await type(form.querySelectorAll('[aria-label="Value"]')[0], 'VAT-FAKE-2')
    await click(buttonIn(form, 'Save'))
    expect(text()).toContain('Saving…')
    await vi.waitFor(() => expect(text()).toContain('Saved'), { timeout: 3000 })
    expect(hub.state.log.filter((m) => m.type === 'send-data')).toEqual([{ type: 'send-data', action: 'save-company', company_brn: 'C00000001' }])
    expect(hub.state.setups.get('C00000001').body.customFields[0].value).toBe('VAT-FAKE-2')
    expect(localStorage.getItem('payroll_app_state_v1')).toBe(JSON.stringify(STATE))
  })

  test('the Global columns are read-only, and say why, for an admin of some but not all companies using them', async () => {
    await startInDashboard(attachedSeed({ othersAttached: [{ brn: 'TEST-BRN-Z', role: null, shared_setup_id: SHARED_ID }] }))
    expect(text()).toContain('The identity fields and Global columns are used by 3 companies, and you are an admin of 2 of them. You can see them here')
    await click(button('Global Columns'))
    expect(button('+ Add Column')).toBeUndefined()
    expect(button('+ Add Identity Field')).toBeUndefined()
    expect(button('Import Column Setup')).toBeUndefined()
    expect(button('Edit')).toBeUndefined()
    expect(button('Export Column Setup')).toBeTruthy()
    // The company's own columns are still the admin's to change.
    await click(button('Company Columns'))
    expect(button('+ Add Column')).toBeTruthy()
  })

  test('someone who is not an admin of the company sees its columns and details read-only', async () => {
    await startInDashboard(attachedSeed({ companies: [{ ...A, role: 'member' }, B] }))
    expect(text()).toContain('Only an admin of Fake Co Ltd can change them.')
    await click(button('Company Columns'))
    expect(button('+ Add Column')).toBeUndefined()
    await click(container.querySelector('[aria-label="Fake Co Ltd details"]'))
    expect(buttonIn(dialog(), 'Save')).toBeUndefined()
    expect(dialog().querySelector('[aria-label="Value"]').readOnly).toBe(true)
  })

  test('a company with no setup yet: import is offered, or new Global columns; nothing is made by itself', async () => {
    await startInDashboard({ companies: [A], selectedBrn: A.brn })
    expect(text()).toContain('Fake Co Ltd has no column setup in the dashboard yet')
    expect(button('Import to the dashboard')).toBeTruthy()
    await vi.waitFor(() => expect(button('Start with new, empty Global columns')).toBeTruthy())
    expect(hub.state.log.filter((m) => m.type === 'send-data')).toEqual([])

    await click(button('Start with new, empty Global columns'))
    await vi.waitFor(() => expect(text()).toContain('kept in the dashboard'))
    expect(hub.state.log.filter((m) => m.type === 'send-data').map((m) => m.action)).toEqual(['save-shared', 'attach-company'])
    expect(hub.state.setups.get('C00000001').body).toEqual({ columns: [], customFields: [] })
  })

  test('the import asks for a backup first, shows what it will do, then imports and checks', async () => {
    const downloads = []
    URL.createObjectURL = () => 'blob:fake'
    URL.revokeObjectURL = () => {}
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      downloads.push(this.download)
    })
    await startInDashboard({ companies: [A], selectedBrn: A.brn })
    await click(button('Import to the dashboard'))
    expect(buttonIn(dialog(), 'Continue').disabled).toBe(true)
    await click(buttonIn(dialog(), 'Download a backup file'))
    expect(downloads).toEqual([expect.stringMatching(/^payroll-backup-\d{4}-\d{2}-\d{2}\.json$/)])
    await click(buttonIn(dialog(), 'Continue'))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Matches Fake Co Ltd in the dashboard'))
    expect(dialog().textContent).toContain('Nothing has been written to the dashboard yet.')
    expect(hub.state.log.filter((m) => m.type === 'send-data')).toEqual([])

    await click(buttonIn(dialog(), 'Import 1 company'))
    await vi.waitFor(() => expect(dialog().textContent).toContain('imported and checked'))
    expect(dialog().textContent).toContain('This browser only. Not the dashboard\'s copy.')
    await click(buttonIn(dialog(), 'Close'))
    await vi.waitFor(() => expect(text()).toContain('Column setup of Fake Co Ltd, kept in the dashboard.'))
    // The months in this browser are there, with the imported setup.
    expect([...container.querySelectorAll('tbody input')].map((i) => i.value)).toContain(octoberEmployees[0].values.id)
    expect(localStorage.getItem('payroll_app_state_v1')).toBe(JSON.stringify(STATE))
  })

  test('inside a dashboard that does not keep payroll setups yet, it works from this browser, as before', async () => {
    await startInDashboard({ ...attachedSeed(), supported: false }, { waitFor: /\+ New Company/ })
    expect(hub.state.log).toEqual([{ type: 'request-data', action: 'load' }])
    expect(text()).not.toContain('kept in the dashboard')
  })
})

describe('opened on its own', () => {
  test('nothing changes, and after an import this browser\'s copy says it is not the dashboard\'s', async () => {
    await import('../../src/payrollHubBridge.js')
    await startApp()
    expect(button('+ New Company')).toBeTruthy()
    expect(text()).not.toContain('This browser only')
    await act(async () => root.unmount())
    container.remove()

    localStorage.setItem(IMPORTED_KEY, JSON.stringify({ companies: { [company.id]: { brn: 'C00000001', company: 'Fake Co Ltd' } } }))
    await startApp()
    expect(text()).toContain("This browser only. Not the dashboard's copy.")
    expect(button('+ New Company')).toBeTruthy()
  })
})
