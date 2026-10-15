import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { CircleAlert, History, LockKeyhole, RotateCcw } from 'lucide-react'
import Modal from './Modal'
import { describeSetupChange } from '../lib/setupChanges'
import { monthsChangedByRestore, setupHistory, setupRevision } from '../lib/dashboardHistory'
import { canRestoreSetup, restoreSetupRevision, revisionsOf, setupInUse } from '../lib/dashboardSetup'
import { askToUnlock, loadMonthRevision, monthHistory, monthInUse, monthStatus, restoreMonth } from '../lib/dashboardMonths'
import { computeGridForEmployees } from '../lib/formulaEngine'
import { getColumnsByKey } from '../lib/model'
import { formatDecimal } from '../lib/format'
import { formatPeriodLabel, parsePeriodKey } from '../lib/periods'

// The History of what the dashboard keeps for this app: a column setup (the
// shared one, or the selected company's own columns) or one month. Every saved
// version, newest first, with when and by whom. Looking at one changes nothing.
// "Restore this version" asks first, then saves it as a NEW revision: nothing
// earlier is rewritten or deleted. Only someone who may change it is offered it.

const savedAt = (iso) =>
  iso ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : 'date not recorded'

const monthLabel = (period) => {
  const { year, month } = parsePeriodKey(period)
  return formatPeriodLabel(year, month)
}

// The saved versions, newest first.
function RevisionList({ revisions, current, selected, onSelect, describe }) {
  if (revisions === null) return <p className="text-sm text-muted">Asking the dashboard…</p>
  if (revisions.length === 0) return <p className="text-sm text-muted">No saved version yet.</p>
  return (
    <ul aria-label="Saved versions" className="flex flex-col gap-1.5">
      {revisions.map((revision) => (
        <li key={revision.revision}>
          <button
            type="button"
            aria-pressed={selected === revision.revision}
            onClick={() => onSelect(revision.revision)}
            className={`flex w-full flex-col gap-0.5 rounded-lg border p-2.5 text-left text-sm ${
              selected === revision.revision ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong'
            }`}
          >
            <span className="font-medium text-fg">
              Revision {revision.revision}
              {revision.revision === current && ' (current)'}
            </span>
            <span className="text-muted">
              {savedAt(revision.saved_at)}, {revision.saved_by_you ? 'saved by you' : 'saved by someone else'}
            </span>
            {describe && <span className="text-muted">{describe(revision)}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}

function Layout({ list, children }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <div className="flex w-full flex-col gap-2 md:w-60 md:shrink-0">{list}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">{children}</div>
    </div>
  )
}

function Problem({ children }) {
  return (
    <p role="alert" className="panel panel-danger text-sm">
      <CircleAlert aria-hidden="true" />
      <span className="min-w-0 flex-1">{children}</span>
    </p>
  )
}

function UnlockPrompt({ children, onUnlocked = () => {} }) {
  const [asking, setAsking] = useState(false)
  return (
    <div className="panel flex-wrap items-center text-sm [--panel:var(--warn)]">
      <LockKeyhole aria-hidden="true" />
      <span className="min-w-48 flex-1">{children}</span>
      <button
        className="btn btn-secondary btn-sm"
        disabled={asking}
        onClick={async () => {
          setAsking(true)
          const unlocked = await askToUnlock()
          setAsking(false)
          if (unlocked) onUnlocked()
        }}
      >
        <LockKeyhole aria-hidden="true" />
        Unlock the dashboard
      </button>
    </div>
  )
}

function ConfirmRestore({ question, busy, onCancel, onConfirm, children }) {
  return (
    <div role="alert" className="panel flex-col items-stretch gap-2 text-sm [--panel:var(--warn)]">
      <span className="text-fg">{question}</span>
      {children}
      <span className="flex flex-wrap justify-end gap-2">
        <button className="btn btn-secondary btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary btn-sm" onClick={onConfirm} disabled={busy}>
          {busy ? 'Restoring…' : 'Restore'}
        </button>
      </span>
    </div>
  )
}

// Reads a history when the dialog opens and each time `reload` changes.
//   read     () => Promise<{ ok, revisions, current? } | { ok: false, code, error }>
function useHistory(read, reload) {
  const [answer, setAnswer] = useState(null)
  useEffect(() => {
    let live = true
    read().then((result) => {
      if (live) setAnswer(result)
    })
    return () => {
      live = false
    }
    // `read` is the same question each time; only `reload` asks it again.
  }, [reload]) // oxlint-disable-line react-hooks/exhaustive-deps
  return answer
}

// ---------- a column setup ----------

const TYPE_LABEL = { input: 'Input', formula: 'Formula' }

function ColumnsShown({ title, columns }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle">{title}</h3>
      {columns.length === 0 ? (
        <p className="text-sm text-muted">None.</p>
      ) : (
        <div className="max-h-64 overflow-auto rounded-xl border border-line">
          <table className="w-full text-xs">
            <thead className="sticky top-0 text-left font-medium text-muted">
              <tr>
                <th className="bg-elevated px-3 py-2 shadow-[inset_0_-1px_0_var(--line)]">Name</th>
                <th className="bg-elevated px-3 py-2 shadow-[inset_0_-1px_0_var(--line)]">Key</th>
                <th className="bg-elevated px-3 py-2 shadow-[inset_0_-1px_0_var(--line)]">Type</th>
                <th className="bg-elevated px-3 py-2 shadow-[inset_0_-1px_0_var(--line)]">Formula</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {columns.map((column) => (
                <tr key={column.id ?? column.key}>
                  <td className="px-3 py-2 text-fg">{column.name}</td>
                  <td className="num px-3 py-2 text-muted">{column.key}</td>
                  <td className="px-3 py-2 text-muted">{TYPE_LABEL[column.type] ?? 'Identity field'}</td>
                  <td className="num break-all px-3 py-2 text-muted">{column.type === 'formula' ? column.formula : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// What restoring this revision would change, compared with the setup in use now.
function ChangeSummary({ change }) {
  if (change.none) return <p className="text-sm text-muted">Restoring it would change nothing: it is the same as the setup in use now.</p>
  const list = (items, render) => (
    <ul className="ml-4 list-disc">
      {items.map((item, i) => (
        <li key={i}>{render(item)}</li>
      ))}
    </ul>
  )
  return (
    <div className="flex flex-col gap-1.5 text-sm text-fg">
      <p className="font-medium">What restoring it would change</p>
      {change.keys.length > 0 && (
        <div>
          <p>Keys that change (values already typed stay under the key they were typed with):</p>
          {list(change.keys, (k) => `${k.name}: ${k.from} becomes ${k.to}`)}
        </div>
      )}
      {change.formulas.length > 0 && (
        <div>
          <p>Formulas that change:</p>
          {list(change.formulas, (f) => `${f.name}: ${f.from ?? '(an input, no formula)'} becomes ${f.to ?? '(an input, no formula)'}`)}
        </div>
      )}
      {change.added.length > 0 && (
        <div>
          <p>Back again:</p>
          {list(change.added, (c) => `${c.name} (${c.key})`)}
        </div>
      )}
      {change.removed.length > 0 && (
        <div>
          <p>Gone:</p>
          {list(change.removed, (c) => `${c.name} (${c.key})`)}
        </div>
      )}
      {change.renamed.length > 0 && (
        <div>
          <p>Names that change:</p>
          {list(change.renamed, (r) => `${r.from} becomes ${r.to}`)}
        </div>
      )}
      {change.settings.length > 0 && (
        <div>
          <p>Other settings that change:</p>
          {list(change.settings, (c) => `${c.name} (${c.key})`)}
        </div>
      )}
      {change.idField && (
        <p>
          The ID field changes from {change.idField.from ?? 'none'} to {change.idField.to ?? 'none'}.
        </p>
      )}
      {change.details && <p>The company's custom details change.</p>}
      {change.reordered && <p>The order of the columns changes.</p>}
    </div>
  )
}

// What the check of the months found, for the confirmation.
function MonthsCheck({ check }) {
  if (!check.checked) return null
  if (check.months.length > 0) {
    return (
      <div className="text-fg">
        <p className="font-medium text-danger">
          {check.months.length === 1 ? '1 month' : `${check.months.length} months`} saved with a later revision would be worked out differently:
        </p>
        <ul className="ml-4 list-disc">
          {check.months.map((m) => (
            <li key={`${m.brn}|${m.period}`}>
              {m.label}, {m.company}: {m.figures} {m.figures === 1 ? 'figure' : 'figures'} in {m.columns.join(', ')}
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <p className="text-muted">
      {check.later === 0
        ? 'No month was saved with a later revision.'
        : `${check.later === 1 ? '1 month was' : `${check.later} months were`} saved with a later revision; every figure would be the same.`}
    </p>
  )
}

//   target  'shared' | 'company'
export function SetupHistoryModal({ target, companyName, onRestored, onClose }) {
  const [reload, setReload] = useState(0)
  const history = useHistory(() => setupHistory(target), reload)
  const revisions = history === null ? null : history.ok ? history.revisions : []
  const current = history?.ok ? history.current : null
  const [selected, setSelected] = useState(null)
  const [preview, setPreview] = useState(null) // { revision, body }
  const [step, setStep] = useState('look') // 'look' | 'checking' | 'confirm' | 'restoring'
  const [check, setCheck] = useState(null)
  const [error, setError] = useState(null)
  const [restoredAs, setRestoredAs] = useState(null)
  const canRestore = canRestoreSetup(target)

  async function show(revision) {
    setSelected(revision)
    setPreview(null)
    setStep('look')
    setCheck(null)
    setError(null)
    const loaded = await setupRevision(target, revision)
    if (loaded.ok) setPreview(loaded.revision)
    else setError(`This version could not be loaded. ${loaded.error}`)
  }

  async function runCheck() {
    setStep('checking')
    setError(null)
    const result = await monthsChangedByRestore(target, preview.revision, preview.body)
    setCheck(result)
    setStep(result.ok ? 'confirm' : 'look')
  }

  async function restore() {
    setStep('restoring')
    setError(null)
    const result = await restoreSetupRevision(target, preview.body)
    if (!result.ok) {
      setStep('confirm')
      setError(`Not restored. ${result.error}`)
      return
    }
    setRestoredAs(result.revision)
    setSelected(null)
    setPreview(null)
    setStep('look')
    setCheck(null)
    onRestored()
    setReload((n) => n + 1)
  }

  // Compared with the setup in use now; worked out again once a restore has changed it.
  const change = useMemo(() => {
    const inUse = setupInUse(target)
    return preview && inUse ? describeSetupChange(inUse.body, preview.body, target) : null
  }, [preview, target])
  const title = target === 'shared' ? 'History of the Global columns' : `History of the columns of ${companyName}`

  return (
    <Modal
      title={title}
      description="Every saved version, newest first. Looking at one changes nothing."
      icon={<History />}
      width="max-w-4xl"
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        {restoredAs !== null && (
          <p role="status" className="text-sm text-fg">
            Restored. It was saved as revision {restoredAs}; the earlier versions are all still here.
          </p>
        )}
        {history && !history.ok && <Problem>The history could not be loaded. {history.error}</Problem>}
        {error && <Problem>{error}</Problem>}
        <Layout list={<RevisionList revisions={revisions} current={current} selected={selected} onSelect={(r) => void show(r)} />}>
          {selected === null ? (
            <p className="text-sm text-muted">
              Choose a version to see its {target === 'shared' ? 'identity fields and Global columns' : 'columns'}.
            </p>
          ) : preview === null ? (
            !error && <p className="text-sm text-muted">Loading revision {selected}…</p>
          ) : (
            <>
              {target === 'shared' ? (
                <>
                  <ColumnsShown title="Identity fields" columns={preview.body.identityFields ?? []} />
                  <ColumnsShown title="Global columns" columns={preview.body.globalColumns ?? []} />
                </>
              ) : (
                <ColumnsShown title={`Columns of ${companyName}`} columns={preview.body.columns ?? []} />
              )}
              {selected === current ? (
                <p className="text-sm text-muted">This is the version in use now.</p>
              ) : (
                <>
                  {change && <ChangeSummary change={change} />}
                  {!canRestore ? (
                    <p className="text-sm text-muted">
                      {target === 'shared'
                        ? 'Only someone who is an admin of every company using these Global columns can restore a version.'
                        : `Only an admin of ${companyName} can restore a version.`}
                    </p>
                  ) : step === 'checking' ? (
                    <p role="status" className="text-sm text-muted">
                      Checking the months saved with a later revision…
                    </p>
                  ) : check && !check.ok && check.code === 'locked' ? (
                    <UnlockPrompt onUnlocked={() => void runCheck()}>
                      Before restoring, the months saved with a later revision are worked out again with this version. The dashboard is locked,
                      so they could not be checked.
                    </UnlockPrompt>
                  ) : check && !check.ok ? (
                    <div className="flex flex-col gap-2">
                      <Problem>The months saved with a later revision could not be checked. {check.error}</Problem>
                      <div>
                        <button className="btn btn-secondary" onClick={() => void runCheck()}>
                          Check again
                        </button>
                      </div>
                    </div>
                  ) : step === 'confirm' || step === 'restoring' ? (
                    <ConfirmRestore
                      question={`Restore revision ${selected}? It is saved as a new revision, and every earlier version is kept.`}
                      busy={step === 'restoring'}
                      onCancel={() => {
                        setStep('look')
                        setCheck(null)
                      }}
                      onConfirm={() => void restore()}
                    >
                      <MonthsCheck check={check} />
                    </ConfirmRestore>
                  ) : (
                    <div>
                      <button className="btn btn-secondary" onClick={() => void runCheck()} disabled={change?.none}>
                        <RotateCcw aria-hidden="true" />
                        Restore this version
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </Layout>
      </div>
    </Modal>
  )
}

// ---------- a month ----------

function cellText(column, cell) {
  const value = cell?.value
  if (cell?.trace?.error) return 'Error'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return formatDecimal(value, column.decimals)
  return value === undefined || value === null ? '' : String(value)
}

// One revision's employees, worked out with the columns in use now. Nothing here can be typed into.
function MonthShown({ employees, identityFields, columns }) {
  const grid = useMemo(() => computeGridForEmployees(employees, columns, getColumnsByKey(columns)), [employees, columns])
  if (employees.length === 0) return <p className="text-sm text-muted">No employees in this version.</p>
  return (
    <div className="max-h-80 overflow-auto rounded-xl border border-line">
      <table className="w-full whitespace-nowrap text-xs">
        <thead className="sticky top-0 text-left font-medium text-muted">
          <tr>
            {[...identityFields, ...columns].map((column) => (
              <th key={column.key} className="bg-elevated px-3 py-2 shadow-[inset_0_-1px_0_var(--line)]">
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {employees.map((employee) => (
            <tr key={employee.id}>
              {identityFields.map((field) => (
                <td key={field.key} className="px-3 py-2 text-fg">
                  {String(employee.values?.[field.key] ?? '')}
                </td>
              ))}
              {columns.map((column) => (
                <td key={column.key} className="num px-3 py-2 text-right text-fg">
                  {cellText(column, grid[employee.id]?.[column.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function MonthHistoryModal({ brn, period, companyName, identityFields, columns, onClose }) {
  const months = useSyncExternalStore(monthStatus.subscribe, monthStatus.get)
  const label = monthLabel(period)
  return (
    <Modal
      title={`History of ${label}, ${companyName}`}
      description="Every save of this month, newest first. Looking at one changes nothing."
      icon={<History />}
      width="max-w-5xl"
      onClose={onClose}
    >
      {/* While the dashboard is locked nothing of the month is shown or held here: the
          content is unmounted, and read again once it is unlocked. */}
      {months.gate === 'locked' ? (
        <UnlockPrompt>The dashboard is locked, so the employees' figures are hidden. Unlock it to see this month's history.</UnlockPrompt>
      ) : (
        <MonthHistoryContent brn={brn} period={period} companyName={companyName} identityFields={identityFields} columns={columns} />
      )}
    </Modal>
  )
}

function MonthHistoryContent({ brn, period, companyName, identityFields, columns }) {
  const [reload, setReload] = useState(0)
  const history = useHistory(() => monthHistory(brn, period), reload)
  const revisions = history === null ? null : history.ok ? history.revisions : []
  const [selected, setSelected] = useState(null)
  const [preview, setPreview] = useState(null)
  const [step, setStep] = useState('look') // 'look' | 'confirm' | 'restoring'
  const [error, setError] = useState(null)
  const [restoredAs, setRestoredAs] = useState(null)
  const inUse = monthInUse(brn, period)
  const label = monthLabel(period)

  async function show(revision) {
    setSelected(revision)
    setPreview(null)
    setStep('look')
    setError(null)
    const kept = revisions.find((r) => r.revision === revision)?.kept || revision === inUse?.revision
    if (!kept) return
    const loaded = await loadMonthRevision(brn, period, revision)
    if (loaded.ok) setPreview(loaded.month)
    else if (loaded.code !== 'locked') setError(`This version could not be loaded. ${loaded.error}`)
  }

  async function restore() {
    setStep('restoring')
    setError(null)
    const result = await restoreMonth(brn, period, preview.revision, preview.employees)
    if (!result.ok) {
      setStep('confirm')
      setError(`Not restored. ${result.error}`)
      return
    }
    setRestoredAs(result.revision)
    setSelected(null)
    setPreview(null)
    setStep('look')
    setReload((n) => n + 1)
  }

  const now = revisionsOf(brn)
  const describe = (revision) =>
    `${revision.employee_count} ${revision.employee_count === 1 ? 'employee' : 'employees'}${revision.kept || revision.revision === inUse?.revision ? '' : ', only the record kept'}`
  const selectedRow = revisions?.find((r) => r.revision === selected) ?? null
  const keptSelected = selectedRow && (selectedRow.kept || selected === inUse?.revision)

  return (
    <div className="flex flex-col gap-3">
          {restoredAs !== null && (
            <p role="status" className="text-sm text-fg">
              Restored. It was saved as revision {restoredAs}; the version it replaced and every earlier one are still here.
            </p>
          )}
          {history && !history.ok && history.code !== 'locked' && <Problem>The history could not be loaded. {history.error}</Problem>}
          {error && <Problem>{error}</Problem>}
          <Layout
            list={
              <RevisionList revisions={revisions} current={inUse?.revision ?? null} selected={selected} onSelect={(r) => void show(r)} describe={describe} />
            }
          >
            {selected === null ? (
              <p className="text-sm text-muted">Choose a version to see its employees.</p>
            ) : !keptSelected ? (
              <p className="text-sm text-muted">
                Only the record of this save was kept, not its content, so it cannot be shown or restored. The dashboard keeps the content of
                the last save of each day, and of a version someone else saved over.
              </p>
            ) : preview === null ? (
              !error && <p className="text-sm text-muted">Loading revision {selected}…</p>
            ) : (
              <>
                <p className="text-sm text-fg">
                  Revision {selected}: {preview.employees.length} {preview.employees.length === 1 ? 'employee' : 'employees'}. The figures are worked
                  out with the columns in use now
                  {now && (preview.shared_revision !== now.shared || preview.company_revision !== now.company)
                    ? `; it was saved with column setup revisions ${preview.shared_revision} (Global) and ${preview.company_revision} (${companyName}), and the ones in use now are ${now.shared} and ${now.company}.`
                    : '.'}
                </p>
                <MonthShown employees={preview.employees} identityFields={identityFields} columns={columns} />
                {selected === inUse?.revision ? (
                  <p className="text-sm text-muted">This is the version in use now.</p>
                ) : step === 'confirm' || step === 'restoring' ? (
                  <ConfirmRestore
                    question={`Restore revision ${selected} of ${label}? It is saved as a new revision, worked out with the columns in use now. The version it replaces is kept, and every earlier version stays in the history.`}
                    busy={step === 'restoring'}
                    onCancel={() => setStep('look')}
                    onConfirm={() => void restore()}
                  />
                ) : (
                  <div>
                    <button className="btn btn-secondary" onClick={() => setStep('confirm')}>
                      <RotateCcw aria-hidden="true" />
                      Restore this version
                    </button>
                  </div>
                )}
              </>
            )}
          </Layout>
    </div>
  )
}
