// FAKE data only - this repo is public. One made-up company, a column set
// covering every kind of column the app supports, and two months of made-up
// employees chosen to hit each branch (thresholds, caps, exemptions, blank
// and non-numeric input, awkward decimals).
//
// Columns are built the way the Column form builds them on Save: the builder
// state is compiled to a plain expression, then wrapped by the exemption.

import { newColumn, getEffectiveColumns, getColumnsByKey } from '../../src/lib/model'
import { compileTieredFormula, compileCompareFormula } from '../../src/lib/tieredFormula'
import { compileProgressiveFormula } from '../../src/lib/progressiveFormula'
import { compileExemptionWrapper } from '../../src/lib/exemptionCondition'
import { computeGridForEmployees } from '../../src/lib/formulaEngine'

// newColumn() assigns a random id; pin it so nothing recorded can vary.
function col(def) {
  return { ...newColumn(def), id: `col-${def.key}` }
}

function input(name, key, extra = {}) {
  return col({ name, key, type: 'input', ...extra })
}

function simple(name, key, formula, extra = {}) {
  return col({ name, key, type: 'formula', builderMode: 'simple', formula: compileExemptionWrapper(extra.exemption, formula), ...extra })
}

function tiered(name, key, tieredState, extra = {}) {
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

function compare(name, key, compareState, extra = {}) {
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

function progressive(name, key, progressiveState, extra = {}) {
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

export const identityFields = [
  { id: 'idf-id', name: 'ID', key: 'id' },
  { id: 'idf-surname', name: 'Surname', key: 'surname' },
  { id: 'idf-other', name: 'Other names', key: 'otherNames' },
]
export const idFieldKey = 'id'

const EMPLOYEE = 'employeeContribution'
const EMPLOYER = 'employerContribution'
const OTHER = 'otherDeductions'

export const globalColumns = [
  input('Basic Salary', 'basicSalary'),
  input('Govt Increment', 'govtIncrement'),
  simple('New Basic Salary', 'newBasicSalary', 'basicSalary + govtIncrement'),
  input('Full time / Part time', 'fullTimePartTime', { valueType: 'text' }),
  input('Allowances', 'allowances'),
  simple('Emoluments', 'emoluments', 'newBasicSalary + allowances'),
  input('Travelling', 'travelling'),
  simple('Gross Pay', 'grossPay', 'emoluments + travelling'),
  input('Age 60+', 'aged60', { valueType: 'checkbox' }),
  // Tiered, two thresholds, no cap.
  tiered(
    'CSG',
    'csg',
    {
      baseKey: 'emoluments',
      tiers: [
        { operator: 'below', threshold: '50000', rate: '1.5' },
        { operator: 'from', threshold: '50000', rate: '3' },
      ],
      cap: '',
    },
    { category: EMPLOYEE }
  ),
  // Tiered, single rate with a cap, plus a checkbox exemption.
  tiered(
    'NSF',
    'nsf',
    { baseKey: 'emoluments', tiers: [{ operator: 'from', threshold: '0', rate: '1' }], cap: '29710' },
    {
      category: EMPLOYEE,
      exemption: {
        enabled: true,
        conditions: [{ type: 'checkbox', columnKey: 'aged60', checked: true }],
        combineWith: 'AND',
        resultType: 'fixed',
        resultValue: 0,
        resultColumnKey: null,
      },
    }
  ),
  // Progressive brackets, shown with no decimals.
  progressive(
    'PAYE',
    'paye',
    {
      baseKey: 'emoluments',
      brackets: [
        { width: '30000', rate: '0' },
        { width: '20000', rate: '10' },
        { width: '', rate: '20' },
      ],
    },
    { category: EMPLOYEE, decimals: 0 }
  ),
  simple('Total deductions', 'totalDeductions', 'csg + nsf + paye', { category: EMPLOYEE }),
  simple('Net Pay', 'netPay', 'grossPay - totalDeductions'),
]

const companyColumns = [
  // Tiered, three thresholds (below / equal / above) with a cap, 3 decimals.
  tiered(
    'Levy',
    'levy',
    {
      baseKey: 'emoluments',
      tiers: [
        { operator: 'below', threshold: '20000', rate: '0' },
        { operator: 'equal', threshold: '50000', rate: '2' },
        { operator: 'above', threshold: '20000', rate: '1.5' },
      ],
      cap: '100000',
    },
    { category: EMPLOYER, decimals: 3 }
  ),
  // Plain formula with a two-condition (OR) exemption that returns another column.
  simple('PRGF', 'prgf', 'emoluments * 0.045', {
    category: EMPLOYER,
    exemption: {
      enabled: true,
      conditions: [
        { type: 'compare', columnKey: 'emoluments', operator: '>', compareToType: 'value', compareToValue: '200000', compareToColumnKey: null },
        { type: 'compare', columnKey: 'basicSalary', operator: '<', compareToType: 'column', compareToValue: 0, compareToColumnKey: 'allowances' },
      ],
      combineWith: 'OR',
      resultType: 'column',
      resultValue: 0,
      resultColumnKey: 'travelling',
    },
  }),
  simple('Total MRA contributions', 'totalMra', 'csg + nsf + paye + levy + prgf', { category: EMPLOYER }),
  input('EDF', 'edf', { category: OTHER, decimals: 0 }),
  simple('EDF (monthly)', 'edfMonthly', 'edf / 13', { category: OTHER }),
  // Compare two columns.
  compare(
    'Total',
    'total',
    { columnAKey: 'edfMonthly', operator: '>', columnBKey: 'emoluments', trueExpr: '0', falseExpr: 'Column B - Column A' },
    { category: OTHER }
  ),
  input('Internal Note', 'internalNote', { valueType: 'text', excludeFromExport: true }),
]

export const company = {
  id: 'company-fake',
  name: 'Fake Co Ltd',
  columns: companyColumns,
  columnWidths: {},
  viewYear: 2026,
  viewMonth: 10,
  details: {
    address: '1 Test Street\nPort Louis',
    brn: 'C00000001',
    customFields: [
      { id: 'cf-vat', label: 'VAT', value: 'VAT-FAKE-1' },
      // Same label as the "Levy" column, so the export has to disambiguate it.
      { id: 'cf-levy', label: 'Levy', value: 'Levy ref 42' },
    ],
  },
}

export const effectiveColumns = getEffectiveColumns(company, globalColumns)
export const columnsByKey = getColumnsByKey(effectiveColumns)

function emp(id, values) {
  return { id, values }
}

// October 2026 - the month "on screen".
export const octoberEmployees = [
  // Ordinary case, below every threshold.
  emp('emp-oct-1', {
    id: 'F001', surname: 'Testeur', otherNames: 'Alpha Fake',
    basicSalary: '18115', govtIncrement: '', fullTimePartTime: 'Full time', allowances: '2000', travelling: '1500',
    aged60: false, edf: '390000', internalNote: '',
  }),
  // Emoluments of exactly 50,000 (tier boundaries).
  emp('emp-oct-2', {
    id: 'F002', surname: 'Exemple, Jr', otherNames: 'Beta "B" Fake',
    basicSalary: '48000', govtIncrement: '500', fullTimePartTime: 'Full time', allowances: '1500', travelling: '0',
    aged60: false, edf: '0', internalNote: 'check, "quoted"',
  }),
  // High earner: over the NSF and Levy caps, PRGF exemption (value condition), awkward decimals.
  emp('emp-oct-3', {
    id: 'F003', surname: 'Specimen', otherNames: 'Gamma Fake',
    basicSalary: '250000', govtIncrement: '0', fullTimePartTime: 'Full time', allowances: '10000.555', travelling: '0',
    aged60: false, edf: '500000', internalNote: '',
  }),
  // Aged 60+ (NSF exemption), part time, EDF larger than emoluments.
  emp('emp-oct-4', {
    id: 'F004', surname: 'Dummy', otherNames: 'Delta Fake',
    basicSalary: '30000.005', govtIncrement: '635', fullTimePartTime: 'Part time', allowances: '', travelling: '750.5',
    aged60: true, edf: '1000000', internalNote: 'part time',
  }),
  // Non-numeric and blank input; PRGF exemption (column condition).
  emp('emp-oct-5', {
    id: 'F005', surname: 'Placeholder', otherNames: 'Epsilon Fake',
    basicSalary: 'abc', govtIncrement: '', fullTimePartTime: '', allowances: '5000', travelling: '300',
    aged60: 'true', edf: '', internalNote: '',
  }),
  // Nothing filled in except the ID.
  emp('emp-oct-6', { id: 'F006', surname: 'Blank', otherNames: 'Zeta Fake' }),
]

// September 2026 - only used by the Totals check.
export const septemberEmployees = [
  emp('emp-sep-1', {
    id: 'F001', surname: 'Testeur', otherNames: 'Alpha Fake',
    basicSalary: '17500', govtIncrement: '615', fullTimePartTime: 'Full time', allowances: '1000', travelling: '1500',
    aged60: false, edf: '390000',
  }),
  emp('emp-sep-2', {
    id: 'F002', surname: 'Exemple, Jr', otherNames: 'Beta "B" Fake',
    basicSalary: '60000', govtIncrement: '0', fullTimePartTime: 'Full time', allowances: '2500.25', travelling: '0',
    aged60: false, edf: '0',
  }),
  // Only present in September.
  emp('emp-sep-7', {
    id: 'F007', surname: 'Leaver', otherNames: 'Eta Fake',
    basicSalary: '22000', govtIncrement: '', fullTimePartTime: 'Part time', allowances: '0', travelling: '400',
    aged60: true, edf: '130000',
  }),
  // No ID: can't be matched across months, so it stays a row of its own.
  emp('emp-sep-noid', {
    id: '', surname: 'Unnumbered', otherNames: 'Theta Fake',
    basicSalary: '15000', govtIncrement: '', fullTimePartTime: 'Full time', allowances: '', travelling: '',
    aged60: false, edf: '',
  }),
]

export const octoberGrid = computeGridForEmployees(octoberEmployees, effectiveColumns, columnsByKey)
