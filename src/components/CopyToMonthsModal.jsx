import { useMemo, useState } from 'react'
import { CalendarRange } from 'lucide-react'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import { autoCopyColumnGroups } from '../lib/autoCopy'
import { periodKey, shiftPeriod } from '../lib/periods'
import {
  checkTargets,
  doneMessage,
  employeesFor,
  joinLabels,
  labelOf,
  monthsToWrite,
  months,
  plural,
  planTargetsInBrowser,
  saveTargetsInBrowser,
  saveTargetsInDashboard,
  targetPeriods,
} from '../lib/copyToMonths'


// "Copy this month to…": choose the months and the columns, see what will
// happen to each month, then save (lib/copyToMonths.js). The month on screen
// is only read.
export default function CopyToMonthsModal({
  companyId,
  current,
  employees,
  identityFields,
  idFieldKey,
  effectiveColumns,
  inDashboard,
  monthSaved,
  onDone,
  onCancel,
}) {
  const currentLabel = labelOf(periodKey(current.year, current.month))
  const next = shiftPeriod(current.year, current.month, 1)
  const groups = useMemo(() => autoCopyColumnGroups(effectiveColumns), [effectiveColumns])
  const allKeys = groups.flatMap((g) => g.columns.map((c) => c.key))

  const [range, setRange] = useState(false)
  const [from, setFrom] = useState(periodKey(next.year, next.month))
  const [to, setTo] = useState(periodKey(next.year, next.month))
  const [ticked, setTicked] = useState(() => new Set(allKeys))
  const [step, setStep] = useState('choose') // choose | checking | preview | saving | done
  const [plan, setPlan] = useState([])
  const [expected, setExpected] = useState(null)
  const [replace, setReplace] = useState(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [problem, setProblem] = useState(null)
  const [result, setResult] = useState(null)

  const target = targetPeriods(current, { from, to: range ? to : from })
  const columnKeys = allKeys.filter((key) => ticked.has(key))
  const makeEmployees = () => employeesFor({ employees, identityFields, columnKeys, effectiveColumns })

  function toggle(key) {
    setTicked((prev) => {
      const nextSet = new Set(prev)
      if (nextSet.has(key)) nextSet.delete(key)
      else nextSet.add(key)
      return nextSet
    })
  }

  async function check() {
    if (!target.ok) return
    setProblem(null)
    setReplace(new Set())
    if (!inDashboard) {
      setPlan(planTargetsInBrowser(companyId, target.periods))
      setStep('preview')
      return
    }
    setStep('checking')
    const answer = await checkTargets(target.periods)
    if (!answer.ok) {
      setProblem(answer.error || 'The dashboard did not answer.')
      setStep('choose')
      return
    }
    setPlan(answer.plan)
    setExpected(answer.expected)
    setStep('preview')
  }

  async function save() {
    setConfirming(false)
    setStep('saving')
    setProblem(null)
    if (!inDashboard) {
      const done = saveTargetsInBrowser(companyId, plan, makeEmployees)
      setResult({ added: done.added, replaced: [], failed: done.failed })
      setStep('done')
      onDone?.()
      return
    }
    const done = await saveTargetsInDashboard({ plan, replace, expected, makeEmployees, idFieldKey })
    if (!done.ok) {
      setProblem(`Nothing was copied. ${done.error || 'The dashboard did not save it.'}`)
      setStep('preview')
      return
    }
    setResult({ added: done.added, replaced: done.replaced, failed: [] })
    setStep('done')
    onDone?.()
  }

  const writing = monthsToWrite(plan, replace)
  const replacing = writing.filter((t) => t.action === 'saved').map((t) => t.period)
  const skipped = plan.filter((t) => t.action === 'saved' && !replace.has(t.period)).length
  const approved = plan.filter((t) => t.action === 'approved').length

  function summaryLine() {
    const parts = []
    if (skipped > 0) parts.push(`${months(skipped)} skipped`)
    if (approved > 0) parts.push(`${plural(approved, 'approved month')} left as it is`)
    const head = `${plural(employees.length, 'employee')} into ${months(writing.length)}.`
    return parts.length > 0 ? `${head} ${parts.join(', ')}.` : head
  }

  function onConfirmClick() {
    if (replacing.length > 0) setConfirming(true)
    else void save()
  }

  const title = `Copy ${currentLabel} to other months`
  return (
    <>
      <Modal title={title} icon={<CalendarRange />} onClose={step === 'saving' ? () => {} : onCancel} width="max-w-xl">
        {(step === 'choose' || step === 'checking') && (
          <>
            <fieldset className="space-y-2 text-sm">
              <legend className="sr-only">Months</legend>
              <div className="flex gap-4">
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name="copy-to-range" checked={!range} onChange={() => setRange(false)} />
                  One month
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name="copy-to-range" checked={range} onChange={() => setRange(true)} />
                  A range of months
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1 text-muted">
                  {range ? 'From' : 'Month'}
                  <input type="month" className="field w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                {range && (
                  <label className="flex flex-col gap-1 text-muted">
                    To
                    <input type="month" className="field w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
                  </label>
                )}
              </div>
              {!target.ok && <p className="text-xs text-danger">{target.problem}</p>}
            </fieldset>

            <div className="mt-4">
              <div className="mb-1.5 flex min-h-8 items-center justify-between gap-2">
                <h3 className="text-[11px] font-medium uppercase tracking-wider text-subtle">Columns to copy</h3>
                <div className="flex gap-1">
                  <button className="btn btn-ghost btn-sm" disabled={allKeys.length === 0} onClick={() => setTicked(new Set(allKeys))}>
                    Tick all
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={ticked.size === 0} onClick={() => setTicked(new Set())}>
                    Untick all
                  </button>
                </div>
              </div>
              <div className="max-h-56 space-y-3 overflow-y-auto rounded-xl border border-line bg-surface p-3">
                {groups.map((group) => (
                  <div key={group.label}>
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle">{group.label}</p>
                    <div className="space-y-1.5">
                      {group.columns.map((col) => (
                        <label key={col.key} className="flex items-center gap-2 text-sm text-fg">
                          <input type="checkbox" checked={ticked.has(col.key)} onChange={() => toggle(col.key)} />
                          {col.name}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                {groups.length === 0 && <p className="text-sm text-muted">No input columns yet: only the identity fields would be copied.</p>}
              </div>
              <p className="mt-2 text-xs text-muted">The identity fields are always copied. Calculated columns are worked out as usual.</p>
            </div>

            {problem && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {problem}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onCancel} className="btn btn-secondary">
                Cancel
              </button>
              <button onClick={() => void check()} disabled={!target.ok || step === 'checking'} className="btn btn-primary">
                {step === 'checking' ? 'Checking the months…' : 'Next'}
              </button>
            </div>
          </>
        )}

        {(step === 'preview' || step === 'saving') && (
          <>
            <ul className="max-h-72 space-y-1.5 overflow-y-auto rounded-xl border border-line bg-surface p-3 text-sm" aria-label="The months">
              {plan.map((t) => (
                <li key={t.period} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-fg">{labelOf(t.period)}</span>
                  {t.action === 'add' && <span className="text-muted">{`Will be added (${plural(employees.length, 'employee')})`}</span>}
                  {t.action === 'approved' && <span className="text-muted">Approved: never changed</span>}
                  {t.action === 'saved' && !inDashboard && <span className="text-muted">Saved already: skipped</span>}
                  {t.action === 'saved' && inDashboard && (
                    <span className="flex items-center gap-3 text-muted">
                      {t.employeeCount === null ? 'Saved already' : `Saved already (${plural(t.employeeCount, 'employee')})`}
                      <label className="flex items-center gap-1">
                        <input
                          type="radio"
                          name={`copy-to-${t.period}`}
                          checked={!replace.has(t.period)}
                          onChange={() => setReplace((prev) => new Set([...prev].filter((p) => p !== t.period)))}
                        />
                        Skip
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="radio"
                          name={`copy-to-${t.period}`}
                          checked={replace.has(t.period)}
                          onChange={() => setReplace((prev) => new Set([...prev, t.period]))}
                        />
                        Replace
                      </label>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-fg">{summaryLine()}</p>
            {!inDashboard && plan.some((t) => t.action === 'saved') && (
              <p className="mt-1 text-xs text-muted">On its own, this app never replaces a saved month: there is no History here to bring it back.</p>
            )}
            {inDashboard && !monthSaved && <p className="mt-1 text-xs text-muted">Waiting for this month to be saved…</p>}
            {problem && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {problem}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setStep('choose')} disabled={step === 'saving'} className="btn btn-secondary">
                Back
              </button>
              <button
                onClick={onConfirmClick}
                disabled={writing.length === 0 || step === 'saving' || (inDashboard && !monthSaved)}
                className="btn btn-primary"
              >
                {step === 'saving'
                  ? 'Copying…'
                  : replacing.length > 0
                    ? `Replace ${months(replacing.length)} and copy`
                    : `Copy to ${months(writing.length)}`}
              </button>
            </div>
          </>
        )}

        {step === 'done' && result && (
          <>
            <p role="status" className="text-sm text-fg">
              {doneMessage(result, plan.length)}
            </p>
            <div className="mt-5 flex justify-end">
              <button onClick={onCancel} className="btn btn-primary">
                Close
              </button>
            </div>
          </>
        )}
      </Modal>

      {confirming && (
        <ConfirmDialog
          title={`Replace ${joinLabels(replacing)}?`}
          message="What is saved there now is kept in History, and Restore brings it back."
          confirmLabel="Replace and copy"
          onConfirm={() => void save()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}
