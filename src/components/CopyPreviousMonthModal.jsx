import { useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import { formatDecimal } from '../lib/format'
import { buildCopyableColumnGroups, matchPreviousEmployees, applyCopyFromPreviousMonth } from '../lib/copyPreviousMonth'

function displayValue(raw, col) {
  if (col.valueType === 'checkbox') return raw ? 'Yes' : 'No'
  if (col.valueType === 'text' || !col) return raw === undefined || raw === null ? '' : String(raw)
  const n = Number(raw)
  return raw === '' || raw === undefined || raw === null || Number.isNaN(n) ? '' : formatDecimal(n, col.decimals ?? 2)
}

function employeeLabel(emp, identityFields) {
  const parts = identityFields.slice(0, 3).map((f) => emp.values?.[f.key]).filter((v) => v !== undefined && v !== null && v !== '')
  return parts.length > 0 ? parts.join(' ') : '(unnamed)'
}

// Lets the user selectively bring specific employees' values for specific
// columns over from the previous month's period into the current one.
// Strictly read-from-previous, write-to-current - `previousEmployees` is
// never touched by anything in here.
export default function CopyPreviousMonthModal({
  previousEmployees,
  currentEmployees,
  identityFields,
  idFieldKey,
  effectiveColumns,
  previousPeriodLabel,
  currentPeriodLabel,
  onConfirm,
  onCancel,
}) {
  const matched = useMemo(
    () => matchPreviousEmployees(previousEmployees, currentEmployees, idFieldKey),
    [previousEmployees, currentEmployees, idFieldKey]
  )
  const columnGroups = useMemo(() => buildCopyableColumnGroups(identityFields, effectiveColumns), [identityFields, effectiveColumns])
  const columnsByKey = useMemo(() => Object.fromEntries(columnGroups.flatMap((g) => g.columns).map((c) => [c.key, c])), [columnGroups])

  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState(() => new Set())
  const [selectedColumnKeys, setSelectedColumnKeys] = useState(() => new Set())
  const [pendingOverwriteCount, setPendingOverwriteCount] = useState(null) // number | null

  function toggleEmployee(id) {
    setSelectedEmployeeIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleColumn(key) {
    setSelectedColumnKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selectAllEmployees() {
    setSelectedEmployeeIds(new Set(previousEmployees.map((e) => e.id)))
  }
  function clearAllEmployees() {
    setSelectedEmployeeIds(new Set())
  }

  const selectedColumns = columnGroups.flatMap((g) => g.columns).filter((c) => selectedColumnKeys.has(c.key))
  const selectedRows = matched.filter(({ prevEmp }) => selectedEmployeeIds.has(prevEmp.id))
  const overwriteCount = selectedRows.filter(({ existing }) => existing).length

  function doApply() {
    const nextEmployees = applyCopyFromPreviousMonth({
      previousEmployees,
      currentEmployees,
      identityFields,
      idFieldKey,
      selectedEmployeeIds,
      selectedColumnKeys,
    })
    onConfirm(nextEmployees)
  }

  function handleConfirmClick() {
    if (overwriteCount > 0) {
      setPendingOverwriteCount(overwriteCount)
      return
    }
    doApply()
  }

  const canConfirm = selectedEmployeeIds.size > 0 && selectedColumnKeys.size > 0

  return (
    <>
      <Modal title="Copy from Previous Month" onClose={onCancel} width="max-w-4xl" icon={<Copy />}>
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted [&_strong]:font-semibold [&_strong]:text-fg">
            Copy selected employees' values for selected columns from <strong>{previousPeriodLabel}</strong> into{' '}
            <strong>{currentPeriodLabel}</strong>. Only what you check below is touched - everything else in{' '}
            {currentPeriodLabel} stays exactly as it is.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 flex min-h-8 items-center justify-between gap-2">
                <h3 className="text-[11px] font-medium uppercase tracking-wider text-subtle">
                  Employees in {previousPeriodLabel}
                </h3>
                <div className="flex gap-1">
                  <button onClick={selectAllEmployees} className="btn btn-ghost btn-sm text-xs text-accent">
                    Select All
                  </button>
                  <button onClick={clearAllEmployees} className="btn btn-ghost btn-sm text-xs text-accent">
                    Clear All
                  </button>
                </div>
              </div>
              <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-xl border border-line bg-surface p-2">
                {matched.map(({ prevEmp, existing }) => (
                  <label
                    key={prevEmp.id}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-surface-hover"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedEmployeeIds.has(prevEmp.id)}
                        onChange={() => toggleEmployee(prevEmp.id)}
                      />
                      <span className="truncate text-fg">{employeeLabel(prevEmp, identityFields)}</span>
                    </span>
                    <span className={`badge ${existing ? 'badge-warn' : 'badge-accent'}`}>{existing ? 'Exists' : 'New'}</span>
                  </label>
                ))}
                {matched.length === 0 && <p className="px-2 py-2 text-sm text-muted">No employees found.</p>}
              </div>
            </div>

            <div>
              <h3 className="mb-1.5 flex min-h-8 items-center text-[11px] font-medium uppercase tracking-wider text-subtle">
                Columns to copy
              </h3>
              <div className="max-h-64 space-y-3 overflow-y-auto rounded-xl border border-line bg-surface p-3">
                {columnGroups.map((group) => (
                  <div key={group.label}>
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle">{group.label}</p>
                    <div className="space-y-1.5">
                      {group.columns.map((col) => (
                        <label key={col.key} className="flex items-center gap-2 text-sm text-fg">
                          <input type="checkbox" checked={selectedColumnKeys.has(col.key)} onChange={() => toggleColumn(col.key)} />
                          {col.name}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                {columnGroups.length === 0 && <p className="text-sm text-muted">No columns defined yet.</p>}
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle">Preview</h3>
            <div className="max-h-56 overflow-auto rounded-xl border border-line">
              <table className="w-full whitespace-nowrap text-xs">
                <thead className="sticky top-0 text-left font-medium text-muted">
                  <tr>
                    <th className="bg-elevated px-3 py-2 shadow-[inset_0_-1px_0_var(--line)]">Employee</th>
                    <th className="bg-elevated px-3 py-2 shadow-[inset_0_-1px_0_var(--line)]">Status</th>
                    {selectedColumns.map((col) => (
                      <th
                        key={col.key}
                        className={`bg-elevated px-3 py-2 shadow-[inset_0_-1px_0_var(--line)] ${
                          col.valueType === 'text' || col.valueType === 'checkbox' || !col.valueType ? '' : 'text-right'
                        }`}
                      >
                        {col.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {selectedRows.map(({ prevEmp, existing }) => (
                    <tr key={prevEmp.id}>
                      <td className="px-3 py-2 text-fg">{employeeLabel(prevEmp, identityFields)}</td>
                      <td className="px-3 py-2">
                        <span className={`badge normal-case ${existing ? 'badge-warn' : 'badge-accent'}`}>
                          {existing ? 'Update existing' : 'Create new'}
                        </span>
                      </td>
                      {selectedColumns.map((col) => (
                        <td
                          key={col.key}
                          className={`num px-3 py-2 text-fg ${
                            col.valueType === 'text' || col.valueType === 'checkbox' || !col.valueType ? '' : 'text-right'
                          }`}
                        >
                          {displayValue(prevEmp.values?.[col.key], columnsByKey[col.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {selectedRows.length === 0 && (
                    <tr>
                      <td colSpan={2 + selectedColumns.length} className="whitespace-normal px-3 py-5 text-center text-muted">
                        Select employees and columns above to see a preview.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <button onClick={onCancel} className="btn btn-secondary">
              Cancel
            </button>
            <button onClick={handleConfirmClick} disabled={!canConfirm} className="btn btn-primary">
              Copy {selectedEmployeeIds.size} Employee{selectedEmployeeIds.size === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </Modal>

      {pendingOverwriteCount !== null && (
        <ConfirmDialog
          title="Overwrite existing values?"
          message={`This will overwrite existing values for ${pendingOverwriteCount} employee${
            pendingOverwriteCount === 1 ? '' : 's'
          } in ${selectedColumns.map((c) => c.name).join(', ')}.`}
          confirmLabel="Overwrite"
          onCancel={() => setPendingOverwriteCount(null)}
          onConfirm={() => {
            setPendingOverwriteCount(null)
            doApply()
          }}
        />
      )}
    </>
  )
}
