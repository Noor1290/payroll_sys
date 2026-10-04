import { useMemo, useState } from 'react'
import { FileOutput } from 'lucide-react'
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
    <Modal title={`Export for PDF fill (${FORMAT_LABEL[format]})`} onClose={onClose} width="max-w-lg" icon={<FileOutput />}>
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-muted">
          Choose which columns to include. The file will have one row per employee, headered by each column's plain
          name (not its internal key), ready to match against an external PDF form.
        </p>

        <div className="flex gap-2">
          <button onClick={selectAll} className="btn btn-secondary btn-sm text-xs">
            Select All
          </button>
          <button onClick={selectNone} className="btn btn-secondary btn-sm text-xs">
            Select None
          </button>
        </div>

        <div className="max-h-80 space-y-4 overflow-y-auto rounded-xl border border-line bg-surface p-3">
          {groups.map((group) => (
            <div key={group.label}>
              <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle">{group.label}</h3>
              <div className="space-y-1.5">
                {group.columns.map((col) => (
                  <label key={col.key} className="flex items-center gap-2 text-sm text-fg">
                    <input type="checkbox" checked={selected.has(col.key)} onChange={() => toggle(col.key)} />
                    {col.name}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {groups.length === 0 && <p className="text-sm text-muted">No columns defined yet.</p>}

          <div className="border-t border-line pt-3">
            <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-subtle">Company Details</h3>
            <p className="mb-1.5 text-xs text-muted">
              Repeats the same value on every row - off by default.
            </p>
            <div className="space-y-1.5">
              {companyFields.map((field) => (
                <label key={field.key} className="flex items-center gap-2 text-sm text-fg">
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

        <p className="text-xs text-muted">
          {selectedCount} column{selectedCount === 1 ? '' : 's'}
          {selectedCompanyFields.size > 0 ? ` + ${selectedCompanyFields.size} company detail field${selectedCompanyFields.size === 1 ? '' : 's'}` : ''} selected
          · {employees.length} employee{employees.length === 1 ? '' : 's'} will be exported.
        </p>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button onClick={handleExport} disabled={selectedCount === 0} className="btn btn-primary">
            Export {FORMAT_LABEL[format]}
          </button>
        </div>
      </div>
    </Modal>
  )
}
