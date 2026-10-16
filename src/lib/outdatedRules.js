// Tiered columns saved before the two tier fixes of October 2026 (audit M1
// and M2) still hold the formula compiled by the old rule, and a column is
// calculated from its saved formula. Such a column keeps its figures until
// it is edited and saved again; until then it is flagged in the column
// list, and its breakdown explains the old rule it is still calculated with,
// so the explanation always matches the figure.

import { compileExemptionWrapper } from './exemptionCondition'
import { compileTieredFormulaBeforeFix, oldRuleShape } from './tieredFormula'

export const OUTDATED_RULE_NOTES = {
  below: "Figures use the old rule, which picked the wrong 'Below' tier. Open and save this column to apply the corrected rule. Its figures will change.",
  cap: "Figures use the old rule, which ignored this tier's condition because of the cap. Open and save this column to apply the corrected rule. Its figures will change.",
}

// 'below', 'cap', or null: why this column's saved formula is the old rule's.
export function outdatedTieredRule(col) {
  if (col?.type !== 'formula' || col.builderMode !== 'tiered' || col.tieredKind === 'compare' || !col.tiered) return null
  const shape = oldRuleShape(col.tiered)
  if (!shape) return null
  return col.formula === compileExemptionWrapper(col.exemption, compileTieredFormulaBeforeFix(col.tiered)) ? shape : null
}
