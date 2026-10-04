import { useMemo, useRef, useState } from 'react'
import { CircleAlert, Columns3 } from 'lucide-react'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import TieredFormulaBuilder from './TieredFormulaBuilder'
import CompareColumnsBuilder from './CompareColumnsBuilder'
import ProgressiveBracketsBuilder from './ProgressiveBracketsBuilder'
import ExemptionConditionBuilder from './ExemptionConditionBuilder'
import { slugify, isValidKey } from '../lib/slugify'
import { validateFormulaSyntax, detectCircularReference } from '../lib/formulaEngine'
import { compileTieredFormula, compileCompareFormula, describeTieredRule, describeCompareRule } from '../lib/tieredFormula'
import { compileProgressiveFormula, describeProgressiveRule } from '../lib/progressiveFormula'
import { compileExemptionWrapper, defaultExemptionState } from '../lib/exemptionCondition'
import { SELECTABLE_CATEGORIES, DEFAULT_CATEGORY, generateUniqueKey, labelColumnsForHelper } from '../lib/categories'

const DEFAULT_TIERED_STATE = { baseKey: null, tiers: [{ operator: 'below', threshold: 0, rate: 0 }], cap: null }
const DEFAULT_COMPARE_STATE = { columnAKey: null, operator: '>', columnBKey: null, trueExpr: '0', falseExpr: '0' }
const DEFAULT_PROGRESSIVE_STATE = { baseKey: null, brackets: [{ width: 0, rate: 0 }, { width: 0, rate: 0 }] }

// Shared add/edit form for both global and company-scoped columns.
//
// availableColumns: columns (excluding the one being edited) that this
//   column is allowed to reference in a formula - for global columns this is
//   just the other global columns; for company columns it's global + that
//   company's own columns.
// columnsByKeyForCycleCheck: full key -> column map (excluding self) used to
//   detect circular references across the whole dependency graph.
export default function ColumnFormModal({
  initial,
  existingKeys,
  availableColumns,
  columnsByKeyForCycleCheck,
  currentScope,
  crossScopeExistingKeys = [],
  crossScopeAvailableKeys = null,
  totalCompanyCount,
  targetCompanyName,
  onSave,
  onClose,
}) {
  const isEdit = Boolean(initial)
  const [name, setName] = useState(initial?.name ?? '')
  const [key, setKey] = useState(initial?.key ?? '')
  const [keyTouched, setKeyTouched] = useState(isEdit)
  const [category, setCategory] = useState(initial?.category ?? DEFAULT_CATEGORY)
  const [type, setType] = useState(initial?.type ?? 'input')
  const [valueType, setValueType] = useState(initial?.valueType ?? 'number')
  const [decimals, setDecimals] = useState(initial?.decimals ?? 2)
  const [builderMode, setBuilderMode] = useState(initial?.builderMode ?? 'simple')
  const [tieredKind, setTieredKind] = useState(initial?.tieredKind ?? 'threshold')
  const [formula, setFormula] = useState(initial?.formula ?? '')
  const [tieredState, setTieredState] = useState(initial?.tiered ?? DEFAULT_TIERED_STATE)
  const [compareState, setCompareState] = useState(initial?.compare ?? DEFAULT_COMPARE_STATE)
  const [progressiveState, setProgressiveState] = useState(initial?.progressive ?? DEFAULT_PROGRESSIVE_STATE)
  const [exemptionState, setExemptionState] = useState(initial?.exemption ?? defaultExemptionState())
  const [includeInExport, setIncludeInExport] = useState(!initial?.excludeFromExport)
  const [scope, setScope] = useState(currentScope ?? 'company')
  const [pendingScopeChange, setPendingScopeChange] = useState(null) // { patch, to } | null
  const [error, setError] = useState(null)
  const formulaRef = useRef(null)

  const availableKeys = useMemo(() => availableColumns.map((c) => c.key), [availableColumns])
  const labeledAvailableColumns = useMemo(() => labelColumnsForHelper(availableColumns), [availableColumns])
  const columnsByKeyForNames = useMemo(() => Object.fromEntries(availableColumns.map((c) => [c.key, c])), [availableColumns])

  // Live plain-language description of whichever base builder mode is
  // currently active, so the Exemption/Condition section can show a
  // combined "If X, use Y. Otherwise: <this>." summary regardless of mode.
  const baseSummary = useMemo(() => {
    if (builderMode === 'progressive') {
      const baseCol = labeledAvailableColumns.find((c) => c.key === progressiveState.baseKey)
      return baseCol ? describeProgressiveRule(progressiveState.brackets) : 'the progressive brackets rule'
    }
    if (builderMode === 'tiered' && tieredKind === 'compare') {
      const colA = labeledAvailableColumns.find((c) => c.key === compareState.columnAKey)
      const colB = labeledAvailableColumns.find((c) => c.key === compareState.columnBKey)
      return colA && colB
        ? describeCompareRule(colA.name, colB.name, compareState.operator, compareState.trueExpr, compareState.falseExpr)
        : 'the comparison rule'
    }
    if (builderMode === 'tiered') {
      const baseCol = labeledAvailableColumns.find((c) => c.key === tieredState.baseKey)
      return baseCol ? describeTieredRule(baseCol.name, tieredState.tiers, tieredState.cap) : 'the tiered rule'
    }
    return formula.trim() || 'the entered formula'
  }, [builderMode, tieredKind, tieredState, compareState, progressiveState, formula, labeledAvailableColumns])

  function autoKeyFor(nameValue, categoryValue) {
    return generateUniqueKey(slugify(nameValue), categoryValue, existingKeys)
  }

  function handleNameChange(value) {
    setName(value)
    if (!keyTouched) setKey(autoKeyFor(value, category))
  }

  function handleCategoryChange(value) {
    setCategory(value)
    if (!keyTouched) setKey(autoKeyFor(name, value))
  }

  function insertKeyIntoFormula(k) {
    const el = formulaRef.current
    if (!el) {
      setFormula((f) => `${f}${k}`)
      return
    }
    const start = el.selectionStart ?? formula.length
    const end = el.selectionEnd ?? formula.length
    const next = formula.slice(0, start) + k + formula.slice(end)
    setFormula(next)
    requestAnimationFrame(() => {
      el.focus()
      const cursor = start + k.length
      el.setSelectionRange(cursor, cursor)
    })
  }

  function switchBuilderMode(mode) {
    if (mode === builderMode) return
    if (mode === 'simple' && builderMode === 'tiered') {
      // Compile the current visual rule so it's visible/editable as raw JS.
      if (tieredKind === 'compare') {
        if (compareState.columnAKey && compareState.columnBKey) {
          setFormula(compileCompareFormula(compareState))
        }
      } else if (tieredState.baseKey) {
        setFormula(compileTieredFormula(tieredState))
      }
    } else if (mode === 'simple' && builderMode === 'progressive') {
      if (progressiveState.baseKey) {
        setFormula(compileProgressiveFormula(progressiveState))
      }
    }
    setBuilderMode(mode)
    setError(null)
  }

  const scopeChanged = Boolean(currentScope) && scope !== currentScope

  // finalizes a validated patch: applies it directly, or - if the scope is
  // changing from Global to "this company only" and other companies would
  // actually lose it - pauses for an explicit confirmation first, since
  // that step removes the column from every other company.
  function finalizeSave(patch) {
    const fullPatch = { ...(initial ?? {}), ...patch }
    if (!scopeChanged) return onSave(fullPatch, null)

    if (scope === 'company') {
      if (!totalCompanyCount || totalCompanyCount <= 1) {
        return onSave(fullPatch, { to: 'company' })
      }
      setPendingScopeChange({ patch: fullPatch, to: 'company' })
      return
    }

    return onSave(fullPatch, { to: 'global' })
  }

  function handleSave() {
    const trimmedName = name.trim()
    const trimmedKey = key.trim()

    if (!trimmedName) return setError('Name is required')
    if (!trimmedKey) return setError('Key is required')
    if (!isValidKey(trimmedKey)) {
      return setError('Key must be a valid identifier (letters, numbers, _ or $, not starting with a number)')
    }

    const effectiveExistingKeys = scopeChanged ? crossScopeExistingKeys : existingKeys
    if (effectiveExistingKeys.includes(trimmedKey)) {
      return setError(
        scopeChanged
          ? `Can't make this column ${scope === 'global' ? 'Global' : 'Company-specific'}: the key "${trimmedKey}" is already used by another column there. Rename the key first, then try again.`
          : `Key "${trimmedKey}" is already used by another field or column`
      )
    }

    if (type !== 'formula') {
      return finalizeSave({
        name: trimmedName,
        key: trimmedKey,
        type,
        category,
        valueType,
        decimals: valueType === 'number' ? decimals : undefined,
        excludeFromExport: !includeInExport,
        formula: undefined,
        builderMode: undefined,
        tieredKind: undefined,
        tiered: undefined,
        compare: undefined,
        progressive: undefined,
        exemption: undefined,
      })
    }

    let finalFormula = formula

    if (builderMode === 'tiered' && tieredKind === 'compare') {
      if (!compareState.columnAKey || !compareState.columnBKey) {
        return setError('Pick Column A and Column B for the comparison')
      }
      if (!String(compareState.trueExpr ?? '').trim() || !String(compareState.falseExpr ?? '').trim()) {
        return setError('Enter a result for both the TRUE and FALSE branches')
      }
      finalFormula = compileCompareFormula(compareState)
    } else if (builderMode === 'tiered') {
      if (!tieredState.baseKey) return setError('Pick a base value column for the tiered rule')
      const invalidTier = tieredState.tiers.find((t) => t.threshold === '' || t.rate === '')
      if (invalidTier) return setError('Every tier needs a threshold amount and a rate')
      if (tieredState.cap === '') return setError('Enter a cap amount, or uncheck the cap option')
      finalFormula = compileTieredFormula(tieredState)
    } else if (builderMode === 'progressive') {
      if (!progressiveState.baseKey) return setError('Pick a base value column for the progressive rule')
      const invalidBracket = progressiveState.brackets.find((b, i) => {
        if (b.rate === '') return true
        const isLast = i === progressiveState.brackets.length - 1
        return !isLast && b.width === ''
      })
      if (invalidBracket) return setError('Every bracket needs a rate, and a width (except the final "Remainder" bracket)')
      finalFormula = compileProgressiveFormula(progressiveState)
    }

    if (exemptionState.enabled) {
      const invalidCondition = exemptionState.conditions.find((c) => {
        if (!c.columnKey) return true
        if (c.type === 'compare' && c.compareToType === 'column' && !c.compareToColumnKey) return true
        if (c.type === 'compare' && c.compareToType === 'value' && c.compareToValue === '') return true
        return false
      })
      if (invalidCondition) return setError('Every exemption condition needs a column selected (and a comparison value/column, if applicable)')
      if (exemptionState.resultType === 'column' && !exemptionState.resultColumnKey) {
        return setError('Pick a column for the exemption result, or switch it to a fixed value')
      }
      if (exemptionState.resultType === 'fixed' && exemptionState.resultValue === '') {
        return setError('Enter a fixed result value for the exemption, or switch it to a column')
      }
      finalFormula = compileExemptionWrapper(exemptionState, finalFormula)
    }

    const result = validateFormulaSyntax(finalFormula, availableKeys)
    if (!result.valid) return setError(result.error)

    // Converting Company -> Global narrows what this formula can reference
    // for every OTHER company - re-validate against the global-only
    // reference set so we don't silently break it for them.
    if (scopeChanged && scope === 'global' && crossScopeAvailableKeys) {
      const crossResult = validateFormulaSyntax(finalFormula, crossScopeAvailableKeys)
      if (!crossResult.valid) {
        return setError(
          `Can't make this column Global: it ${crossResult.error.replace(/^Unknown column reference: /, 'references ')}, a company-specific column other companies don't have. Remove that reference first, or keep this column Company-specific.`
        )
      }
    }

    const { hasCycle, cyclePath } = detectCircularReference(trimmedKey, finalFormula, columnsByKeyForCycleCheck)
    if (hasCycle) {
      return setError(`Circular reference detected: ${cyclePath.join(' → ')}`)
    }

    finalizeSave({
      name: trimmedName,
      key: trimmedKey,
      type,
      category,
      valueType: undefined,
      decimals,
      excludeFromExport: !includeInExport,
      formula: finalFormula.trim(),
      builderMode,
      tieredKind: builderMode === 'tiered' ? tieredKind : undefined,
      tiered: builderMode === 'tiered' && tieredKind === 'threshold' ? tieredState : undefined,
      compare: builderMode === 'tiered' && tieredKind === 'compare' ? compareState : undefined,
      progressive: builderMode === 'progressive' ? progressiveState : undefined,
      exemption: exemptionState.enabled ? exemptionState : undefined,
    })
  }

  const autoAdjustedKey = !keyTouched && key && key !== slugify(name)

  return (
    <>
    <Modal title={isEdit ? 'Edit column' : 'Add column'} onClose={onClose} width="max-w-2xl" redesigned icon={<Columns3 />}>
      <div className="space-y-4">
        <div>
          <label className="label">Name</label>
          <input
            className="field"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. Basic Salary"
            autoFocus
          />
        </div>

        <div>
          <label className="label">Category</label>
          <select
            value={category}
            onChange={(e) => handleCategoryChange(e.target.value)}
            className="field"
          >
            {SELECTABLE_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {isEdit && currentScope && (
          <div>
            <label className="label">Scope</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setScope('global')}
                className={`choice ${
                  scope === 'global'
                    ? 'choice-active'
                    : ''
                }`}
              >
                Global
              </button>
              <button
                type="button"
                onClick={() => setScope('company')}
                className={`choice ${
                  scope === 'company'
                    ? 'choice-active'
                    : ''
                }`}
              >
                This company only
              </button>
            </div>
            {scopeChanged && (
              <p className="hint text-warn">
                {scope === 'company'
                  ? `This will convert this column from Global to Company-specific, scoped only to ${
                      targetCompanyName ?? 'this company'
                    }. It will be removed from every other company (their data for it is preserved but hidden).`
                  : "This will make this column available to all companies. Other companies won't have any existing data for it - it'll just start empty."}
              </p>
            )}
          </div>
        )}

        <div>
          <label className="label">Key</label>
          <input
            className="field font-mono"
            value={key}
            onChange={(e) => {
              setKeyTouched(true)
              setKey(e.target.value)
            }}
            placeholder="basicSalary"
          />
          {autoAdjustedKey && (
            <p className="hint">
              This column's formula key: <span className="font-mono">{key}</span> (auto-adjusted to avoid a naming
              collision with another column called "{name}")
            </p>
          )}
        </div>

        <div>
          <label className="label">Type</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType('input')}
              className={`choice ${
                type === 'input'
                  ? 'choice-active'
                  : ''
              }`}
            >
              Input
            </button>
            <button
              type="button"
              onClick={() => setType('formula')}
              className={`choice ${
                type === 'formula'
                  ? 'choice-active'
                  : ''
              }`}
            >
              Formula
            </button>
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={includeInExport} onChange={(e) => setIncludeInExport(e.target.checked)} />
            Include in Excel export
          </label>
          <p className="hint">
            {includeInExport
              ? 'Appears in the Export Preview and the downloaded file, like any other column.'
              : "Stays hidden from the Export Preview, the visible spreadsheet, and payslips - it still shows in the app's Employee Table, marked as not exported. If a Live-Formula export still needs its value, it's written as a hidden column."}
          </p>
        </div>

        {type === 'input' && (
          <div>
            <label className="label">Value type</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setValueType('number')}
                className={`choice ${
                  valueType === 'number'
                    ? 'choice-active'
                    : ''
                }`}
              >
                Number
              </button>
              <button
                type="button"
                onClick={() => setValueType('text')}
                className={`choice ${
                  valueType === 'text'
                    ? 'choice-active'
                    : ''
                }`}
              >
                Text
              </button>
              <button
                type="button"
                onClick={() => setValueType('checkbox')}
                className={`choice ${
                  valueType === 'checkbox'
                    ? 'choice-active'
                    : ''
                }`}
              >
                Checkbox (Yes/No)
              </button>
            </div>
            <p className="hint">
              {valueType === 'checkbox'
                ? 'A yes/no flag, shown as a checkbox in the Employee Table. Available in formulas as 1 (ticked) or 0 (not ticked).'
                : 'Use Text for non-numeric values like "Full Time" / "Part Time" - it won\'t be coerced to 0.'}
            </p>
          </div>
        )}

        {(type === 'formula' || (type === 'input' && valueType === 'number')) && (
          <div>
            <label className="label">Decimal places</label>
            <select
              value={decimals}
              onChange={(e) => setDecimals(Number(e.target.value))}
              className="field w-32"
            >
              {[0, 1, 2, 3, 4].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <p className="hint">
              How this column's values are rounded for display in the table, breakdown, and export. Stored values
              keep full precision.
            </p>
          </div>
        )}

        {type === 'formula' && (
          <>
            <div>
              <label className="label">Formula builder</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => switchBuilderMode('simple')}
                  className={`choice ${
                    builderMode === 'simple'
                      ? 'choice-active'
                      : ''
                  }`}
                >
                  Simple
                </button>
                <button
                  type="button"
                  onClick={() => switchBuilderMode('tiered')}
                  className={`choice ${
                    builderMode === 'tiered'
                      ? 'choice-active'
                      : ''
                  }`}
                >
                  Tiered / Conditional
                </button>
                <button
                  type="button"
                  onClick={() => switchBuilderMode('progressive')}
                  className={`choice ${
                    builderMode === 'progressive'
                      ? 'choice-active'
                      : ''
                  }`}
                >
                  Progressive Brackets
                </button>
              </div>
              {builderMode === 'simple' && (
                <p className="hint">
                  A single expression referencing column keys, e.g. basicSalary + bonus.
                </p>
              )}
              {(builderMode === 'tiered' || builderMode === 'progressive') && (
                <p className="hint">
                  Switching to Simple will show the compiled expression this rule produces.
                </p>
              )}
            </div>

            <ExemptionConditionBuilder
              availableColumns={labeledAvailableColumns}
              exemption={exemptionState}
              onChange={setExemptionState}
              baseSummary={baseSummary}
              columnsByKey={columnsByKeyForNames}
            />

            {builderMode === 'tiered' && (
              <div>
                <label className="label">Tiered rule type</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setTieredKind('threshold')}
                    className={`choice ${
                      tieredKind === 'threshold'
                        ? 'choice-active'
                        : ''
                    }`}
                  >
                    Threshold Tiers
                  </button>
                  <button
                    type="button"
                    onClick={() => setTieredKind('compare')}
                    className={`choice ${
                      tieredKind === 'compare'
                        ? 'choice-active'
                        : ''
                    }`}
                  >
                    Compare Two Columns
                  </button>
                </div>
              </div>
            )}

            {builderMode === 'simple' ? (
              <div>
                <label className="label">Formula expression</label>
                <textarea
                  ref={formulaRef}
                  className="field font-mono"
                  rows={3}
                  value={formula}
                  onChange={(e) => setFormula(e.target.value)}
                  placeholder="basicSalary * 0.03 + bonus - deductions"
                />
                <div className="mt-2">
                  <p className="hint mb-1.5">Available columns (click to insert):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {labeledAvailableColumns.length === 0 && (
                      <span className="text-xs text-subtle">No other columns defined yet</span>
                    )}
                    {labeledAvailableColumns.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => insertKeyIntoFormula(c.key)}
                        className="chip font-mono"
                        title={c.helperLabel}
                      >
                        {c.helperLabel}
                        {c.valueType === 'checkbox' && <span className="text-subtle"> (checkbox)</span>} → {c.key}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : builderMode === 'progressive' ? (
              <ProgressiveBracketsBuilder
                availableColumns={labeledAvailableColumns}
                baseKey={progressiveState.baseKey}
                brackets={progressiveState.brackets}
                onChange={setProgressiveState}
              />
            ) : tieredKind === 'compare' ? (
              <CompareColumnsBuilder
                availableColumns={labeledAvailableColumns}
                columnAKey={compareState.columnAKey}
                operator={compareState.operator}
                columnBKey={compareState.columnBKey}
                trueExpr={compareState.trueExpr}
                falseExpr={compareState.falseExpr}
                onChange={setCompareState}
              />
            ) : (
              <TieredFormulaBuilder
                availableColumns={labeledAvailableColumns}
                baseKey={tieredState.baseKey}
                tiers={tieredState.tiers}
                cap={tieredState.cap}
                onChange={setTieredState}
              />
            )}
          </>
        )}

        {error && (
          <div role="alert" className="panel panel-danger text-sm">
            <CircleAlert aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="btn btn-primary"
          >
            Save
          </button>
        </div>
      </div>
    </Modal>

    {pendingScopeChange && (
      <ConfirmDialog
        title="Convert to Company-specific?"
        message={`This column currently applies to all ${totalCompanyCount} companies. Converting it to "This company only" will remove it from the other ${
          totalCompanyCount - 1
        } compan${totalCompanyCount - 1 === 1 ? 'y' : 'ies'}. Their historical data for this column will be preserved but hidden/inactive unless the column is restored to Global or recreated for them individually.`}
        confirmLabel="Convert"
        onCancel={() => setPendingScopeChange(null)}
        onConfirm={() => {
          onSave(pendingScopeChange.patch, { to: pendingScopeChange.to })
          setPendingScopeChange(null)
        }}
      />
    )}
    </>
  )
}
