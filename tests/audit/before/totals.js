// A copy of src/lib/totals.js as it was on main (c921d11), before the speed fixes, kept
// unchanged so the tests can compare the new calculation with the old one.
// Only its imports are pointed back at src/. Never used by the app.

import { computeGridForEmployees } from './formulaEngine.js'
import { isErrorCell } from '../../../src/lib/exportErrors'
import { formatPeriodLabel } from '../../../src/lib/periods'

// Aggregates employees across a set of already-loaded periods into one
// "Totals" row per distinct employee, matched by the company's designated
// ID field (the same identity-matching concept import's duplicate
// detection uses). Numeric (Input/Formula, non-text) columns sum across
// every period the employee appears in; a period they're missing from
// simply contributes 0, it never errors. Identity fields come from the
// FIRST (chronologically earliest, since `periods` must be pre-sorted)
// period where the employee appears - and so do Text and Checkbox columns,
// which cannot be added up: the grid carries them exactly as that first
// month has them (a Date too: a date is never added up), so the Totals screen and the Totals export (both of which
// read this one grid) always show the same thing.
//
// A figure that is in error in any month is in error in the total too: it
// is never counted as 0.
//
// periods: [{ year, month, employees }], chronological
// Returns { employees, computedGrid } shaped exactly like a normal
// (employees, computedGrid) pair, so it can be fed straight into the
// existing Excel export/preview pipeline.
// IDs held by more than one employee within one month of `periods`: their
// figures are added together in one Totals row, so the screen says so.
// [{ year, month, id, count }], in month order then ID order.
export function findSharedIds(periods, idFieldKey) {
  if (!idFieldKey) return []
  const shared = []
  for (const { year, month, employees } of periods) {
    const counts = new Map()
    for (const emp of employees) {
      const id = String(emp.values?.[idFieldKey] ?? '').trim()
      if (id !== '') counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    for (const [id, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) if (count > 1) shared.push({ year, month, id, count })
  }
  return shared
}

// The TOTAL row under the Totals table, the same figures the Totals export
// ends with: by column key, { sum } for a figure column, { error: true } when
// any row of it is in error (never counted as 0), { ticked } for a checkbox
// column; a Text or Date column has no entry, it cannot be added up.
export function grandTotal(employees, columns, computedGrid) {
  const out = {}
  for (const col of columns) {
    if (col.valueType === 'text' || col.valueType === 'date') continue
    const cells = employees.map((emp) => computedGrid[emp.id]?.[col.key])
    if (col.valueType === 'checkbox') {
      out[col.key] = { ticked: cells.filter((cell) => cell?.value === 1).length }
    } else if (cells.some(isErrorCell)) {
      out[col.key] = { error: true }
    } else {
      out[col.key] = { sum: cells.reduce((sum, cell) => sum + (typeof cell?.value === 'number' && !Number.isNaN(cell.value) ? cell.value : 0), 0) }
    }
  }
  return out
}

export function computeTotals(periods, effectiveColumns, columnsByKey, idFieldKey) {
  const isFixedColumn = (c) => c.valueType === 'text' || c.valueType === 'checkbox' || c.valueType === 'date'
  const numericColumns = effectiveColumns.filter((c) => (c.type === 'input' || c.type === 'formula') && !isFixedColumn(c))
  const fixedColumns = effectiveColumns.filter(isFixedColumn)

  const groups = new Map() // groupKey -> { id, values, sums, errors, fixed }

  for (const period of periods) {
    const grid = computeGridForEmployees(period.employees, effectiveColumns, columnsByKey)

    for (const emp of period.employees) {
      const idValue = idFieldKey ? String(emp.values?.[idFieldKey] ?? '').trim() : ''
      const groupKey = idValue !== '' ? `id:${idValue}` : `rec:${emp.id}`
      const row = grid[emp.id]

      if (!groups.has(groupKey)) {
        const fixed = {}
        for (const col of fixedColumns) fixed[col.key] = row?.[col.key]?.value
        groups.set(groupKey, { id: groupKey, values: emp.values, sums: {}, errors: {}, fixed })
      }
      const group = groups.get(groupKey)

      for (const col of numericColumns) {
        const cell = row?.[col.key]
        if (isErrorCell(cell)) {
          group.errors[col.key] ??= `In error in ${formatPeriodLabel(period.year, period.month)}`
          continue
        }
        const v = cell?.value
        const contribution = typeof v === 'number' && !Number.isNaN(v) ? v : 0
        group.sums[col.key] = (group.sums[col.key] ?? 0) + contribution
      }
    }
  }

  const employees = [...groups.values()].map((g) => ({ id: g.id, values: g.values }))

  const computedGrid = {}
  for (const g of groups.values()) {
    computedGrid[g.id] = {}
    for (const col of numericColumns) {
      computedGrid[g.id][col.key] = g.errors[col.key] ? { value: NaN, error: g.errors[col.key] } : { value: g.sums[col.key] ?? 0 }
    }
    for (const col of fixedColumns) {
      computedGrid[g.id][col.key] = { value: g.fixed[col.key] }
    }
  }

  return { employees, computedGrid }
}
