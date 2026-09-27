import { useState } from 'react'
import Modal from './Modal'
import { downloadExportPlan } from '../lib/excelExport'
import { formatDecimal } from '../lib/format'

function formatCell(value, col) {
  const isText = col.kind === 'identity' || col.valueType === 'text'
  if (isText) return value === '' || value === undefined ? '' : String(value)
  const n = typeof value === 'number' ? value : Number(value) || 0
  return formatDecimal(n, col.decimals ?? 2)
}

export default function ExportPreviewModal({ plan, onClose }) {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState(null)

  async function handleDownload() {
    setDownloading(true)
    setError(null)
    try {
      await downloadExportPlan(plan)
      onClose()
    } catch (e) {
      console.error('Failed to export workbook:', e)
      setError('Something went wrong generating the file. Please try again.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Modal title="Export Preview" onClose={onClose} width="max-w-6xl">
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          This is how the exported spreadsheet will look, including header styling, column widths, number
          formatting, row banding, and the frozen header row. Only columns currently defined for this company are
          included. Columns shaded violet are calculated (formula) columns.
        </p>

        <div className="overflow-auto rounded-lg border border-slate-200" style={{ maxHeight: '60vh' }}>
          <div className="min-w-max bg-white p-2 font-serif">
            <div className="text-center text-base font-bold text-slate-800">{plan.companyName}</div>
            <div className="text-center text-sm italic text-slate-500">{plan.exportDateLabel}</div>
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
                      const isText = col.kind === 'identity' || col.valueType === 'text'
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
                      const isText = col.kind === 'identity' || col.valueType === 'text'
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
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {downloading ? 'Preparing file…' : 'Download .xlsx'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
