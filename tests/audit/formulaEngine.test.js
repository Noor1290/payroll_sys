// Audit, part 1: the formula engine, against values worked out by hand.
// TEST data only.
//
// A test marked `test.fails` records a bug: it states what SHOULD happen, and
// passes only while the app still gets it wrong. When the bug is fixed the
// test starts failing, which is the cue to remove the `.fails` marker.

import { describe, expect, test } from 'vitest'
import { getColumnsByKey } from '../../src/lib/model'
import {
  validateFormulaSyntax,
  detectCircularReference,
  computeCell,
  computeGridForEmployees,
} from '../../src/lib/formulaEngine'
import { formatDecimal, roundHalfUp } from '../../src/lib/format'
import { compileTieredFormula, compileTieredFormulaBeforeFix, describeTieredRule, resolveMatchedTier } from '../../src/lib/tieredFormula'
import { OUTDATED_RULE_NOTES, outdatedTieredRule } from '../../src/lib/outdatedRules'
import { compileExemptionWrapper } from '../../src/lib/exemptionCondition'
import { input, simple, tiered, compare, progressive, checkboxExemption, computeValues, computeRow } from './build'

const basic = () => input('Basic Salary', 'basicSalary')
const incr = () => input('Govt Increment', 'govtIncrement')
const newBasic = () => simple('New Basic', 'newBasic', 'basicSalary + govtIncrement')

function thresholdColumn(tiers, cap = null) {
  return tiered('Rule', 'rule', { baseKey: 'basicSalary', tiers, cap })
}

function ruleAt(column, value) {
  return computeValues([basic(), column], { basicSalary: String(value) }).rule
}

describe('simple and chained formulas', () => {
  test('a simple formula adds two input columns', () => {
    const v = computeValues([basic(), incr(), newBasic()], { basicSalary: '18115', govtIncrement: '635' })
    expect(v.newBasic).toBe(18750)
  })

  test('a formula that uses a formula that uses a formula', () => {
    const columns = [
      basic(),
      incr(),
      newBasic(),
      input('Allowances', 'allowances'),
      simple('Emoluments', 'emoluments', 'newBasic + allowances'),
      simple('CSG', 'csg', 'emoluments * 0.015'),
      simple('NSF', 'nsf', 'emoluments * 0.01'),
      simple('Deductions', 'deductions', 'csg + nsf'),
      simple('Net', 'net', 'emoluments - deductions'),
    ]
    const v = computeValues(columns, { basicSalary: '18115', govtIncrement: '635', allowances: '1250' })
    // 18,750 + 1,250 = 20,000; 1.5% = 300; 1% = 200; net = 19,500
    expect(v.emoluments).toBe(20000)
    expect(v.csg).toBe(300)
    expect(v.nsf).toBe(200)
    expect(v.deductions).toBe(500)
    expect(v.net).toBe(19500)
  })

  test('column order does not matter: a formula can use a column defined after it', () => {
    const v = computeValues([simple('Net', 'net', 'newBasic - 100'), newBasic(), incr(), basic()], { basicSalary: '1000', govtIncrement: '50' })
    expect(v.net).toBe(950)
  })

  test('blank and non-numeric input counts as 0 in a formula', () => {
    expect(computeValues([basic(), incr(), newBasic()], { basicSalary: 'abc', govtIncrement: '' }).newBasic).toBe(0)
    expect(computeValues([basic(), incr(), newBasic()], {}).newBasic).toBe(0)
  })

  test('the regression example: Basic 18,115 + Govt Increment 635', () => {
    const columns = [
      basic(),
      incr(),
      newBasic(),
      input('Age 60+', 'age60', { valueType: 'checkbox' }),
      tiered('CSG', 'csg', { baseKey: 'newBasic', tiers: [{ operator: 'below', threshold: 50001, rate: 1.5 }, { operator: 'above', threshold: 50000, rate: 3 }], cap: null }),
      tiered('NSF', 'nsf', { baseKey: 'newBasic', tiers: [{ operator: 'from', threshold: 0, rate: 1 }], cap: 29710 }, { exemption: checkboxExemption('age60') }),
    ]
    const v = computeValues(columns, { basicSalary: '18115', govtIncrement: '635', age60: false })
    expect(v.newBasic).toBe(18750)
    expect(v.csg).toBe(281.25)
    expect(v.nsf).toBe(187.5)
  })
})

describe('circular references', () => {
  const columnsByKey = () =>
    getColumnsByKey([basic(), simple('A', 'a', 'b + 1'), simple('B', 'b', 'c + 1'), simple('C', 'c', 'basicSalary + 1')])

  test('saving a formula that closes a loop is flagged, with the path', () => {
    const result = detectCircularReference('c', 'a + 1', columnsByKey())
    expect(result.hasCycle).toBe(true)
    expect(result.cyclePath).toEqual(['c', 'a', 'b', 'c'])
  })

  test('a formula that refers to itself is flagged', () => {
    expect(detectCircularReference('c', 'c + 1', columnsByKey()).hasCycle).toBe(true)
  })

  test('a formula that does not close a loop is not flagged', () => {
    expect(detectCircularReference('c', 'basicSalary * 2', columnsByKey()).hasCycle).toBe(false)
  })

  test('a loop already in the saved data gives an error cell, not a crash', () => {
    const columns = [simple('A', 'a', 'b + 1'), simple('B', 'b', 'a + 1')]
    const row = computeRow(columns, {})
    expect(Number.isNaN(row.a.value)).toBe(true)
    expect(JSON.stringify(row.a.trace)).toContain('Circular reference detected')
  })
})

describe('invalid formulas are rejected on save', () => {
  const keys = ['basicSalary', 'govtIncrement']

  test.each([
    ['empty', '', 'Formula cannot be empty'],
    ['only spaces', '   ', 'Formula cannot be empty'],
    ['dangling operator', 'basicSalary +', 'Syntax error'],
    ['unbalanced bracket', '(basicSalary * 2', 'Syntax error'],
    ['two operators', 'basicSalary * / 2', 'Syntax error'],
    ['unknown column', 'basicSalary + bonus', 'Unknown column reference: bonus'],
    ['a column name instead of its key', 'Basic Salary * 2', 'Unknown column reference'],
    ['a function call that is not allowed', 'alert(1)', 'Unknown column reference: alert'],
  ])('%s', (_label, expr, message) => {
    const result = validateFormulaSyntax(expr, keys)
    expect(result.valid).toBe(false)
    expect(result.error).toContain(message)
  })

  test('a valid formula is accepted and its dependencies listed', () => {
    const result = validateFormulaSyntax('Math.min(basicSalary, 29710) * 0.01 + govtIncrement', keys)
    expect(result).toEqual({ valid: true, error: null, dependencies: ['basicSalary', 'govtIncrement'] })
  })

  // Were audit bugs (report M3): both were accepted on save, but can never
  // produce a number.
  test('"min(basicSalary, 5)" is not accepted on save, since it always errors', () => {
    const expr = 'min(basicSalary, 5)'
    const accepted = validateFormulaSyntax(expr, keys).valid
    const row = computeRow([basic(), simple('X', 'x', expr)], { basicSalary: '10' })
    // Either it is rejected on save, or it works.
    expect(accepted && row.x.trace.error !== undefined).toBe(false)
  })

  test('a comparison such as "basicSalary > 5" is not accepted on save, since it always errors', () => {
    const expr = 'basicSalary > 5'
    const accepted = validateFormulaSyntax(expr, keys).valid
    const row = computeRow([basic(), simple('X', 'x', expr)], { basicSalary: '10' })
    expect(accepted && row.x.trace.error !== undefined).toBe(false)
  })

  test.each([
    ['a bare "min"', 'min(basicSalary, 5)', "This formula can't be saved:\nUnknown column reference: min\nDid you mean Math.min, Math.max or Math.round?"],
    ['a bare "round"', 'round(basicSalary)', "This formula can't be saved:\nUnknown column reference: round\nDid you mean Math.min, Math.max or Math.round?"],
    ['a bare "floor"', 'floor(basicSalary)', "This formula can't be saved:\nUnknown column reference: floor"],
    [
      'a comparison on its own',
      'basicSalary > 5',
      "This formula can't be saved:\nFormula did not return a number (got boolean)\nThe formula must give a number. For a yes/no rule, use a condition such as (x > 5 ? 1 : 0).",
    ],
    ['a Math function that does not exist', 'Math.minimum(basicSalary, 5)', "This formula can't be saved:\nMath.minimum is not a function"],
    // A name that is not a Math function keeps the message it always had.
    ['an unknown column', 'basicSalry * 2', 'Unknown column reference: basicSalry'],
  ])('%s is refused with the message the cell would show', (_label, expr, message) => {
    expect(validateFormulaSyntax(expr, keys)).toEqual({ valid: false, error: message, dependencies: [] })
  })

  test.each([
    ['Math.min(basicSalary, 5)'],
    ['basicSalary > 5 ? 100 : 0'],
    ['(basicSalary > 5) * 100'],
    // Divides by zero at 1 - 1, but not for every employee: left to the cells.
    ['basicSalary / (govtIncrement - 1)'],
  ])('"%s" is still accepted', (expr) => {
    expect(validateFormulaSyntax(expr, keys).valid).toBe(true)
  })
})

describe('division by zero', () => {
  const columns = () => [basic(), incr(), simple('Ratio', 'ratio', 'basicSalary / govtIncrement')]

  test('0 / 0 is an error, not "NaN" shown as a figure', () => {
    const row = computeRow(columns(), { basicSalary: '0', govtIncrement: '0' })
    expect(row.ratio.trace.error).toBe('The calculation has no result (for example 0 divided by 0)')
    expect(Number.isNaN(row.ratio.value)).toBe(true)
  })

  test('100 / 0 is an error, not an infinity sign shown as a figure', () => {
    const row = computeRow(columns(), { basicSalary: '100', govtIncrement: '0' })
    expect(row.ratio.trace.error).toBe('Division by zero')
    expect(Number.isNaN(row.ratio.value)).toBe(true)
  })

  test('a division that works is unaffected', () => {
    const row = computeRow(columns(), { basicSalary: '100', govtIncrement: '8' })
    expect(row.ratio.trace.error).toBeUndefined()
    expect(row.ratio.value).toBe(12.5)
  })
})

describe('tiered rules at and around a threshold', () => {
  test('Below 50,000 at 3%', () => {
    const column = thresholdColumn([{ operator: 'below', threshold: 50000, rate: 3 }])
    expect(ruleAt(column, 49999)).toBeCloseTo(1499.97, 10)
    expect(ruleAt(column, 50000)).toBe(0)
    expect(ruleAt(column, 50001)).toBe(0)
  })

  test('Equal to 50,000 at 4%', () => {
    const column = thresholdColumn([{ operator: 'equal', threshold: 50000, rate: 4 }])
    expect(ruleAt(column, 49999)).toBe(0)
    expect(ruleAt(column, 50000)).toBe(2000)
    expect(ruleAt(column, 50001)).toBe(0)
  })

  test('Above 50,000 at 6%', () => {
    const column = thresholdColumn([{ operator: 'above', threshold: 50000, rate: 6 }])
    expect(ruleAt(column, 49999)).toBe(0)
    expect(ruleAt(column, 50000)).toBe(0)
    expect(ruleAt(column, 50001)).toBeCloseTo(3000.06, 10)
  })

  test('From 50,000 at 5%', () => {
    const column = thresholdColumn([{ operator: 'from', threshold: 50000, rate: 5 }])
    expect(ruleAt(column, 49999)).toBe(0)
    expect(ruleAt(column, 50000)).toBe(2500)
    expect(ruleAt(column, 50001)).toBeCloseTo(2500.05, 10)
  })

  test('Below / Equal to / Above together at one threshold', () => {
    const column = thresholdColumn([
      { operator: 'below', threshold: 50000, rate: 3 },
      { operator: 'equal', threshold: 50000, rate: 4 },
      { operator: 'above', threshold: 50000, rate: 6 },
    ])
    expect(ruleAt(column, 49999)).toBeCloseTo(1499.97, 10)
    expect(ruleAt(column, 50000)).toBe(2000)
    expect(ruleAt(column, 50001)).toBeCloseTo(3000.06, 10)
  })

  test('"Equal to" wins over "From" at the same threshold', () => {
    const column = thresholdColumn([
      { operator: 'from', threshold: 50000, rate: 5 },
      { operator: 'equal', threshold: 50000, rate: 4 },
    ])
    expect(ruleAt(column, 50000)).toBe(2000)
    expect(ruleAt(column, 50001)).toBeCloseTo(2500.05, 10)
  })

  test('Below + From: the usual two-rate rule has no gap', () => {
    const column = thresholdColumn([
      { operator: 'below', threshold: 50000, rate: 1.5 },
      { operator: 'from', threshold: 50000, rate: 3 },
    ])
    expect(ruleAt(column, 49999)).toBeCloseTo(749.985, 10)
    expect(ruleAt(column, 50000)).toBe(1500)
    expect(ruleAt(column, 50001)).toBeCloseTo(1500.03, 10)
  })

  // Exactly 50,000 falls through "Below 50,000" + "Above 50,000" and gets 0.
  // That is the rule as entered; until report L2 nothing said so.
  test('Below + Above at the same threshold leaves the threshold itself at 0, and the rule summary says so', () => {
    const tiers = [
      { operator: 'below', threshold: 50000, rate: 1.5 },
      { operator: 'above', threshold: 50000, rate: 3 },
    ]
    expect(ruleAt(thresholdColumn(tiers), 50000)).toBe(0)
    expect(describeTieredRule('Basic Salary', tiers, null)).toBe(
      'If Basic Salary is below 50,000, apply 1.5%. If Basic Salary is above 50,000, apply 3%. Exactly 50,000 matches no tier, so the rate there is 0%.'
    )
  })

  test('the summary says nothing more where the threshold is covered, or where nothing applies on one side', () => {
    const covered = [
      { operator: 'below', threshold: 50000, rate: 1.5 },
      { operator: 'from', threshold: 50000, rate: 3 },
    ]
    expect(describeTieredRule('Basic Salary', covered, null)).not.toContain('matches no tier')
    expect(describeTieredRule('Basic Salary', [{ operator: 'below', threshold: 50000, rate: 3 }], null)).not.toContain('matches no tier')
  })

  test('three "From" bands pick the highest one reached', () => {
    const column = thresholdColumn([
      { operator: 'from', threshold: 0, rate: 1 },
      { operator: 'from', threshold: 20000, rate: 2 },
      { operator: 'from', threshold: 50000, rate: 3 },
    ])
    expect(ruleAt(column, 19999)).toBeCloseTo(199.99, 10)
    expect(ruleAt(column, 20000)).toBe(400)
    expect(ruleAt(column, 50000)).toBe(1500)
  })

  // Was an audit bug (report M1): with two "Below" tiers the wider one
  // always won, so the narrower tier could never apply.
  test('"Below 50,000 at 3%" + "Below 100,000 at 5%" gives 3% for 30,000', () => {
    const column = thresholdColumn([
      { operator: 'below', threshold: 50000, rate: 3 },
      { operator: 'below', threshold: 100000, rate: 5 },
    ])
    expect(ruleAt(column, 30000)).toBe(900)
  })

  test('three "Below" tiers and a "From": each figure gets the narrowest tier it is in, in any order of entry', () => {
    const tiers = [
      { operator: 'from', threshold: 100000, rate: 7 },
      { operator: 'below', threshold: 100000, rate: 5 },
      { operator: 'below', threshold: 20000, rate: 1 },
      { operator: 'below', threshold: 50000, rate: 3 },
    ]
    const column = thresholdColumn(tiers)
    expect(ruleAt(column, 10000)).toBe(100)
    expect(ruleAt(column, 30000)).toBe(900)
    expect(ruleAt(column, 70000)).toBe(3500)
    expect(ruleAt(column, 100000)).toBeCloseTo(7000, 10)
    // The breakdown names the tier the figure came from.
    expect(resolveMatchedTier(tiers, 30000)).toEqual({ operator: 'below', threshold: 50000, rate: 3 })
  })
})

describe('caps', () => {
  const column = () => thresholdColumn([{ operator: 'from', threshold: 0, rate: 1 }], 29710)

  test('1% of min(value, 29,710)', () => {
    expect(ruleAt(column(), 20000)).toBe(200)
    expect(ruleAt(column(), 29710)).toBeCloseTo(297.1, 10)
    expect(ruleAt(column(), 40000)).toBeCloseTo(297.1, 10)
  })

  test('a cap with several tiers: the rate comes from the real value, the base is capped', () => {
    const multi = thresholdColumn(
      [
        { operator: 'below', threshold: 20000, rate: 0 },
        { operator: 'from', threshold: 20000, rate: 1.5 },
      ],
      100000
    )
    expect(ruleAt(multi, 19999)).toBe(0)
    expect(ruleAt(multi, 20000)).toBe(300)
    expect(ruleAt(multi, 250000)).toBe(1500)
  })

  // Was an audit bug (report M2): with ONE tier and a cap, the tier's own
  // condition was dropped.
  test('"Above 10,000 at 1%, capped at 29,710" gives 0 for 5,000', () => {
    const single = thresholdColumn([{ operator: 'above', threshold: 10000, rate: 1 }], 29710)
    expect(ruleAt(single, 5000)).toBe(0)
  })

  test('one tier with a cap: the condition is tested on the real figure, and only the base is capped', () => {
    const single = thresholdColumn([{ operator: 'above', threshold: 10000, rate: 1 }], 29710)
    expect(ruleAt(single, 10000)).toBe(0)
    expect(ruleAt(single, 20000)).toBe(200)
    expect(ruleAt(single, 40000)).toBeCloseTo(297.1, 10)
  })

  test('"From 0 at 1%, capped" is still the flat rate up to a maximum, with the same formula as before', () => {
    const state = { baseKey: 'basicSalary', tiers: [{ operator: 'from', threshold: 0, rate: 1 }], cap: 29710 }
    expect(compileTieredFormula(state)).toBe('(Math.min(basicSalary, 29710)) * (0.01)')
    expect(compileTieredFormula(state)).toBe(compileTieredFormulaBeforeFix(state))
    expect(describeTieredRule('Basic Salary', state.tiers, state.cap)).toBe('1% of Basic Salary, up to a maximum of 29,710.')
  })
})

describe('a tiered column saved before the M1 / M2 fixes', () => {
  // As it was stored: the tiers, and the formula the old rule compiled.
  const savedBefore = (tiers, cap = null) => {
    const state = { baseKey: 'basicSalary', tiers, cap }
    return { ...tiered('Rule', 'rule', state), formula: compileTieredFormulaBeforeFix(state) }
  }
  const twoBelow = [
    { operator: 'below', threshold: 50000, rate: 3 },
    { operator: 'below', threshold: 100000, rate: 5 },
  ]
  const capped = [{ operator: 'above', threshold: 10000, rate: 1 }]

  test.each([
    ['two "Below" tiers', () => savedBefore(twoBelow), 'below', 30000, 1500, 'This is below 100,000.00 → rate: 5%.'],
    ['one tier with a cap', () => savedBefore(capped, 29710), 'cap', 5000, 50, '5,000.00 × 1% = 50.00.'],
  ])('%s keeps its figure, is flagged, and its breakdown explains the rule the figure came from', (_label, make, shape, base, figure, explained) => {
    const column = make()
    expect(outdatedTieredRule(column)).toBe(shape)
    const row = computeRow([basic(), column], { basicSalary: String(base) })
    expect(row.rule.value).toBe(figure)
    expect(row.rule.trace.tiered.sentence).toContain(explained)
  })

  test('saved again, it gets the corrected figure and is no longer flagged', () => {
    for (const column of [tiered('Rule', 'rule', { baseKey: 'basicSalary', tiers: twoBelow, cap: null }), tiered('Rule', 'rule', { baseKey: 'basicSalary', tiers: capped, cap: 29710 })]) {
      expect(outdatedTieredRule(column)).toBeNull()
    }
    expect(ruleAt(thresholdColumn(twoBelow), 30000)).toBe(900)
    expect(computeRow([basic(), thresholdColumn(twoBelow)], { basicSalary: '30000' }).rule.trace.tiered.sentence).toContain('This is below 50,000.00 → rate: 3%.')
  })

  test('a rule the fixes do not change is never flagged, however it was saved', () => {
    const unchanged = [
      [{ operator: 'from', threshold: 0, rate: 1 }],
      [{ operator: 'below', threshold: 50000, rate: 1.5 }, { operator: 'from', threshold: 50000, rate: 3 }],
      // Two "Below" tiers at one rate give the same figures either way.
      [{ operator: 'below', threshold: 50000, rate: 3 }, { operator: 'below', threshold: 100000, rate: 3 }],
    ]
    expect(outdatedTieredRule(savedBefore(unchanged[0], 29710))).toBeNull()
    expect(outdatedTieredRule(savedBefore(unchanged[1]))).toBeNull()
    expect(outdatedTieredRule(savedBefore(unchanged[2]))).toBeNull()
    expect(outdatedTieredRule(simple('X', 'x', 'basicSalary * 2'))).toBeNull()
  })

  test('with an exemption, the saved formula is recognised inside its wrapper', () => {
    const exemption = { enabled: true, combineWith: 'AND', conditions: [{ type: 'compare', columnKey: 'basicSalary', operator: '>', compareToType: 'value', compareToValue: 200000 }], resultType: 'fixed', resultValue: 0 }
    const state = { baseKey: 'basicSalary', tiers: twoBelow, cap: null }
    const column = { ...tiered('Rule', 'rule', state, { exemption }), formula: compileExemptionWrapper(exemption, compileTieredFormulaBeforeFix(state)) }
    expect(outdatedTieredRule(column)).toBe('below')
  })

  test('the notes say what is wrong and what to do', () => {
    expect(OUTDATED_RULE_NOTES).toEqual({
      below: "Figures use the old rule, which picked the wrong 'Below' tier. Open and save this column to apply the corrected rule. Its figures will change.",
      cap: "Figures use the old rule, which ignored this tier's condition because of the cap. Open and save this column to apply the corrected rule. Its figures will change.",
    })
  })
})

describe('progressive brackets', () => {
  const paye = () =>
    progressive('PAYE', 'paye', {
      baseKey: 'basicSalary',
      brackets: [
        { width: 38000, rate: 0 },
        { width: 38000, rate: 10 },
        { width: '', rate: 20 },
      ],
    })

  test.each([
    [30000, 0],
    [38000, 0],
    [50000, 1200],
    [76000, 3800],
    [100000, 8600],
  ])('first 38,000 at 0%, next 38,000 at 10%, remainder at 20%: %i gives %i', (value, expected) => {
    expect(computeValues([basic(), paye()], { basicSalary: String(value) }).paye).toBeCloseTo(expected, 8)
  })

  test('100,000 is 8,600, not a flat 20%', () => {
    expect(computeValues([basic(), paye()], { basicSalary: '100000' }).paye).not.toBe(20000)
  })

  test('a negative base gives 0, not a negative tax', () => {
    expect(computeValues([basic(), paye()], { basicSalary: '-5000' }).paye).toBe(0)
  })
})

describe('checkbox columns and exemptions', () => {
  const columns = () => [
    basic(),
    input('Age 60+', 'age60', { valueType: 'checkbox' }),
    tiered('NSF', 'nsf', { baseKey: 'basicSalary', tiers: [{ operator: 'from', threshold: 0, rate: 1 }], cap: 29710 }, { exemption: checkboxExemption('age60') }),
  ]

  test('ticked gives NSF 0', () => {
    expect(computeValues(columns(), { basicSalary: '18750', age60: true }).nsf).toBe(0)
  })

  test('unticked gives the normal value', () => {
    expect(computeValues(columns(), { basicSalary: '18750', age60: false }).nsf).toBe(187.5)
    expect(computeValues(columns(), { basicSalary: '18750' }).nsf).toBe(187.5)
  })

  test('a checkbox is 1 or 0 inside a formula', () => {
    const cols = [input('Flag', 'flag', { valueType: 'checkbox' }), simple('Twice', 'twice', 'flag * 2')]
    expect(computeValues(cols, { flag: true }).twice).toBe(2)
    expect(computeValues(cols, { flag: false }).twice).toBe(0)
  })

  test('"is not ticked" as the condition', () => {
    const exemption = { ...checkboxExemption('age60', 5), conditions: [{ type: 'checkbox', columnKey: 'age60', checked: false }] }
    const cols = [basic(), input('Age 60+', 'age60', { valueType: 'checkbox' }), simple('X', 'x', 'basicSalary * 2', { exemption })]
    expect(computeValues(cols, { basicSalary: '10', age60: false }).x).toBe(5)
    expect(computeValues(cols, { basicSalary: '10', age60: true }).x).toBe(20)
  })

  test('two conditions joined with AND and with OR', () => {
    const conditions = [
      { type: 'checkbox', columnKey: 'age60', checked: true },
      { type: 'compare', columnKey: 'basicSalary', operator: '>=', compareToType: 'value', compareToValue: 50000, compareToColumnKey: null },
    ]
    const make = (combineWith) => [
      basic(),
      input('Age 60+', 'age60', { valueType: 'checkbox' }),
      simple('X', 'x', 'basicSalary * 0.01', { exemption: { enabled: true, conditions, combineWith, resultType: 'fixed', resultValue: 0, resultColumnKey: null } }),
    ]
    expect(computeValues(make('AND'), { basicSalary: '60000', age60: true }).x).toBe(0)
    expect(computeValues(make('AND'), { basicSalary: '40000', age60: true }).x).toBe(400)
    expect(computeValues(make('OR'), { basicSalary: '40000', age60: true }).x).toBe(0)
    expect(computeValues(make('OR'), { basicSalary: '40000', age60: false }).x).toBe(400)
  })

  test('an exemption can return another column instead of a fixed value', () => {
    const exemption = { enabled: true, conditions: [{ type: 'checkbox', columnKey: 'age60', checked: true }], combineWith: 'AND', resultType: 'column', resultValue: 0, resultColumnKey: 'govtIncrement' }
    const cols = [basic(), incr(), input('Age 60+', 'age60', { valueType: 'checkbox' }), simple('X', 'x', 'basicSalary * 2', { exemption })]
    expect(computeValues(cols, { basicSalary: '10', govtIncrement: '7', age60: true }).x).toBe(7)
  })
})

describe('column compared with column', () => {
  const columns = () => [
    input('EDF', 'edf'),
    input('Emoluments', 'emoluments'),
    compare('Chargeable', 'chargeable', { columnAKey: 'edf', operator: '>', columnBKey: 'emoluments', trueExpr: '0', falseExpr: 'Column B - Column A' }),
  ]

  test('EDF greater than Emoluments gives 0', () => {
    expect(computeValues(columns(), { edf: '30000', emoluments: '18750' }).chargeable).toBe(0)
  })

  test('otherwise Emoluments - EDF', () => {
    expect(computeValues(columns(), { edf: '9000', emoluments: '18750' }).chargeable).toBe(9750)
  })

  test('equal amounts take the "otherwise" branch and give 0', () => {
    expect(computeValues(columns(), { edf: '18750', emoluments: '18750' }).chargeable).toBe(0)
  })

  test.each([
    ['>', 5, 5, 'F'],
    ['>=', 5, 5, 'T'],
    ['<', 4, 5, 'T'],
    ['<=', 5, 5, 'T'],
    ['==', 5, 5, 'T'],
    ['==', 5, 6, 'F'],
  ])('operator %s with A=%i, B=%i takes the %s branch', (operator, a, b, branch) => {
    const cols = [input('A', 'a'), input('B', 'b'), compare('R', 'r', { columnAKey: 'a', operator, columnBKey: 'b', trueExpr: '1', falseExpr: '2' })]
    expect(computeValues(cols, { a: String(a), b: String(b) }).r).toBe(branch === 'T' ? 1 : 2)
  })
})

describe('decimal places: display is rounded, the stored value is not', () => {
  test('formatDecimal rounds for display only', () => {
    expect(formatDecimal(1234.5678, 2)).toBe('1,234.57')
    expect(formatDecimal(1234.5678, 0)).toBe('1,235')
    expect(formatDecimal(1234.5, 3)).toBe('1,234.500')
  })

  test('a chain of formulas does not drift: (100 / 3) * 3 is exactly 100', () => {
    const cols = [
      basic(),
      simple('Third', 'third', 'basicSalary / 3', { decimals: 0 }),
      simple('Back', 'back', 'third * 3', { decimals: 2 }),
    ]
    const row = computeRow(cols, { basicSalary: '100' })
    expect(formatDecimal(row.third.value, 0)).toBe('33')
    expect(row.third.value).toBeCloseTo(33.3333333333, 8)
    expect(row.back.value).toBe(100)
  })

  test('a column shown with 0 decimals still feeds its full value onwards', () => {
    const cols = [basic(), simple('Half', 'half', 'basicSalary / 2', { decimals: 0 }), simple('Double', 'double', 'half * 2')]
    const row = computeRow(cols, { basicSalary: '333' })
    expect(formatDecimal(row.half.value, 0)).toBe('167')
    expect(row.double.value).toBe(333)
  })

  test('ten additions of 0.1 through a chain show 1.00', () => {
    const cols = [basic(), simple('S', 's', 'basicSalary + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1')]
    expect(formatDecimal(computeValues(cols, { basicSalary: '0' }).s, 2)).toBe('1.00')
  })

  // An exact half cent rounds UP (away from zero), even though the computer
  // holds 271.725 as 271.72499999999997.
  test('1.5% of 18,115 is 271.725 and shows as 271.73', () => {
    const cols = [basic(), simple('CSG', 'csg', 'basicSalary * 0.015')]
    const value = computeValues(cols, { basicSalary: '18115' }).csg
    expect(formatDecimal(value, 2)).toBe('271.73')
    // The stored value is untouched: only the display is rounded.
    expect(value).toBe(18115 * 0.015)
  })

  test('1.5% of 20,115 is 301.725 and shows as 301.73', () => {
    const cols = [basic(), simple('CSG', 'csg', 'basicSalary * 0.015')]
    expect(formatDecimal(computeValues(cols, { basicSalary: '20115' }).csg, 2)).toBe('301.73')
  })

  test.each([
    [271.725, 2, 271.73],
    [301.725, 2, 301.73],
    [905.175, 2, 905.18],
    [260000.555, 2, 260000.56],
    [1.005, 2, 1.01],
    [2.675, 2, 2.68],
    [0.125, 2, 0.13],
    [0.5, 0, 1],
    [1.5, 0, 2],
    [2.5, 0, 3],
    [-271.725, 2, -271.73],
    [-0.5, 0, -1],
    [271.7249, 2, 271.72],
    [271.7251, 2, 271.73],
    [18750, 2, 18750],
    [0.1 + 0.2, 2, 0.3],
    [33.333333333333336, 3, 33.333],
    [-0.001, 2, 0],
    [0, 2, 0],
  ])('roundHalfUp(%f, %i) is %f', (value, decimals, expected) => {
    expect(roundHalfUp(value, decimals)).toBe(expected)
  })

  test('rounding leaves text and missing values alone', () => {
    expect(roundHalfUp('abc', 2)).toBe('abc')
    expect(Number.isNaN(roundHalfUp(NaN, 2))).toBe(true)
    expect(formatDecimal(-0.001, 2)).toBe('0.00')
  })
})

describe('the grid', () => {
  test('one employee\'s figures never leak into another\'s', () => {
    const columns = [basic(), incr(), newBasic()]
    const employees = [
      { id: 'a', values: { basicSalary: '100', govtIncrement: '1' } },
      { id: 'b', values: { basicSalary: '200', govtIncrement: '2' } },
      { id: 'c', values: {} },
    ]
    const grid = computeGridForEmployees(employees, columns, getColumnsByKey(columns))
    expect(grid.a.newBasic.value).toBe(101)
    expect(grid.b.newBasic.value).toBe(202)
    expect(grid.c.newBasic.value).toBe(0)
  })

  test('a formula that uses a deleted column is an error cell, not a crash', () => {
    const columns = [basic(), simple('X', 'x', 'basicSalary + gone')]
    const memo = new Map()
    const cell = computeCell('x', { id: 'e', values: { basicSalary: '5' } }, getColumnsByKey(columns), memo)
    expect(Number.isNaN(cell.value)).toBe(true)
    expect(cell.trace.error).toContain('gone is not defined')
  })

  // A figure worked out from a figure in error is in error too, and says
  // which column to look at - it is never "NaN" shown as a figure.
  test('a column calculated from a column in error is itself an error, naming that column', () => {
    const columns = [basic(), simple('X', 'x', 'basicSalary + gone'), simple('Y', 'y', 'x * 2'), simple('Z', 'z', 'y + 1')]
    const row = computeRow(columns, { basicSalary: '5' })
    expect(row.x.trace.error).toContain('gone is not defined')
    expect(row.y.trace.error).toBe('"X" is in error')
    expect(row.z.trace.error).toBe('"Y" is in error')
    // The breakdown still lists what it depends on, so the cause can be opened.
    expect(row.z.trace.dependencies.map((d) => d.name)).toEqual(['Y'])
  })

  test('an error never turns into a figure through a condition', () => {
    // Before, "bad > 100 ? 5 : 10" quietly gave 10 when "bad" was in error.
    const columns = [basic(), simple('Bad', 'bad', 'basicSalary / 0'), simple('Pick', 'pick', 'bad > 100 ? 5 : 10')]
    const row = computeRow(columns, { basicSalary: '5' })
    expect(row.pick.trace.error).toBe('"Bad" is in error')
  })

  test('a text column used in a formula counts as 0', () => {
    const cols = [input('Status', 'status', { valueType: 'text' }), simple('X', 'x', 'status + 5')]
    expect(computeValues(cols, { status: 'Full Time' }).x).toBe(5)
  })
})
