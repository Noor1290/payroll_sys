import { useMemo, useState } from 'react'
import { Upload } from 'lucide-react'
import Modal from './Modal'
import { guessMapping, projectRows } from '../lib/excelImport'

const PREVIEW_ROW_COUNT = 5

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
export default function ImportMappingModal({ headers, rows, systemFields, initialMapping, recognized, autoNote, onConfirm, onClose }) {
  const [mapping, setMapping] = useState(() => initialMapping ?? guessMapping(systemFields, headers))

  const previewRows = useMemo(
    () => projectRows(rows.slice(0, PREVIEW_ROW_COUNT), systemFields, mapping),
    [rows, systemFields, mapping]
  )

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
                  <span className="w-32 shrink-0 truncate text-sm text-fg sm:w-52" title={field.name}>
                    {field.name}
                    <span className={`badge ml-1.5 normal-case ${field.kind === 'identity' ? '' : 'badge-accent'}`}>
                      {field.kind === 'identity' ? 'identity' : 'input'}
                    </span>
                  </span>
                  <select
                    value={mapping[field.key] ?? ''}
                    aria-label={field.name}
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
                      {field.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {previewRows.map((row, i) => (
                  <tr key={i}>
                    {systemFields.map((field) => (
                      <td key={field.key} className="num whitespace-nowrap px-3 py-2 text-fg">
                        {row[field.key] === undefined || row[field.key] === '' ? (
                          <span className="font-sans italic text-subtle">empty</span>
                        ) : (
                          String(row[field.key])
                        )}
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

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button onClick={() => onConfirm(mapping)} disabled={rows.length === 0} className="btn btn-primary">
            Import {rows.length} row{rows.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
