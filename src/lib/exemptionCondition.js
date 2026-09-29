// "Exemption / Condition" wrapper: an optional guard that can sit on top of
// ANY formula builder mode (Simple, Tiered, Progressive, or the Tiered
// sub-mode Compare Two Columns) and override the result when one or more
// conditions match - e.g. "if this employee is marked Aged 60+, this
// deduction is 0, otherwise calculate normally". It compiles down to the
// same ternary-expression format as everything else, wrapping whatever
// expression the chosen base mode produced, so neither side needs to know
// about the other - the engine, Excel translator, and circular-reference
// checker all keep working unchanged.

import { formatNum } from './tieredFormula'

const COMPARE_OPERATOR_PHRASES = {
  '>': 'greater than',
  '<': 'less than',
  '>=': 'greater than or equal to',
  '<=': 'less than or equal to',
  '==': 'equal to',
  '!=': 'not equal to',
}

export const COMPARE_OPERATORS = Object.keys(COMPARE_OPERATOR_PHRASES)

export function compareOperatorLabel(operator) {
  return COMPARE_OPERATOR_PHRASES[operator] ? `${COMPARE_OPERATOR_PHRASES[operator]} (${operator})` : operator
}

export function newCheckboxCondition() {
  return { type: 'checkbox', columnKey: null, checked: true }
}

export function newCompareCondition() {
  return { type: 'compare', columnKey: null, operator: '>', compareToType: 'value', compareToValue: 0, compareToColumnKey: null }
}

export function defaultExemptionState() {
  return {
    enabled: false,
    conditions: [newCheckboxCondition()],
    combineWith: 'AND', // 'AND' | 'OR' - only relevant with 2+ conditions
    resultType: 'fixed', // 'fixed' | 'column'
    resultValue: 0,
    resultColumnKey: null,
  }
}

function compileCondition(cond) {
  if (cond.type === 'checkbox') {
    return `${cond.columnKey} === ${cond.checked ? 1 : 0}`
  }
  const jsOp = cond.operator === '==' ? '===' : cond.operator === '!=' ? '!==' : cond.operator
  const right = cond.compareToType === 'column' ? cond.compareToColumnKey : Number(cond.compareToValue) || 0
  return `${cond.columnKey} ${jsOp} ${right}`
}

// Wraps `baseExpr` (whatever the active builder mode compiled to) in the
// exemption condition, e.g. "(over60 === 1) ? (0) : (baseExpr)". Returns
// `baseExpr` unchanged when the exemption isn't enabled.
export function compileExemptionWrapper(exemption, baseExpr) {
  if (!exemption?.enabled || !exemption.conditions?.length) return baseExpr
  const joiner = exemption.combineWith === 'OR' ? ' || ' : ' && '
  const condExpr = exemption.conditions.map((c) => `(${compileCondition(c)})`).join(joiner)
  const resultExpr = exemption.resultType === 'column' ? exemption.resultColumnKey : Number(exemption.resultValue) || 0
  return `(${condExpr}) ? (${resultExpr}) : (${baseExpr})`
}

// Re-derives whether the condition matched, given resolved dependency
// values - evaluates the identical logic compileCondition compiles, so it
// can never disagree with what the actual formula computed.
export function evaluateExemptionCondition(exemption, depValues) {
  if (!exemption?.enabled || !exemption.conditions?.length) return false
  const results = exemption.conditions.map((cond) => {
    if (cond.type === 'checkbox') {
      const v = depValues[cond.columnKey] ?? 0
      return cond.checked ? v === 1 : v === 0
    }
    const left = depValues[cond.columnKey] ?? 0
    const right = cond.compareToType === 'column' ? (depValues[cond.compareToColumnKey] ?? 0) : Number(cond.compareToValue) || 0
    switch (cond.operator) {
      case '>':
        return left > right
      case '<':
        return left < right
      case '>=':
        return left >= right
      case '<=':
        return left <= right
      case '==':
        return left === right
      case '!=':
        return left !== right
      default:
        return false
    }
  })
  return exemption.combineWith === 'OR' ? results.some(Boolean) : results.every(Boolean)
}

function columnName(columnsByKey, key) {
  return columnsByKey?.[key]?.name ?? key ?? '…'
}

// A condition's plain-language description, structural (no specific
// employee's values) - used by the live rule summary.
function describeConditionRule(cond, columnsByKey) {
  if (cond.type === 'checkbox') {
    return `"${columnName(columnsByKey, cond.columnKey)}" is ${cond.checked ? 'ticked' : 'not ticked'}`
  }
  const opPhrase = COMPARE_OPERATOR_PHRASES[cond.operator] ?? cond.operator
  const right =
    cond.compareToType === 'column' ? `"${columnName(columnsByKey, cond.compareToColumnKey)}"` : formatNum(cond.compareToValue)
  return `"${columnName(columnsByKey, cond.columnKey)}" is ${opPhrase} ${right}`
}

// Live, rule-level plain-language summary shown above the builder, e.g.
// "If "Aged 60 or above" is ticked, this amount is 0. Otherwise: 1% of
//  Basic Salary, up to a maximum of 29,710." `baseSummary` is whatever the
// active base builder mode's own describe-function produced.
export function describeExemptionRule(exemption, columnsByKey, baseSummary) {
  if (!exemption?.enabled || !exemption.conditions?.length) return baseSummary
  const joiner = exemption.combineWith === 'OR' ? ' or ' : ' and '
  const condText = exemption.conditions.map((c) => describeConditionRule(c, columnsByKey)).join(joiner)
  const resultText =
    exemption.resultType === 'column'
      ? `the value of "${columnName(columnsByKey, exemption.resultColumnKey)}"`
      : formatNum(exemption.resultValue)
  return `If ${condText}, this amount is ${resultText}. Otherwise: ${baseSummary}`
}

// A condition's plain-language description using this EMPLOYEE's actual
// resolved values, e.g. "'Aged 60 or above' is ticked" or "'Basic Salary'
// (52,000) is greater than 50,000" - true regardless of whether it
// happened to match the configured requirement.
function describeConditionActual(cond, columnsByKey, depValues) {
  const name = columnName(columnsByKey, cond.columnKey)
  if (cond.type === 'checkbox') {
    const isTicked = (depValues[cond.columnKey] ?? 0) === 1
    return `'${name}' is ${isTicked ? 'ticked' : 'not ticked'}`
  }
  const leftVal = depValues[cond.columnKey] ?? 0
  const opPhrase = COMPARE_OPERATOR_PHRASES[cond.operator] ?? cond.operator
  const rightVal = cond.compareToType === 'column' ? (depValues[cond.compareToColumnKey] ?? 0) : Number(cond.compareToValue) || 0
  return `'${name}' (${formatNum(leftVal)}) is ${opPhrase} ${formatNum(rightVal)}`
}

// Per-employee breakdown sentence stating whether the exemption matched,
// e.g. "'Aged 60 or above' is ticked, so NSF = 0." when matched, or
// "'Aged 60 or above' is not ticked, so the normal calculation applies:"
// when not - callers append the underlying calculation's own explanation
// after this only in the non-matched case.
export function buildExemptionExplanation({ exemption, columnsByKey, depValues, matched, resultValue, resultDecimals, columnLabel }) {
  const joiner = exemption.combineWith === 'OR' ? ' or ' : ' and '
  const condText = exemption.conditions.map((c) => describeConditionActual(c, columnsByKey, depValues)).join(joiner)

  const sentence = matched
    ? `${condText}, so ${columnLabel} = ${formatNum(resultValue, resultDecimals)}.`
    : `${condText}, so the normal calculation applies:`

  return { sentence, matched }
}
