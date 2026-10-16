// Audit, part 2: columns and structure - keys, names shown instead of keys,
// the breakdown text for every kind of formula, and the column setup
// export / import round trip. TEST data only.
//
// `test.fails` marks a bug: see the note at the top of formulaEngine.test.js.

import { describe, expect, test } from 'vitest'
import { getColumnsByKey, getEffectiveColumns } from '../../src/lib/model'
import { slugify, isValidKey } from '../../src/lib/slugify'
import {
  generateUniqueKey,
  labelColumnsForHelper,
  getOrderedEffectiveColumns,
  getCategoryGroups,
  reorderWithinCategory,
  CATEGORIES,
} from '../../src/lib/categories'
import { formatFormulaForDisplay, computeGridForEmployees } from '../../src/lib/formulaEngine'
import { describeTieredRule, describeCompareRule } from '../../src/lib/tieredFormula'
import { describeProgressiveRule } from '../../src/lib/progressiveFormula'
import { buildColumnSetupExport, parseColumnSetupFile, planColumnImport } from '../../src/lib/columnSetup'
import { input, simple, tiered, EMPLOYEE, EMPLOYER, OTHER, testColumns, testEmployees, computeRow } from './build'
import { findFormulasUsingColumn, findScopeChangeBlockers, renameKeyInColumn, renameKeyInExpression, renameKeyInWidths } from '../../src/lib/columnUsage'
import { renameValueKey } from '../../src/lib/storage'
import { compileExemptionWrapper, stripExemptionWrapper } from '../../src/lib/exemptionCondition'

const portable = ({ id: _id, ...rest }) => JSON.parse(JSON.stringify(rest))

function asFile(object) {
  return new File([typeof object === 'string' ? object : JSON.stringify(object)], 'column-setup.json', { type: 'application/json' })
}

describe('keys', () => {
  test('a name becomes a camelCase key', () => {
    expect(slugify('Basic Salary')).toBe('basicSalary')
    expect(slugify('Tax %')).toBe('tax')
    expect(slugify('  Full time / Part time ')).toBe('fullTimePartTime')
    expect(slugify('13th month')).toBe('_13thMonth')
    expect(isValidKey(slugify('13th month'))).toBe(true)
  })

  test('two columns called "CSG" in different categories get different keys', () => {
    const first = generateUniqueKey(slugify('CSG'), EMPLOYEE, [])
    const second = generateUniqueKey(slugify('CSG'), EMPLOYER, [first])
    const third = generateUniqueKey(slugify('CSG'), EMPLOYER, [first, second])
    expect(first).toBe('csg')
    expect(second).toBe('csg_employer')
    expect(third).toBe('csg_2')
    expect(new Set([first, second, third]).size).toBe(3)
  })

  test('columns that share a name are told apart by their category', () => {
    const labels = labelColumnsForHelper(testColumns())
      .filter((c) => c.name === 'CSG')
      .map((c) => c.helperLabel)
    expect(labels).toEqual(['CSG (Employee Contribution)', 'CSG (Employer Contribution)'])
  })

  test('a column with a unique name keeps its plain name', () => {
    const nsf = labelColumnsForHelper(testColumns()).find((c) => c.key === 'nsf')
    expect(nsf.helperLabel).toBe('NSF')
  })
})

describe('categories and order', () => {
  test('the five groups, in their fixed order', () => {
    expect(CATEGORIES.map((c) => c.label)).toEqual(['Identifiers', 'General', 'Employee Contribution', 'Employer Contribution', 'Other Deductions'])
  })

  test('columns are grouped by category whatever order they were added in', () => {
    const groups = getCategoryGroups(getOrderedEffectiveColumns(testColumns()))
    expect(groups.map((g) => [g.label, g.columns.map((c) => c.key)])).toEqual([
      ['General', ['basicSalary', 'govtIncrement', 'newBasic', 'status', 'allowances', 'emoluments', 'age60', 'bonusBase', 'bonus', 'netPay']],
      ['Employee Contribution', ['csg', 'nsf', 'paye']],
      ['Employer Contribution', ['csg_employer']],
      ['Other Deductions', ['edf', 'chargeable']],
    ])
  })

  test('dragging moves a column within its own category', () => {
    const moved = reorderWithinCategory(testColumns(), 'col-paye', 'col-csg')
    expect(getOrderedEffectiveColumns(moved).filter((c) => c.category === EMPLOYEE).map((c) => c.key)).toEqual(['paye', 'csg', 'nsf'])
  })

  test('dragging onto a column of another category changes nothing', () => {
    const columns = testColumns()
    expect(reorderWithinCategory(columns, 'col-paye', 'col-edf')).toBe(columns)
  })

  test('global columns come first, then the company\'s own', () => {
    const global = [input('Basic Salary', 'basicSalary')]
    const company = { columns: [input('Levy', 'levy', { category: OTHER })] }
    expect(getEffectiveColumns(company, global).map((c) => c.key)).toEqual(['basicSalary', 'levy'])
  })
})

describe('an exemption around a Simple formula (known issue 4)', () => {
  const age60 = { enabled: true, conditions: [{ type: 'checkbox', columnKey: 'aged60', checked: true }], combineWith: 'AND', resultType: 'fixed', resultValue: 0, resultColumnKey: null }
  const wrapped = compileExemptionWrapper(age60, 'emoluments * 0.01')

  test('the form gets back exactly what was wrapped, so saving again gives the same formula', () => {
    expect(stripExemptionWrapper(age60, wrapped)).toBe('emoluments * 0.01')
    expect(compileExemptionWrapper(age60, stripExemptionWrapper(age60, wrapped))).toBe(wrapped)
  })

  test('a formula wrapped several times by the old form comes back to its base, with the same figures', () => {
    const nested = compileExemptionWrapper(age60, compileExemptionWrapper(age60, wrapped))
    expect(stripExemptionWrapper(age60, nested)).toBe('emoluments * 0.01')
    for (const aged60 of [0, 1]) {
      const run = (formula) => new Function('emoluments', 'aged60', `return ${formula}`)(29710, aged60)
      expect(run(compileExemptionWrapper(age60, stripExemptionWrapper(age60, nested)))).toBe(run(nested))
    }
  })

  test('anything not wrapped in exactly this exemption is left as it is', () => {
    expect(stripExemptionWrapper(age60, 'emoluments * 0.01')).toBe('emoluments * 0.01')
    expect(stripExemptionWrapper({ ...age60, resultValue: 5 }, wrapped)).toBe(wrapped)
    expect(stripExemptionWrapper({ ...age60, enabled: false }, wrapped)).toBe(wrapped)
    expect(stripExemptionWrapper(undefined, wrapped)).toBe(wrapped)
    // Starts and ends like the wrapper, but its last bracket closes something else.
    const lookalike = '(aged60 === 1) ? (0) : (emoluments) * (0.01)'
    expect(stripExemptionWrapper(age60, lookalike)).toBe(lookalike)
  })
})

describe('renaming', () => {
  // What "Edit column" does on Save: the same column object with new fields.
  const edit = (columns, key, patch) => columns.map((c) => (c.key === key ? { ...c, ...patch } : c))
  const values = { basicSalary: '18115', govtIncrement: '635' }

  test('renaming a column (its name) does not break the formulas that use it', () => {
    const columns = [input('Basic Salary', 'basicSalary'), input('Govt Increment', 'govtIncrement'), simple('New Basic', 'newBasic', 'basicSalary + govtIncrement')]
    const renamed = edit(columns, 'basicSalary', { name: 'Base Pay' })
    expect(computeRow(renamed, values).newBasic.value).toBe(18750)
    expect(formatFormulaForDisplay(renamed[2].formula, { basicSalary: 'Base Pay', govtIncrement: 'Govt Increment' })).toBe('Base Pay + Govt Increment')
  })

  // The Edit form also lets the Key be changed. The change is carried through
  // every formula that uses the column and every saved value held under it.
  test('changing a column\'s key keeps the formulas that use it working, and its figures with it', () => {
    const columns = [input('Basic Salary', 'basicSalary'), input('Govt Increment', 'govtIncrement'), simple('New Basic', 'newBasic', 'basicSalary + govtIncrement')]
    const rekeyed = edit(columns.map((c) => renameKeyInColumn(c, 'basicSalary', 'basePay')), 'basicSalary', { key: 'basePay' })
    expect(rekeyed.map((c) => c.key)).toEqual(['basePay', 'govtIncrement', 'newBasic'])
    expect(rekeyed[2].formula).toBe('basePay + govtIncrement')
    const moved = renameValueKey({ id: 'e1', values }, 'basicSalary', 'basePay')
    expect(moved.values).toEqual({ govtIncrement: '635', basePay: '18115' })
    expect(computeRow(rekeyed, moved.values).newBasic.value).toBe(18750)
  })

  test('a key that is part of a longer key is left alone', () => {
    expect(renameKeyInExpression('csg + csg_employer * csg', 'csg', 'csgEmployee')).toBe('csgEmployee + csg_employer * csgEmployee')
  })

  test('a key change reaches the visual builder settings too, so the builders still open on the right column', () => {
    const all = testColumns().map((c) => renameKeyInColumn(c, 'newBasic', 'revisedBasic')).map((c) => renameKeyInColumn(c, 'age60', 'over60')).map((c) => renameKeyInColumn(c, 'edf', 'edfClaim'))
    const of = (key) => all.find((c) => c.key === key)
    expect(of('csg').tiered.baseKey).toBe('revisedBasic')
    expect(of('csg').formula).toBe('(revisedBasic) * (revisedBasic < 50001 ? 0.015 : revisedBasic > 50000 ? 0.03 : 0)')
    expect(of('nsf').tiered.baseKey).toBe('revisedBasic')
    expect(of('nsf').exemption.conditions).toEqual([{ type: 'checkbox', columnKey: 'over60', checked: true }])
    expect(of('nsf').formula).toBe('((over60 === 1)) ? (0) : ((Math.min(revisedBasic, 29710)) * (0.01))')
    expect(of('chargeable').compare.columnAKey).toBe('edfClaim')
    expect(of('chargeable').formula).toBe('(edfClaim > emoluments) ? (0) : (emoluments - edfClaim)')
    // Emoluments (which PAYE is based on) was not renamed.
    expect(of('paye').progressive.baseKey).toBe('emoluments')
    expect(of('emoluments').formula).toBe('revisedBasic + allowances')
    // Input columns have nothing to rewrite.
    const plain = input('Basic Salary', 'basicSalary')
    expect(renameKeyInColumn(plain, 'newBasic', 'revisedBasic')).toBe(plain)
  })

  test('after a key change every figure calculates as before', () => {
    const before = testColumns()
    const after = before.map((c) => renameKeyInColumn(c, 'newBasic', 'revisedBasic')).map((c) => (c.key === 'newBasic' ? { ...c, key: 'revisedBasic' } : c))
    for (const employee of testEmployees()) {
      const a = computeRow(before, employee.values)
      const b = computeRow(after, employee.values)
      for (const column of before) expect(b[column.key === 'newBasic' ? 'revisedBasic' : column.key].value, column.name).toBe(a[column.key].value)
    }
  })

  test('a remembered column width moves to the new key', () => {
    expect(renameKeyInWidths({ basicSalary: 200, edf: 90 }, 'basicSalary', 'basePay')).toEqual({ edf: 90, basePay: 200 })
    const untouched = { edf: 90 }
    expect(renameKeyInWidths(untouched, 'basicSalary', 'basePay')).toBe(untouched)
  })
})

describe('formulas are shown with column names, not keys', () => {
  const labels = () => Object.fromEntries(labelColumnsForHelper(testColumns()).map((c) => [c.key, c.helperLabel]))
  const formulaOf = (key) => testColumns().find((c) => c.key === key).formula

  test('a simple formula', () => {
    expect(formatFormulaForDisplay(formulaOf('newBasic'), labels())).toBe('Basic Salary + Govt Increment')
  })

  test('columns that share a name are shown with their category', () => {
    expect(formatFormulaForDisplay(formulaOf('netPay'), labels())).toBe('Emoluments + Bonus - CSG (Employee Contribution) - NSF - PAYE')
  })

  test('no key is left over in any formula', () => {
    const columns = testColumns()
    const keysWithOtherNames = columns.filter((c) => c.key !== c.name).map((c) => c.key)
    for (const column of columns.filter((c) => c.type === 'formula')) {
      const shown = formatFormulaForDisplay(column.formula, labels())
      for (const key of keysWithOtherNames) {
        expect(shown, `${column.name}: ${shown}`).not.toMatch(new RegExp(`\\b${key}\\b`))
      }
    }
  })

  test('a key that is part of a longer key is not replaced inside it', () => {
    expect(formatFormulaForDisplay('csg + csg_employer', { csg: 'A', csg_employer: 'B' })).toBe('A + B')
  })
})

describe('the rule summaries in the builders', () => {
  test('tiered', () => {
    expect(
      describeTieredRule('New Basic', [{ operator: 'below', threshold: 50000, rate: 3 }, { operator: 'above', threshold: 50000, rate: 6 }], null)
    ).toBe('If New Basic is below 50,000, apply 3%. If New Basic is above 50,000, apply 6%.')
  })

  test('one rate with a cap', () => {
    expect(describeTieredRule('New Basic', [{ operator: 'from', threshold: 0, rate: 1 }], 29710)).toBe('1% of New Basic, up to a maximum of 29,710.')
  })

  test('progressive', () => {
    expect(describeProgressiveRule([{ width: 38000, rate: 0 }, { width: 38000, rate: 10 }, { width: '', rate: 20 }])).toBe(
      'First 38,000 taxed at 0%. Next 38,000 (38,000–76,000) taxed at 10%. Remainder above 76,000 taxed at 20%.'
    )
  })

  test('compare two columns', () => {
    expect(describeCompareRule('EDF', 'Emoluments', '>', '0', 'Column B - Column A')).toBe(
      'If EDF is greater than Emoluments, use 0. Otherwise, use Emoluments − EDF.'
    )
  })
})

describe('the breakdown view', () => {
  const [first, second, third] = testEmployees()
  const trace = (employee, key) => computeRow(testColumns(), employee.values)[key].trace

  test('simple formula: the formula and the substituted figures', () => {
    const t = trace(first, 'newBasic')
    expect(t.formula).toBe('basicSalary + govtIncrement')
    expect(t.substituted).toBe('18115.00 + 635.00')
    expect(t.value).toBe(18750)
    expect(t.dependencies.map((d) => [d.name, d.value])).toEqual([['Basic Salary', 18115], ['Govt Increment', 635]])
  })

  test('tiered: which tier applied', () => {
    expect(trace(first, 'csg').tiered.sentence).toBe('New Basic: 18,750.00. This is below 50,001.00 → rate: 1.5%. 18,750.00 × 1.5% = 281.25.')
    expect(trace(third, 'csg').tiered.sentence).toBe('New Basic: 60,000.00. This is above 50,000.00 → rate: 3%. 60,000.00 × 3% = 1,800.00.')
  })

  test('one rate with a cap: under and over the cap', () => {
    expect(trace(first, 'nsf').tiered.sentence).toBe('New Basic: 18,750.00. 18,750.00 × 1% = 187.50.')
    expect(trace(third, 'nsf').tiered.sentence).toBe('New Basic: 60,000.00. Capped at 29,710.00 → 29,710.00 × 1% = 297.10.')
  })

  test('exemption met: says why, and gives no misleading calculation', () => {
    const t = trace(second, 'nsf')
    expect(t.exemption).toEqual({ sentence: "'Age 60+' is ticked, so NSF = 0.00.", matched: true })
    expect(t.tiered).toBeUndefined()
    expect(t.value).toBe(0)
  })

  test('exemption not met: says so, then the normal calculation', () => {
    const t = trace(first, 'nsf')
    expect(t.exemption).toEqual({ sentence: "'Age 60+' is not ticked, so the normal calculation applies:", matched: false })
    expect(t.tiered.sentence).toContain('× 1% = 187.50')
  })

  test('progressive: each bracket and the total', () => {
    expect(trace(second, 'paye').progressive.sentence).toBe(
      'Emoluments: 100,000.00. First 38,000 @ 0% = 0.00. Next 38,000 (38,000–76,000) @ 10% = 3,800.00. Remainder (24,000.00 above 76,000.00) @ 20% = 4,800.00. Total: 8,600.00.'
    )
    const amounts = trace(second, 'paye').progressive.brackets.map((b) => b.amount)
    expect(amounts).toEqual([0, 3800, 4800])
  })

  test('compare two columns: both branches', () => {
    expect(trace(first, 'chargeable').compare.sentence).toBe(
      'EDF: 9,000.00. Emoluments: 18,750.00. 9,000.00 is not greater than 18,750.00 → 18,750.00 − 9,000.00 = 9,750.00.'
    )
    expect(trace(second, 'chargeable').compare.sentence).toBe(
      'EDF: 390,000.00. Emoluments: 100,000.00. 390,000.00 is greater than 100,000.00 → 0 = 0.00.'
    )
  })

  test('nested: Net Pay lists what it depends on, each with its own breakdown', () => {
    const t = trace(first, 'netPay')
    expect(t.dependencies.map((d) => d.name)).toEqual(['Emoluments', 'Bonus', 'CSG', 'NSF', 'PAYE'])
    const emoluments = t.dependencies[0]
    expect(emoluments.dependencies.map((d) => d.name)).toEqual(['New Basic', 'Allowances'])
    expect(emoluments.dependencies[0].dependencies.map((d) => d.name)).toEqual(['Basic Salary', 'Govt Increment'])
    // 18,750 + 100 - 281.25 - 187.50 - 0
    expect(t.value).toBe(18381.25)
    expect(t.substituted).toBe('18750.00 + 100.00 - 281.25 - 187.50 - 0.00')
  })

  test('every nested breakdown agrees with the figure in the table', () => {
    const columns = testColumns()
    const grid = computeGridForEmployees(testEmployees(), columns, getColumnsByKey(columns))
    const walk = (t, row) => {
      expect(t.value, t.name).toBe(row[t.key].value)
      for (const dep of t.dependencies ?? []) walk(dep, row)
    }
    for (const employee of testEmployees()) {
      for (const column of columns) walk(grid[employee.id][column.key].trace, grid[employee.id])
    }
  })
})

describe('column setup: export, delete, import again', () => {
  const company = { name: 'TEST Co A', details: { address: '1 Test Street', brn: 'TEST-BRN-A', customFields: [] } }

  test('everything comes back identical, including the visual builder settings', async () => {
    const original = testColumns()
    const exported = JSON.parse(JSON.stringify(buildColumnSetupExport(original, 'company', company.name, company.details)))
    const parsed = await parseColumnSetupFile(asFile(exported))
    expect(parsed.valid).toBe(true)
    expect(parsed.scope).toBe('company')
    expect(parsed.companyName).toBe('TEST Co A')

    // The test columns were deleted, so nothing collides.
    const plan = planColumnImport(parsed.columns, ['id', 'name', 'surname'], 'skip')
    expect(plan.map((p) => p.action)).toEqual(original.map(() => 'new'))
    expect(plan.map((p) => portable(p.column))).toEqual(original.map(portable))

    const imported = plan.map((p) => p.column)
    for (const key of ['csg', 'nsf', 'csg_employer']) {
      const column = imported.find((c) => c.key === key)
      expect(column.builderMode).toBe('tiered')
      expect(column.tieredKind).toBe('threshold')
      expect(column.tiered).toEqual(original.find((c) => c.key === key).tiered)
    }
    expect(imported.find((c) => c.key === 'paye').builderMode).toBe('progressive')
    expect(imported.find((c) => c.key === 'paye').progressive.brackets).toHaveLength(3)
    expect(imported.find((c) => c.key === 'chargeable').tieredKind).toBe('compare')
    expect(imported.find((c) => c.key === 'nsf').exemption.conditions).toEqual([{ type: 'checkbox', columnKey: 'age60', checked: true }])
    expect(imported.find((c) => c.key === 'bonusBase').excludeFromExport).toBe(true)
  })

  test('the imported columns calculate the same figures', async () => {
    const original = testColumns()
    const parsed = await parseColumnSetupFile(asFile(buildColumnSetupExport(original, 'global')))
    const imported = planColumnImport(parsed.columns, [], 'skip').map((p) => p.column)
    for (const employee of testEmployees()) {
      const before = computeRow(original, employee.values)
      const after = computeRow(imported, employee.values)
      for (const column of original) expect(after[column.key].value, column.name).toBe(before[column.key].value)
    }
  })

  test('imported columns get new ids, so importing twice never collides on id', async () => {
    const parsed = await parseColumnSetupFile(asFile(buildColumnSetupExport(testColumns(), 'global')))
    const a = planColumnImport(parsed.columns, [], 'skip').map((p) => p.column.id)
    const b = planColumnImport(parsed.columns, [], 'skip').map((p) => p.column.id)
    expect(new Set([...a, ...b]).size).toBe(a.length + b.length)
  })

  test('a column that already exists is skipped, or added under a new key', async () => {
    const parsed = await parseColumnSetupFile(asFile(buildColumnSetupExport(testColumns(), 'global')))
    const skip = planColumnImport(parsed.columns, ['csg'], 'skip')
    expect(skip.find((p) => p.originalKey === 'csg').action).toBe('skip')
    expect(skip.find((p) => p.originalKey === 'csg').column).toBeNull()

    const duplicate = planColumnImport(parsed.columns, ['csg'], 'duplicate')
    const csg = duplicate.find((p) => p.originalKey === 'csg')
    expect(csg.action).toBe('duplicate')
    expect(csg.finalKey).toBe('csg_employee')
    expect(csg.column.key).toBe('csg_employee')
  })

  test.each([
    ['not JSON', 'this is not json', 'This file is not valid JSON.'],
    ['some other JSON file', { hello: 'world' }, 'This file is not a recognized column-setup export.'],
    ['a payroll export', [{ ID: 'TST001' }], 'This file is not a recognized column-setup export.'],
    ['an unknown scope', { _meta: { app: 'payroll-sys-column-setup', scope: 'everyone' }, columns: [] }, 'This file is not a recognized column-setup export.'],
  ])('a file that is %s is refused', async (_label, content, message) => {
    expect(await parseColumnSetupFile(asFile(content))).toEqual({ valid: false, error: message })
  })

  // Was an audit bug (report M8): only the wrapper was checked, so columns
  // with no name, no key or no type were added as they were.
  test('a column with no name, key or type is refused', async () => {
    const parsed = await parseColumnSetupFile(asFile({ _meta: { app: 'payroll-sys-column-setup', version: 1, scope: 'global' }, columns: [{}] }))
    const plan = parsed.valid ? planColumnImport(parsed.columns, [], 'skip') : []
    expect(plan.filter((p) => p.action === 'new')).toHaveLength(0)
  })

  test('a file with a column that could not be made by hand is refused whole, and every problem is named', async () => {
    const columns = [
      {},
      { name: 'Net', key: 'net pay', type: 'formula' },
      { name: '  ', key: 'rate', type: 'input', valueType: 'percent' },
      'not a column',
      ...buildColumnSetupExport(testColumns(), 'global').columns,
    ]
    expect(await parseColumnSetupFile(asFile({ _meta: { app: 'payroll-sys-column-setup', version: 1, scope: 'global' }, columns }))).toEqual({
      valid: false,
      error:
        'This file cannot be imported. Column 1: no name, no valid key, no valid type. Column 2 ("Net"): no valid key, no formula. ' +
        'Column 3: no name, an unknown value type. Column 4: not a column.',
    })
    // The app's own export of every kind of column passes the same checks.
    expect((await parseColumnSetupFile(asFile(buildColumnSetupExport(testColumns(), 'global')))).valid).toBe(true)
  })

  // Was an audit bug (report M9): an imported formula was not checked
  // against the columns that exist, so a file from another company could add
  // formulas that can only show Error.
  test('a formula that uses a column the company does not have is flagged on import', async () => {
    const lonely = [simple('Net', 'net', 'grossFromElsewhere - 100')]
    const parsed = await parseColumnSetupFile(asFile(buildColumnSetupExport(lonely, 'company', 'TEST Co B')))
    const plan = planColumnImport(parsed.columns, [], 'skip')
    expect(plan[0].action).not.toBe('new')
  })

  test('such a formula is not imported, says why, and neither is a formula that uses it', async () => {
    const file = [simple('Net', 'net', 'grossFromElsewhere - 100'), simple('Half Net', 'halfNet', 'net / 2'), simple('Doubled', 'doubled', 'basicSalary * 2')]
    const parsed = await parseColumnSetupFile(asFile(buildColumnSetupExport(file, 'company', 'TEST Co B')))
    const plan = planColumnImport(parsed.columns, ['id', 'basicSalary'], 'skip', ['basicSalary'])
    expect(plan.map((p) => [p.originalKey, p.action, p.problem])).toEqual([
      ['net', 'problem', 'Unknown column reference: grossFromElsewhere'],
      ['halfNet', 'problem', 'Unknown column reference: net'],
      ['doubled', 'new', null],
    ])
    expect(plan.filter((p) => p.column).map((p) => p.column.key)).toEqual(['doubled'])
  })

  test('a formula may use a column that is skipped because it exists here, but not one that exists only where formulas here cannot reach', async () => {
    const file = [input('Basic Salary', 'basicSalary'), simple('Doubled', 'doubled', 'basicSalary * 2')]
    const parsed = await parseColumnSetupFile(asFile(buildColumnSetupExport(file, 'global')))
    // Global scope: "basicSalary" is a Global column here, so the formula uses that one.
    expect(planColumnImport(parsed.columns, ['basicSalary'], 'skip', ['basicSalary']).map((p) => p.action)).toEqual(['skip', 'new'])
    // "basicSalary" is only another company's column: a Global formula cannot use it.
    expect(planColumnImport(parsed.columns, ['basicSalary'], 'skip', []).map((p) => p.action)).toEqual(['skip', 'problem'])
  })

  // Was an audit bug (report M10): "Import as new/duplicate" gave the copy a
  // new key, but the other imported formulas still pointed at the column
  // that was already there.
  test('importing as a duplicate keeps the imported formulas pointing at the imported copy', async () => {
    const file = [input('Rate Base', 'rateBase'), simple('Charge', 'charge', 'rateBase * 0.5')]
    const parsed = await parseColumnSetupFile(asFile(buildColumnSetupExport(file, 'global')))
    const plan = planColumnImport(parsed.columns, ['rateBase', 'charge'], 'duplicate')
    const copyOfBase = plan.find((p) => p.originalKey === 'rateBase').finalKey
    expect(plan.find((p) => p.originalKey === 'charge').column.formula).toBe(`${copyOfBase} * 0.5`)
  })

  test('a copy given a new key takes the builder settings of the imported formulas with it, and never takes a key the file uses later', async () => {
    const file = [
      input('CSG', 'csg', { category: EMPLOYEE }),
      tiered('Levy', 'levy', { baseKey: 'csg', tiers: [{ operator: 'above', threshold: 100, rate: 1 }], cap: null }),
      input('CSG Employee', 'csg_employee', { category: EMPLOYEE }),
    ]
    const parsed = await parseColumnSetupFile(asFile(buildColumnSetupExport(file, 'global')))
    const plan = planColumnImport(parsed.columns, ['csg', 'levy'], 'duplicate')
    const [csg, levy, csgEmployee] = plan
    expect(csg.finalKey).not.toBe('csg_employee')
    expect(csgEmployee).toMatchObject({ action: 'new', finalKey: 'csg_employee' })
    expect(levy.column.tiered.baseKey).toBe(csg.finalKey)
    expect(levy.column.formula).toContain(csg.finalKey)
    expect(levy.column.formula).not.toMatch(/\bcsg\b/)
    expect(levy.column.formula).not.toContain('csg_employee')
  })
})

describe('scope: a Global column that becomes Company-specific', () => {
  // Making a Global column company-only takes it away from every Global
  // formula and from the other companies. The form refuses while anything
  // uses it; this is the list it shows.
  const base = input('Basic Salary', 'basicSalary')
  const doubled = simple('Doubled', 'doubled', 'basicSalary * 2')
  const unrelated = simple('Fixed', 'fixed', '5 + 5')
  const companies = [
    { id: 'test-co-a', name: 'TEST Co A', columns: [simple('Site Total', 'siteTotal', 'basicSalary + 10')] },
    { id: 'test-co-b', name: 'TEST Co B', columns: [simple('Shift Pay', 'shiftPay', 'basicSalary * 0.1'), input('Note', 'note', { valueType: 'text' })] },
  ]

  test('every formula that uses it is found: Global ones, and other companies\' own', () => {
    expect(findScopeChangeBlockers(base, [base, doubled, unrelated], companies, 'test-co-a')).toEqual([
      { name: 'Doubled', where: 'Global' },
      { name: 'Shift Pay', where: 'TEST Co B' },
    ])
  })

  test('the company that keeps the column may go on using it', () => {
    const blockers = findScopeChangeBlockers(base, [base, unrelated], companies, 'test-co-a')
    expect(blockers).toEqual([{ name: 'Shift Pay', where: 'TEST Co B' }])
    expect(findScopeChangeBlockers(base, [base, unrelated], companies, 'test-co-b')).toEqual([{ name: 'Site Total', where: 'TEST Co A' }])
  })

  test('a column nothing uses can be converted', () => {
    expect(findScopeChangeBlockers(unrelated, [base, doubled, unrelated], companies, 'test-co-a')).toEqual([])
  })

  test('a formula is found through any part of it: tier base, exemption, comparison', () => {
    const users = (key) => findFormulasUsingColumn(key, testColumns()).map((c) => c.key)
    expect(users('newBasic')).toEqual(['emoluments', 'csg', 'nsf', 'csg_employer'])
    expect(users('age60')).toEqual(['nsf'])
    expect(users('edf')).toEqual(['chargeable'])
    expect(users('csg')).toEqual(['netPay'])
    expect(users('status')).toEqual([])
  })
})

describe('tiered formula text', () => {
  // Not a wrong figure (the difference is far below a cent), but this is what
  // the column list and a Live-Formulas export show for a rate of 1.1%.
  test.fails('BUG: a rate of 1.1% is written into the formula as 0.011', () => {
    const column = tiered('Levy', 'levy', { baseKey: 'basicSalary', tiers: [{ operator: 'from', threshold: 0, rate: 1.1 }, { operator: 'from', threshold: 100, rate: 2 }], cap: null })
    expect(column.formula).toContain('0.011 ')
  })
})
