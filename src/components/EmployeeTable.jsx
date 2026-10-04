import { useMemo, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import ConfirmDialog from './ConfirmDialog'
import { getOrderedEffectiveColumns, getCategoryGroups, labelColumnsForHelper } from '../lib/categories'
import { formatDecimal } from '../lib/format'

const MIN_COLUMN_WIDTH = 64
const MAX_COLUMN_WIDTH = 600
// Wide enough that typical values don't truncate on first render, before
// any manual resizing - identity fields (ID/Surname/Other Names) get the
// most room since they tend to hold the longest free-text values; numeric/
// text columns get enough for e.g. "123,456.78" or "Part Time" unclipped.
const DEFAULT_ID_WIDTH = 140
const DEFAULT_IDENTITY_WIDTH = 160
const DEFAULT_COLUMN_WIDTH = 120
const DEFAULT_ACTIONS_WIDTH = 88
const GROUP_HEADER_HEIGHT = 28

// Sticky header cells: a solid background (rows scroll underneath) and the
// bottom rule drawn as an inset shadow, since a collapsed border doesn't
// travel with a sticky cell.
const HEADER_CELL = 'bg-elevated shadow-[inset_0_-1px_0_var(--line)]'

// Figures (number inputs and formula results) are right-aligned; so are their headers.
function isFigureColumn(col) {
  return col.type === 'formula' || (col.valueType !== 'text' && col.valueType !== 'checkbox')
}

function ResizeHandle({ onResizeStart }) {
  return (
    <div
      onMouseDown={onResizeStart}
      title="Drag to resize"
      className="absolute right-0 top-0 z-20 h-full w-2 translate-x-1/2 cursor-col-resize select-none hover:bg-accent/60"
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
    <div className="flex h-full min-h-0 flex-col">
      {/* The table scrolls inside its card. No backdrop blur here: a large
          scrolling area has to stay cheap to paint. */}
      <div className="card max-h-full overflow-auto">
        <table className="border-collapse text-sm" style={{ tableLayout: 'fixed', minWidth: totalWidth }}>
          <colgroup>
            {columnDefs.map((cd) => (
              <col key={cd.key} style={{ width: getWidth(cd.key, cd.defaultWidth) }} />
            ))}
          </colgroup>
          <thead>
            <tr
              className="sticky z-20 text-left text-[11px] font-medium uppercase tracking-wider text-subtle"
              style={{ top: 0, height: GROUP_HEADER_HEIGHT }}
            >
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
              <th className={`${HEADER_CELL} px-3`}></th>
            </tr>
            <tr className="sticky z-10 text-left text-xs font-medium text-muted" style={{ top: GROUP_HEADER_HEIGHT }}>
              {identityFields.map((field, idx) => {
                const defaultWidth = idx === 0 ? DEFAULT_ID_WIDTH : DEFAULT_IDENTITY_WIDTH
                return (
                  <th key={field.key} className={`${HEADER_CELL} relative px-3 py-2.5`}>
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <span className="truncate">{field.name}</span>
                      {idFieldKey === field.key && <span className="badge badge-warn">ID</span>}
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
                  className={`${HEADER_CELL} relative px-3 py-2.5`}
                  title={col.helperLabel !== col.name ? col.helperLabel : undefined}
                >
                  <div className={`flex items-center gap-1.5 overflow-hidden ${isFigureColumn(col) ? 'justify-end' : ''}`}>
                    <span className="truncate">{col.name}</span>
                    {col.type === 'formula' && <span className="badge badge-glow">fx</span>}
                    {col.excludeFromExport && (
                      <span title="Not included in Excel exports or payslips" className="badge">
                        not exported
                      </span>
                    )}
                  </div>
                  <ResizeHandle
                    onResizeStart={(e) => handleResizeStart(e, col.key, getWidth(col.key, DEFAULT_COLUMN_WIDTH))}
                  />
                </th>
              ))}
              <th className={`${HEADER_CELL} px-3 py-2.5 text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {employees.map((emp) => {
              const rawIdValue = idFieldKey ? String(emp.values?.[idFieldKey] ?? '').trim() : ''
              const isDuplicate = rawIdValue !== '' && duplicateIdValues.has(rawIdValue)

              return (
                <tr key={emp.id} className="transition-colors hover:bg-surface-hover">
                  {identityFields.map((field) => (
                    <td key={field.key} className="overflow-hidden px-2 py-1">
                      <div className="flex items-center gap-1">
                        <input
                          aria-label={field.name}
                          className={`field field-cell ${idFieldKey === field.key ? 'num' : ''}`}
                          value={emp.values?.[field.key] ?? ''}
                          onChange={(e) => onUpdateValue(emp.id, field.key, e.target.value)}
                        />
                        {idFieldKey === field.key && isDuplicate && (
                          <span title="Duplicate ID" className="shrink-0 cursor-help text-warn">
                            <TriangleAlert className="h-4 w-4" aria-label="Duplicate ID" />
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
                              aria-label={col.name}
                              className="h-4 w-4 align-middle accent-accent"
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
                              aria-label={col.name}
                              className="field field-cell"
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
                            aria-label={col.name}
                            className="field field-cell num text-right"
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
                          className={`flex h-8 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md border px-2 text-sm transition-colors ${
                            hasError
                              ? 'border-danger/40 bg-danger/10 text-danger hover:border-danger/70'
                              : 'border-glow/25 bg-glow/10 text-fg hover:border-glow/60'
                          }`}
                          title="Click to see calculation breakdown"
                        >
                          {hasError ? (
                            <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          ) : (
                            <span className="shrink-0 text-[10px] font-semibold text-glow" aria-hidden="true">
                              fx
                            </span>
                          )}
                          <span className="num min-w-0 flex-1 truncate text-right">
                            {hasError ? 'Error' : formatDecimal(cell?.value ?? 0, col.decimals ?? 2)}
                          </span>
                        </button>
                      </td>
                    )
                  })}
                  <td className="overflow-hidden px-2 py-1 text-right">
                    <button onClick={() => setDeleting(emp)} className="btn btn-ghost btn-sm text-xs hover:text-danger">
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
                  className="btn btn-ghost btn-sm border-dashed border-line-strong hover:border-accent hover:text-accent"
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
