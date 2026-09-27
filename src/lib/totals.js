import { computeGridForEmployees } from './formulaEngine'

// Aggregates employees across a set of already-loaded periods into one
// "Totals" row per distinct employee, matched by the company's designated
// ID field (the same identity-matching concept import's duplicate
// detection uses). Numeric (Input/Formula, non-text) columns sum across
// every period the employee appears in; a period they're missing from
// simply contributes 0, it never errors. Identity fields come from the
// FIRST (chronologically earliest, since `periods` must be pre-sorted)
// period where the employee appears.
//
// periods: [{ year, month, employees }], chronological
// Returns { employees, computedGrid } shaped exactly like a normal
// (employees, computedGrid) pair, so it can be fed straight into the
// existing Excel export/preview pipeline.
export function computeTotals(periods, effectiveColumns, columnsByKey, idFieldKey) {
  const numericColumns = effectiveColumns.filter(
    (c) => (c.type === 'input' || c.type === 'formula') && c.valueType !== 'text'
  )

  const groups = new Map() // groupKey -> { id, values, sums: {colKey: number} }

  for (const period of periods) {
    const grid = computeGridForEmployees(period.employees, effectiveColumns, columnsByKey)

    for (const emp of period.employees) {
      const idValue = idFieldKey ? String(emp.values?.[idFieldKey] ?? '').trim() : ''
      const groupKey = idValue !== '' ? `id:${idValue}` : `rec:${emp.id}`

      if (!groups.has(groupKey)) {
        groups.set(groupKey, { id: groupKey, values: emp.values, sums: {} })
      }
      const group = groups.get(groupKey)

      const row = grid[emp.id]
      for (const col of numericColumns) {
        const v = row?.[col.key]?.value
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
      computedGrid[g.id][col.key] = { value: g.sums[col.key] ?? 0 }
    }
  }

  return { employees, computedGrid }
}
