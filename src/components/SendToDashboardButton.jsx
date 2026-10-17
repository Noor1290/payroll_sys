import { useState } from 'react'
import { CircleAlert, CircleCheck, Send, X } from 'lucide-react'
import {
  buildPdfFillColumns,
  buildCompanyDetailFields,
  resolveCompanyFieldHeaders,
  buildPdfFillRows,
  findClashingHeaders,
  pdfFillHeaders,
} from '../lib/pdfFillExport'
import { periodKey } from '../lib/periods'
import { findErrorCells } from '../lib/exportErrors'
import { checkRequiredNames } from '../lib/requiredNames'
import { employmentDateHeader, withIsoEmploymentDates } from '../lib/employmentDate'
import { describeEmployee } from '../lib/excelImport'
import Modal from './Modal'
import RequiredNamesNote from './RequiredNamesNote'

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
  // The names the other apps look for that this month lacks, shown before sending (rehearsal fix F4).
  const [askFirst, setAskFirst] = useState(null)

  if (!window.PayrollHubBridge.isEmbedded()) return null

  // A figure in error is never sent as a number, and the dashboard takes
  // figures only - so nothing is sent until it is fixed.
  const errors = findErrorCells(employees, buildPdfFillColumns(identityFields, effectiveColumns), computedGrid, identityFields)

  // Rows are keyed by name: two company details with one label would
  // overwrite each other in what is sent (as in "Export for PDF fill").
  const allColumns = buildPdfFillColumns(identityFields, effectiveColumns)
  const clashingLabels = findClashingHeaders(
    pdfFillHeaders(allColumns, resolveCompanyFieldHeaders(buildCompanyDetailFields(companyName, companyDetails), allColumns.map((c) => c.name)))
  )

  const blockedReason =
    employees.length === 0
      ? 'Nothing to send: there are no employees for this month.'
      : !(companyDetails?.brn ?? '').trim()
        ? "Can't send yet: this company has no BRN. Add it in Company Details (the ⓘ next to the company name)."
        : errors.length > 0
          ? `Can't send yet: ${errors.length} figure${errors.length === 1 ? ' is' : 's are'} in error (${errors[0].employee} — ${errors[0].column}${
              errors.length > 1 ? ', …' : ''
            }). Fix ${errors.length === 1 ? 'it' : 'them'} first.`
          : clashingLabels.length > 0
            ? `Can't send yet: ${clashingLabels.map((label) => `more than one company detail is called "${label}".`).join(' ')} Each would overwrite the other in what is sent. Rename them in Company Details first.`
            : null

  // Exactly what is sent: the PDF fill rows, with the date of employment written "YYYY-MM-DD"
  // (rehearsal fix F6). A date that cannot be read is left out for that employee.
  function rowsToSend() {
    const columns = buildPdfFillColumns(identityFields, effectiveColumns)
    const companyFields = resolveCompanyFieldHeaders(
      buildCompanyDetailFields(companyName, companyDetails),
      columns.map((c) => c.name)
    )
    const rows = buildPdfFillRows(columns, employees, computedGrid, companyFields)
    return withIsoEmploymentDates(rows, employmentDateHeader(columns.map((c) => c.name)))
  }

  // Warns, never blocks: the dashboard still decides what it accepts.
  function handleClick() {
    const names = checkRequiredNames(buildPdfFillColumns(identityFields, effectiveColumns).map((c) => c.name))
    const dates = rowsToSend().unreadable.map((u) => ({ ...u, who: describeEmployee(employees[u.index]?.values, identityFields) || `Row ${u.index + 1}` }))
    if (names.length > 0 || dates.length > 0) setAskFirst({ names, dates })
    else void handleSend()
  }

  async function handleSend() {
    setAskFirst(null)
    setSending(true)
    setReply(null)
    const result = await window.PayrollHubBridge.sendToDashboard('send-data', {
      dataType: 'payroll-result',
      rows: rowsToSend().rows,
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
        onClick={handleClick}
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

      {askFirst && (
        <Modal title="Send to the dashboard?" onClose={() => setAskFirst(null)} icon={<Send />}>
          <div className="space-y-4">
            <RequiredNamesNote
              problems={askFirst.names}
              closing="The dashboard refuses a month without the names it needs, and the payslip app needs its own. Add or rename the columns under Global Columns or Company Columns, or send anyway."
            />
            {askFirst.dates.length > 0 && (
              <div data-testid="unreadable-dates" role="note" className="note note-warn space-y-1 text-sm">
                <p className="font-medium">Dates of employment that can&rsquo;t be read</p>
                <p>{askFirst.dates.map((d) => `${d.who} (“${d.raw}”)`).join(', ')}.</p>
                <p>These are not sent. Write the date as DD/MM/YYYY, for example 01/08/2026, or send anyway without them.</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setAskFirst(null)} className="btn btn-secondary">
                Cancel
              </button>
              <button onClick={() => void handleSend()} className="btn btn-primary">
                Send anyway
              </button>
            </div>
          </div>
        </Modal>
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
