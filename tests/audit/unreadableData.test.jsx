// @vitest-environment jsdom

// Audit R4 (backlog batch D): saved data in this browser that cannot be read
// is never taken for "nothing saved", so it is never shown as empty and
// never saved over. The setup and companies: the app opens on a page that
// says so, with Back up, Restore and "Start with an empty setup". A month:
// it is covered, not shown, and never written. TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../../src/App'
import { resetDataStore } from '../../src/lib/dataStore'
import * as browserStore from '../../src/lib/storage'
import { identityFields, idFieldKey, testColumns, testEmployees } from './build'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const STATE_KEY = 'payroll_app_state_v1'
const SEPTEMBER = 'payroll_period_test-co-a_2026-09'
const DAMAGED = '{"identityFields": [{"id": "i1", "key": "id"'
const company = { id: 'test-co-a', name: 'TEST Co A', columns: [], columnWidths: {}, viewYear: 2026, viewMonth: 9, details: { address: '', brn: 'TEST-BRN-A', customFields: [] } }
const goodState = () => JSON.stringify({ identityFields, idFieldKey, globalColumns: testColumns(), companies: [company], activeCompanyId: company.id })

let root
let container
const text = () => container.textContent
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === label)

async function startApp() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<App />))
}

beforeEach(async () => {
  localStorage.clear()
  resetDataStore()
  await import('../../src/payrollHubBridge.js')
})

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  root = container = null
  vi.restoreAllMocks()
})

describe('the saved setup cannot be read', () => {
  test.each([
    ['cut off', DAMAGED],
    ['not an object', '[1, 2, 3]'],
    ['null', 'null'],
  ])('%s: it is not "nothing saved", and it is never saved over', (_label, stored) => {
    localStorage.setItem(STATE_KEY, stored)
    expect(browserStore.loadState()).toBeNull()
    expect(browserStore.setupIsUnreadable()).toBe(true)
    expect(browserStore.saveState({ identityFields, idFieldKey, globalColumns: [], companies: [], activeCompanyId: null })).toBe(false)
    expect(localStorage.getItem(STATE_KEY)).toBe(stored)
  })

  test('nothing saved at all is still an empty start, and a readable setup is not flagged', () => {
    expect(browserStore.setupIsUnreadable()).toBe(false)
    localStorage.setItem(STATE_KEY, goodState())
    expect(browserStore.setupIsUnreadable()).toBe(false)
    expect(browserStore.loadState().companies.map((c) => c.name)).toEqual(['TEST Co A'])
  })

  test('"Start with an empty setup" keeps the text under a key of its own first; if the browser refuses that copy, nothing changes', () => {
    localStorage.setItem(STATE_KEY, DAMAGED)
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(browserStore.startWithEmptySetup(new Date('2026-10-16T09:00:00.000Z'))).toEqual({ ok: false })
    setItem.mockRestore()
    expect(localStorage.getItem(STATE_KEY)).toBe(DAMAGED)

    expect(browserStore.startWithEmptySetup(new Date('2026-10-16T09:00:00.000Z'))).toEqual({ ok: true, keptUnder: 'payroll_app_state_v1_unreadable_2026-10-16T09:00:00.000Z' })
    expect(localStorage.getItem('payroll_app_state_v1_unreadable_2026-10-16T09:00:00.000Z')).toBe(DAMAGED)
    expect(localStorage.getItem(STATE_KEY)).toBeNull()
    expect(browserStore.setupIsUnreadable()).toBe(false)
  })

  test('on its own, the app opens on a page that says so, and starts empty only when asked, keeping the copy', async () => {
    localStorage.setItem(STATE_KEY, DAMAGED)
    localStorage.setItem(SEPTEMBER, JSON.stringify({ employees: testEmployees() }))
    await startApp()
    expect(container.querySelector('h1').textContent).toBe('The saved setup could not be read')
    expect(text()).toContain(
      'The columns and companies saved in this browser are there, but they could not be read, so they cannot be shown. Nothing has been changed, and nothing will be saved over them.'
    )
    expect(text()).toContain('First save a backup with "Back up": it keeps them exactly as they are. If you have an earlier backup, "Restore" puts it back.')
    expect(text()).toContain('Keeps a copy of what could not be read in this browser, then starts with no columns and no companies. The saved months are not touched.')
    expect(button('Back up')).toBeTruthy()
    expect(button('Restore')).toBeTruthy()
    // Opening the page wrote nothing.
    expect(localStorage.getItem(STATE_KEY)).toBe(DAMAGED)

    await act(async () => button('Start with an empty setup').click())
    const kept = Object.keys(localStorage).filter((k) => k.startsWith('payroll_app_state_v1_unreadable_'))
    expect(kept).toHaveLength(1)
    expect(localStorage.getItem(kept[0])).toBe(DAMAGED)
    expect(document.body.textContent).toContain('Started with an empty setup')
    expect(document.body.textContent).toContain(`What could not be read is kept in this browser, under "${kept[0]}".`)
    // The month is still there as it was.
    expect(JSON.parse(localStorage.getItem(SEPTEMBER)).employees).toHaveLength(testEmployees().length)
  })

  test('when the browser refuses the copy, the page says so and nothing is changed', async () => {
    localStorage.setItem(STATE_KEY, DAMAGED)
    await startApp()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    await act(async () => button('Start with an empty setup').click())
    vi.restoreAllMocks()
    expect(text()).toContain("The browser's storage is full, so no copy could be kept. Nothing was changed. Save a backup, free some space, and try again.")
    expect(localStorage.getItem(STATE_KEY)).toBe(DAMAGED)
    expect(container.querySelector('h1').textContent).toBe('The saved setup could not be read')
  })
})

describe('a saved month cannot be read', () => {
  test('it is not "no employees": it is not shown, and never written, by a save or a change of key', () => {
    localStorage.setItem(SEPTEMBER, DAMAGED)
    expect(browserStore.loadPeriod('test-co-a', 2026, 9)).toEqual({
      employees: [],
      blocked: { code: 'unreadable', error: 'The data saved in this browser for this month could not be read. It is not shown, and nothing will be saved over it.' },
    })
    expect(browserStore.savePeriod('test-co-a', 2026, 9, { employees: [] })).toBe(false)
    expect(browserStore.renameValueKeyInPeriods(['test-co-a'], 'basicSalary', 'basicPay')).toBe(true)
    expect(localStorage.getItem(SEPTEMBER)).toBe(DAMAGED)
    // Another month is saved as before.
    expect(browserStore.savePeriod('test-co-a', 2026, 10, { employees: [] })).toBe(true)
  })

  test('on its own, the app covers that month with the reason, and the table is not there to type into', async () => {
    localStorage.setItem(STATE_KEY, goodState())
    localStorage.setItem(SEPTEMBER, DAMAGED)
    await startApp()
    const tab = [...container.querySelectorAll('button, [role="tab"]')].find((b) => b.textContent.trim() === 'Employee Table')
    if (tab) await act(async () => tab.click())
    const cover = [...container.querySelectorAll('[role="alert"]')].find((n) => n.textContent.includes('This month could not be read'))
    expect(cover.textContent.replace(/\s+/g, ' ').trim()).toBe(
      'This month could not be read' +
        'The data saved in this browser for this month could not be read. It is not shown, and nothing will be saved over it. A backup ("Back up", at the foot of the company list) keeps it exactly as it is.'
    )
    expect(container.querySelector('table')).toBeNull()
    expect(localStorage.getItem(SEPTEMBER)).toBe(DAMAGED)
  })
})
