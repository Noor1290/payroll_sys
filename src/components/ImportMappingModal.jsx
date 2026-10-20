import { useMemo, useState } from 'react'
import { Upload } from 'lucide-react'
import Modal from './Modal'
import { guessMapping, projectRows, convertImportValue, findUnreadableValues, planMonthImport } from '../lib/excelImport'
import { showDate } from '../lib/dates'

const PREVIEW_ROW_COUNT = 5

const names = (items) => items.map((item) => item.label).join(', ')

// What the import will do to the month (rehearsal fix F2), and what it leaves out.
function ImportSummary({ plan, monthCount, idFieldName, removeMissing, onRemoveMissingChange }) {
  const skipText = (s) =>
    s.reason === 'total'
      ? `row ${s.row} (“TOTAL”, a totals line)`
      : s.reason === 'no-id'
        ? `row ${s.row} (no ${idFieldName})`
        : `row ${s.row}, ${s.label} (same ${idFieldName} as row ${s.firstRow})`
  return (
    <div data-testid="import-summary" className="space-y-2 rounded-xl border border-line bg-surface p-3 text-sm">
      {monthCount > 0 && (
        <p className="font-medium text-fg">
          This month already has {monthCount} employee{monthCount === 1 ? '' : 's'}. People are matched by {idFieldName}.
        </p>
      )}
      {plan.updates.length > 0 && (
        <p>
          Update {plan.updates.length} existing: {names(plan.updates)}.
        </p>
      )}
      {plan.additions.length > 0 && (
        <p>
          Add {plan.additions.length} new: {names(plan.additions)}.
        </p>
      )}
      {plan.removals.length > 0 && (
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={removeMissing} onChange={(e) => onRemoveMissingChange(e.target.checked)} />
          <span>
            Also remove {plan.removals.length} not in the file: {names(plan.removals)}.
          </span>
        </label>
      )}
      {plan.notUpdated.map((n) => (
        <p key={n.id} className="text-warn">
          {n.id} is in this month {n.copies} times, so no copy is updated. Delete the extra copy first.
        </p>
      ))}
      {plan.skipped.length > 0 && (
        <p className="text-muted">Not imported: {plan.skipped.map(skipText).join('; ')}.</p>
      )}
    </div>
  )
}

// Lets the user map uploaded file columns onto the company's identity
// fields + input columns before anything is imported, with a live preview.
//
// initialMapping: starting mapping - from a recognized/partial system
//   export's metadata when available, otherwise plain name-based guessing.
// recognized: when true, this file was confirmed as a system export for
//   THIS company with all columns still valid - the interactive mapping
//   section is hidden entirely and the (already-correct) mapping goes
//   straight to preview + confirm.
// autoNote: an explanatory message shown above the mapping UI when the
//   file looked like a system export but couldn't be fully auto-applied
//   (wrong company, or a column since removed).
//
// existingEmployees, idFieldKey, identityFields: the month the file goes into. People are matched
//   by the ID field and updated rather than added again (rehearsal fix F2).
export default function ImportMappingModal({
  headers,
  rows,
  systemFields,
  initialMapping,
  recognized,
  autoNote,
  meta,
  existingEmployees = [],
  idFieldKey = null,
  identityFields = [],
  onConfirm,
  onClose,
}) {
  const [mapping, setMapping] = useState(() => initialMapping ?? guessMapping(systemFields, headers))
  const [removeMissing, setRemoveMissing] = useState(false)
  const plan = useMemo(() => {
    let n = 0
    const makeId = () => `preview-${++n}`
    return planMonthImport({ rows, systemFields, mapping, meta, existing: existingEmployees, idFieldKey, identityFields, makeId })
  }, [rows, systemFields, mapping, meta, existingEmployees, idFieldKey, identityFields])
  const idFieldName = identityFields.find((f) => f.key === idFieldKey)?.name ?? 'ID'
  const removing = removeMissing ? plan.removals.length : 0
  const changes = plan.updates.length + plan.additions.length + removing
  const parts = [
    plan.updates.length > 0 && `update ${plan.updates.length}`,
    plan.additions.length > 0 && `add ${plan.additions.length}`,
    removing > 0 && `remove ${removing}`,
  ].filter(Boolean)
  const confirmLabel =
    existingEmployees.length === 0
      ? `Import ${plan.additions.length} row${plan.additions.length === 1 ? '' : 's'}`
      : parts.length > 0
        ? parts.join(', ').replace(/^./, (c) => c.toUpperCase())
        : 'Nothing to import'

  const previewRows = useMemo(
    () => projectRows(rows.slice(0, PREVIEW_ROW_COUNT), systemFields, mapping),
    [rows, systemFields, mapping]
  )

  // Number cells in the WHOLE file (not just the previewed rows) that cannot
  // be read as numbers. They are left blank on import, never written as 0.
  const unreadable = useMemo(() => findUnreadableValues({ rows, systemFields, mapping, meta }), [rows, systemFields, mapping, meta])
  const unreadableNumbers = unreadable.filter((u) => !u.date)
  const unreadableDates = unreadable.filter((u) => u.date)

  // What a previewed cell will be stored as - the same conversion the import
  // itself uses, so the preview and the imported value always match.
  function previewCell(field, raw) {
    if (field.valueType === 'date') {
      if (raw === undefined || raw === null || raw === '') return <span className="font-sans italic text-subtle">empty</span>
      const converted = convertImportValue(field, raw)
      if (converted.unreadable) {
        return (
          <span className="text-warn" title="Not a date: this cell will not be imported">
            {String(raw)} <span className="font-sans italic">(not a date)</span>
          </span>
        )
      }
      return showDate(converted.value)
    }
    if (field.kind === 'identity' || field.valueType === 'text' || field.valueType === 'checkbox') {
      return raw === undefined || raw === '' ? <span className="font-sans italic text-subtle">empty</span> : String(raw)
    }
    if (raw === undefined || raw === null || raw === '') return <span className="font-sans italic text-subtle">empty</span>
    const converted = convertImportValue(field, raw)
    if (converted.unreadable) {
      return (
        <span className="text-warn" title="Not a number: this cell will be left blank">
          {String(raw)} <span className="font-sans italic">(not a number)</span>
        </span>
      )
    }
    return String(converted.value)
  }

  function setFieldMapping(fieldKey, indexStr) {
    setMapping((prev) => ({ ...prev, [fieldKey]: indexStr === '' ? null : Number(indexStr) }))
  }

  return (
    <Modal title="Import from Excel" onClose={onClose} width="max-w-3xl" icon={<Upload />}>
      <div className="space-y-5">
        {recognized ? (
          <div className="note note-accent">
            ✓ Recognized as a previous export from this company — column mapping applied automatically. Review the
            preview below and confirm.
          </div>
        ) : (
          <div>
            {autoNote && (
              <div className="note note-warn mb-3">
                {autoNote}
              </div>
            )}
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-subtle">
              Map file columns to fields ({rows.length} row{rows.length === 1 ? '' : 's'} found)
            </p>
            <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-line bg-surface p-3">
              {systemFields.map((field) => (
                <div key={field.key} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-sm text-fg sm:w-52" title={field.label ?? field.name}>
                    {field.label ?? field.name}
                    <span className={`badge ml-1.5 normal-case ${field.kind === 'identity' ? '' : 'badge-accent'}`}>
                      {field.kind === 'identity' ? 'identity' : 'input'}
                    </span>
                  </span>
                  <select
                    value={mapping[field.key] ?? ''}
                    aria-label={field.label ?? field.name}
                    onChange={(e) => setFieldMapping(field.key, e.target.value)}
                    className="field field-cell min-w-0 flex-1"
                  >
                    <option value="">— Skip —</option>
                    {headers.map((h, i) => (
                      <option key={`${h}-${i}`} value={i}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {unreadableNumbers.length > 0 && (
          <div role="alert" className="note note-warn">
            <p className="font-medium">
              {unreadableNumbers.length} value{unreadableNumbers.length === 1 ? '' : 's'} can't be read as a number and will be left blank (not
              imported as 0):
            </p>
            <ul className="mt-1 max-h-24 overflow-y-auto">
              {unreadableNumbers.map((u, i) => (
                <li key={i}>
                  {u.employee} — {u.field}: “{u.raw}”
                </li>
              ))}
            </ul>
          </div>
        )}

        {unreadableDates.length > 0 && (
          <div role="alert" className="note note-warn">
            <p className="font-medium">
              {unreadableDates.length} date{unreadableDates.length === 1 ? '' : 's'} can't be read and will not be imported (a date already
              saved is kept):
            </p>
            <ul className="mt-1 max-h-24 overflow-y-auto">
              {unreadableDates.map((u, i) => (
                <li key={i}>
                  {u.employee} — {u.field}: “{u.raw}”
                </li>
              ))}
            </ul>
            <p className="mt-1">A date is read from an Excel date cell, or from text written DD/MM/YYYY or YYYY-MM-DD.</p>
          </div>
        )}

        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-subtle">
            Preview (first {Math.min(PREVIEW_ROW_COUNT, rows.length)} rows)
          </p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-xs">
              <thead className="text-left font-medium text-muted">
                <tr className="border-b border-line">
                  {systemFields.map((field) => (
                    <th key={field.key} className="whitespace-nowrap bg-elevated px-3 py-2">
                      {field.label ?? field.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {previewRows.map((row, i) => (
                  <tr key={i}>
                    {systemFields.map((field) => (
                      <td key={field.key} className="num whitespace-nowrap px-3 py-2 text-fg">
                        {previewCell(field, row[field.key])}
                      </td>
                    ))}
                  </tr>
                ))}
                {previewRows.length === 0 && (
                  <tr>
                    <td colSpan={systemFields.length} className="px-3 py-4 text-center text-muted">
                      No rows to preview.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <ImportSummary
          plan={plan}
          monthCount={existingEmployees.length}
          idFieldName={idFieldName}
          removeMissing={removeMissing}
          onRemoveMissingChange={setRemoveMissing}
        />

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button onClick={() => onConfirm(mapping, { removeMissing })} disabled={changes === 0} className="btn btn-primary">
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
