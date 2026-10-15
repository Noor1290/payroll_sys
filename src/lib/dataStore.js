// The one way the app reads and saves its data.
//
// Screens never touch the browser's storage themselves: they call the
// operations below, and a "store" carries them out. Today there is one store,
// the browser (storage.js), so the app behaves exactly as it always has. When
// the app later saves through the Payroll Hub dashboard, that is a second
// store with the same operations, chosen here, and no screen has to change.
//
// The operations, and what each must do:
//   loadState()                                    the saved setup and companies, or null when nothing is saved
//   saveState(state)                               true when saved, false when it was refused
//   loadPeriod(companyId, year, month)             { employees } for one month (empty when nothing is saved);
//                                                  a store that reads over the network may answer with a
//                                                  promise of it, or with { employees: [], blocked: { code, error } }
//                                                  when the month cannot be read (nothing to show, nothing to save)
//   savePeriod(companyId, year, month, data)       true when saved, false when it was refused
//   periodHasEmployees(companyId, year, month)     whether a saved month has anyone in it
//   deletePeriodsForCompany(companyId)             removes every saved month of a company
//   countPeriodsHoldingKey(companyIds, key)        { periods, companies } holding a value under that key
//   renameValueKeyInPeriods(companyIds, old, new)  moves those values; false if any write was refused

import * as browserStore from './storage'

export const STORE_OPERATIONS = [
  'loadState',
  'saveState',
  'loadPeriod',
  'savePeriod',
  'periodHasEmployees',
  'deletePeriodsForCompany',
  'countPeriodsHoldingKey',
  'renameValueKeyInPeriods',
]

let current = browserStore

// Chooses the store every later call goes to. Returns the one it replaces,
// so it can be put back. A store that lacks an operation is refused here,
// not later in the middle of someone's work.
export function setDataStore(store) {
  const missing = STORE_OPERATIONS.filter((name) => typeof store?.[name] !== 'function')
  if (missing.length > 0) throw new Error(`This store cannot be used: it has no ${missing.join(', ')}.`)
  const previous = current
  current = store
  return previous
}

// Back to the browser, the store the app starts with.
export function resetDataStore() {
  return setDataStore(browserStore)
}

// What the screens call. Each call goes to whichever store is chosen at that moment.
export const dataStore = Object.fromEntries(STORE_OPERATIONS.map((name) => [name, (...args) => current[name](...args)]))

// Not storage: a pure helper for one employee record, kept next to the
// operation that does the same to every saved month.
export { renameValueKey } from './storage'
