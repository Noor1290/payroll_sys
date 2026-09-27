import { useMemo, useState } from 'react'
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
    <Modal title="Import from Excel" onClose={onClose} width="max-w-3xl">
      <div className="space-y-5">
        {recognized ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            ✓ Recognized as a previous export from this company — column mapping applied automatically. Review the
            preview below and confirm.
          </div>
        ) : (
          <div>
            {autoNote && (
              <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {autoNote}
              </div>
            )}
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Map file columns to fields ({rows.length} row{rows.length === 1 ? '' : 's'} found)
            </p>
            <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border border-slate-200 p-2">
              {systemFields.map((field) => (
                <div key={field.key} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate text-sm text-slate-700" title={field.name}>
                    {field.name}
                    <span
                      className={`ml-1.5 rounded px-1 py-0.5 text-[10px] font-semibold ${
                        field.kind === 'identity' ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {field.kind === 'identity' ? 'identity' : 'input'}
                    </span>
                  </span>
                  <select
                    value={mapping[field.key] ?? ''}
                    onChange={(e) => setFieldMapping(field.key, e.target.value)}
                    className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
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
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Preview (first {Math.min(PREVIEW_ROW_COUNT, rows.length)} rows)
          </p>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  {systemFields.map((field) => (
                    <th key={field.key} className="whitespace-nowrap px-3 py-1.5">
                      {field.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {previewRows.map((row, i) => (
                  <tr key={i}>
                    {systemFields.map((field) => (
                      <td key={field.key} className="whitespace-nowrap px-3 py-1.5 text-slate-600">
                        {row[field.key] === undefined || row[field.key] === '' ? (
                          <span className="italic text-slate-300">empty</span>
                        ) : (
                          String(row[field.key])
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                {previewRows.length === 0 && (
                  <tr>
                    <td colSpan={systemFields.length} className="px-3 py-4 text-center text-slate-400">
                      No rows to preview.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(mapping)}
            disabled={rows.length === 0}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Import {rows.length} row{rows.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
