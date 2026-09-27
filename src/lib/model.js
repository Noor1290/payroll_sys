// Shared data-model helpers: ids, column resolution, validation.

import { getCurrentPeriod } from './periods'

export function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

// Employee data lives per (company, year, month) period, not on the
// company itself - see storage.js's loadPeriod/savePeriod. `viewYear` /
// `viewMonth` just remember which month this company was last looking at,
// defaulting to the current real-world month, so switching companies in
// the sidebar returns you to where you left off.
export function newCompany(name) {
  const { year, month } = getCurrentPeriod()
  return { id: makeId(), name, columns: [], columnWidths: {}, viewYear: year, viewMonth: month }
}

export function newEmployee() {
  return { id: makeId(), values: {} }
}

export function newColumn({ name, key, type, formula, builderMode, tieredKind, tiered, compare, category, valueType, decimals }) {
  const resolvedValueType = type === 'input' ? (valueType ?? 'number') : undefined
  const isNumeric = type === 'formula' || (type === 'input' && resolvedValueType !== 'text')
  return {
    id: makeId(),
    name,
    key,
    type,
    category: category ?? 'general',
    valueType: resolvedValueType,
    decimals: isNumeric ? (decimals ?? 2) : undefined,
    formula: type === 'formula' ? formula : undefined,
    builderMode: type === 'formula' ? builderMode : undefined,
    tieredKind: type === 'formula' ? tieredKind : undefined,
    tiered: type === 'formula' ? tiered : undefined,
    compare: type === 'formula' ? compare : undefined,
  }
}

export function newIdentityField({ name, key }) {
  return { id: makeId(), name, key }
}

// Identity fields seeded for a brand-new install (no saved state yet).
export function defaultIdentityFields() {
  return [
    newIdentityField({ name: 'ID', key: 'id' }),
    newIdentityField({ name: 'Name', key: 'name' }),
    newIdentityField({ name: 'Surname', key: 'surname' }),
  ]
}

// Effective visible columns for a company: global columns first, then the
// company's own columns, in the order each was added.
export function getEffectiveColumns(company, globalColumns) {
  return [...globalColumns, ...(company?.columns ?? [])]
}

export function getColumnsByKey(columns) {
  const map = {}
  for (const col of columns) map[col.key] = col
  return map
}

// Every key already in use anywhere in the global scope (identity fields +
// global columns + every company's own columns). Used to keep identity
// field keys and global column keys collision-free with the whole app,
// since identity fields and global columns are visible to every company.
export function getGlobalKnownKeys(identityFields, globalColumns, companies) {
  return [
    ...identityFields.map((f) => f.key),
    ...globalColumns.map((c) => c.key),
    ...companies.flatMap((c) => c.columns.map((col) => col.key)),
  ]
}

// Every key already in use within one company's own effective scope
// (identity fields + global columns + that company's own columns). Used
// when converting a Global column down to "this company only", where the
// relevant collision set is just this one company's world, not every
// company's.
export function getCompanyScopeKnownKeys(identityFields, globalColumns, company) {
  return [
    ...identityFields.map((f) => f.key),
    ...globalColumns.map((c) => c.key),
    ...(company?.columns ?? []).map((c) => c.key),
  ]
}
