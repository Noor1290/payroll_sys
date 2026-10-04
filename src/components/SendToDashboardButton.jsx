import { useState } from 'react'
import { buildPdfFillColumns, buildCompanyDetailFields, resolveCompanyFieldHeaders, buildPdfFillRows } from '../lib/pdfFillExport'
import { periodKey } from '../lib/periods'

// Sends the month currently shown to the Payroll Hub dashboard: the same
// rows "Export for PDF fill (JSON)" writes with every column and every
// Company Details field selected, built by the same functions - no picker,
// no recalculation. Renders nothing unless the app is inside the
// dashboard's iframe, so the app looks unchanged when opened on its own.
export default function SendToDashboardButton({
  identityFields,
  effectiveColumns,
  employees,
  computedGrid,
  companyName,
  companyDetails,
  year,
  month,
}) {
  const [sending, setSending] = useState(false)
  const [reply, setReply] = useState(null) // { ok, text } | null

  if (!window.PayrollHubBridge.isEmbedded()) return null

  const blockedReason =
    employees.length === 0
      ? 'Nothing to send: there are no employees for this month.'
      : !(companyDetails?.brn ?? '').trim()
        ? "Can't send yet: this company has no BRN. Add it in Company Details (the ⓘ next to the company name)."
        : null

  async function handleSend() {
    const columns = buildPdfFillColumns(identityFields, effectiveColumns)
    const companyFields = resolveCompanyFieldHeaders(
      buildCompanyDetailFields(companyName, companyDetails),
      columns.map((c) => c.name)
    )
    setSending(true)
    setReply(null)
    const result = await window.PayrollHubBridge.sendToDashboard('send-data', {
      dataType: 'payroll-result',
      rows: buildPdfFillRows(columns, employees, computedGrid, companyFields),
      meta: { period: periodKey(year, month) },
    })
    setSending(false)
    setReply(result.ok ? { ok: true, text: 'Sent to the dashboard' } : { ok: false, text: `Not sent: ${result.error}` })
  }

  return (
    // The title sits on the wrapper because a disabled button doesn't
    // reliably show its own tooltip.
    <div className="relative" title={blockedReason ?? undefined}>
      <button
        onClick={handleSend}
        disabled={Boolean(blockedReason) || sending}
        aria-describedby={blockedReason ? 'send-to-dashboard-reason' : undefined}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-indigo-600"
      >
        {sending ? 'Sending…' : 'Send to dashboard'}
      </button>
      {blockedReason && (
        <span id="send-to-dashboard-reason" className="sr-only">
          {blockedReason}
        </span>
      )}

      {reply && (
        <div
          role="status"
          className={`absolute right-0 top-full z-30 mt-1 flex w-72 items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm shadow-lg ${
            reply.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          <span>{reply.text}</span>
          <button onClick={() => setReply(null)} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
