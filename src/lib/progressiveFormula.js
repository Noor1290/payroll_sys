// Compiles a visually-built "progressive brackets" rule (a base column and
// N brackets, each taxing only the PORTION of the value that falls within
// it - like PAYE income tax) into the same plain expression string format
// used by "Simple" mode formulas, so the calculation engine, dependency
// resolution, and circular-reference checks never need to know progressive
// rules exist at all. This is deliberately a different shape from
// Tiered/Conditional: tiered rules pick ONE rate for the whole value based
// on which threshold it falls into, while progressive brackets apply a
// DIFFERENT rate to each slice of the value and sum the results.
//
// Bracket shape: { width, rate }. Every bracket except the last defines its
// own width (added on top of the previous bracket's cumulative ceiling);
// the last bracket is always open-ended (its width is ignored) and taxes
// everything above the previous ceiling - "Remainder".

import { formatNum } from './tieredFormula'

// Walks brackets computing each one's [floor, ceiling) and rate, calling
// back with everything needed to build an expression, a summary line, or a
// breakdown line - so the three derived views can never disagree about
// which numbers belong to which bracket.
function walkBrackets(brackets, fn) {
  let floor = 0
  brackets.forEach((b, i) => {
    const isLast = i === brackets.length - 1
    const rate = Number(b.rate) || 0
    if (isLast) {
      fn({ index: i, isLast, floor, ceiling: null, width: null, rate })
      return
    }
    const width = Number(b.width) || 0
    const ceiling = floor + width
    fn({ index: i, isLast, floor, ceiling, width, rate })
    floor = ceiling
  })
}

// Compiles { baseKey, brackets } into a plain JS-like expression, e.g.
// "(Math.max(0, Math.min(income, 38000) - 0)) * 0 + (Math.max(0, Math.min(income, 76000) - 38000)) * 0.1 + (Math.max(0, income - 76000)) * 0.2"
export function compileProgressiveFormula({ baseKey, brackets }) {
  const terms = []
  walkBrackets(brackets, ({ isLast, floor, ceiling, rate }) => {
    const rateFraction = rate / 100
    const portionExpr = isLast
      ? `Math.max(0, ${baseKey} - ${floor})`
      : `Math.max(0, Math.min(${baseKey}, ${ceiling}) - ${floor})`
    terms.push(`(${portionExpr}) * ${rateFraction}`)
  })
  return terms.join(' + ')
}

function bracketLabel({ index, isLast, floor, ceiling, width }) {
  if (isLast) return 'Remainder'
  return index === 0 ? `First ${formatNum(width)}` : `Next ${formatNum(width)} (${formatNum(floor)}–${formatNum(ceiling)})`
}

// Live, rule-level plain-language summary shown above the builder as the
// user fills it in, e.g.
// "First 38,000 taxed at 0%. Next 38,000 (38,000–76,000) taxed at 10%.
//  Remainder above 76,000 taxed at 20%."
export function describeProgressiveRule(brackets) {
  const validBrackets = brackets.filter((b) => b.rate !== '')
  if (validBrackets.length === 0) return 'Add at least one bracket to see a summary.'

  const parts = []
  walkBrackets(brackets, (info) => {
    const label = bracketLabel(info)
    parts.push(info.isLast ? `${label} above ${formatNum(info.floor)} taxed at ${info.rate}%.` : `${label} taxed at ${info.rate}%.`)
  })
  return parts.join(' ')
}

// Per-employee plain-language explanation of a computed progressive-bracket
// result, for the calculation breakdown view, e.g.
// "Taxable Income: 100,000. First 38,000 @ 0% = 0. Next 38,000
//  (38,000–76,000) @ 10% = 3,800. Remainder (24,000 above 76,000) @ 20% =
//  4,800. Total: 8,600."
// Generic over any number of brackets - nothing here is PAYE-specific.
export function buildProgressiveExplanation(progressiveConfig, baseValue, baseName, resultValue, baseDecimals = 2, resultDecimals = 2) {
  const { brackets } = progressiveConfig
  const parts = [`${baseName}: ${formatNum(baseValue, baseDecimals)}.`]
  const bracketResults = []

  walkBrackets(brackets, (info) => {
    const { isLast, floor, ceiling, width, rate } = info
    const portion = isLast ? Math.max(0, baseValue - floor) : Math.max(0, Math.min(baseValue, ceiling) - floor)
    const amount = portion * (rate / 100)
    const label = isLast
      ? `Remainder (${formatNum(portion, baseDecimals)} above ${formatNum(floor, baseDecimals)})`
      : bracketLabel(info)

    parts.push(`${label} @ ${rate}% = ${formatNum(amount, resultDecimals)}.`)
    bracketResults.push({ index: info.index, floor, ceiling, width, rate, portion, amount })
  })

  parts.push(`Total: ${formatNum(resultValue, resultDecimals)}.`)

  return {
    sentence: parts.join(' '),
    baseName,
    baseValue,
    brackets: bracketResults,
    resultValue,
  }
}
