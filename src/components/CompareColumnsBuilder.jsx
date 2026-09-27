import { COMPARE_OPERATORS, compareOperatorLabel, describeCompareRule } from '../lib/tieredFormula'

// Visual builder for comparing two columns directly against each other,
// with a custom result expression per branch (rather than a single column
// vs. a fixed threshold). Result expressions are free text using the
// literal placeholders "Column A" / "Column B", which get swapped for real
// column keys when compiled and real column names/values in the summary
// and breakdown - see tieredFormula.js.
export default function CompareColumnsBuilder({ availableColumns, columnAKey, operator, columnBKey, trueExpr, falseExpr, onChange }) {
  const columnA = availableColumns.find((c) => c.key === columnAKey)
  const columnB = availableColumns.find((c) => c.key === columnBKey)
  const columnAName = columnA?.name ?? 'Column A'
  const columnBName = columnB?.name ?? 'Column B'

  function patch(update) {
    onChange({ columnAKey, operator, columnBKey, trueExpr, falseExpr, ...update })
  }

  function insertPlaceholder(field, placeholder) {
    const current = field === 'trueExpr' ? trueExpr : falseExpr
    patch({ [field]: `${current}${current && !current.endsWith(' ') ? ' ' : ''}${placeholder}` })
  }

  const summary =
    columnA && columnB
      ? describeCompareRule(columnAName, columnBName, operator, trueExpr, falseExpr)
      : 'Pick Column A and Column B to get started.'

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">{summary}</div>

      <div className="grid grid-cols-3 items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Column A</label>
          <select
            value={columnAKey ?? ''}
            onChange={(e) => patch({ columnAKey: e.target.value || null })}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="">— Select —</option>
            {availableColumns.map((c) => (
              <option key={c.key} value={c.key}>
                {c.helperLabel ?? c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Comparison</label>
          <select
            value={operator}
            onChange={(e) => patch({ operator: e.target.value })}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          >
            {COMPARE_OPERATORS.map((op) => (
              <option key={op} value={op}>
                {compareOperatorLabel(op)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Column B</label>
          <select
            value={columnBKey ?? ''}
            onChange={(e) => patch({ columnBKey: e.target.value || null })}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="">— Select —</option>
            {availableColumns.map((c) => (
              <option key={c.key} value={c.key}>
                {c.helperLabel ?? c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Result if TRUE</label>
        <input
          value={trueExpr}
          onChange={(e) => patch({ trueExpr: e.target.value })}
          placeholder="e.g. 0, or Column B - Column A"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-sm focus:border-indigo-500 focus:outline-none"
        />
        <div className="mt-1 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => insertPlaceholder('trueExpr', 'Column A')}
            className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-200"
          >
            + Column A
          </button>
          <button
            type="button"
            onClick={() => insertPlaceholder('trueExpr', 'Column B')}
            className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-200"
          >
            + Column B
          </button>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Result if FALSE</label>
        <input
          value={falseExpr}
          onChange={(e) => patch({ falseExpr: e.target.value })}
          placeholder="e.g. 0, or Column B - Column A"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-sm focus:border-indigo-500 focus:outline-none"
        />
        <div className="mt-1 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => insertPlaceholder('falseExpr', 'Column A')}
            className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-200"
          >
            + Column A
          </button>
          <button
            type="button"
            onClick={() => insertPlaceholder('falseExpr', 'Column B')}
            className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-200"
          >
            + Column B
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Enter a number, or an expression using "Column A" / "Column B" as placeholders for the two columns above.
        </p>
      </div>
    </div>
  )
}
