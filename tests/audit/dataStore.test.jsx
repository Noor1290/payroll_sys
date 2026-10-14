// @vitest-environment jsdom

// The storage interface (lib/dataStore.js): every read and save of the app
// goes through it, so a second store (the dashboard, later) can take the
// browser's place without any screen changing. TEST data only.

import fs from 'node:fs'
import path from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../../src/App'
import { dataStore, resetDataStore, setDataStore, STORE_OPERATIONS } from '../../src/lib/dataStore'
import * as browserStore from '../../src/lib/storage'
import { identityFields, idFieldKey, testColumns, testEmployees } from './build'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SRC = path.resolve(import.meta.dirname, '../../src')
const sourceFiles = (dir = SRC) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.jsx?$/.test(entry.name) ? [full] : []
  })
const relative = (file) => path.relative(SRC, file).replaceAll('\\', '/')

const company = { id: 'test-co-a', name: 'TEST Co A', columns: [], columnWidths: {}, viewYear: 2026, viewMonth: 9, details: { address: '', brn: 'TEST-BRN-A', customFields: [] } }

// A store that keeps everything in memory and writes down what it was asked.
function memoryStore() {
  const calls = []
  const periods = new Map([['test-co-a:2026-9', { employees: testEmployees() }]])
  let state = { identityFields, idFieldKey, globalColumns: testColumns(), companies: [company], activeCompanyId: company.id }
  const record = (name, fn) => (...args) => {
    calls.push(name)
    return fn(...args)
  }
  return {
    calls,
    saved: () => state,
    period: (key) => periods.get(key),
    loadState: record('loadState', () => state),
    saveState: record('saveState', (next) => {
      state = next
      return true
    }),
    loadPeriod: record('loadPeriod', (id, year, month) => periods.get(`${id}:${year}-${month}`) ?? { employees: [] }),
    savePeriod: record('savePeriod', (id, year, month, data) => {
      periods.set(`${id}:${year}-${month}`, data)
      return true
    }),
    deletePeriodsForCompany: record('deletePeriodsForCompany', () => {}),
    countPeriodsHoldingKey: record('countPeriodsHoldingKey', () => ({ periods: 0, companies: 0 })),
    renameValueKeyInPeriods: record('renameValueKeyInPeriods', () => true),
  }
}

let root
let container

async function startApp() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<App />))
}

beforeEach(async () => {
  localStorage.clear()
  await import('../../src/payrollHubBridge.js')
})

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  root = null
  container?.remove()
  resetDataStore()
  vi.restoreAllMocks()
})

describe('one way in', () => {
  test('only the browser store itself touches the browser\'s storage', () => {
    // The theme is a display preference, not data, and keeps its own key.
    const allowed = ['lib/storage.js', 'lib/theme.js']
    const touching = sourceFiles()
      .filter((file) => /\b(localStorage|sessionStorage|indexedDB)\s*[.[]/.test(fs.readFileSync(file, 'utf8')))
      .map(relative)
    expect(touching.sort()).toEqual(allowed)
  })

  test('no screen reaches past the interface to the browser store', () => {
    // backup.js is the browser's own copy by definition: it reads and replaces exactly that.
    // dashboardSetup.js is the second store: it keeps the months in the browser store
    // until Phase 3. dashboardImport.js reads the browser's own copy to import it, and
    // never writes it.
    const allowed = ['lib/backup.js', 'lib/dashboardImport.js', 'lib/dashboardSetup.js', 'lib/dataStore.js']
    const importing = sourceFiles()
      .filter((file) => /from\s+['"][./]+(lib\/)?storage['"]/.test(fs.readFileSync(file, 'utf8')))
      .map(relative)
    expect(importing.sort()).toEqual(allowed)
  })

  test('the interface is exactly the operations the browser store has always had', () => {
    expect(STORE_OPERATIONS).toEqual([
      'loadState',
      'saveState',
      'loadPeriod',
      'savePeriod',
      'deletePeriodsForCompany',
      'countPeriodsHoldingKey',
      'renameValueKeyInPeriods',
    ])
    for (const name of STORE_OPERATIONS) expect(typeof browserStore[name]).toBe('function')
  })
})

describe('the browser store, through the interface', () => {
  test('is what the app uses unless told otherwise, and stores exactly what it always stored', () => {
    const state = { identityFields, idFieldKey, globalColumns: testColumns(), companies: [company], activeCompanyId: company.id }

    expect(dataStore.saveState(state)).toBe(true)
    expect(dataStore.savePeriod(company.id, 2026, 9, { employees: testEmployees() })).toBe(true)

    expect(Object.keys(localStorage).sort()).toEqual(['payroll_app_state_v1', 'payroll_period_test-co-a_2026-09'])
    expect(localStorage.getItem('payroll_app_state_v1')).toBe(JSON.stringify(state))
    expect(localStorage.getItem('payroll_period_test-co-a_2026-09')).toBe(JSON.stringify({ employees: testEmployees() }))
    expect(dataStore.loadState()).toEqual(browserStore.loadState())
    expect(dataStore.loadPeriod(company.id, 2026, 9)).toEqual({ employees: testEmployees() })
  })
})

describe('another store in its place', () => {
  test('a store that lacks an operation is refused at once, and the browser store stays in use', () => {
    const { savePeriod: _savePeriod, ...incomplete } = memoryStore()
    expect(() => setDataStore(incomplete)).toThrow('This store cannot be used: it has no savePeriod.')
    expect(() => setDataStore(null)).toThrow(/This store cannot be used/)

    dataStore.saveState({ identityFields, idFieldKey, globalColumns: [], companies: [], activeCompanyId: null })
    expect(localStorage.getItem('payroll_app_state_v1')).not.toBeNull()
  })

  test('the whole app then reads and saves there, and the browser\'s storage is left alone', async () => {
    const store = memoryStore()
    setDataStore(store)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    await startApp()

    // What is on screen came from the store: the company and its September employees.
    expect(container.textContent).toContain('TEST Co A')
    const ids = [...container.querySelectorAll('tbody input')].map((input) => input.value)
    for (const employee of testEmployees()) expect(ids).toContain(employee.values.id)
    expect(store.calls).toContain('loadState')
    expect(store.calls).toContain('loadPeriod')

    // A change is saved to the store: add an employee.
    const before = store.period('test-co-a:2026-9').employees.length
    const add = [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === '+ Add Employee')
    expect(add, 'the "+ Add Employee" button').toBeTruthy()
    await act(async () => add.click())
    expect(store.period('test-co-a:2026-9').employees).toHaveLength(before + 1)

    // Nothing of it went to the browser's storage.
    expect(setItem.mock.calls.filter(([key]) => String(key).startsWith('payroll_app') || String(key).startsWith('payroll_period'))).toEqual([])
    expect(Object.keys(localStorage)).toEqual([])
  })

  test('going back to the browser store puts the app back on the browser\'s own copy', async () => {
    setDataStore(memoryStore())
    resetDataStore()
    localStorage.setItem(
      'payroll_app_state_v1',
      JSON.stringify({ identityFields, idFieldKey, globalColumns: [], companies: [{ ...company, name: 'TEST Co B' }], activeCompanyId: company.id })
    )

    await startApp()

    expect(container.textContent).toContain('TEST Co B')
    expect(container.textContent).not.toContain('TEST Co A')
  })
})
