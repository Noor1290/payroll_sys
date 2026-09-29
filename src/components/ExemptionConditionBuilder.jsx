import {
  COMPARE_OPERATORS,
  compareOperatorLabel,
  describeExemptionRule,
  newCheckboxCondition,
  newCompareCondition,
} from '../lib/exemptionCondition'

const TOGGLE_ACTIVE = 'border-indigo-600 bg-indigo-50 text-indigo-700'
const TOGGLE_INACTIVE = 'border-slate-300 text-slate-600 hover:bg-slate-50'

function toggleClass(active) {
  return `rounded-md border px-3 py-1.5 text-sm ${active ? TOGGLE_ACTIVE : TOGGLE_INACTIVE}`
}

// Optional guard shown alongside any formula builder mode: "if [condition],
// this result is [override], otherwise use the normal calculation below."
// Generic over Simple/Tiered/Progressive - it just wraps whatever
// expression the base mode produces, so this component knows nothing about
// which mode is active.
export default function ExemptionConditionBuilder({ availableColumns, exemption, onChange, baseSummary, columnsByKey }) {
  const checkboxColumns = availableColumns.filter((c) => c.valueType === 'checkbox')

  function patch(update) {
    onChange({ ...exemption, ...update })
  }

  function updateCondition(index, patch) {
    const next = exemption.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c))
    onChange({ ...exemption, conditions: next })
  }

  function setConditionType(index, type) {
    const next = exemption.conditions.map((c, i) => (i === index ? (type === 'checkbox' ? newCheckboxCondition() : newCompareCondition()) : c))
    onChange({ ...exemption, conditions: next })
  }

  function addCondition() {
    onChange({ ...exemption, conditions: [...exemption.conditions, newCheckboxCondition()] })
  }

  function removeCondition(index) {
    if (exemption.conditions.length <= 1) return
    onChange({ ...exemption, conditions: exemption.conditions.filter((_, i) => i !== index) })
  }

  const summary = exemption.enabled ? describeExemptionRule(exemption, columnsByKey, baseSummary) : null

  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-3">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input type="checkbox" checked={exemption.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
        Add an exemption / override condition
      </label>

      {exemption.enabled && (
        <div className="space-y-3">
          {summary && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{summary}</div>
          )}

          <div className="space-y-2">
            {exemption.conditions.map((cond, i) => (
              <div key={i} className="rounded-md border border-slate-200 bg-slate-50 p-2">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConditionType(i, 'checkbox')}
                      className={toggleClass(cond.type === 'checkbox')}
                    >
                      Checkbox
                    </button>
                    <button
                      type="button"
                      onClick={() => setConditionType(i, 'compare')}
                      className={toggleClass(cond.type === 'compare')}
                    >
                      Compare columns
                    </button>
                  </div>
                  {exemption.conditions.length > 1 && (
                    <button type="button" onClick={() => removeCondition(i)} className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                      Remove
                    </button>
                  )}
                </div>

                {cond.type === 'checkbox' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={cond.columnKey ?? ''}
                      onChange={(e) => updateCondition(i, { columnKey: e.target.value || null })}
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="">— Select a checkbox column —</option>
                      {checkboxColumns.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.helperLabel ?? c.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={cond.checked ? 'ticked' : 'unticked'}
                      onChange={(e) => updateCondition(i, { checked: e.target.value === 'ticked' })}
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="ticked">is ticked</option>
                      <option value="unticked">is not ticked</option>
                    </select>
                    {checkboxColumns.length === 0 && (
                      <span className="text-xs text-slate-400">No checkbox columns available yet.</span>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={cond.columnKey ?? ''}
                      onChange={(e) => updateCondition(i, { columnKey: e.target.value || null })}
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="">— Select a column —</option>
                      {availableColumns.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.helperLabel ?? c.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={cond.operator}
                      onChange={(e) => updateCondition(i, { operator: e.target.value })}
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                    >
                      {COMPARE_OPERATORS.map((op) => (
                        <option key={op} value={op}>
                          {compareOperatorLabel(op)}
                        </option>
                      ))}
                    </select>
                    <select
                      value={cond.compareToType}
                      onChange={(e) => updateCondition(i, { compareToType: e.target.value })}
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="value">a fixed value</option>
                      <option value="column">another column</option>
                    </select>
                    {cond.compareToType === 'value' ? (
                      <input
                        type="number"
                        value={cond.compareToValue}
                        onChange={(e) => updateCondition(i, { compareToValue: e.target.value === '' ? '' : Number(e.target.value) })}
                        className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                      />
                    ) : (
                      <select
                        value={cond.compareToColumnKey ?? ''}
                        onChange={(e) => updateCondition(i, { compareToColumnKey: e.target.value || null })}
                        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="">— Select a column —</option>
                        {availableColumns.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.helperLabel ?? c.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={addCondition}
              className="rounded-md border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500 hover:border-indigo-400 hover:text-indigo-600"
            >
              + Add Condition
            </button>
            {exemption.conditions.length > 1 && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                Combine with
                <select
                  value={exemption.combineWith}
                  onChange={(e) => patch({ combineWith: e.target.value })}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
                >
                  <option value="AND">AND (all must match)</option>
                  <option value="OR">OR (any can match)</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Result when the condition is met</label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={exemption.resultType}
                onChange={(e) => patch({ resultType: e.target.value })}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              >
                <option value="fixed">Fixed value</option>
                <option value="column">Value of another column</option>
              </select>
              {exemption.resultType === 'fixed' ? (
                <input
                  type="number"
                  value={exemption.resultValue}
                  onChange={(e) => patch({ resultValue: e.target.value === '' ? '' : Number(e.target.value) })}
                  className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                />
              ) : (
                <select
                  value={exemption.resultColumnKey ?? ''}
                  onChange={(e) => patch({ resultColumnKey: e.target.value || null })}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">— Select a column —</option>
                  {availableColumns.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.helperLabel ?? c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
