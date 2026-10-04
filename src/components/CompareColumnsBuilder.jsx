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
      <div className="note note-accent">{summary}</div>

      <div className="grid items-end gap-2 sm:grid-cols-3">
        <div>
          <label className="label">Column A</label>
          <select
            value={columnAKey ?? ''}
            aria-label="Column A"
            onChange={(e) => patch({ columnAKey: e.target.value || null })}
            className="field"
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
          <label className="label">Comparison</label>
          <select
            value={operator}
            aria-label="Comparison"
            onChange={(e) => patch({ operator: e.target.value })}
            className="field"
          >
            {COMPARE_OPERATORS.map((op) => (
              <option key={op} value={op}>
                {compareOperatorLabel(op)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Column B</label>
          <select
            value={columnBKey ?? ''}
            aria-label="Column B"
            onChange={(e) => patch({ columnBKey: e.target.value || null })}
            className="field"
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
        <label className="label">Result if TRUE</label>
        <input
          value={trueExpr}
          aria-label="Result if TRUE"
          onChange={(e) => patch({ trueExpr: e.target.value })}
          placeholder="e.g. 0, or Column B - Column A"
          className="field font-mono"
        />
        <div className="mt-1 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => insertPlaceholder('trueExpr', 'Column A')}
            className="chip"
          >
            + Column A
          </button>
          <button
            type="button"
            onClick={() => insertPlaceholder('trueExpr', 'Column B')}
            className="chip"
          >
            + Column B
          </button>
        </div>
      </div>

      <div>
        <label className="label">Result if FALSE</label>
        <input
          value={falseExpr}
          aria-label="Result if FALSE"
          onChange={(e) => patch({ falseExpr: e.target.value })}
          placeholder="e.g. 0, or Column B - Column A"
          className="field font-mono"
        />
        <div className="mt-1 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => insertPlaceholder('falseExpr', 'Column A')}
            className="chip"
          >
            + Column A
          </button>
          <button
            type="button"
            onClick={() => insertPlaceholder('falseExpr', 'Column B')}
            className="chip"
          >
            + Column B
          </button>
        </div>
        <p className="hint">
          Enter a number, or an expression using "Column A" / "Column B" as placeholders for the two columns above.
        </p>
      </div>
    </div>
  )
}
