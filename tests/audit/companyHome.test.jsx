// @vitest-environment jsdom

// Company lists, Stage 3: inside the dashboard the app opens on "Your companies",
// a card for each company on the Payroll list (company-list, the dashboard's
// migration 0024), in a stand-in for the dashboard (tests/helpers/fakeSetupHub.js).
// A dashboard from before the lists: the app opens on the company, as before
// (dashboardApp.test.jsx). TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../../src/App'
import { resetDataStore } from '../../src/lib/dataStore'
import { forgetDashboardSetup } from '../../src/lib/dashboardSetup'
import { formatPeriodLabel, getCurrentPeriod, shiftPeriod } from '../../src/lib/periods'
import { createFakeSetupHub, installFakeBridge } from '../helpers/fakeSetupHub'
import { identityFields, idFieldKey, globalColumns, company } from '../safetyNet/fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SHARED_ID = '30000000-0000-4000-8000-000000000001'
const A = { brn: 'C00000001', name: 'TEST Alpha Ltd', address: '1 Test Street', role: 'admin' }
const B = { brn: 'C00000002', name: 'TEST Beta Ltd', address: '2 Test Street', role: 'admin' }
const C = { brn: 'C00000003', name: 'TEST Coral Ltd', address: '3 Test Street', role: 'admin' }

function seed(companyList, more = {}) {
  return {
    companies: [A, B, C],
    selectedBrn: A.brn,
    shared: [{ id: SHARED_ID, name: 'Shared column setup', body: structuredClone({ identityFields, idFieldKey, globalColumns }), revision: 1 }],
    setups: {
      [A.brn]: { shared_setup_id: SHARED_ID, body: structuredClone({ columns: company.columns, customFields: [] }), revision: 1 },
    },
    ...(companyList ? { companyList } : {}),
    ...more,
  }
}

let root
let container
let hub

const home = () => container.querySelector('[data-testid="company-home"]')
const cardNames = () => [...container.querySelectorAll('.company-card .company-name')].map((el) => el.textContent)
const buttonIn = (scope, label) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
// What is on screen: the cards, or the company (the company may stay open, hidden, behind the cards).
const shownText = () => (home() ? home().textContent : container.textContent).replace(/\s+/g, ' ')
const companyShown = () => !home() && /kept in the dashboard/.test(container.textContent)
const monthLabel = (delta) => {
  const { year, month } = shiftPeriod(getCurrentPeriod().year, getCurrentPeriod().month, delta)
  return { key: `${year}-${String(month).padStart(2, '0')}`, label: formatPeriodLabel(year, month) }
}

async function startApp(theHub) {
  hub = theHub
  installFakeBridge(hub)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<App />))
}

// As the dashboard does after it selected another company: the app starts again.
async function reload() {
  await act(async () => root.unmount())
  container.remove()
  forgetDashboardSetup()
  resetDataStore()
  await startApp(hub)
}

async function click(target) {
  expect(target, 'the control').toBeTruthy()
  await act(async () => target.click())
}

async function choose(select, value) {
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

beforeEach(() => {
  localStorage.clear()
  forgetDashboardSetup()
})

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  root = null
  container?.remove()
  document.body.innerHTML = ''
  resetDataStore()
  delete window.PayrollHubBridge
})

describe('Your companies', () => {
  test('opens on a card for each company on the Payroll list, by name, and loads no company until one is opened', async () => {
    await startApp(createFakeSetupHub(seed({ listed: [C.brn, A.brn] })))
    await vi.waitFor(() => expect(cardNames()).toEqual(['TEST Alpha Ltd', 'TEST Coral Ltd']))
    expect(shownText()).toContain('Your companies')
    expect(shownText()).toContain(monthLabel(0).label)
    expect(shownText()).toContain('C00000003')
    expect(buttonIn(home(), 'Choose companies')).toBeTruthy()
    expect(hub.state.log.map((one) => one.action)).toEqual(['companies'])
  })

  test('Choose companies asks the dashboard for its picker', async () => {
    await startApp(createFakeSetupHub(seed({ listed: [A.brn] })))
    await vi.waitFor(() => expect(cardNames()).toEqual(['TEST Alpha Ltd']))
    await click(buttonIn(home(), 'Choose companies'))
    await vi.waitFor(() => expect(hub.state.pickerOpened).toBe(1))
  })

  test('an empty list: "No companies yet", and Choose companies for an admin', async () => {
    await startApp(createFakeSetupHub(seed({ listed: [] })))
    await vi.waitFor(() => expect(container.querySelector('[data-testid="no-companies"]')).toBeTruthy())
    expect(shownText()).toContain('No companies yet')
    await click(buttonIn(home(), 'Choose companies'))
    await vi.waitFor(() => expect(hub.state.pickerOpened).toBe(1))
  })

  test('an empty list, for someone who is an admin of no company: "An admin can choose them."', async () => {
    const member = (one) => ({ ...one, role: 'member' })
    await startApp(createFakeSetupHub(seed({ listed: [] }, { companies: [member(A), member(B)] })))
    await vi.waitFor(() => expect(shownText()).toContain('An admin can choose them.'))
    expect(buttonIn(home(), 'Choose companies')).toBeUndefined()
  })

  test('the card of the selected company opens it in the month chosen; Your companies goes back, and the company stays as it was', async () => {
    await startApp(createFakeSetupHub(seed({ listed: [A.brn, B.brn] })))
    await vi.waitFor(() => expect(cardNames()).toHaveLength(2))
    const earlier = monthLabel(-2)
    await choose(home().querySelector('select'), earlier.key)
    await click(container.querySelector('.company-card'))
    await vi.waitFor(() => expect(companyShown()).toBe(true))
    expect(hub.state.opened).toEqual([{ brn: A.brn, period: earlier.key }])
    expect(container.textContent).toContain(earlier.label)

    await click(buttonIn(container.querySelector('[data-testid="home-bar"]'), 'Your companies'))
    await vi.waitFor(() => expect(home()).toBeTruthy())
    // Opened again, now in this month: the setup is not loaded a second time.
    await choose(home().querySelector('select'), monthLabel(0).key)
    await click(container.querySelector('.company-card'))
    await vi.waitFor(() => expect(companyShown()).toBe(true))
    expect(container.textContent).toContain(monthLabel(0).label)
    expect(hub.state.log.filter((one) => one.action === 'load')).toHaveLength(1)
  })

  test('another company\'s card: the dashboard selects it and the app, started again, opens it straight away in that month', async () => {
    await startApp(createFakeSetupHub(seed({ listed: [A.brn, B.brn] })))
    await vi.waitFor(() => expect(cardNames()).toHaveLength(2))
    const earlier = monthLabel(-1)
    await choose(home().querySelector('select'), earlier.key)
    await click(container.querySelectorAll('.company-card')[1])
    await vi.waitFor(() => expect(hub.state.opened).toEqual([{ brn: B.brn, period: earlier.key }]))
    expect(hub.state.selectedBrn).toBe(B.brn)
    // B has no column setup yet: its usual start screen, with the way back to the cards.
    await reload()
    await vi.waitFor(() => expect(container.textContent).toContain('TEST Beta Ltd has no column setup in the dashboard yet'))
    expect(home()).toBeNull()
    expect(buttonIn(container, 'Your companies')).toBeTruthy()
  })

  test('opened straight away on a company that is not on the list: "Not on the list", and Add opens the picker', async () => {
    await startApp(createFakeSetupHub(seed({ listed: [B.brn], open: { period: null } })))
    await vi.waitFor(() => expect(companyShown()).toBe(true))
    const bar = container.querySelector('[data-testid="home-bar"]')
    expect(bar.textContent).toContain('Not on the list')
    await click(buttonIn(bar, 'Add'))
    await vi.waitFor(() => expect(hub.state.pickerOpened).toBe(1))
  })

  test('the list cannot be read: the reason and Try again, which reads it again', async () => {
    const theHub = createFakeSetupHub(seed({ listed: [A.brn] }))
    theHub.state.companyList.down = true
    await startApp(theHub)
    await vi.waitFor(() => expect(container.querySelector('[data-testid="home-problem"]')).toBeTruthy())
    expect(shownText()).toContain("Can't reach the database.")
    theHub.state.companyList.down = false
    await click(buttonIn(home(), 'Try again'))
    await vi.waitFor(() => expect(cardNames()).toEqual(['TEST Alpha Ltd']))
  })
})
