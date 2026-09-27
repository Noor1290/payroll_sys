import { useMemo } from 'react'
import { getOrderedEffectiveColumns, getCategoryGroups, labelColumnsForHelper } from '../lib/categories'
import { formatDecimal } from '../lib/format'

// Read-only aggregated view: same category-grouped header as the Employee
// Table, but cells are plain summed values - no editing, no per-cell
// breakdown (a sum across months has no single formula trace to show).
export default function TotalsTable({ identityFields, idFieldKey, effectiveColumns, employees, computedGrid }) {
  const orderedColumns = useMemo(() => getOrderedEffectiveColumns(effectiveColumns), [effectiveColumns])
  const categoryGroups = useMemo(() => getCategoryGroups(orderedColumns), [orderedColumns])
  const labeledColumns = useMemo(() => labelColumnsForHelper(orderedColumns), [orderedColumns])

  return (
    <div className="max-h-[calc(100vh-16rem)] overflow-auto rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="sticky top-0 z-20 bg-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600 shadow-sm">
            {identityFields.length > 0 && (
              <th colSpan={identityFields.length} className="border-b border-slate-300 px-3 py-1.5">
                Identifiers
              </th>
            )}
            {categoryGroups.map((group) => (
              <th key={group.category} colSpan={group.columns.length} className="border-b border-slate-300 px-3 py-1.5">
                {group.label}
              </th>
            ))}
          </tr>
          <tr className="sticky top-[28px] z-10 bg-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-500 shadow-sm">
            {identityFields.map((field) => (
              <th key={field.key} className="border-b border-slate-200 px-3 py-2">
                <span className="flex items-center gap-1">
                  {field.name}
                  {idFieldKey === field.key && (
                    <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-700">ID</span>
                  )}
                </span>
              </th>
            ))}
            {labeledColumns.map((col) => (
              <th
                key={col.key}
                className="border-b border-slate-200 px-3 py-2"
                title={col.helperLabel !== col.name ? col.helperLabel : undefined}
              >
                <span className="flex items-center gap-1">
                  {col.name}
                  {col.type === 'formula' && (
                    <span className="rounded bg-violet-100 px-1 py-0.5 text-[10px] font-semibold text-violet-700">fx</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {employees.map((emp) => (
            <tr key={emp.id} className="hover:bg-slate-50">
              {identityFields.map((field) => (
                <td key={field.key} className="px-3 py-1.5 text-slate-700">
                  {emp.values?.[field.key] ?? ''}
                </td>
              ))}
              {orderedColumns.map((col) => {
                if (col.valueType === 'text') {
                  return (
                    <td key={col.key} className="px-3 py-1.5 text-slate-700">
                      {emp.values?.[col.key] ?? ''}
                    </td>
                  )
                }
                const value = computedGrid[emp.id]?.[col.key]?.value ?? 0
                return (
                  <td key={col.key} className={`px-3 py-1.5 font-mono ${col.type === 'formula' ? 'bg-violet-50' : ''}`}>
                    {formatDecimal(value, col.decimals ?? 2)}
                  </td>
                )
              })}
            </tr>
          ))}
          {employees.length === 0 && (
            <tr>
              <td
                colSpan={identityFields.length + orderedColumns.length}
                className="px-3 py-6 text-center text-slate-400"
              >
                No employees found in the selected month range.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
