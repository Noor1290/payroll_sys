// Shared helpers for the audit tests. TEST data only: company "TEST Co A",
// employee IDs starting with "TST".
//
// Columns are built the way the Column form builds them on Save: the builder
// state is compiled to a plain expression, then wrapped by the exemption.

import { newColumn, getColumnsByKey } from '../../src/lib/model'
import { compileTieredFormula, compileCompareFormula } from '../../src/lib/tieredFormula'
import { compileProgressiveFormula } from '../../src/lib/progressiveFormula'
import { compileExemptionWrapper } from '../../src/lib/exemptionCondition'
import { computeGridForEmployees } from '../../src/lib/formulaEngine'

export const EMPLOYEE = 'employeeContribution'
export const EMPLOYER = 'employerContribution'
export const OTHER = 'otherDeductions'

function col(def) {
  return { ...newColumn(def), id: `col-${def.key}` }
}

export function input(name, key, extra = {}) {
  return col({ name, key, type: 'input', ...extra })
}

export function simple(name, key, formula, extra = {}) {
  return col({ name, key, type: 'formula', builderMode: 'simple', formula: compileExemptionWrapper(extra.exemption, formula), ...extra })
}

export function tiered(name, key, tieredState, extra = {}) {
  return col({
    name,
    key,
    type: 'formula',
    builderMode: 'tiered',
    tieredKind: 'threshold',
    tiered: tieredState,
    formula: compileExemptionWrapper(extra.exemption, compileTieredFormula(tieredState)),
    ...extra,
  })
}

export function compare(name, key, compareState, extra = {}) {
  return col({
    name,
    key,
    type: 'formula',
    builderMode: 'tiered',
    tieredKind: 'compare',
    compare: compareState,
    formula: compileExemptionWrapper(extra.exemption, compileCompareFormula(compareState)),
    ...extra,
  })
}

export function progressive(name, key, progressiveState, extra = {}) {
  return col({
    name,
    key,
    type: 'formula',
    builderMode: 'progressive',
    progressive: progressiveState,
    formula: compileExemptionWrapper(extra.exemption, compileProgressiveFormula(progressiveState)),
    ...extra,
  })
}

export function checkboxExemption(columnKey, resultValue = 0) {
  return {
    enabled: true,
    conditions: [{ type: 'checkbox', columnKey, checked: true }],
    combineWith: 'AND',
    resultType: 'fixed',
    resultValue,
    resultColumnKey: null,
  }
}

// Computes every column for ONE employee and returns { key: { value, trace } }.
export function computeRow(columns, values) {
  const employee = { id: 'emp-test', values }
  return computeGridForEmployees([employee], columns, getColumnsByKey(columns))['emp-test']
}

// Just the numbers: { key: value }.
export function computeValues(columns, values) {
  const row = computeRow(columns, values)
  return Object.fromEntries(Object.entries(row).map(([k, cell]) => [k, cell.value]))
}

export const identityFields = [
  { id: 'idf-id', name: 'ID', key: 'id' },
  { id: 'idf-name', name: 'Name', key: 'name' },
  { id: 'idf-surname', name: 'Surname', key: 'surname' },
]
export const idFieldKey = 'id'

// The column set used across the audit: every kind of column, all five
// category groups, two columns both called "CSG", and one excluded column
// that an exported formula still needs.
export function testColumns() {
  return [
    input('Basic Salary', 'basicSalary'),
    input('Govt Increment', 'govtIncrement'),
    simple('New Basic', 'newBasic', 'basicSalary + govtIncrement'),
    input('Status', 'status', { valueType: 'text' }),
    input('Allowances', 'allowances'),
    simple('Emoluments', 'emoluments', 'newBasic + allowances'),
    input('Age 60+', 'age60', { valueType: 'checkbox' }),
    input('Bonus Base', 'bonusBase', { excludeFromExport: true }),
    simple('Bonus', 'bonus', 'bonusBase * 0.1'),
    tiered(
      'CSG',
      'csg',
      {
        baseKey: 'newBasic',
        tiers: [
          { operator: 'below', threshold: 50001, rate: 1.5 },
          { operator: 'above', threshold: 50000, rate: 3 },
        ],
        cap: null,
      },
      { category: EMPLOYEE }
    ),
    tiered(
      'NSF',
      'nsf',
      { baseKey: 'newBasic', tiers: [{ operator: 'from', threshold: 0, rate: 1 }], cap: 29710 },
      { category: EMPLOYEE, exemption: checkboxExemption('age60') }
    ),
    progressive(
      'PAYE',
      'paye',
      {
        baseKey: 'emoluments',
        brackets: [
          { width: 38000, rate: 0 },
          { width: 38000, rate: 10 },
          { width: '', rate: 20 },
        ],
      },
      { category: EMPLOYEE }
    ),
    tiered(
      'CSG',
      'csg_employer',
      {
        baseKey: 'newBasic',
        tiers: [
          { operator: 'below', threshold: 50001, rate: 3 },
          { operator: 'above', threshold: 50000, rate: 6 },
        ],
        cap: null,
      },
      { category: EMPLOYER }
    ),
    input('EDF', 'edf', { category: OTHER }),
    compare(
      'Chargeable',
      'chargeable',
      { columnAKey: 'edf', operator: '>', columnBKey: 'emoluments', trueExpr: '0', falseExpr: 'Column B - Column A' },
      { category: OTHER }
    ),
    simple('Net Pay', 'netPay', 'emoluments + bonus - csg - nsf - paye'),
  ]
}

export function testEmployees() {
  return [
    // The owner's regression example: 18,115 + 635 = 18,750.
    { id: 'e1', values: { id: 'TST001', name: 'Alpha', surname: 'Tester', basicSalary: '18115', govtIncrement: '635', status: 'Full Time', allowances: '0', age60: false, bonusBase: '1000', edf: '9000' } },
    // Aged 60+, over the NSF cap, into the top PAYE bracket.
    { id: 'e2', values: { id: 'TST002', name: 'Beta', surname: 'Tester', basicSalary: '95000', govtIncrement: '5000', status: 'Part Time', allowances: '0', age60: true, bonusBase: '0', edf: '390000' } },
    // Above the CSG threshold, not exempt, over the NSF cap.
    { id: 'e3', values: { id: 'TST003', name: 'Gamma', surname: 'Tester', basicSalary: '60000', govtIncrement: '0', status: '', allowances: '2500.5', age60: false, bonusBase: '250.75', edf: '0' } },
  ]
}
