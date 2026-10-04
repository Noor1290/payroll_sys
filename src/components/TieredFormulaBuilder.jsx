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
      <div className="note note-accent">
        {summary}
      </div>

      <div>
        <label className="label">Base value column</label>
        <select
          value={baseKey ?? ''}
          aria-label="Base value column"
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
        <label className="label">Tiers</label>
        <div className="space-y-2">
          {tiers.map((tier, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={tier.operator}
                aria-label="Tiers"
                onChange={(e) => updateTier(i, { operator: e.target.value })}
                className="field w-auto max-w-full"
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
                aria-label="amount"
                placeholder="amount"
                className="field num w-32 text-right"
              />
              <span className="text-sm text-subtle">→ rate</span>
              <input
                type="number"
                value={tier.rate}
                onChange={(e) => updateTier(i, { rate: e.target.value === '' ? '' : Number(e.target.value) })}
                aria-label="rate"
                placeholder="rate"
                className="field num w-24 text-right"
              />
              <span className="text-sm text-subtle">%</span>
              <button
                type="button"
                onClick={() => removeTier(i)}
                disabled={tiers.length <= 1}
                className="btn btn-ghost btn-sm text-xs text-danger"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addTier}
          className="btn btn-ghost btn-sm mt-2 border-dashed border-line-strong text-xs hover:border-accent hover:text-accent"
        >
          + Add Tier
        </button>
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={cap !== null && cap !== undefined} onChange={(e) => setCapEnabled(e.target.checked)} />
          Cap / Ceiling — apply the rate to a maximum of
        </label>
        {cap !== null && cap !== undefined && (
          <input
            type="number"
            value={cap}
            onChange={(e) => setCapValue(e.target.value === '' ? '' : Number(e.target.value))}
            aria-label="maximum amount"
            placeholder="maximum amount"
            className="field num mt-2 w-40 text-right"
          />
        )}
      </div>
    </div>
  )
}
