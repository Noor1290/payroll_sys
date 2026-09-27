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

function migrateCompany(company) {
  const { year, month } = getCurrentPeriod()
  return migrateCompanyLegacyEmployees({
    ...company,
    columns: Array.isArray(company.columns) ? company.columns.map(migrateColumn) : [],
    columnWidths: company.columnWidths && typeof company.columnWidths === 'object' ? company.columnWidths : {},
    viewYear: company.viewYear ?? year,
    viewMonth: company.viewMonth ?? month,
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

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (e) {
    console.error('Failed to save payroll state to localStorage:', e)
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

export function savePeriod(companyId, year, month, periodData) {
  try {
    localStorage.setItem(periodStorageKey(companyId, year, month), JSON.stringify(periodData))
  } catch (e) {
    console.error('Failed to save payroll period to localStorage:', e)
  }
}
