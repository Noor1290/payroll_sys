// "Copy from Previous Month": lets the user selectively bring specific
// employees' values for specific columns from the previous month's period
// into the current one, on demand - never automatic, and never touches the
// previous month's own data (strictly read-from-previous, write-to-current).

import { makeId } from './model'
import { getCategoryGroups, getOrderedEffectiveColumns } from './categories'

// Same filtering Import already uses for its system-field list: Formula
// columns are computed, not copied, so only Input columns (plus identity
// fields) are selectable here.
export function buildCopyableColumnGroups(identityFields, effectiveColumns) {
  const orderedInputColumns = getOrderedEffectiveColumns(effectiveColumns).filter((c) => c.type === 'input')
  const groups = []
  if (identityFields.length > 0) {
    groups.push({ label: 'Identifiers', columns: identityFields.map((f) => ({ key: f.key, name: f.name })) })
  }
  for (const group of getCategoryGroups(orderedInputColumns)) {
    groups.push({
      label: group.label,
      columns: group.columns.map((c) => ({ key: c.key, name: c.name, valueType: c.valueType, decimals: c.decimals ?? 2 })),
    })
  }
  return groups
}

// The cross-month match key for one employee - blank (no ID field
// designated, or this employee's own ID value is blank) never matches
// anything, so an ambiguous employee is always treated as new rather than
// risking silently merging two unrelated people.
function matchKeyFor(emp, idFieldKey) {
  if (!idFieldKey) return ''
  return String(emp.values?.[idFieldKey] ?? '').trim()
}

// For every previous-month employee, whether a matching current-month
// employee already exists (by the designated ID field) - drives both the
// picker's "exists / new" badges and the overwrite-warning/preview logic.
export function matchPreviousEmployees(previousEmployees, currentEmployees, idFieldKey) {
  const currentByKey = new Map()
  for (const emp of currentEmployees) {
    const k = matchKeyFor(emp, idFieldKey)
    if (k) currentByKey.set(k, emp)
  }
  return previousEmployees.map((prevEmp) => ({
    prevEmp,
    existing: (() => {
      const k = matchKeyFor(prevEmp, idFieldKey)
      return k ? (currentByKey.get(k) ?? null) : null
    })(),
  }))
}

// Applies the copy: for each selected employee, merges the selected
// columns' values into their existing current-month record (columns/
// employees not selected are left untouched), or creates a brand-new one.
// A new row always gets its identity fields copied over regardless of
// which columns were checked - otherwise it'd be an unidentifiable blank
// row - with only the explicitly selected non-identity columns joining
// them, same as a freshly added employee otherwise. Returns a new
// current-month employees array; never mutates the inputs, and never
// touches `previousEmployees` at all.
export function applyCopyFromPreviousMonth({
  previousEmployees,
  currentEmployees,
  identityFields,
  idFieldKey,
  selectedEmployeeIds,
  selectedColumnKeys,
}) {
  const matched = matchPreviousEmployees(previousEmployees, currentEmployees, idFieldKey)
  let nextEmployees = [...currentEmployees]

  for (const { prevEmp, existing } of matched) {
    if (!selectedEmployeeIds.has(prevEmp.id)) continue

    if (existing) {
      nextEmployees = nextEmployees.map((e) => {
        if (e.id !== existing.id) return e
        const patch = {}
        for (const key of selectedColumnKeys) patch[key] = prevEmp.values?.[key]
        return { ...e, values: { ...e.values, ...patch } }
      })
    } else {
      const values = {}
      for (const field of identityFields) values[field.key] = prevEmp.values?.[field.key] ?? ''
      for (const key of selectedColumnKeys) values[key] = prevEmp.values?.[key]
      nextEmployees.push({ id: makeId(), values })
    }
  }

  return nextEmployees
}
