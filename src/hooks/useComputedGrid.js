import { useMemo } from 'react'
import { computeGridForEmployees } from '../lib/formulaEngine'
import { getColumnsByKey } from '../lib/model'

// Precomputes { [employeeId]: { [columnKey]: { value, trace } } } for every
// employee in the current period, given the effective (global + company)
// columns.
export function useComputedGrid(employees, effectiveColumns) {
  return useMemo(() => {
    const columnsByKey = getColumnsByKey(effectiveColumns)
    return computeGridForEmployees(employees ?? [], effectiveColumns, columnsByKey)
  }, [employees, effectiveColumns])
}
