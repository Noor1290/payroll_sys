// "When I open a month with no employees yet": ask (today's way, the default),
// or copy from the previous month automatically. A setting per company, kept
// with the company's own column setup (so inside the dashboard it is saved
// there and is the same on every laptop):
//   company.autoCopy = { mode: 'auto', columns: ['basicSalary', ...] }
// `columns` are the keys of the input columns to copy; identity fields are
// always copied, every other column is left empty. A column added later is not
// in the list, so it starts unticked. No `autoCopy` at all means "Ask me".

import { getCategoryGroups, getOrderedEffectiveColumns } from './categories'
import { makeId } from './model'

export const ASK = 'ask'
export const AUTO = 'auto'

// The setting as it is to be used: anything unreadable is "Ask me".
export function readAutoCopy(raw) {
  if (!raw || typeof raw !== 'object' || raw.mode !== AUTO) return { mode: ASK, columns: [] }
  const columns = Array.isArray(raw.columns) ? raw.columns.filter((key) => typeof key === 'string' && key !== '') : []
  return { mode: AUTO, columns: [...new Set(columns)] }
}

// What is kept on the company: nothing for "Ask me", so a company that never
// chose keeps exactly the setup it has always had.
export function autoCopyToKeep(setting) {
  const read = readAutoCopy(setting)
  return read.mode === AUTO ? read : undefined
}

// The input columns that can be ticked, in the order and groups of the table.
export function autoCopyColumnGroups(effectiveColumns) {
  const inputs = getOrderedEffectiveColumns(effectiveColumns).filter((c) => c.type === 'input')
  return getCategoryGroups(inputs).map((group) => ({
    label: group.label,
    columns: group.columns.map((c) => ({ key: c.key, name: c.name })),
  }))
}

// The ticked columns that are still input columns of this company, in table order.
export function chosenColumns(setting, effectiveColumns) {
  const wanted = new Set(readAutoCopy(setting).columns)
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
