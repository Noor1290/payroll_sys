import { useMemo, useState } from 'react'
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
      <Modal title="Copy from Previous Month" onClose={onCancel} width="max-w-4xl">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Copy selected employees' values for selected columns from <strong>{previousPeriodLabel}</strong> into{' '}
            <strong>{currentPeriodLabel}</strong>. Only what you check below is touched - everything else in{' '}
            {currentPeriodLabel} stays exactly as it is.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Employees in {previousPeriodLabel}
                </h3>
                <div className="flex gap-2">
                  <button onClick={selectAllEmployees} className="text-xs text-indigo-600 hover:underline">
                    Select All
                  </button>
                  <button onClick={clearAllEmployees} className="text-xs text-indigo-600 hover:underline">
                    Clear All
                  </button>
                </div>
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
                {matched.map(({ prevEmp, existing }) => (
                  <label key={prevEmp.id} className="flex items-center justify-between gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
                    <span className="flex items-center gap-2 truncate">
                      <input
                        type="checkbox"
                        checked={selectedEmployeeIds.has(prevEmp.id)}
                        onChange={() => toggleEmployee(prevEmp.id)}
                      />
                      <span className="truncate text-slate-700">{employeeLabel(prevEmp, identityFields)}</span>
                    </span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        existing ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {existing ? 'Exists' : 'New'}
                    </span>
                  </label>
                ))}
                {matched.length === 0 && <p className="px-1 py-2 text-sm text-slate-400">No employees found.</p>}
              </div>
            </div>

            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Columns to copy</h3>
              <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border border-slate-200 p-2">
                {columnGroups.map((group) => (
                  <div key={group.label}>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group.label}</p>
                    <div className="space-y-1">
                      {group.columns.map((col) => (
                        <label key={col.key} className="flex items-center gap-2 text-sm text-slate-700">
                          <input type="checkbox" checked={selectedColumnKeys.has(col.key)} onChange={() => toggleColumn(col.key)} />
                          {col.name}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                {columnGroups.length === 0 && <p className="text-sm text-slate-400">No columns defined yet.</p>}
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Preview</h3>
            <div className="max-h-64 overflow-auto rounded-md border border-slate-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5">Employee</th>
                    <th className="px-2 py-1.5">Status</th>
                    {selectedColumns.map((col) => (
                      <th key={col.key} className="px-2 py-1.5">
                        {col.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedRows.map(({ prevEmp, existing }) => (
                    <tr key={prevEmp.id}>
                      <td className="px-2 py-1.5 text-slate-700">{employeeLabel(prevEmp, identityFields)}</td>
                      <td className="px-2 py-1.5">
                        <span className={existing ? 'text-amber-700' : 'text-emerald-700'}>
                          {existing ? 'Update existing' : 'Create new'}
                        </span>
                      </td>
                      {selectedColumns.map((col) => (
                        <td key={col.key} className="px-2 py-1.5 font-mono text-slate-600">
                          {displayValue(prevEmp.values?.[col.key], columnsByKey[col.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {selectedRows.length === 0 && (
                    <tr>
                      <td colSpan={2 + selectedColumns.length} className="px-2 py-4 text-center text-slate-400">
                        Select employees and columns above to see a preview.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button onClick={onCancel} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
            <button
              onClick={handleConfirmClick}
              disabled={!canConfirm}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
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
