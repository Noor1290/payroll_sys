// TODO C17 (rehearsal L2): the column list showed a built rule as code, e.g.
// "((Age 60+ === 1)) ? (0) : ((Math.min(Basic Salary, 29710)) * (0.01))", while the
// plain sentence was only inside the column form. This gives the list the same
// sentence the form shows ("Rule summary"), from the saved column alone.
//
// A formula typed by hand has no sentence: it is shown as the readable formula, as
// before (wrapped in its exemption's "If ..., this amount is ... Otherwise:" when it
// has one). A Tiered column still on an old rule keeps its formula too: the sentence
// would describe today's rule, not the figures it still gives.
import { describeExemptionRule, stripExemptionWrapper } from './exemptionCondition'
import { formatFormulaForDisplay } from './formulaEngine'
import { outdatedTieredRule } from './outdatedRules'
import { describeCompareRule, describeTieredRule } from './tieredFormula'
import { describeProgressiveRule } from './progressiveFormula'

// labels: key -> the readable name the list uses ("Name (Category)" when two share a name).
// columnsByKey: key -> column, for the exemption's conditions (as in the form).
// Returns { text, sentence }: sentence is false when text is a formula.
export function describeColumnRule(col, labels, columnsByKey) {
  if (!col?.formula) return null
  const asFormula = { text: formatFormulaForDisplay(col.formula, labels), sentence: false }
  const name = (key) => labels[key]

  let base = null
  if (col.builderMode === 'progressive' && col.progressive && name(col.progressive.baseKey)) {
    base = describeProgressiveRule(col.progressive.brackets ?? [])
  } else if (col.builderMode === 'tiered' && col.tieredKind === 'compare' && col.compare) {
    const { columnAKey, columnBKey, operator, trueExpr, falseExpr } = col.compare
    if (name(columnAKey) && name(columnBKey)) base = describeCompareRule(name(columnAKey), name(columnBKey), operator, trueExpr, falseExpr)
  } else if (col.builderMode === 'tiered' && col.tiered) {
    if (outdatedTieredRule(col)) return asFormula
    if (name(col.tiered.baseKey)) base = describeTieredRule(name(col.tiered.baseKey), col.tiered.tiers ?? [], col.tiered.cap)
  } else if (!col.builderMode || col.builderMode === 'simple') {
    if (!col.exemption?.enabled) return asFormula
    base = formatFormulaForDisplay(stripExemptionWrapper(col.exemption, col.formula), labels)
  }
  if (base === null) return asFormula
  return { text: describeExemptionRule(col.exemption, columnsByKey, base), sentence: true }
}
