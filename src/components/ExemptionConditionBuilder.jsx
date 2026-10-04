import {
  COMPARE_OPERATORS,
  compareOperatorLabel,
  describeExemptionRule,
  newCheckboxCondition,
  newCompareCondition,
} from '../lib/exemptionCondition'

const TOGGLE_ACTIVE = 'choice-active'
const TOGGLE_INACTIVE = ''

function toggleClass(active) {
  return `choice ${active ? TOGGLE_ACTIVE : TOGGLE_INACTIVE}`
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
    <div className="space-y-3 rounded-xl border border-line bg-surface p-3">
      <label className="flex items-center gap-2 text-sm font-medium text-fg">
        <input type="checkbox" checked={exemption.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
        Add an exemption / override condition
      </label>

      {exemption.enabled && (
        <div className="space-y-3">
          {summary && (
            <div className="note note-warn">{summary}</div>
          )}

          <div className="space-y-2">
            {exemption.conditions.map((cond, i) => (
              <div key={i} className="rounded-lg border border-line bg-surface p-3">
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
                    <button type="button" onClick={() => removeCondition(i)} className="btn btn-ghost btn-sm text-xs text-danger">
                      Remove
                    </button>
                  )}
                </div>

                {cond.type === 'checkbox' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={cond.columnKey ?? ''}
                      onChange={(e) => updateCondition(i, { columnKey: e.target.value || null })}
                      className="field w-auto max-w-full"
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
                      className="field w-auto max-w-full"
                    >
                      <option value="ticked">is ticked</option>
                      <option value="unticked">is not ticked</option>
                    </select>
                    {checkboxColumns.length === 0 && (
                      <span className="text-xs text-subtle">No checkbox columns available yet.</span>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={cond.columnKey ?? ''}
                      onChange={(e) => updateCondition(i, { columnKey: e.target.value || null })}
                      className="field w-auto max-w-full"
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
                      className="field w-auto max-w-full"
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
                      className="field w-auto max-w-full"
                    >
                      <option value="value">a fixed value</option>
                      <option value="column">another column</option>
                    </select>
                    {cond.compareToType === 'value' ? (
                      <input
                        type="number"
                        value={cond.compareToValue}
                        onChange={(e) => updateCondition(i, { compareToValue: e.target.value === '' ? '' : Number(e.target.value) })}
                        className="field num w-28 text-right"
                      />
                    ) : (
                      <select
                        value={cond.compareToColumnKey ?? ''}
                        onChange={(e) => updateCondition(i, { compareToColumnKey: e.target.value || null })}
                        className="field w-auto max-w-full"
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
              className="btn btn-ghost btn-sm border-dashed border-line-strong text-xs hover:border-accent hover:text-accent"
            >
              + Add Condition
            </button>
            {exemption.conditions.length > 1 && (
              <div className="flex items-center gap-1.5 text-xs text-muted">
                Combine with
                <select
                  value={exemption.combineWith}
                  onChange={(e) => patch({ combineWith: e.target.value })}
                  className="field field-cell w-auto"
                >
                  <option value="AND">AND (all must match)</option>
                  <option value="OR">OR (any can match)</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="label">Result when the condition is met</label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={exemption.resultType}
                onChange={(e) => patch({ resultType: e.target.value })}
                className="field w-auto max-w-full"
              >
                <option value="fixed">Fixed value</option>
                <option value="column">Value of another column</option>
              </select>
              {exemption.resultType === 'fixed' ? (
                <input
                  type="number"
                  value={exemption.resultValue}
                  onChange={(e) => patch({ resultValue: e.target.value === '' ? '' : Number(e.target.value) })}
                  className="field num w-28 text-right"
                />
              ) : (
                <select
                  value={exemption.resultColumnKey ?? ''}
                  onChange={(e) => patch({ resultColumnKey: e.target.value || null })}
                  className="field w-auto max-w-full"
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
