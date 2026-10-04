import { useState } from 'react'
import { CircleAlert, CircleCheck, Send, X } from 'lucide-react'
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
        className="btn btn-secondary"
      >
        <Send aria-hidden="true" className="text-accent" />
        {sending ? 'Sending…' : 'Send to dashboard'}
      </button>
      {blockedReason && (
        <span id="send-to-dashboard-reason" className="sr-only">
          {blockedReason}
        </span>
      )}

      {reply && (
        // Narrow screens: pinned to the bottom edge, so it can't run off the side.
        <div
          role="status"
          className={`panel rise-in z-30 text-sm shadow-pop max-sm:fixed max-sm:inset-x-4 max-sm:bottom-4 sm:absolute sm:right-0 sm:top-full sm:mt-2 sm:w-72 ${
            reply.ok ? 'panel-accent' : 'panel-danger'
          }`}
        >
          {reply.ok ? <CircleCheck aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
          <span className="min-w-0 flex-1">{reply.text}</span>
          <button onClick={() => setReply(null)} aria-label="Dismiss" className="btn btn-ghost btn-icon btn-sm -my-1 -mr-1.5">
            <X aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}
