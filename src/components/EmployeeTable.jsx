import { useMemo, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import { getOrderedEffectiveColumns, getCategoryGroups, labelColumnsForHelper } from '../lib/categories'
import { formatDecimal } from '../lib/format'

const MIN_COLUMN_WIDTH = 64
const MAX_COLUMN_WIDTH = 600
const DEFAULT_ID_WIDTH = 96
const DEFAULT_IDENTITY_WIDTH = 128
const DEFAULT_COLUMN_WIDTH = 112
const DEFAULT_ACTIONS_WIDTH = 88
const GROUP_HEADER_HEIGHT = 28

function ResizeHandle({ onResizeStart }) {
  return (
    <div
      onMouseDown={onResizeStart}
      title="Drag to resize"
      className="absolute right-0 top-0 z-20 h-full w-2 translate-x-1/2 cursor-col-resize select-none hover:bg-indigo-400/60"
    />
  )
}

export default function EmployeeTable({
  employees,
  identityFields,
  idFieldKey,
  effectiveColumns,
  computedGrid,
  columnWidths,
  onResizeColumn,
  onUpdateValue,
  onAddEmployee,
  onDeleteEmployee,
  onOpenBreakdown,
}) {
  const [deleting, setDeleting] = useState(null)
  // Widths for the column currently being dragged, applied instantly for
  // smooth visual feedback without pushing every intermediate pixel up to
  // parent state (and localStorage) on every mousemove.
  const [liveWidths, setLiveWidths] = useState({})
  // The numeric input cell currently focused (if any) - while editing, its
  // raw stored value is shown unrounded so typing isn't disrupted; once
  // blurred, it displays rounded to the column's configured decimal places.
  // The underlying stored value is never touched by this - display only.
  const [focusedCellKey, setFocusedCellKey] = useState(null)

  // Employees sharing the same (non-empty) value in the designated ID field
  // get an amber "Duplicate ID" warning next to that cell.
  const duplicateIdValues = useMemo(() => {
    if (!idFieldKey) return new Set()
    const counts = new Map()
    for (const emp of employees) {
      const v = String(emp.values?.[idFieldKey] ?? '').trim()
      if (v === '') continue
      counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([v]) => v))
  }, [employees, idFieldKey])

  const nameField = identityFields[0]
  const secondField = identityFields[1]

  // Columns grouped and ordered by category (Identifiers are handled
  // separately below - they're always leftmost regardless of these groups).
  const orderedColumns = useMemo(() => getOrderedEffectiveColumns(effectiveColumns), [effectiveColumns])
  const categoryGroups = useMemo(() => getCategoryGroups(orderedColumns), [orderedColumns])
  const labeledColumns = useMemo(() => labelColumnsForHelper(orderedColumns), [orderedColumns])

  const columnDefs = useMemo(
    () => [
      ...identityFields.map((field, idx) => ({
        key: field.key,
        defaultWidth: idx === 0 ? DEFAULT_ID_WIDTH : DEFAULT_IDENTITY_WIDTH,
      })),
      ...orderedColumns.map((col) => ({ key: col.key, defaultWidth: DEFAULT_COLUMN_WIDTH })),
      { key: '__actions', defaultWidth: DEFAULT_ACTIONS_WIDTH, resizable: false },
    ],
    [identityFields, orderedColumns]
  )

  function getWidth(key, fallback) {
    return liveWidths[key] ?? columnWidths?.[key] ?? fallback
  }

  // table-layout: fixed only fixes the RATIO between columns within
  // whatever width the table box ends up with - an auto-width table still
  // fills (and is squeezed/stretched to) its container, silently
  // overriding the declared per-column px widths. Giving the table an
  // explicit min-width equal to the sum of all column widths forces it to
  // actually be that wide, so it overflows the scroll container instead of
  // squeezing columns to fit.
  const totalWidth = columnDefs.reduce((sum, cd) => sum + getWidth(cd.key, cd.defaultWidth), 0)

  function handleResizeStart(e, key, startWidth) {
    e.preventDefault()
    const startX = e.clientX

    function clamp(clientX) {
      return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, startWidth + (clientX - startX)))
    }
    function onMouseMove(ev) {
      setLiveWidths((prev) => ({ ...prev, [key]: clamp(ev.clientX) }))
    }
    function onMouseUp(ev) {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      onResizeColumn(key, clamp(ev.clientX))
      setLiveWidths((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="max-h-[calc(100vh-11rem)] overflow-auto rounded-lg border border-slate-200">
        <table className="border-collapse text-sm" style={{ tableLayout: 'fixed', minWidth: totalWidth }}>
          <colgroup>
            {columnDefs.map((cd) => (
              <col key={cd.key} style={{ width: getWidth(cd.key, cd.defaultWidth) }} />
            ))}
          </colgroup>
          <thead>
            <tr
              className="sticky z-20 bg-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600 shadow-sm"
              style={{ top: 0, height: GROUP_HEADER_HEIGHT }}
            >
              {identityFields.length > 0 && (
                <th colSpan={identityFields.length} className="border-b border-slate-300 px-3">
                  Identifiers
                </th>
              )}
              {categoryGroups.map((group) => (
                <th key={group.category} colSpan={group.columns.length} className="border-b border-slate-300 px-3">
                  {group.label}
                </th>
              ))}
              <th className="border-b border-slate-300 px-3"></th>
            </tr>
            <tr
              className="sticky z-10 bg-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-500 shadow-sm"
              style={{ top: GROUP_HEADER_HEIGHT }}
            >
              {identityFields.map((field, idx) => {
                const defaultWidth = idx === 0 ? DEFAULT_ID_WIDTH : DEFAULT_IDENTITY_WIDTH
                return (
                  <th key={field.key} className="relative border-b border-slate-200 px-3 py-2">
                    <div className="flex items-center gap-1 overflow-hidden">
                      <span className="truncate">{field.name}</span>
                      {idFieldKey === field.key && (
                        <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-700">
                          ID
                        </span>
                      )}
                    </div>
                    <ResizeHandle
                      onResizeStart={(e) => handleResizeStart(e, field.key, getWidth(field.key, defaultWidth))}
                    />
                  </th>
                )
              })}
              {labeledColumns.map((col) => (
                <th
                  key={col.key}
                  className="relative border-b border-slate-200 px-3 py-2"
                  title={col.helperLabel !== col.name ? col.helperLabel : undefined}
                >
                  <div className="flex items-center gap-1 overflow-hidden">
                    <span className="truncate">{col.name}</span>
                    {col.type === 'formula' && (
                      <span className="shrink-0 rounded bg-violet-100 px-1 py-0.5 text-[10px] font-semibold text-violet-700">
                        fx
                      </span>
                    )}
                    {col.excludeFromExport && (
                      <span
                        title="Not included in Excel exports or payslips"
                        className="shrink-0 rounded bg-slate-200 px-1 py-0.5 text-[10px] font-semibold text-slate-500"
                      >
                        not exported
                      </span>
                    )}
                  </div>
                  <ResizeHandle
                    onResizeStart={(e) => handleResizeStart(e, col.key, getWidth(col.key, DEFAULT_COLUMN_WIDTH))}
                  />
                </th>
              ))}
              <th className="border-b border-slate-200 px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {employees.map((emp) => {
              const rawIdValue = idFieldKey ? String(emp.values?.[idFieldKey] ?? '').trim() : ''
              const isDuplicate = rawIdValue !== '' && duplicateIdValues.has(rawIdValue)

              return (
                <tr key={emp.id} className="hover:bg-slate-50">
                  {identityFields.map((field) => (
                    <td key={field.key} className="overflow-hidden px-2 py-1">
                      <div className="flex items-center gap-1">
                        <input
                          className="w-full min-w-0 rounded border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                          value={emp.values?.[field.key] ?? ''}
                          onChange={(e) => onUpdateValue(emp.id, field.key, e.target.value)}
                        />
                        {idFieldKey === field.key && isDuplicate && (
                          <span title="Duplicate ID" className="shrink-0 cursor-help text-amber-500">
                            ⚠
                          </span>
                        )}
                      </div>
                    </td>
                  ))}
                  {orderedColumns.map((col) => {
                    const cell = computedGrid[emp.id]?.[col.key]
                    if (col.type === 'input') {
                      const raw = emp.values?.[col.key] ?? ''
                      if (col.valueType === 'checkbox') {
                        return (
                          <td key={col.key} className="overflow-hidden px-2 py-1 text-center">
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-indigo-600"
                              checked={Boolean(raw)}
                              onChange={(e) => onUpdateValue(emp.id, col.key, e.target.checked)}
                            />
                          </td>
                        )
                      }
                      if (col.valueType === 'text') {
                        return (
                          <td key={col.key} className="overflow-hidden px-2 py-1">
                            <input
                              type="text"
                              className="w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                              value={raw}
                              onChange={(e) => onUpdateValue(emp.id, col.key, e.target.value)}
                            />
                          </td>
                        )
                      }
                      const cellKey = `${emp.id}:${col.key}`
                      const isFocused = focusedCellKey === cellKey
                      const displayValue =
                        isFocused || raw === '' || Number.isNaN(Number(raw))
                          ? raw
                          : formatDecimal(Number(raw), col.decimals ?? 2, { grouping: false })
                      return (
                        <td key={col.key} className="overflow-hidden px-2 py-1">
                          <input
                            type="number"
                            className="w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                            value={displayValue}
                            onFocus={() => setFocusedCellKey(cellKey)}
                            onBlur={() => setFocusedCellKey((k) => (k === cellKey ? null : k))}
                            onChange={(e) => onUpdateValue(emp.id, col.key, e.target.value)}
                          />
                        </td>
                      )
                    }
                    const hasError = cell?.trace?.error
                    return (
                      <td key={col.key} className="overflow-hidden px-2 py-1">
                        <button
                          onClick={() => onOpenBreakdown(cell.trace)}
                          className={`flex w-full min-w-0 items-center justify-between rounded border px-2 py-1 text-sm ${
                            hasError
                              ? 'border-red-200 bg-red-50 text-red-600'
                              : 'border-violet-100 bg-violet-50 text-slate-700'
                          } cursor-pointer hover:brightness-95`}
                          title="Click to see calculation breakdown"
                        >
                          <span className="truncate font-mono">
                            {hasError ? 'Error' : formatDecimal(cell?.value ?? 0, col.decimals ?? 2)}
                          </span>
                          <span className="ml-1 shrink-0 rounded bg-violet-200 px-1 text-[10px] font-semibold text-violet-700">
                            fx
                          </span>
                        </button>
                      </td>
                    )
                  })}
                  <td className="overflow-hidden px-2 py-1 text-right">
                    <button
                      onClick={() => setDeleting(emp)}
                      className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              )
            })}

            <tr>
              <td colSpan={columnDefs.length} className="px-2 py-2">
                <button
                  onClick={onAddEmployee}
                  className="rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:border-indigo-400 hover:text-indigo-600"
                >
                  + Add Employee
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {deleting && (
        <ConfirmDialog
          title="Delete employee"
          message={`Delete ${
            [deleting.values?.[nameField?.key], secondField ? deleting.values?.[secondField.key] : null]
              .filter(Boolean)
              .join(' ')
              .trim() || 'this employee'
          }?`}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            onDeleteEmployee(deleting.id)
            setDeleting(null)
          }}
        />
      )}
    </div>
  )
}
