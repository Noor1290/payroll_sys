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

// The order tiers were evaluated in before October 2026: highest threshold
// first, then by the tie-break priority above. Kept for columns saved with
// it (see outdatedRules.js).
function priorityOrderBeforeFix(tiers) {
  return [...tiers].sort((a, b) => {
    const ta = Number(a.threshold) || 0
    const tb = Number(b.threshold) || 0
    if (tb !== ta) return tb - ta
    return (OPERATOR_TIE_PRIORITY[a.operator] ?? 3) - (OPERATOR_TIE_PRIORITY[b.operator] ?? 3)
  })
}

// Tiers can be entered in any order / with any thresholds. To pick which
// tier applies to a given value unambiguously, tiers are evaluated
// highest-threshold-first, then by the tie-break priority above - except
// that among "Below" tiers the narrowest (lowest threshold) is evaluated
// first: "Below 50,000" and "Below 100,000" both hold for 30,000, and the
// narrower one is meant. The "Below" tiers keep the places the other order
// gave them, so nothing changes for a rule with one "Below" tier.
export function resolvePriorityOrder(tiers) {
  const ordered = priorityOrderBeforeFix(tiers)
  const belowAscending = ordered.filter((t) => t.operator === 'below').sort((a, b) => (Number(a.threshold) || 0) - (Number(b.threshold) || 0))
  let next = 0
  return ordered.map((t) => (t.operator === 'below' ? belowAscending[next++] : t))
}

function matchInOrder(ordered, value) {
  for (const tier of ordered) {
    const threshold = Number(tier.threshold) || 0
    if (testTierCondition(tier.operator, threshold, value)) return tier
  }
  return null
}

// Finds the single tier that applies to a given numeric value, using the
// same priority order the compiled expression encodes.
export function resolveMatchedTier(tiers, value) {
  return matchInOrder(resolvePriorityOrder(tiers), value)
}

const hasCapValue = (cap) => cap !== null && cap !== undefined && cap !== ''

// A rate in percent as the fraction written into the formula, without the
// float noise of the division: 1.1% is 0.011, not 0.011000000000000001.
const rateFraction = (rate) => Number(((Number(rate) || 0) / 100).toPrecision(12))

// A single "From 0" (or lower) tier + a cap is the "flat rate up to a
// maximum" shape (e.g. "1% of Gross Pay, up to a maximum of 29,710" - see
// describeTieredRule's matching special case, and the Cap checkbox's own
// label: "apply the rate to a maximum of..."). Its condition holds for any
// figure from 0 up, so the rate always applies; only the BASE is capped.
// Any other single tier keeps its condition, tested on the real (uncapped)
// base like every tiered rule: "Above 10,000 at 1%, capped at 29,710" is 0
// for 5,000.
function isFlatRateWithCap(tiers, cap) {
  return tiers.length === 1 && hasCapValue(cap) && (tiers[0].operator ?? 'from') === 'from' && (Number(tiers[0].threshold) || 0) <= 0
}

// Compiles { baseKey, tiers, cap } into a plain JS-like expression, e.g.
// "(Math.min(basicSalary, 29710)) * (basicSalary >= 0 ? 0.01 : 0)"
export function compileTieredFormula({ baseKey, tiers, cap }) {
  const valueExpr = hasCapValue(cap) ? `Math.min(${baseKey}, ${Number(cap)})` : baseKey
  if (isFlatRateWithCap(tiers, cap)) return `(${valueExpr}) * (${rateFraction(tiers[0].rate)})`

  const ordered = resolvePriorityOrder(tiers)
  let rateExpr = '0'
  for (let i = ordered.length - 1; i >= 0; i--) {
    const tier = ordered[i]
    const threshold = Number(tier.threshold) || 0
    const cond = tierConditionExpr(tier.operator, baseKey, threshold)
    rateExpr = `${cond} ? ${rateFraction(tier.rate)} : ${rateExpr}`
  }
  return `(${valueExpr}) * (${rateExpr})`
}

// The formula as compiled before October 2026, exactly: the old order, the
// cap ignoring a single tier's condition, and the rate as divided. Only to
// recognise a column still saved with it (see outdatedRules.js).
export function compileTieredFormulaBeforeFix({ baseKey, tiers, cap }) {
  const hasCap = hasCapValue(cap)
  const valueExpr = hasCap ? `Math.min(${baseKey}, ${Number(cap)})` : baseKey
  if (tiers.length === 1 && hasCap) return `(${valueExpr}) * (${(Number(tiers[0].rate) || 0) / 100})`

  const ordered = priorityOrderBeforeFix(tiers)
  let rateExpr = '0'
  for (let i = ordered.length - 1; i >= 0; i--) {
    const tier = ordered[i]
    const threshold = Number(tier.threshold) || 0
    const rate = (Number(tier.rate) || 0) / 100
    rateExpr = `${tierConditionExpr(tier.operator, baseKey, threshold)} ? ${rate} : ${rateExpr}`
  }
  return `(${valueExpr}) * (${rateExpr})`
}

// Which of the two old rules gives this rule other figures than the rule
// now: 'below' (two or more "Below" tiers, with different thresholds and
// rates), 'cap' (one tier with a cap, other than "From 0"), or null.
export function oldRuleShape({ tiers, cap }) {
  const below = tiers.filter((t) => t.operator === 'below')
  const differ = (pick) => new Set(below.map((t) => Number(pick(t)) || 0)).size > 1
  if (differ((t) => t.threshold) && differ((t) => t.rate)) return 'below'
  if (tiers.length === 1 && hasCapValue(cap) && !isFlatRateWithCap(tiers, cap)) return 'cap'
  return null
}

// Thresholds that no tier covers although tiers apply just below and just
// above them, e.g. exactly 50,000 with "Below 50,000" + "Above 50,000".
function uncoveredThresholds(tiers) {
  const thresholds = [...new Set(tiers.map((t) => Number(t.threshold) || 0))].sort((a, b) => a - b)
  return thresholds.filter(
    (t) => !resolveMatchedTier(tiers, t) && resolveMatchedTier(tiers, t - 0.005) && resolveMatchedTier(tiers, t + 0.005)
  )
}

// A cap that cuts off the tier: with a cap, the tiers give 0% to every figure
// from some point up, though a lower figure gets a rate, so the cap never
// limits anything. Most often "Below X" meant "From 0" with the cap at X:
// "Below 29,710 at 1%" + a cap of 29,710 gives 0 to anyone on 29,710 or more.
// Returns { at, inclusive, tierCount } (0% for every figure from `at` up, `at`
// itself included or not), or null. Not blocked on save: it may be meant.
export function tierStopsBeforeCap({ tiers, cap }) {
  if (!hasCapValue(cap) || tiers.length === 0 || isFlatRateWithCap(tiers, cap)) return null
  const rateAt = (value) => Number(resolveMatchedTier(tiers, value)?.rate) || 0
  const thresholds = [...new Set(tiers.map((t) => Number(t.threshold) || 0))].sort((a, b) => b - a)

  // From the top down: the stretch above each threshold, then the threshold itself.
  let from = null
  for (let i = 0; i < thresholds.length; i++) {
    const t = thresholds[i]
    const above = i === 0 ? t + 1 : (t + thresholds[i - 1]) / 2
    if (rateAt(above) !== 0) break
    from = { at: t, inclusive: false }
    if (rateAt(t) !== 0) break
    from = { at: t, inclusive: true }
    if (i === thresholds.length - 1 && rateAt(t - 1) === 0) return null // 0% everywhere
  }
  // Only when some figure from 0 up, below that point, gets a rate.
  return from && from.at > 0 ? { ...from, tierCount: tiers.length } : null
}

// "Anyone with Gross Pay of 29,710 or more gets 0%, because the tier stops at 29,710."
export function describeTierStop(baseName, stop) {
  const who = stop.inclusive ? `of ${formatNum(stop.at)} or more` : `above ${formatNum(stop.at)}`
  return `Anyone with ${baseName} ${who} gets 0%, because the ${stop.tierCount === 1 ? 'tier stops' : 'tiers stop'} at ${formatNum(stop.at)}.`
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

  const hasCap = hasCapValue(cap)

  if (isFlatRateWithCap(validTiers, cap)) {
    return `${validTiers[0].rate || 0}% of ${baseName}, up to a maximum of ${formatNum(cap)}.`
  }

  const ascending = [...validTiers].sort((a, b) => (Number(a.threshold) || 0) - (Number(b.threshold) || 0))
  const sentences = ascending.map((t) => `If ${baseName} is ${tierConditionText(t.operator, t.threshold)}, apply ${t.rate || 0}%.`)
  for (const t of uncoveredThresholds(validTiers)) sentences.push(`Exactly ${formatNum(t)} matches no tier, so the rate there is 0%.`)
  if (hasCap) sentences.push(`Capped at a maximum ${baseName} value of ${formatNum(cap)}.`)
  return sentences.join(' ')
}

// Per-employee plain-language explanation of a computed tiered result, for
// the calculation breakdown view. Derived purely from the tier/cap
// structure and the resolved values - no per-deduction hardcoding.
// baseDecimals/resultDecimals are the BASE column's and THIS formula
// column's own configured decimal places, respectively, so each value in
// the sentence rounds to its own column's setting.
//
// beforeFix: the column is still saved with the formula of the old rule
// (see outdatedRules.js), so it is explained by that rule, the one its
// figure comes from.
export function buildTieredExplanation(tieredConfig, baseValue, baseName, resultValue, baseDecimals = 2, resultDecimals = 2, beforeFix = false) {
  const { tiers, cap } = tieredConfig
  const hasCap = hasCapValue(cap)
  // Mirrors compileTieredFormula's own special case: a flat rate + a cap
  // always applies that tier's rate (the cap only limits the base), so the
  // breakdown must resolve the rate the same way the compiled expression
  // actually did, not via the normal below/above tier lookup.
  const flat = beforeFix ? tiers.length === 1 && hasCap : isFlatRateWithCap(tiers, cap)
  const matched = flat ? tiers[0] : matchInOrder(beforeFix ? priorityOrderBeforeFix(tiers) : resolvePriorityOrder(tiers), baseValue)
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
