// Compiles a visually-built "tiered / conditional" rule (a base column, N
// threshold tiers, and an optional cap) into the same plain expression
// string format used by "Simple" mode formulas - so the calculation engine,
// dependency resolution, and circular-reference checks never need to know
// tiered rules exist at all. Also derives plain-language explanations of
// the rule (for the live builder summary) and of one computed result (for
// the breakdown view), generically from the tier/cap structure - nothing
// here is specific to any one deduction.

import { formatDecimal } from './format'

export function formatNum(n, decimals) {
  const num = typeof n === 'number' ? n : Number(n)
  if (Number.isNaN(num)) return String(n)
  return formatDecimal(num, decimals)
}

// Four tier operators. "from" is kept as the >= equivalent for backward
// compatibility with tiers created before "equal"/"above" existed.
function testTierCondition(operator, threshold, value) {
  switch (operator) {
    case 'below':
      return value < threshold
    case 'equal':
      return value === threshold
    case 'above':
      return value > threshold
    case 'from':
    default:
      return value >= threshold
  }
}

function tierConditionExpr(operator, baseKey, threshold) {
  switch (operator) {
    case 'below':
      return `${baseKey} < ${threshold}`
    case 'equal':
      return `${baseKey} === ${threshold}`
    case 'above':
      return `${baseKey} > ${threshold}`
    case 'from':
    default:
      return `${baseKey} >= ${threshold}`
  }
}

function tierConditionText(operator, threshold, decimals) {
  const t = formatNum(threshold, decimals)
  switch (operator) {
    case 'below':
      return `below ${t}`
    case 'equal':
      return `equal to ${t}`
    case 'above':
      return `above ${t}`
    case 'from':
    default:
      return `${t} or above`
  }
}

// At an identical threshold, more than one operator can be true for the
// same value (e.g. "equal to 50,000" and "from 50,000" both match exactly
// 50,000). Tie-break so the more specific comparison wins: an exact "equal"
// tier beats a general "from"/"above" one, and "above"/"below" never
// actually overlap with each other so their relative order doesn't matter.
const OPERATOR_TIE_PRIORITY = { equal: 0, above: 1, below: 1, from: 2 }

// Tiers can be entered in any order / with any thresholds. To pick which
// tier applies to a given value unambiguously, tiers are evaluated
// highest-threshold-first, then by the tie-break priority above.
export function resolvePriorityOrder(tiers) {
  return [...tiers].sort((a, b) => {
    const ta = Number(a.threshold) || 0
    const tb = Number(b.threshold) || 0
    if (tb !== ta) return tb - ta
    return (OPERATOR_TIE_PRIORITY[a.operator] ?? 3) - (OPERATOR_TIE_PRIORITY[b.operator] ?? 3)
  })
}

// Finds the single tier that applies to a given numeric value, using the
// same priority order the compiled expression encodes.
export function resolveMatchedTier(tiers, value) {
  const ordered = resolvePriorityOrder(tiers)
  for (const tier of ordered) {
    const threshold = Number(tier.threshold) || 0
    if (testTierCondition(tier.operator, threshold, value)) return tier
  }
  return null
}

// Compiles { baseKey, tiers, cap } into a plain JS-like expression, e.g.
// "(Math.min(basicSalary, 29710)) * (basicSalary >= 0 ? 0.01 : 0)"
export function compileTieredFormula({ baseKey, tiers, cap }) {
  const ordered = resolvePriorityOrder(tiers)
  let rateExpr = '0'
  for (let i = ordered.length - 1; i >= 0; i--) {
    const tier = ordered[i]
    const threshold = Number(tier.threshold) || 0
    const rate = (Number(tier.rate) || 0) / 100
    const cond = tierConditionExpr(tier.operator, baseKey, threshold)
    rateExpr = `${cond} ? ${rate} : ${rateExpr}`
  }
  const hasCap = cap !== null && cap !== undefined && cap !== ''
  const valueExpr = hasCap ? `Math.min(${baseKey}, ${Number(cap)})` : baseKey
  return `(${valueExpr}) * (${rateExpr})`
}

// Live, rule-level plain-language summary shown above the builder as the
// user fills it in, e.g.
// "If Basic Salary is below 50,000, apply 3%. If Basic Salary is equal to
//  0, apply 0%. If Basic Salary is above 50,000, apply 6%." or, for a
// single flat-rate + cap rule:
// "1% of Basic Salary, up to a maximum of 29,710."
export function describeTieredRule(baseName, tiers, cap) {
  const validTiers = tiers.filter((t) => t.threshold !== '' && t.rate !== '')
  if (validTiers.length === 0) return 'Add at least one tier to see a summary.'

  const hasCap = cap !== null && cap !== undefined && cap !== ''

  if (validTiers.length === 1 && hasCap) {
    return `${validTiers[0].rate || 0}% of ${baseName}, up to a maximum of ${formatNum(cap)}.`
  }

  const ascending = [...validTiers].sort((a, b) => (Number(a.threshold) || 0) - (Number(b.threshold) || 0))
  const sentence = ascending
    .map((t) => `If ${baseName} is ${tierConditionText(t.operator, t.threshold)}, apply ${t.rate || 0}%.`)
    .join(' ')

  return hasCap ? `${sentence} Capped at a maximum ${baseName} value of ${formatNum(cap)}.` : sentence
}

// Per-employee plain-language explanation of a computed tiered result, for
// the calculation breakdown view. Derived purely from the tier/cap
// structure and the resolved values - no per-deduction hardcoding.
// baseDecimals/resultDecimals are the BASE column's and THIS formula
// column's own configured decimal places, respectively, so each value in
// the sentence rounds to its own column's setting.
export function buildTieredExplanation(tieredConfig, baseValue, baseName, resultValue, baseDecimals = 2, resultDecimals = 2) {
  const { tiers, cap } = tieredConfig
  const matched = resolveMatchedTier(tiers, baseValue)
  const hasCap = cap !== null && cap !== undefined && cap !== ''
  const isCapped = hasCap && baseValue > Number(cap)
  const appliedValue = isCapped ? Number(cap) : baseValue
  const rate = matched ? Number(matched.rate) || 0 : 0

  const parts = [`${baseName}: ${formatNum(baseValue, baseDecimals)}.`]

  if (tiers.length > 1 && matched) {
    parts.push(`This is ${tierConditionText(matched.operator, matched.threshold, baseDecimals)} → rate: ${rate}%.`)
  }

  if (isCapped) {
    parts.push(
      `Capped at ${formatNum(cap, baseDecimals)} → ${formatNum(appliedValue, baseDecimals)} × ${rate}% = ${formatNum(resultValue, resultDecimals)}.`
    )
  } else {
    parts.push(`${formatNum(appliedValue, baseDecimals)} × ${rate}% = ${formatNum(resultValue, resultDecimals)}.`)
  }

  return {
    sentence: parts.join(' '),
    baseName,
    baseValue,
    matchedTier: matched,
    isCapped,
    cap: hasCap ? Number(cap) : null,
    appliedValue,
    rate,
    resultValue,
  }
}

// --- "Compare Two Columns" tiered sub-mode -------------------------------
//
// A different (simpler) rule shape than threshold tiers: two columns
// compared directly against each other, with a custom result expression per
// branch. Result expressions are free text using the literal placeholders
// "Column A" / "Column B", substituted with real column keys at compile
// time and with real column names/values for the live summary and
// breakdown explanation. Still compiles to the exact same ternary
// expression format as every other formula.

const COMPARE_OPERATOR_LABELS = {
  '>': 'Greater than (>)',
  '<': 'Less than (<)',
  '>=': 'Greater than or equal to (>=)',
  '<=': 'Less than or equal to (<=)',
  '==': 'Equal to (==)',
}

export const COMPARE_OPERATORS = Object.keys(COMPARE_OPERATOR_LABELS)

export function compareOperatorLabel(operator) {
  return COMPARE_OPERATOR_LABELS[operator] ?? operator
}

const COMPARE_OPERATOR_PHRASES = {
  '>': 'greater than',
  '<': 'less than',
  '>=': 'greater than or equal to',
  '<=': 'less than or equal to',
  '==': 'equal to',
}

function testCompareCondition(operator, a, b) {
  switch (operator) {
    case '>':
      return a > b
    case '<':
      return a < b
    case '>=':
      return a >= b
    case '<=':
      return a <= b
    case '==':
    default:
      return a === b
  }
}

// Replaces the literal placeholders "Column A" / "Column B" in a
// user-typed result expression with real column keys (for compiling) or
// real column names/values (for display). Anything else the user typed
// (numbers, operators, or even other column keys) passes through as-is.
function substitutePlaceholders(expr, aReplacement, bReplacement) {
  return String(expr ?? '').replace(/Column A/g, aReplacement).replace(/Column B/g, bReplacement)
}

// Cosmetic-only: renders arithmetic operators the way a person would write
// them in a sentence (an en-dash-style minus, multiplication/division
// signs), for the live summary and breakdown - never used for the actual
// compiled expression.
function prettifyOperatorsForDisplay(s) {
  return String(s)
    .replace(/\s*-\s*/g, ' − ')
    .replace(/\s*\*\s*/g, ' × ')
    .replace(/\s*\/\s*/g, ' ÷ ')
    .trim()
}

// Compiles { columnAKey, operator, columnBKey, trueExpr, falseExpr } into a
// plain ternary expression, e.g. "(edf > emoluments) ? (0) : (emoluments - edf)".
export function compileCompareFormula({ columnAKey, operator, columnBKey, trueExpr, falseExpr }) {
  const jsOperator = operator === '==' ? '===' : operator
  const cond = `${columnAKey} ${jsOperator} ${columnBKey}`
  const trueCompiled = substitutePlaceholders(trueExpr, columnAKey, columnBKey).trim() || '0'
  const falseCompiled = substitutePlaceholders(falseExpr, columnAKey, columnBKey).trim() || '0'
  return `(${cond}) ? (${trueCompiled}) : (${falseCompiled})`
}

// Live, rule-level plain-language summary, e.g.
// "If EDF is greater than Emoluments, use 0. Otherwise, use Emoluments − EDF."
export function describeCompareRule(columnAName, columnBName, operator, trueExpr, falseExpr) {
  const opPhrase = COMPARE_OPERATOR_PHRASES[operator] ?? operator
  const trueDisplay = prettifyOperatorsForDisplay(substitutePlaceholders(trueExpr || '0', columnAName, columnBName))
  const falseDisplay = prettifyOperatorsForDisplay(substitutePlaceholders(falseExpr || '0', columnAName, columnBName))
  return `If ${columnAName} is ${opPhrase} ${columnBName}, use ${trueDisplay}. Otherwise, use ${falseDisplay}.`
}

// Per-employee plain-language explanation of a computed "compare two
// columns" result, for the breakdown view, e.g.
// "EDF: 9,000. Emoluments: 18,750. 9,000 is not greater than 18,750 →
//  18,750 − 9,000 = 9,750."
export function buildCompareExplanation(
  compareConfig,
  columnAName,
  columnBName,
  valueA,
  valueB,
  resultValue,
  aDecimals = 2,
  bDecimals = 2,
  resultDecimals = 2
) {
  const { operator, trueExpr, falseExpr } = compareConfig
  const conditionMet = testCompareCondition(operator, valueA, valueB)
  const opPhrase = COMPARE_OPERATOR_PHRASES[operator] ?? operator
  const chosenExpr = conditionMet ? trueExpr : falseExpr

  const formattedA = formatNum(valueA, aDecimals)
  const formattedB = formatNum(valueB, bDecimals)
  const substituted = prettifyOperatorsForDisplay(substitutePlaceholders(chosenExpr || '0', formattedA, formattedB))

  const sentence = [
    `${columnAName}: ${formattedA}.`,
    `${columnBName}: ${formattedB}.`,
    `${formattedA} is ${conditionMet ? '' : 'not '}${opPhrase} ${formattedB} → ${substituted} = ${formatNum(resultValue, resultDecimals)}.`,
  ].join(' ')

  return {
    sentence,
    columnAName,
    columnBName,
    valueA,
    valueB,
    conditionMet,
    resultValue,
  }
}
