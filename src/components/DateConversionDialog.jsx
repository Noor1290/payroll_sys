import { useEffect, useRef, useState } from 'react'
import { CalendarDays, CircleAlert } from 'lucide-react'
import Modal from './Modal'
import { checkSavedDates } from '../lib/dates'
import { formatPeriodLabel, parsePeriodKey } from '../lib/periods'

const plural = (n, one, many) => (n === 1 ? one : many)

// Asked before a field that is not a Date becomes one. Its saved months are read first (`readSaved`, a
// promise of the store's readSavedValues) and nothing is changed by that, nor by the change itself: a
// value that is a clear date, "01/08/2026" or "2026-08-01", is read as that date at once; one that is
// not is listed by month and row and kept exactly as it is, shown in red, until someone corrects it.
// The change is then one save of the column setup (inside the dashboard, one revision that History >
// Restore undoes).
export default function DateConversionDialog({ fieldName, readSaved, companyNames, onConfirm, onCancel }) {
  const [state, setState] = useState({ step: 'checking' })
  // Read once, when the dialog opens.
  const read = useRef(readSaved)

  useEffect(() => {
    let live = true
    read.current().then(
      (answer) => live && setState(answer.ok ? { step: 'checked', ...checkSavedDates(answer.months) } : { step: 'failed', error: answer.error }),
      (error) => live && setState({ step: 'failed', error: String(error?.message ?? error) })
    )
    return () => {
      live = false
    }
  }, [])

  const companiesNamed = state.step === 'checked' && new Set(state.unreadable.map((u) => u.companyId)).size > 1
  const where = (u) => {
    const { year, month } = parsePeriodKey(u.period)
    const company = companiesNamed ? `${companyNames[u.companyId] ?? 'A company'}, ` : ''
    return `${company}${formatPeriodLabel(year, month)}, row ${u.row}`
  }

  return (
    <Modal title={`Make "${fieldName}" a Date?`} onClose={onCancel} width="max-w-lg" icon={<CalendarDays />}>
      <div className="space-y-3 text-sm" data-testid="date-conversion">
        {state.step === 'checking' && <p className="text-muted">Checking the saved months…</p>}

        {state.step === 'failed' && (
          <div role="alert" className="panel panel-danger">
            <CircleAlert aria-hidden="true" />
            <span>The saved months could not be checked: {state.error} Nothing was changed.</span>
          </div>
        )}

        {state.step === 'checked' && (
          <>
            {state.dates === 0 && state.unreadable.length === 0 && <p>No date is saved under it yet.</p>}
            {state.dates > 0 && (
              <p>
                {state.dates} saved {plural(state.dates, 'value is a date', 'values are dates')}: shown DD/MM/YYYY from now on.
              </p>
            )}
            {state.unreadable.length > 0 && (
              <div role="note" className="note note-warn">
                <p className="font-medium">
                  {state.unreadable.length} saved {plural(state.unreadable.length, "value can't", "values can't")} be read as a date.{' '}
                  {plural(state.unreadable.length, 'It is kept exactly as it is', 'They are kept exactly as they are')}, shown in red until corrected:
                </p>
                <ul className="mt-1 max-h-40 overflow-y-auto">
                  {state.unreadable.map((u) => (
                    <li key={`${u.companyId}|${u.period}|${u.row}`}>{where(u)}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-muted">No saved value is changed: a date is written as YYYY-MM-DD the next time its cell is changed.</p>
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
          {state.step === 'checked' && (
            <button onClick={onConfirm} className="btn btn-primary">
              Make it a Date
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
