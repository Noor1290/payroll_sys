import { describeTieredRule } from '../lib/tieredFormula'

// Visual, no-code builder for tiered/conditional deduction rules: a base
// column, any number of threshold tiers, and an optional cap. Generic by
// design - nothing here names or special-cases any specific deduction.
export default function TieredFormulaBuilder({ availableColumns, baseKey, tiers, cap, onChange }) {
  const baseColumn = availableColumns.find((c) => c.key === baseKey)
  const baseName = baseColumn?.name ?? 'the base value'

  function updateTier(index, patch) {
    const next = tiers.map((t, i) => (i === index ? { ...t, ...patch } : t))
    onChange({ baseKey, tiers: next, cap })
  }

  function addTier() {
    const lastThreshold = tiers.length > 0 ? Number(tiers[tiers.length - 1].threshold) || 0 : 0
    const next = [...tiers, { operator: 'from', threshold: lastThreshold, rate: 0 }]
    onChange({ baseKey, tiers: next, cap })
  }

  function removeTier(index) {
    if (tiers.length <= 1) return
    onChange({ baseKey, tiers: tiers.filter((_, i) => i !== index), cap })
  }

  function setBaseKey(key) {
    onChange({ baseKey: key, tiers, cap })
  }

  function setCapEnabled(enabled) {
    onChange({ baseKey, tiers, cap: enabled ? '' : null })
  }

  function setCapValue(value) {
    onChange({ baseKey, tiers, cap: value })
  }

  const summary = baseColumn ? describeTieredRule(baseName, tiers, cap) : 'Pick a base value column to get started.'

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
        <label className="mb-1 block text-xs font-medium text-slate-600">Tiers</label>
        <div className="space-y-2">
          {tiers.map((tier, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={tier.operator}
                onChange={(e) => updateTier(i, { operator: e.target.value })}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              >
                <option value="below">Below</option>
                <option value="equal">Equal to</option>
                <option value="above">Above</option>
                <option value="from">From</option>
              </select>
              <input
                type="number"
                value={tier.threshold}
                onChange={(e) => updateTier(i, { threshold: e.target.value === '' ? '' : Number(e.target.value) })}
                placeholder="amount"
                className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
              <span className="text-sm text-slate-400">→ rate</span>
              <input
                type="number"
                value={tier.rate}
                onChange={(e) => updateTier(i, { rate: e.target.value === '' ? '' : Number(e.target.value) })}
                placeholder="rate"
                className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
              <span className="text-sm text-slate-400">%</span>
              <button
                type="button"
                onClick={() => removeTier(i)}
                disabled={tiers.length <= 1}
                className="ml-1 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addTier}
          className="mt-2 rounded-md border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500 hover:border-indigo-400 hover:text-indigo-600"
        >
          + Add Tier
        </button>
      </div>

      <div>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          <input type="checkbox" checked={cap !== null && cap !== undefined} onChange={(e) => setCapEnabled(e.target.checked)} />
          Cap / Ceiling — apply the rate to a maximum of
        </label>
        {cap !== null && cap !== undefined && (
          <input
            type="number"
            value={cap}
            onChange={(e) => setCapValue(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="maximum amount"
            className="mt-1 w-40 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        )}
      </div>
    </div>
  )
}
