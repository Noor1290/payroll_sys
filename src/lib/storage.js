import { makeId } from './model'
import { getCurrentPeriod, periodKey } from './periods'

const STORAGE_KEY = 'payroll_app_state_v1'
const PERIOD_KEY_PREFIX = 'payroll_period_'

// Migrates a pre-identity-fields employee ({ employeeId, name, surname,
// values }) into the current shape (everything lives in `values`).
function migrateEmployee(emp) {
  const isLegacyShape = emp.employeeId !== undefined || emp.name !== undefined || emp.surname !== undefined
  if (!isLegacyShape) {
    return { id: emp.id, values: emp.values ?? {} }
  }
  const { id, employeeId, name, surname, values } = emp
  return {
    id,
    values: { employeeId: employeeId ?? '', name: name ?? '', surname: surname ?? '', ...(values ?? {}) },
  }
}

// Pre-categories columns default to "General" so nothing disappears from
// the Employee Table or its grouped header after upgrading. Pre-decimals
// columns default to 2dp (payroll figures are typically currency-like);
// pre-value-type Input columns default to "number" (their existing,
// unchanged behavior).
function migrateColumn(col) {
  const valueType = col.type === 'input' ? (col.valueType ?? 'number') : undefined
  const isNumeric = col.type === 'formula' || (col.type === 'input' && valueType !== 'text')
  return {
    ...col,
    category: col.category ?? 'general',
    valueType,
    decimals: isNumeric ? (col.decimals ?? 2) : col.decimals,
  }
}

function periodStorageKey(companyId, year, month) {
  return `${PERIOD_KEY_PREFIX}${companyId}_${periodKey(year, month)}`
}

// Employees created before monthly periods existed lived directly on the
// company. They're migrated ONCE into the current real-world month's
// period (matching what a brand-new company defaults to), then stripped
// off the company object - from then on, employee data only ever lives in
// per-period storage. Guarded by "does this period key exist at all" (not
// merged) so the migration is idempotent even if loadState() runs more
// than once in quick succession before the stripped shape is persisted
// back - e.g. React StrictMode deliberately double-invokes mount effects
// in development, which would otherwise append the legacy employees twice.
function migrateCompanyLegacyEmployees(company) {
  const { employees, ...rest } = company
  if (!Array.isArray(employees) || employees.length === 0) return rest

  const { year, month } = getCurrentPeriod()
  const key = periodStorageKey(company.id, year, month)

  if (localStorage.getItem(key) === null) {
    try {
      localStorage.setItem(key, JSON.stringify({ employees: employees.map(migrateEmployee) }))
    } catch (e) {
      console.error('Failed to migrate legacy employees into a monthly period:', e)
    }
  }

  return rest
}

function migrateCompanyDetails(details) {
  const d = details && typeof details === 'object' ? details : {}
  return {
    address: typeof d.address === 'string' ? d.address : '',
    brn: typeof d.brn === 'string' ? d.brn : '',
    customFields: Array.isArray(d.customFields) ? d.customFields : [],
  }
}

function migrateCompany(company) {
  const { year, month } = getCurrentPeriod()
  return migrateCompanyLegacyEmployees({
    ...company,
    columns: Array.isArray(company.columns) ? company.columns.map(migrateColumn) : [],
    columnWidths: company.columnWidths && typeof company.columnWidths === 'object' ? company.columnWidths : {},
    viewYear: company.viewYear ?? year,
    viewMonth: company.viewMonth ?? month,
    details: migrateCompanyDetails(company.details),
  })
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    const hasIdentityFields = Array.isArray(parsed.identityFields)
    const identityFields = hasIdentityFields
      ? parsed.identityFields
      : [
          { id: makeId(), key: 'employeeId', name: 'ID' },
          { id: makeId(), key: 'name', name: 'Name' },
          { id: makeId(), key: 'surname', name: 'Surname' },
        ]
    const idFieldKey = hasIdentityFields ? (parsed.idFieldKey ?? null) : 'employeeId'

    const companies = Array.isArray(parsed.companies) ? parsed.companies.map(migrateCompany) : []

    return {
      identityFields,
      idFieldKey,
      globalColumns: Array.isArray(parsed.globalColumns) ? parsed.globalColumns.map(migrateColumn) : [],
      companies,
      activeCompanyId: parsed.activeCompanyId ?? null,
    }
  } catch (e) {
    console.error('Failed to load payroll state from localStorage:', e)
    return null
  }
}

// Returns true when the state is safely in the browser's storage, false when
// the browser refused it (most often because storage is full). The caller
// must tell the user: a refused save means the change is NOT kept.
export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    return true
  } catch (e) {
    console.error('Failed to save payroll state to localStorage:', e)
    return false
  }
}

// One month's employee data for one company - stored separately from the
// core app state so viewing/editing one month never touches another
// month's (or company's) data on disk.
export function loadPeriod(companyId, year, month) {
  try {
    const raw = localStorage.getItem(periodStorageKey(companyId, year, month))
    if (!raw) return { employees: [] }
    const parsed = JSON.parse(raw)
    return { employees: Array.isArray(parsed.employees) ? parsed.employees.map(migrateEmployee) : [] }
  } catch (e) {
    console.error('Failed to load payroll period from localStorage:', e)
    return { employees: [] }
  }
}

// Returns true when saved, false when the browser refused the write - see saveState.
export function savePeriod(companyId, year, month, periodData) {
  try {
    localStorage.setItem(periodStorageKey(companyId, year, month), JSON.stringify(periodData))
    return true
  } catch (e) {
    console.error('Failed to save payroll period to localStorage:', e)
    return false
  }
}

// The storage keys of every month saved for one company.
function periodKeysForCompany(companyId) {
  const prefix = `${PERIOD_KEY_PREFIX}${companyId}_`
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(prefix) && /^\d{4}-\d{2}$/.test(key.slice(prefix.length))) keys.push(key)
  }
  return keys
}

// Removes every month of employee data saved for a company - used when the
// company itself is deleted, so nothing of it is left behind in the browser.
export function deletePeriodsForCompany(companyId) {
  for (const key of periodKeysForCompany(companyId)) localStorage.removeItem(key)
}

function readEmployees(storageKey) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey))
    return Array.isArray(parsed?.employees) ? parsed.employees : []
  } catch {
    return []
  }
}

// How many saved months, across the given companies, hold a value under
// `valueKey` - what a change of that column's key would have to move.
export function countPeriodsHoldingKey(companyIds, valueKey) {
  let periods = 0
  const companies = new Set()
  for (const companyId of companyIds) {
    for (const storageKey of periodKeysForCompany(companyId)) {
      if (readEmployees(storageKey).some((e) => e.values && valueKey in e.values)) {
        periods++
        companies.add(companyId)
      }
    }
  }
  return { periods, companies: companies.size }
}

// Moves every saved value from `oldKey` to `newKey`, in every month of the
// given companies - what keeps a column's figures with it when its key is
// changed. Returns false if the browser refused any write.
export function renameValueKeyInPeriods(companyIds, oldKey, newKey) {
  let ok = true
  for (const companyId of companyIds) {
    for (const storageKey of periodKeysForCompany(companyId)) {
      const employees = readEmployees(storageKey)
      if (!employees.some((e) => e.values && oldKey in e.values)) continue
      const moved = employees.map((e) => renameValueKey(e, oldKey, newKey))
      try {
        localStorage.setItem(storageKey, JSON.stringify({ employees: moved }))
      } catch (e) {
        console.error('Failed to move saved values to the new column key:', e)
        ok = false
      }
    }
  }
  return ok
}

// One employee record with its value moved from `oldKey` to `newKey`.
export function renameValueKey(employee, oldKey, newKey) {
  if (!employee.values || !(oldKey in employee.values)) return employee
  const { [oldKey]: value, ...rest } = employee.values
  return { ...employee, values: { ...rest, [newKey]: value } }
}

// ---- Everything this app keeps in the browser, as it is stored ----------
// Used by the full backup (see backup.js): the app state and every saved
// month, whatever company they belong to. The theme is a display preference
// and is not part of it.

function isOwnKey(key) {
  return key === STORAGE_KEY || key.startsWith(PERIOD_KEY_PREFIX)
}

function ownKeys() {
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && isOwnKey(key)) keys.push(key)
  }
  return keys.sort()
}

// { storage key: the text stored under it }, for every key of this app.
export function readBrowserData() {
  const data = {}
  for (const key of ownKeys()) data[key] = localStorage.getItem(key)
  return data
}

// Replaces everything this app keeps in the browser with `entries`
// ({ storage key: text }). All or nothing: if the browser refuses any write
// (storage full), what was there before is put back.
//   { ok: true }                     replaced
//   { ok: false, unchanged: true }   refused; the browser holds what it held before
//   { ok: false, unchanged: false }  refused, and the earlier data could not be put back either
export function replaceBrowserData(entries) {
  if (Object.keys(entries).some((key) => !isOwnKey(key))) return { ok: false, unchanged: true }

  const before = readBrowserData()
  try {
    for (const key of Object.keys(before)) localStorage.removeItem(key)
    for (const [key, text] of Object.entries(entries)) localStorage.setItem(key, text)
    return { ok: true }
  } catch (e) {
    console.error('Failed to replace the payroll data in localStorage:', e)
  }

  try {
    for (const key of ownKeys()) localStorage.removeItem(key)
    for (const [key, text] of Object.entries(before)) localStorage.setItem(key, text)
    return { ok: false, unchanged: true }
  } catch (e) {
    console.error('Failed to put the earlier payroll data back:', e)
    return { ok: false, unchanged: false }
  }
}

export const BROWSER_STATE_KEY = STORAGE_KEY
export const BROWSER_PERIOD_KEY_PREFIX = PERIOD_KEY_PREFIX
