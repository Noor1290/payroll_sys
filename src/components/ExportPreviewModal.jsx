import { useState } from 'react'
import { CircleAlert, Download, FileSpreadsheet } from 'lucide-react'
import Modal from './Modal'
import { downloadExportPlan, formatCompanyDetailsLine } from '../lib/excelExport'
import { formatDecimal } from '../lib/format'

function isTextLikeColumn(col) {
  return col.kind === 'identity' || col.valueType === 'text' || col.valueType === 'checkbox'
}

function formatCell(value, col) {
  if (isTextLikeColumn(col)) return value === '' || value === undefined ? '' : String(value)
  const n = typeof value === 'number' ? value : Number(value) || 0
  return formatDecimal(n, col.decimals ?? 2)
}

export default function ExportPreviewModal({ plan, onClose }) {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState(null)
  const detailsLine = formatCompanyDetailsLine(plan.companyDetails)
  const [includeDetails, setIncludeDetails] = useState(Boolean(detailsLine))

  async function handleDownload() {
    setDownloading(true)
    setError(null)
    try {
      await downloadExportPlan({ ...plan, showCompanyDetails: includeDetails })
      onClose()
    } catch (e) {
      console.error('Failed to export workbook:', e)
      setError('Something went wrong generating the file. Please try again.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Modal title="Export Preview" onClose={onClose} width="max-w-6xl" icon={<FileSpreadsheet />}>
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-muted">
          This is how the exported spreadsheet will look, including header styling, column widths, number
          formatting, row banding, and the frozen header row. Only columns currently defined for this company are
          included. Columns shaded violet are calculated (formula) columns.
        </p>

        <label className={`flex flex-wrap items-center gap-2 text-sm ${detailsLine ? 'text-fg' : 'text-subtle'}`}>
          <input
            type="checkbox"
            checked={includeDetails}
            disabled={!detailsLine}
            onChange={(e) => setIncludeDetails(e.target.checked)}
          />
          Include company details in header
          {!detailsLine && <span className="text-xs">(add an address or BRN in Company Details first)</span>}
        </label>

        {/* The sheet itself is a picture of the Excel file, so it keeps the
            file's own white paper, serif font and header colours in both themes. */}
        <div className="overflow-auto rounded-xl border border-line" style={{ maxHeight: '55vh' }}>
          <div className="min-w-max bg-white p-2 font-serif text-slate-900 scheme-light">
            <div className="text-center text-base font-bold text-slate-800">{plan.companyName}</div>
            <div className="text-center text-sm italic text-slate-500">{plan.exportDateLabel}</div>
            {includeDetails && detailsLine && (
              <div className="text-center text-xs italic text-slate-500">{detailsLine}</div>
            )}
            <div className="h-2" />
            <table className="border-collapse text-xs">
              <thead className="sticky top-0">
                <tr>
                  {plan.groups.map((group, i) => (
                    <th
                      key={i}
                      colSpan={group.count}
                      className="border border-slate-400 px-2 py-1.5 font-bold text-slate-800"
                      style={{ backgroundColor: '#B4C6E7' }}
                    >
                      {group.label}
                    </th>
                  ))}
                </tr>
                <tr>
                  {plan.columns.map((col) => (
                    <th
                      key={col.key}
                      className="border border-slate-400 px-2 py-2 font-bold text-slate-800"
                      style={{ backgroundColor: '#B4C6E7', minWidth: 90 }}
                    >
                      {col.kind === 'formula' ? `${col.name} (calc)` : col.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row, rIdx) => (
                  <tr key={rIdx} className={rIdx % 2 === 1 ? 'bg-slate-100' : 'bg-white'}>
                    {row.map((value, cIdx) => {
                      const col = plan.columns[cIdx]
                      const isText = isTextLikeColumn(col)
                      return (
                        <td
                          key={col.key}
                          className={`border border-slate-300 px-2 py-1 ${isText ? 'text-left' : 'text-center'} ${
                            col.kind === 'formula' ? 'bg-violet-100' : ''
                          }`}
                        >
                          {formatCell(value, col)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {plan.rows.length === 0 && (
                  <tr>
                    <td colSpan={plan.columns.length} className="border border-slate-300 px-2 py-6 text-center text-slate-400">
                      No employees to export yet.
                    </td>
                  </tr>
                )}
                {plan.rows.length > 0 && (
                  <tr className="bg-[#DCE3EC] font-bold text-slate-800">
                    {plan.totalsRow.map((value, cIdx) => {
                      const col = plan.columns[cIdx]
                      const isText = isTextLikeColumn(col)
                      return (
                        <td
                          key={col.key}
                          className={`border border-slate-300 border-t-2 border-t-slate-500 px-2 py-1 ${
                            isText ? 'text-left' : 'text-center'
                          }`}
                        >
                          {isText ? value : formatCell(value, col)}
                        </td>
                      )
                    })}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {error && (
          <div role="alert" className="panel panel-danger text-sm">
            <CircleAlert aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button onClick={handleDownload} disabled={downloading} className="btn btn-primary">
            <Download aria-hidden="true" />
            {downloading ? 'Preparing file…' : 'Download .xlsx'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
