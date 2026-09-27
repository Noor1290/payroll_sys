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
      <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
        {summary}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Base value column</label>
        <select
          value={baseKey ?? ''}
          onChange={(e) => setBaseKey(e.target.value || null)}
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
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
        <label className="mb-1 block text-xs font-medium text-slate-600">Brackets</label>
        <div className="space-y-2">
          {brackets.map((b, i) => {
            const isLast = i === brackets.length - 1
            const label = isLast ? 'Remainder' : i === 0 ? 'First' : 'Next'
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-sm text-slate-500">{label}</span>
                {!isLast && (
                  <input
                    type="number"
                    value={b.width}
                    onChange={(e) => updateBracket(i, { width: e.target.value === '' ? '' : Number(e.target.value) })}
                    placeholder="width"
                    className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                )}
                <span className="text-sm text-slate-400">→ rate</span>
                <input
                  type="number"
                  value={b.rate}
                  onChange={(e) => updateBracket(i, { rate: e.target.value === '' ? '' : Number(e.target.value) })}
                  placeholder="rate"
                  className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                />
                <span className="text-sm text-slate-400">%</span>
                {!isLast && (
                  <button
                    type="button"
                    onClick={() => removeBracket(i)}
                    className="ml-1 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
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
          className="mt-2 rounded-md border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500 hover:border-indigo-400 hover:text-indigo-600"
        >
          + Add Bracket
        </button>
      </div>
    </div>
  )
}
