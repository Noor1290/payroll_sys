// Tiered columns saved before the tier fixes of October 2026 (audit M1 and
// M2) and of November 2026 (known issue 9, "Equal to" first) still hold the
// formula compiled by the old rule, and a column is calculated from its
// saved formula. Such a column keeps its figures until it is edited and
// saved again; until then it is flagged in the column list, and its
// breakdown explains the old rule it is still calculated with, so the
// explanation always matches the figure.

import { compileExemptionWrapper } from './exemptionCondition'
import { compileTieredFormulaBeforeEqualFix, compileTieredFormulaBeforeFix, equalTierShadowed, oldRuleShape } from './tieredFormula'

export const OUTDATED_RULE_NOTES = {
  below: "Figures use the old rule, which picked the wrong 'Below' tier. Open and save this column to apply the corrected rule. Its figures will change.",
  cap: "Figures use the old rule, which ignored this tier's condition because of the cap. Open and save this column to apply the corrected rule. Its figures will change.",
  equal: "Figures use the old rule, which let a wider tier win over an 'Equal to' tier. Open and save this column to apply the corrected rule. Its figures will change.",
}

// The rule a Tiered column's saved formula comes from, and why it gives
// other figures than the rule now: { rule: 'beforeFix' | 'beforeEqualFix',
// reason: 'below' | 'cap' | 'equal' }, or null when its figures are the
// rule's now.
export function savedTieredRule(col) {
  if (col?.type !== 'formula' || col.builderMode !== 'tiered' || col.tieredKind === 'compare' || !col.tiered) return null
  const saved = (compile) => col.formula === compileExemptionWrapper(col.exemption, compile(col.tiered))
  // The October rule first: when both old rules compile the same formula, they give the same figures.
  if (saved(compileTieredFormulaBeforeEqualFix)) return equalTierShadowed(col.tiered, 'beforeEqualFix') ? { rule: 'beforeEqualFix', reason: 'equal' } : null
  if (saved(compileTieredFormulaBeforeFix)) {
    const reason = oldRuleShape(col.tiered) ?? (equalTierShadowed(col.tiered, 'beforeFix') ? 'equal' : null)
    return reason ? { rule: 'beforeFix', reason } : null
  }
  return null
}

// 'below', 'cap', 'equal', or null: why this column's saved formula is an old rule's.
export function outdatedTieredRule(col) {
  return savedTieredRule(col)?.reason ?? null
}
