import { useMemo, useState } from 'react'
import Modal from './Modal'
import {
  buildPdfFillColumnGroups,
  buildCompanyDetailFields,
  resolveCompanyFieldHeaders,
  downloadPdfFillExport,
} from '../lib/pdfFillExport'

const FORMAT_LABEL = { csv: 'CSV', json: 'JSON' }

// Column-picker shown before a "PDF fill" export: a checklist (grouped the
// same way as everywhere else in the app) of every Identifier/Global/
// Company column currently available, plus a separate Company Details
// section (Company Name/Address/BRN/custom fields, default unchecked) that
// repeats the same value on every employee row/object.
export default function PdfFillExportModal({
  format,
  identityFields,
  effectiveColumns,
  employees,
  computedGrid,
  companyName,
  companyDetails,
  year,
  month,
  onClose,
}) {
  const groups = useMemo(() => buildPdfFillColumnGroups(identityFields, effectiveColumns), [identityFields, effectiveColumns])
  const allKeys = useMemo(() => groups.flatMap((g) => g.columns.map((c) => c.key)), [groups])
  const [selected, setSelected] = useState(() => new Set(allKeys))

  const companyFields = useMemo(() => buildCompanyDetailFields(companyName, companyDetails), [companyName, companyDetails])
  // Default OFF, unlike the employee columns above - adding this section
  // must never change what an existing export already contains.
  const [selectedCompanyFields, setSelectedCompanyFields] = useState(() => new Set())

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(allKeys))
  }

  function selectNone() {
    setSelected(new Set())
  }

  function toggleCompanyField(key) {
    setSelectedCompanyFields((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectedCount = selected.size

  function handleExport() {
    const chosenColumns = groups.flatMap((g) => g.columns).filter((c) => selected.has(c.key))
    const chosenCompanyFields = companyFields.filter((f) => selectedCompanyFields.has(f.key))
    const resolvedCompanyFields = resolveCompanyFieldHeaders(
      chosenCompanyFields,
      chosenColumns.map((c) => c.name)
    )
    downloadPdfFillExport(format, chosenColumns, employees, computedGrid, resolvedCompanyFields, { companyName, year, month })
    onClose()
  }

  return (
    <Modal title={`Export for PDF fill (${FORMAT_LABEL[format]})`} onClose={onClose} width="max-w-lg">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Choose which columns to include. The file will have one row per employee, headered by each column's plain
          name (not its internal key), ready to match against an external PDF form.
        </p>

        <div className="flex gap-2">
          <button onClick={selectAll} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
            Select All
          </button>
          <button onClick={selectNone} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
            Select None
          </button>
        </div>

        <div className="max-h-96 space-y-4 overflow-y-auto rounded-md border border-slate-200 p-3">
          {groups.map((group) => (
            <div key={group.label}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.label}</h3>
              <div className="space-y-1">
                {group.columns.map((col) => (
                  <label key={col.key} className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={selected.has(col.key)} onChange={() => toggle(col.key)} />
                    {col.name}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {groups.length === 0 && <p className="text-sm text-slate-400">No columns defined yet.</p>}

          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Company Details</h3>
            <p className="mb-1 text-xs text-slate-400">
              Repeats the same value on every row - off by default.
            </p>
            <div className="space-y-1">
              {companyFields.map((field) => (
                <label key={field.key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={selectedCompanyFields.has(field.key)}
                    onChange={() => toggleCompanyField(field.key)}
                  />
                  {field.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-500">
          {selectedCount} column{selectedCount === 1 ? '' : 's'}
          {selectedCompanyFields.size > 0 ? ` + ${selectedCompanyFields.size} company detail field${selectedCompanyFields.size === 1 ? '' : 's'}` : ''} selected
          · {employees.length} employee{employees.length === 1 ? '' : 's'} will be exported.
        </p>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={selectedCount === 0}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export {FORMAT_LABEL[format]}
          </button>
        </div>
      </div>
    </Modal>
  )
}
