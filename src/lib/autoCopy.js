// "When I open a month with no employees yet": copy from the previous month
// automatically, or ask (copy only with Copy from Previous Month). A setting
// per company, kept with the company's own column setup (so inside the
// dashboard it is saved there and is the same on every laptop):
//   company.autoCopy = { mode: 'auto', columns: ['basicSalary', ...] }
//   company.autoCopy = { mode: 'ask' }
// `columns` are the keys of the input columns to copy; identity fields are
// always copied, every other column is left empty. A column added later is not
// in the list, so it starts unticked.
//
// No `autoCopy` at all means the company never chose: automatic copy is ON,
// with the default columns (every input column whose name contains none of
// ONE_OFF_WORDS). Nothing is written for it; once a choice is saved, the
// choice wins, and "Ask me" is kept as { mode: 'ask' } so it is never taken
// for "never chose" again.

import { getCategoryGroups, getOrderedEffectiveColumns } from './categories'
import { makeId } from './model'

export const ASK = 'ask'
export const AUTO = 'auto'

// The owner's list (Four changes, 14 Nov 2026): a column whose name contains
// one of these, anywhere and in any case, is not copied by default.
export const ONE_OFF_WORDS = ['bonus', 'allowance', 'overtime', 'increment', 'arrears', 'commission', 'leave']

export function isOneOffName(name) {
  const lower = String(name ?? '').toLowerCase()
  return ONE_OFF_WORDS.some((word) => lower.includes(word))
}

const NEVER_CHOSE = Object.freeze({ mode: AUTO, columns: [], isDefault: true })

// The setting as it is to be used. Nothing stored: the default (on, default
// columns). Anything else unreadable is "Ask me".
export function readAutoCopy(raw) {
  if (raw === undefined || raw === null) return { ...NEVER_CHOSE }
  if (typeof raw !== 'object') return { mode: ASK, columns: [], isDefault: false }
  if (raw.isDefault === true) return { ...NEVER_CHOSE }
  if (raw.mode !== AUTO) return { mode: ASK, columns: [], isDefault: false }
  const columns = Array.isArray(raw.columns) ? raw.columns.filter((key) => typeof key === 'string' && key !== '') : []
  return { mode: AUTO, columns: [...new Set(columns)], isDefault: false }
}

// What is kept on the company: nothing while it never chose (so its setup is
// exactly the one it has always had), otherwise the choice, "Ask me" included.
export function autoCopyToKeep(setting) {
  const read = readAutoCopy(setting)
  if (read.isDefault) return undefined
  return read.mode === AUTO ? { mode: AUTO, columns: read.columns } : { mode: ASK }
}

// The input columns that can be ticked, in the order and groups of the table.
export function autoCopyColumnGroups(effectiveColumns) {
  const inputs = getOrderedEffectiveColumns(effectiveColumns).filter((c) => c.type === 'input')
  return getCategoryGroups(inputs).map((group) => ({
    label: group.label,
    columns: group.columns.map((c) => ({ key: c.key, name: c.name })),
  }))
}

// The default columns: every input column whose name is not a one-off one.
export function defaultColumnKeys(effectiveColumns) {
  return autoCopyColumnGroups(effectiveColumns)
    .flatMap((group) => group.columns)
    .filter((c) => !isOneOffName(c.name))
    .map((c) => c.key)
}

// The ticked columns that are still input columns of this company, in table
// order; the default columns while the company never chose.
export function chosenColumns(setting, effectiveColumns) {
  const read = readAutoCopy(setting)
  const wanted = new Set(read.isDefault ? defaultColumnKeys(effectiveColumns) : read.columns)
  return autoCopyColumnGroups(effectiveColumns)
    .flatMap((group) => group.columns)
    .filter((c) => wanted.has(c.key))
}

// A column's key changed: the setting follows it.
export function renameKeyInAutoCopy(setting, oldKey, newKey) {
  if (!setting || !Array.isArray(setting.columns) || !setting.columns.includes(oldKey)) return setting
  return { ...setting, columns: setting.columns.map((key) => (key === oldKey ? newKey : key)) }
}

// The month made from the previous one: every employee, with their identity
// fields and the chosen columns; nothing else. Each is a new record (a new id),
// so nothing is shared with the previous month, which is never changed.
export function copyFromPrevious({ previousEmployees, identityFields, setting, effectiveColumns }) {
  const columns = chosenColumns(setting, effectiveColumns)
  const employees = previousEmployees.map((prev) => {
    const values = {}
    for (const field of identityFields) values[field.key] = prev.values?.[field.key] ?? ''
    for (const column of columns) {
      if (prev.values && Object.hasOwn(prev.values, column.key)) values[column.key] = structuredClone(prev.values[column.key])
    }
    return { id: makeId(), values }
  })
  return { employees, columnNames: columns.map((c) => c.name) }
}

// Whether the month still holds exactly what was copied: then Undo may empty it.
export function untouchedSinceCopy(current, copied) {
  return JSON.stringify(current) === JSON.stringify(copied)
}
