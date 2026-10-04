import { useMemo } from 'react'
import { CalendarSearch } from 'lucide-react'
import { getOrderedEffectiveColumns, getCategoryGroups, labelColumnsForHelper } from '../lib/categories'
import { formatDecimal } from '../lib/format'

// Sticky header cells: a solid background (rows scroll underneath) and the
// bottom rule drawn as an inset shadow, since a collapsed border doesn't
// travel with a sticky cell.
const HEADER_CELL = 'bg-elevated shadow-[inset_0_-1px_0_var(--line)]'

function isFigureColumn(col) {
  return col.valueType !== 'text' && col.valueType !== 'checkbox'
}

// Read-only aggregated view: same category-grouped header as the Employee
// Table, but cells are plain summed values - no editing, no per-cell
// breakdown (a sum across months has no single formula trace to show).
export default function TotalsTable({ identityFields, idFieldKey, effectiveColumns, employees, computedGrid }) {
  const orderedColumns = useMemo(() => getOrderedEffectiveColumns(effectiveColumns), [effectiveColumns])
  const categoryGroups = useMemo(() => getCategoryGroups(orderedColumns), [orderedColumns])
  const labeledColumns = useMemo(() => labelColumnsForHelper(orderedColumns), [orderedColumns])

  return (
    // The table scrolls inside its card; no backdrop blur on a large scrolling area.
    <div className="card flex min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 overflow-auto">
        <table className="w-full border-collapse whitespace-nowrap text-sm">
          <thead>
            <tr className="sticky top-0 z-20 h-7 text-left text-[11px] font-medium uppercase tracking-wider text-subtle">
              {identityFields.length > 0 && (
                <th colSpan={identityFields.length} className={`${HEADER_CELL} px-3`}>
                  Identifiers
                </th>
              )}
              {categoryGroups.map((group) => (
                <th key={group.category} colSpan={group.columns.length} className={`${HEADER_CELL} border-l border-line px-3`}>
                  {group.label}
                </th>
              ))}
            </tr>
            <tr className="sticky top-7 z-10 text-left text-xs font-medium text-muted">
              {identityFields.map((field) => (
                <th key={field.key} className={`${HEADER_CELL} px-3 py-2.5`}>
                  <span className="flex items-center gap-1.5">
                    {field.name}
                    {idFieldKey === field.key && <span className="badge badge-warn">ID</span>}
                  </span>
                </th>
              ))}
              {labeledColumns.map((col) => (
                <th
                  key={col.key}
                  className={`${HEADER_CELL} px-3 py-2.5`}
                  title={col.helperLabel !== col.name ? col.helperLabel : undefined}
                >
                  <span className={`flex items-center gap-1.5 ${isFigureColumn(col) ? 'justify-end' : ''}`}>
                    {col.name}
                    {col.type === 'formula' && <span className="badge badge-glow">fx</span>}
                    {col.excludeFromExport && (
                      <span title="Not included in Excel exports or payslips" className="badge">
                        not exported
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {employees.map((emp) => (
              <tr key={emp.id} className="transition-colors hover:bg-surface-hover">
                {identityFields.map((field) => (
                  <td key={field.key} className={`px-3 py-2 text-fg ${idFieldKey === field.key ? 'num' : ''}`}>
                    {emp.values?.[field.key] ?? ''}
                  </td>
                ))}
                {orderedColumns.map((col) => {
                  if (col.valueType === 'text') {
                    return (
                      <td key={col.key} className="px-3 py-2 text-fg">
                        {emp.values?.[col.key] ?? ''}
                      </td>
                    )
                  }
                  if (col.valueType === 'checkbox') {
                    return (
                      <td key={col.key} className="px-3 py-2 text-fg">
                        {emp.values?.[col.key] ? 'Yes' : 'No'}
                      </td>
                    )
                  }
                  const value = computedGrid[emp.id]?.[col.key]?.value ?? 0
                  return (
                    <td key={col.key} className={`num px-3 py-2 text-right text-fg ${col.type === 'formula' ? 'bg-glow/10' : ''}`}>
                      {formatDecimal(value, col.decimals ?? 2)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {employees.length === 0 && (
        <div className="flex flex-col items-center gap-3 border-t border-line px-4 py-10 text-center">
          <span className="icon-tile icon-tile-neutral" aria-hidden="true">
            <CalendarSearch />
          </span>
          <p className="text-sm text-muted">No employees found in the selected month range.</p>
        </div>
      )}
    </div>
  )
}
