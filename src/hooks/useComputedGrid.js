import { useMemo } from 'react'
import { computeRowForEmployee } from '../lib/formulaEngine'
import { getColumnsByKey } from '../lib/model'

// Precomputes { [employeeId]: { [columnKey]: { value, trace } } } for every
// employee in the current period, given the effective (global + company)
// columns.
//
// Each employee's row is worked out only when that employee changed: a change
// to an employee always makes a new employee object (screens never change one
// in place), so an employee object seen before, with the same columns, has the
// same figures. Changing the columns works out every row again. A figure never
// depends on another employee (formulas read one employee's values), so the
// rows of the others stay right; totals over employees are worked out from
// this grid by whoever shows them.
export function useComputedGrid(employees, effectiveColumns) {
  // The rows worked out so far, for these columns: a new set of columns starts afresh.
  const kept = useMemo(() => ({ columnsByKey: getColumnsByKey(effectiveColumns), rows: new WeakMap() }), [effectiveColumns])
  return useMemo(() => {
    const { columnsByKey, rows } = kept
    const grid = {}
    for (const employee of employees ?? []) {
      let row = rows.get(employee)
      if (!row) {
        row = computeRowForEmployee(employee, effectiveColumns, columnsByKey)
        rows.set(employee, row)
      }
      grid[employee.id] = row
    }
    return grid
  }, [kept, employees, effectiveColumns])
}
