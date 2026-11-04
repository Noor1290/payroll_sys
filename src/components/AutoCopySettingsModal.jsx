import { useMemo, useState } from 'react'
import { CopyCheck } from 'lucide-react'
import Modal from './Modal'
import { ASK, AUTO, autoCopyColumnGroups, autoCopyToKeep, readAutoCopy } from '../lib/autoCopy'

// "When I open a month with no employees yet": Ask me, or copy from the
// previous month automatically with the input columns ticked here. Saved on
// the company (lib/autoCopy.js); inside the dashboard, with its column setup.
export default function AutoCopySettingsModal({ company, effectiveColumns, inDashboard, onSave, onCancel }) {
  const start = readAutoCopy(company.autoCopy)
  const groups = useMemo(() => autoCopyColumnGroups(effectiveColumns), [effectiveColumns])
  const allKeys = groups.flatMap((g) => g.columns.map((c) => c.key))
  const [mode, setMode] = useState(start.mode)
  const [ticked, setTicked] = useState(() => new Set(start.columns.filter((key) => allKeys.includes(key))))

  function toggle(key) {
    setTicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function save() {
    // Kept in the table's order; a key no longer a column of this company is dropped.
    onSave(autoCopyToKeep({ mode, columns: allKeys.filter((key) => ticked.has(key)) }))
  }

  const auto = mode === AUTO
  return (
    <Modal
      title="When I open a month with no employees yet"
      description={`For ${company.name}.`}
      icon={<CopyCheck />}
      onClose={onCancel}
      width="max-w-xl"
    >
      <fieldset className="space-y-2">
        <legend className="sr-only">When I open a month with no employees yet</legend>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface p-3 text-sm has-[:checked]:border-accent/50">
          <input type="radio" name="auto-copy" className="mt-0.5" checked={!auto} onChange={() => setMode(ASK)} />
          <span>
            <span className="font-medium text-fg">Ask me</span>
            <span className="mt-0.5 block text-muted">Nothing is copied by itself. Use Copy from Previous Month when you need it.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface p-3 text-sm has-[:checked]:border-accent/50">
          <input type="radio" name="auto-copy" className="mt-0.5" checked={auto} onChange={() => setMode(AUTO)} />
          <span>
            <span className="font-medium text-fg">Copy from the previous month automatically</span>
            <span className="mt-0.5 block text-muted">
              The first time a month with no employees is opened, every employee of the month before is copied with their identity fields and the
              columns ticked below. The other columns stay empty; calculated columns are worked out as usual. A month that has employees is never
              changed.
            </span>
          </span>
        </label>
      </fieldset>

      <div className={`mt-4 ${auto ? '' : 'opacity-50'}`}>
        <div className="mb-1.5 flex min-h-8 items-center justify-between gap-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-subtle">Input columns to copy</h3>
          <div className="flex gap-1">
            <button className="btn btn-ghost btn-sm" disabled={!auto || allKeys.length === 0} onClick={() => setTicked(new Set(allKeys))}>
              Tick all
            </button>
            <button className="btn btn-ghost btn-sm" disabled={!auto || ticked.size === 0} onClick={() => setTicked(new Set())}>
              Untick all
            </button>
          </div>
        </div>
        <div className="max-h-64 space-y-3 overflow-y-auto rounded-xl border border-line bg-surface p-3">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle">{group.label}</p>
              <div className="space-y-1.5">
                {group.columns.map((col) => (
                  <label key={col.key} className="flex items-center gap-2 text-sm text-fg">
                    <input type="checkbox" disabled={!auto} checked={ticked.has(col.key)} onChange={() => toggle(col.key)} />
                    {col.name}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {groups.length === 0 && <p className="text-sm text-muted">No input columns yet: only the identity fields would be copied.</p>}
        </div>
        <p className="mt-2 text-xs text-muted">A column added later starts unticked.</p>
      </div>

      {inDashboard && (
        <p className="mt-4 text-xs text-muted">
          Saved in the dashboard with this company&apos;s columns, so it is the same on every laptop. It is a new revision of its columns (History).
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} className="btn btn-secondary">
          Cancel
        </button>
        <button onClick={save} className="btn btn-primary">
          Save
        </button>
      </div>
    </Modal>
  )
}
