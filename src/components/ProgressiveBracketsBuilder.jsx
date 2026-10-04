import { describeProgressiveRule } from '../lib/progressiveFormula'

// Visual, no-code builder for progressive/graduated bracket rules (like
// PAYE income tax): a base column and any number of brackets, each taxing
// only the PORTION of the value that falls within it. Generic by design -
// nothing here names or special-cases any specific tax scheme.
//
// Each bracket after the first is entered as a WIDTH added on top of the
// previous bracket's ceiling (matching how people naturally think about tax
// brackets), not an absolute threshold. The last bracket is always
// open-ended ("Remainder") and can't be removed or given a width.
export default function ProgressiveBracketsBuilder({ availableColumns, baseKey, brackets, onChange }) {
  const baseColumn = availableColumns.find((c) => c.key === baseKey)

  function updateBracket(index, patch) {
    const next = brackets.map((b, i) => (i === index ? { ...b, ...patch } : b))
    onChange({ baseKey, brackets: next })
  }

  function addBracket() {
    const next = [...brackets]
    next.splice(brackets.length - 1, 0, { width: 0, rate: 0 })
    onChange({ baseKey, brackets: next })
  }

  function removeBracket(index) {
    if (brackets.length <= 1) return
    onChange({ baseKey, brackets: brackets.filter((_, i) => i !== index) })
  }

  function setBaseKey(key) {
    onChange({ baseKey: key, brackets })
  }

  const summary = baseColumn ? describeProgressiveRule(brackets) : 'Pick a base value column to get started.'

  return (
    <div className="space-y-4">
      <div className="note note-accent">
        {summary}
      </div>

      <div>
        <label className="label">Base value column</label>
        <select
          value={baseKey ?? ''}
          onChange={(e) => setBaseKey(e.target.value || null)}
          className="field"
        >
          <option value="">— Select a column —</option>
          {availableColumns.map((c) => (
            <option key={c.key} value={c.key}>
              {c.helperLabel ?? c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Brackets</label>
        <div className="space-y-2">
          {brackets.map((b, i) => {
            const isLast = i === brackets.length - 1
            const label = isLast ? 'Remainder' : i === 0 ? 'First' : 'Next'
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-sm text-muted">{label}</span>
                {!isLast && (
                  <input
                    type="number"
                    value={b.width}
                    onChange={(e) => updateBracket(i, { width: e.target.value === '' ? '' : Number(e.target.value) })}
                    placeholder="width"
                    className="field num w-32 text-right"
                  />
                )}
                <span className="text-sm text-subtle">→ rate</span>
                <input
                  type="number"
                  value={b.rate}
                  onChange={(e) => updateBracket(i, { rate: e.target.value === '' ? '' : Number(e.target.value) })}
                  placeholder="rate"
                  className="field num w-24 text-right"
                />
                <span className="text-sm text-subtle">%</span>
                {!isLast && (
                  <button
                    type="button"
                    onClick={() => removeBracket(i)}
                    className="btn btn-ghost btn-sm text-xs text-danger"
                  >
                    Remove
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <button
          type="button"
          onClick={addBracket}
          className="btn btn-ghost btn-sm mt-2 border-dashed border-line-strong text-xs hover:border-accent hover:text-accent"
        >
          + Add Bracket
        </button>
      </div>
    </div>
  )
}
