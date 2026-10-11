import { computeGridForEmployees } from './formulaEngine'
import { isErrorCell } from './exportErrors'
import { formatPeriodLabel } from './periods'

// Aggregates employees across a set of already-loaded periods into one
// "Totals" row per distinct employee, matched by the company's designated
// ID field (the same identity-matching concept import's duplicate
// detection uses). Numeric (Input/Formula, non-text) columns sum across
// every period the employee appears in; a period they're missing from
// simply contributes 0, it never errors. Identity fields come from the
// FIRST (chronologically earliest, since `periods` must be pre-sorted)
// period where the employee appears - and so do Text and Checkbox columns,
// which cannot be added up: the grid carries them exactly as that first
// month has them, so the Totals screen and the Totals export (both of which
// read this one grid) always show the same thing.
//
// A figure that is in error in any month is in error in the total too: it
// is never counted as 0.
//
// periods: [{ year, month, employees }], chronological
// Returns { employees, computedGrid } shaped exactly like a normal
// (employees, computedGrid) pair, so it can be fed straight into the
// existing Excel export/preview pipeline.
export function computeTotals(periods, effectiveColumns, columnsByKey, idFieldKey) {
  const isFixedColumn = (c) => c.valueType === 'text' || c.valueType === 'checkbox'
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
