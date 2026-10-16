// Audit, part 3: import and export. The generated .xlsx files are opened
// again and read cell by cell; the live formulas are worked out with a small
// independent Excel evaluator (excelEval.js) and compared with the app's
// figures. TEST data only.
//
// `test.fails` marks a bug: see the note at the top of formulaEngine.test.js.

import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'
import { beforeAll, describe, expect, test } from 'vitest'
import { getColumnsByKey, makeId } from '../../src/lib/model'
import { computeGridForEmployees } from '../../src/lib/formulaEngine'
import { buildExportPlan, buildWorkbookBuffer, columnsWrittenAsFigures, formatCompanyDetailsLine } from '../../src/lib/excelExport'
import {
  parseWorkbookFile,
  getImportableSystemFields,
  guessMapping,
  resolveImportMapping,
  isRecognizedExport,
  describeUnrecognizedMeta,
  buildImportedEmployees,
  parseCheckboxValue,
  parseNumberCell,
  findUnreadableValues,
} from '../../src/lib/excelImport'
import { ERROR_TEXT, findErrorCells, isErrorCell } from '../../src/lib/exportErrors'
import {
  buildPdfFillColumns,
  buildPdfFillColumnGroups,
  buildPdfFillRows,
  buildCompanyDetailFields,
  resolveCompanyFieldHeaders,
  buildCsvContent,
  buildJsonContent,
  buildPdfFillFilename,
  downloadPdfFillExport,
  findClashingHeaders,
  pdfFillHeaders,
} from '../../src/lib/pdfFillExport'
import { computeTotals } from '../../src/lib/totals'
import { evaluateExcelFormula, isExcelError } from './excelEval'
import { identityFields, idFieldKey, input, simple, testColumns, testEmployees } from './build'

const COMPANY_ID = 'test-co-a'
const DETAILS = { address: '1 Test Street\nTestville', brn: 'TEST-BRN-A', customFields: [{ id: 'cf1', label: 'VAT No', value: 'TEST-VAT-1' }] }

const columns = testColumns()
const employees = testEmployees()
const grid = computeGridForEmployees(employees, columns, getColumnsByKey(columns))
const appValue = (employeeIndex, key) => grid[employees[employeeIndex].id][key].value

function planFor(exportMode, overrides = {}) {
  return buildExportPlan({
    title: 'TEST Co A',
    companyId: COMPANY_ID,
    companyDetails: DETAILS,
    kind: 'period',
    exportMode,
    employees,
    identityFields,
    effectiveColumns: columns,
    computedGrid: grid,
    ...overrides,
  })
}

async function openWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  return workbook
}

const asFile = (bytes) => ({ name: 'test.xlsx', arrayBuffer: async () => bytes })
const letter = (n) => (n > 26 ? String.fromCharCode(64 + Math.floor((n - 1) / 26)) : '') + String.fromCharCode(65 + ((n - 1) % 26))

const HEADERS = ['ID', 'Name', 'Surname', 'Basic Salary', 'Govt Increment', 'New Basic (calc)', 'Status', 'Allowances', 'Emoluments (calc)', 'Age 60+', 'Bonus (calc)', 'Net Pay (calc)', 'CSG (calc)', 'NSF (calc)', 'PAYE (calc)', 'CSG (calc)', 'EDF', 'Chargeable (calc)']
const KEYS = ['id', 'name', 'surname', 'basicSalary', 'govtIncrement', 'newBasic', 'status', 'allowances', 'emoluments', 'age60', 'bonus', 'netPay', 'csg', 'nsf', 'paye', 'csg_employer', 'edf', 'chargeable']
const FORMULA_KEYS = ['newBasic', 'emoluments', 'bonus', 'netPay', 'csg', 'nsf', 'paye', 'csg_employer', 'chargeable']
const NUMBER_KEYS = ['basicSalary', 'govtIncrement', 'allowances', 'edf', ...FORMULA_KEYS]
const columnOf = (key) => KEYS.indexOf(key) + 1

describe('Excel export with values', () => {
  let workbook
  let sheet
  beforeAll(async () => {
    workbook = await openWorkbook(await buildWorkbookBuffer({ ...planFor('values'), showCompanyDetails: true }))
    sheet = workbook.getWorksheet('Payroll')
  })

  test('title, date line and company details line', () => {
    expect(sheet.getCell('A1').value).toBe('TEST Co A')
    expect(sheet.getCell('A2').value).toMatch(/^Exported /)
    expect(sheet.getCell('A3').value).toBe('1 Test Street, Testville   •   BRN: TEST-BRN-A')
    expect(formatCompanyDetailsLine(DETAILS)).toBe(sheet.getCell('A3').value)
  })

  test('all five category headers, each over its own columns', () => {
    const row = Array.from({ length: KEYS.length }, (_, i) => sheet.getCell(5, i + 1).value)
    expect(row).toEqual([
      'Identifiers', 'Identifiers', 'Identifiers',
      'General', 'General', 'General', 'General', 'General', 'General', 'General', 'General', 'General',
      'Employee Contribution', 'Employee Contribution', 'Employee Contribution',
      'Employer Contribution',
      'Other Deductions', 'Other Deductions',
    ])
  })

  test('only the system columns, in order; the excluded column is not there', () => {
    expect(sheet.columnCount).toBe(HEADERS.length)
    expect(Array.from({ length: HEADERS.length }, (_, i) => sheet.getCell(6, i + 1).value)).toEqual(HEADERS)
    expect(HEADERS.join('|')).not.toContain('Bonus Base')
  })

  test('every cell holds the app\'s figure', () => {
    employees.forEach((employee, index) => {
      const row = 7 + index
      expect(sheet.getCell(row, 1).value).toBe(employee.values.id)
      expect(sheet.getCell(row, 2).value).toBe(employee.values.name)
      expect(sheet.getCell(row, columnOf('status')).value ?? '').toBe(employee.values.status)
      expect(sheet.getCell(row, columnOf('age60')).value).toBe(employee.values.age60 ? 'Yes' : 'No')
      for (const key of NUMBER_KEYS) {
        expect(sheet.getCell(row, columnOf(key)).value, `${employee.values.id} ${key}`).toBe(appValue(index, key))
      }
    })
  })

  test('the regression example is in the file: 18,750 / 281.25 / 187.50', () => {
    expect(sheet.getCell(7, columnOf('newBasic')).value).toBe(18750)
    expect(sheet.getCell(7, columnOf('csg')).value).toBe(281.25)
    expect(sheet.getCell(7, columnOf('nsf')).value).toBe(187.5)
  })

  test('no cell holds a formula', () => {
    sheet.eachRow((row) => row.eachCell((cell) => expect(cell.formula, cell.address).toBeUndefined()))
  })

  test('number formats: two decimals on figures, none on text', () => {
    for (const key of NUMBER_KEYS) expect(sheet.getCell(7, columnOf(key)).numFmt, key).toBe('#,##0.00')
    for (const key of ['id', 'name', 'surname', 'status', 'age60']) expect(sheet.getCell(7, columnOf(key)).numFmt, key).toBeFalsy()
  })

  test('a column set to 0 or 3 decimals gets that format', async () => {
    const custom = [input('Whole', 'whole', { decimals: 0 }), simple('Fine', 'fine', 'whole / 3', { decimals: 3 })]
    const people = [{ id: 'e1', values: { id: 'TST001', whole: '10' } }]
    const plan = buildExportPlan({ title: 'TEST Co A', companyId: COMPANY_ID, employees: people, identityFields, effectiveColumns: custom, computedGrid: computeGridForEmployees(people, custom, getColumnsByKey(custom)) })
    const ws = (await openWorkbook(await buildWorkbookBuffer(plan))).getWorksheet('Payroll')
    expect(ws.getCell(7, 4).numFmt).toBe('#,##0')
    expect(ws.getCell(7, 5).numFmt).toBe('#,##0.000')
    expect(ws.getCell(7, 5).value).toBeCloseTo(3.3333333333, 8)
  })

  test('the totals row adds up every figure column', () => {
    const row = 7 + employees.length
    expect(sheet.getCell(row, 1).value).toBe('TOTAL')
    for (const key of NUMBER_KEYS) {
      const expected = employees.reduce((sum, _e, index) => sum + appValue(index, key), 0)
      expect(sheet.getCell(row, columnOf(key)).value, key).toBeCloseTo(expected, 8)
    }
    // By hand: 18,115 + 95,000 + 60,000 and 281.25 + 3,000 + 1,800
    expect(sheet.getCell(row, columnOf('basicSalary')).value).toBe(173115)
    expect(sheet.getCell(row, columnOf('csg')).value).toBe(5081.25)
    expect(sheet.getCell(row, columnOf('age60')).value).toBe('1 ticked')
    expect(sheet.getCell(row, columnOf('status')).value ?? '').toBe('')
  })

  test('the header row is frozen and the _meta sheet is hidden', () => {
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 6 })
    expect(workbook.getWorksheet('_meta').state).toBe('veryHidden')
    const meta = JSON.parse(workbook.getWorksheet('_meta').getCell('A1').value)
    expect(meta).toMatchObject({ generator: 'payroll-sys', version: 2, kind: 'period', companyId: COMPANY_ID, columnKeys: KEYS })
    expect(meta.excludedValues).toEqual({ bonusBase: [1000, 0, 250.75] })
  })

  test('the company details line is left blank when not ticked', async () => {
    const ws = (await openWorkbook(await buildWorkbookBuffer({ ...planFor('values'), showCompanyDetails: false }))).getWorksheet('Payroll')
    expect(ws.getCell('A3').value ?? '').toBe('')
    expect(ws.getCell(6, 1).value).toBe('ID')
  })
})

describe('Excel export with live formulas', () => {
  let buffer
  let sheet
  beforeAll(async () => {
    buffer = await buildWorkbookBuffer({ ...planFor('formulas'), showCompanyDetails: true })
    sheet = (await openWorkbook(buffer)).getWorksheet('Payroll')
  })

  const getCell = (ref) => {
    const cell = sheet.getCell(ref)
    if (cell.formula) return { formula: cell.formula }
    return cell.value ?? null
  }
  const liveValue = (row, key) => evaluateExcelFormula(sheet.getCell(row, columnOf(key)).formula, getCell)

  test('every formula column holds a formula in every row', () => {
    employees.forEach((_e, index) => {
      for (const key of FORMULA_KEYS) expect(sheet.getCell(7 + index, columnOf(key)).formula, `${key} row ${7 + index}`).toBeTruthy()
    })
  })

  test('the formulas, written out for the first employee', () => {
    const f = (key) => sheet.getCell(7, columnOf(key)).formula
    expect(f('newBasic')).toBe('(D7+E7)')
    expect(f('emoluments')).toBe('(F7+H7)')
    expect(f('csg')).toBe('(F7*IF((F7<50001),0.015,IF((F7>50000),0.03,0)))')
    expect(f('nsf')).toBe('IF((J7=1),0,(MIN(F7,29710)*0.01))')
    expect(f('paye')).toBe('(((MAX(0,(MIN(I7,38000)-0))*0)+(MAX(0,(MIN(I7,76000)-38000))*0.1))+(MAX(0,(I7-76000))*0.2))')
    expect(f('chargeable')).toBe('IF((Q7>I7),0,(I7-Q7))')
    expect(f('netPay')).toBe('((((I7+K7)-M7)-N7)-O7)')
  })

  test('input cells stay plain values', () => {
    for (const key of ['basicSalary', 'govtIncrement', 'allowances', 'edf']) {
      expect(sheet.getCell(7, columnOf(key)).formula).toBeUndefined()
      expect(sheet.getCell(7, columnOf(key)).value).toBe(appValue(0, key))
    }
  })

  test('a non-zero result is cached in the file, equal to the app\'s figure', () => {
    employees.forEach((_e, index) => {
      for (const key of FORMULA_KEYS) {
        if (appValue(index, key) === 0) continue
        expect(sheet.getCell(7 + index, columnOf(key)).result, `${key} row ${7 + index}`).toBe(appValue(index, key))
      }
    })
  })

  // Read with a second library: the one above drops a cached 0 when it reads
  // a file back, which would look like a missing value.
  test('a result of 0 is cached in the file too', () => {
    const raw = XLSX.read(buffer, { type: 'array' }).Sheets.Payroll
    const zeroCells = []
    employees.forEach((_e, index) => {
      for (const key of FORMULA_KEYS) if (appValue(index, key) === 0) zeroCells.push(`${letter(columnOf(key))}${7 + index}`)
    })
    expect(zeroCells.length).toBeGreaterThan(0)
    for (const ref of zeroCells) expect(raw[ref]?.v, ref).toBe(0)
  })

  test('the excluded column a formula needs is there, as a hidden column', () => {
    const hiddenIndex = HEADERS.length + 1
    expect(sheet.columnCount).toBe(hiddenIndex)
    expect(sheet.getCell(6, hiddenIndex).value).toBe('Bonus Base (hidden)')
    expect(sheet.getColumn(hiddenIndex).hidden).toBe(true)
    expect([7, 8, 9].map((r) => sheet.getCell(r, hiddenIndex).value)).toEqual([1000, 0, 250.75])
    expect(sheet.getCell(7, columnOf('bonus')).formula).toBe(`(${letter(hiddenIndex)}7*0.1)`)
    for (let c = 1; c <= HEADERS.length; c++) expect(Boolean(sheet.getColumn(c).hidden), `column ${c}`).toBe(false)
  })

  test('an excluded column that no formula needs is not written at all', async () => {
    const withNote = [...columns, input('Internal Note', 'internalNote', { valueType: 'text', excludeFromExport: true })]
    const g = computeGridForEmployees(employees, withNote, getColumnsByKey(withNote))
    const ws = (await openWorkbook(await buildWorkbookBuffer(planFor('formulas', { effectiveColumns: withNote, computedGrid: g })))).getWorksheet('Payroll')
    const headers = Array.from({ length: ws.columnCount }, (_, i) => String(ws.getCell(6, i + 1).value))
    expect(headers.some((h) => h.includes('Internal Note'))).toBe(false)
  })

  test('the totals row is a SUM over the data rows', () => {
    const row = 7 + employees.length
    for (const key of NUMBER_KEYS) {
      const col = letter(columnOf(key))
      expect(sheet.getCell(row, columnOf(key)).formula, key).toBe(`SUM(${col}7:${col}9)`)
    }
    expect(sheet.getCell(row, columnOf('age60')).value).toBe('1 ticked')
  })

  // The exemption formulas test a checkbox against 1, and in a spreadsheet
  // the text "Yes" is never equal to 1. So in this file a checkbox cell
  // holds 1 or 0 and is only displayed as Yes / No.
  test('a checkbox cell holds 1 or 0, displayed as Yes / No', () => {
    expect([7, 8, 9].map((r) => sheet.getCell(r, columnOf('age60')).value)).toEqual([0, 1, 0])
    for (const r of [7, 8, 9]) expect(sheet.getCell(r, columnOf('age60')).numFmt).toBe('"Yes";"Yes";"No"')
    expect(sheet.getCell(7, columnOf('nsf')).formula).toBe('IF((J7=1),0,(MIN(F7,29710)*0.01))')
  })

  test('worked out as a spreadsheet would, EVERY formula in every row matches the app', () => {
    employees.forEach((_e, index) => {
      for (const key of FORMULA_KEYS) {
        const live = liveValue(7 + index, key)
        expect(isExcelError(live), `${key} row ${7 + index}`).toBe(false)
        expect(live, `${key} row ${7 + index}`).toBeCloseTo(appValue(index, key), 8)
      }
    })
  })

  test('the live NSF of the employee ticked "Age 60+" is 0, as in the app', () => {
    expect(employees[1].values.age60).toBe(true)
    expect(appValue(1, 'nsf')).toBe(0)
    expect(liveValue(8, 'nsf')).toBe(0)
  })

  test('the live Net Pay of that employee matches the app: 88,400', () => {
    expect(liveValue(8, 'netPay')).toBe(88400)
    expect(appValue(1, 'netPay')).toBe(88400)
  })

  test('the live totals match the app\'s totals', () => {
    const row = 7 + employees.length
    for (const key of NUMBER_KEYS) {
      const expected = employees.reduce((sum, _e, index) => sum + appValue(index, key), 0)
      expect(evaluateExcelFormula(sheet.getCell(row, columnOf(key)).formula, getCell), key).toBeCloseTo(expected, 8)
    }
  })

  test('changing the cell to 0 in the spreadsheet brings the NSF back, as unticking does in the app', () => {
    const unticked = (ref) => (ref === 'J8' ? 0 : getCell(ref))
    expect(evaluateExcelFormula(sheet.getCell('N8').formula, unticked)).toBeCloseTo(297.1, 8)
  })

  test('a values export keeps Yes / No as text, as before', async () => {
    const values = (await openWorkbook(await buildWorkbookBuffer(planFor('values')))).getWorksheet('Payroll')
    expect([7, 8, 9].map((r) => values.getCell(r, columnOf('age60')).value)).toEqual(['No', 'Yes', 'No'])
  })

  // Was an audit bug (report M4): Math.round / Math.floor / Math.ceil work in
  // the app and are accepted on save, but could not be written as a formula,
  // so that one column silently became a fixed number in a file that is
  // meant to recalculate.
  test('a column using Math.round is exported as a live formula', async () => {
    const rounded = [input('Basic Salary', 'basicSalary'), simple('Rounded', 'rounded', 'Math.round(basicSalary * 0.015)')]
    const people = [{ id: 'e1', values: { id: 'TST001', basicSalary: '18115' } }]
    const g = computeGridForEmployees(people, rounded, getColumnsByKey(rounded))
    expect(g.e1.rounded.value).toBe(272)
    const plan = buildExportPlan({ title: 'TEST Co A', companyId: COMPANY_ID, exportMode: 'formulas', employees: people, identityFields, effectiveColumns: rounded, computedGrid: g })
    const ws = (await openWorkbook(await buildWorkbookBuffer(plan))).getWorksheet('Payroll')
    expect(ws.getCell(7, 5).formula).toBeTruthy()
  })

  test('Math.round, Math.floor and Math.ceil give in Excel exactly what they give in the app, halves and minus figures included', async () => {
    const cols = [
      input('Basic Salary', 'basicSalary'),
      simple('Rounded', 'rounded', 'Math.round(basicSalary / 2)'),
      simple('Floored', 'floored', 'Math.floor(basicSalary / 2)'),
      simple('Ceiled', 'ceiled', 'Math.ceil(basicSalary / 2) + 1'),
    ]
    const people = [5, -5, 4, -7, 18115, 0.4].map((v, i) => ({ id: `e${i}`, values: { id: `TST00${i}`, basicSalary: String(v) } }))
    const g = computeGridForEmployees(people, cols, getColumnsByKey(cols))
    const plan = buildExportPlan({ title: 'TEST Co A', companyId: COMPANY_ID, exportMode: 'formulas', employees: people, identityFields, effectiveColumns: cols, computedGrid: g })
    const ws = (await openWorkbook(await buildWorkbookBuffer(plan))).getWorksheet('Payroll')
    const header = ws.getRow(6).values
    const at = (name) => header.indexOf(name)
    people.forEach((person, i) => {
      const row = 7 + i
      const cellAt = (ref) => ws.getCell(ref).value
      for (const key of ['rounded', 'floored', 'ceiled']) {
        const name = cols.find((c) => c.key === key).name
        const cell = ws.getCell(row, at(`${name} (calc)`))
        expect(cell.formula, `${person.values.basicSalary} ${key}`).toMatch(/INT\(/)
        expect(evaluateExcelFormula(cell.formula, cellAt), `${person.values.basicSalary} ${key}`).toBe(g[person.id][key].value)
      }
    })
    // The half-way cases that tell the ways of rounding apart: 2.5 → 3, -2.5 → -2.
    expect([g.e0.rounded.value, g.e1.rounded.value]).toEqual([3, -2])
  })

  test('the preview names exactly the formula columns that the file writes as fixed figures', async () => {
    const cols = [input('Basic Salary', 'basicSalary'), simple('Rounded', 'rounded', 'Math.round(basicSalary * 0.015)'), simple('Logged', 'logged', 'Math.log(basicSalary)')]
    const people = [{ id: 'e1', values: { id: 'TST001', basicSalary: '18115' } }]
    const g = computeGridForEmployees(people, cols, getColumnsByKey(cols))
    const planIn = (exportMode) => buildExportPlan({ title: 'TEST Co A', companyId: COMPANY_ID, exportMode, employees: people, identityFields, effectiveColumns: cols, computedGrid: g })
    expect(columnsWrittenAsFigures(planIn('formulas'))).toEqual(['Logged'])
    expect(columnsWrittenAsFigures(planIn('values'))).toEqual([])
    // The same columns in the file itself.
    const ws = (await openWorkbook(await buildWorkbookBuffer(planIn('formulas')))).getWorksheet('Payroll')
    const header = ws.getRow(6).values
    expect(ws.getCell(7, header.indexOf('Rounded (calc)')).formula).toBeTruthy()
    expect(ws.getCell(7, header.indexOf('Logged (calc)')).formula).toBeUndefined()
    // The app's own test columns are all written as formulas.
    expect(columnsWrittenAsFigures(planFor('formulas'))).toEqual([])
  })
})

describe('a formula in error', () => {
  const broken = [input('Basic Salary', 'basicSalary'), simple('PAYE', 'paye', 'basicSalary * rateThatWasDeleted')]
  const people = [{ id: 'e1', values: { id: 'TST001', basicSalary: '50000' } }]
  const g = computeGridForEmployees(people, broken, getColumnsByKey(broken))

  test('the app shows it as an error', () => {
    expect(g.e1.paye.trace.error).toContain('rateThatWasDeleted is not defined')
  })

  // A figure in error is never exported as a number: every export writes
  // the text "Error", after warning which employees and columns are affected.
  const planOf = (exportMode) => buildExportPlan({ title: 'TEST Co A', companyId: COMPANY_ID, exportMode, employees: people, identityFields, effectiveColumns: broken, computedGrid: g })

  test('the cells to warn about are listed by employee and column', () => {
    expect(findErrorCells(people, planOf('values').columns, g, identityFields)).toEqual([{ employee: 'TST001', column: 'PAYE' }])
    expect(findErrorCells(testEmployees(), planFor('values').columns, grid, identityFields)).toEqual([])
  })

  test('an employee with no identity values is named by position', () => {
    const anonymous = [{ id: 'e1', values: { basicSalary: '1' } }]
    const ga = computeGridForEmployees(anonymous, broken, getColumnsByKey(broken))
    expect(findErrorCells(anonymous, broken, ga, identityFields)).toEqual([{ employee: 'Row 1', column: 'PAYE' }])
  })

  test('the Excel export writes "Error" for it, and for the column\'s total', () => {
    const plan = planOf('values')
    expect(plan.rows[0]).toEqual(['TST001', '', '', 50000, ERROR_TEXT])
    expect(plan.totalsRow).toEqual(['TOTAL', '', '', 50000, ERROR_TEXT])
  })

  test.each(['values', 'formulas'])('in the %s file the cell is the text "Error": no number, no formula', async (mode) => {
    const ws = (await openWorkbook(await buildWorkbookBuffer(planOf(mode)))).getWorksheet('Payroll')
    for (const row of [7, 8]) {
      expect(ws.getCell(row, 5).value).toBe('Error')
      expect(ws.getCell(row, 5).formula).toBeUndefined()
    }
    expect(ws.getCell(7, 4).value).toBe(50000)
  })

  test('the PDF fill export writes "Error" for it', () => {
    const rows = buildPdfFillRows(buildPdfFillColumns(identityFields, broken), people, g)
    expect(rows[0]).toEqual({ ID: 'TST001', Name: '', Surname: '', 'Basic Salary': 50000, PAYE: 'Error' })
    expect(buildCsvContent(['ID', 'PAYE'], rows)).toBe('ID,PAYE\r\nTST001,Error')
  })

  test('Totals marks it as an error, saying which month, and the Totals export writes "Error"', () => {
    const fine = [{ id: 'e2', values: { id: 'TST002', basicSalary: '100' } }]
    const totals = computeTotals(
      [{ year: 2026, month: 8, employees: fine }, { year: 2026, month: 9, employees: people }],
      broken,
      getColumnsByKey(broken),
      idFieldKey
    )
    const cell = totals.computedGrid['id:TST001'].paye
    expect(isErrorCell(cell)).toBe(true)
    expect(cell.error).toBe('In error in September 2026')
    // The figures that are fine are still added up.
    expect(totals.computedGrid['id:TST001'].basicSalary.value).toBe(50000)
    const plan = buildExportPlan({ title: 'TEST Co A', companyId: COMPANY_ID, kind: 'totals', employees: totals.employees, identityFields, effectiveColumns: broken, computedGrid: totals.computedGrid })
    expect(plan.rows.map((r) => r[4])).toEqual([ERROR_TEXT, ERROR_TEXT])
  })

  test('a division by zero is exported as "Error" too', () => {
    const cols = [input('Basic Salary', 'basicSalary'), input('Days', 'days'), simple('Daily', 'daily', 'basicSalary / days')]
    const one = [{ id: 'e1', values: { id: 'TST001', basicSalary: '100', days: '0' } }]
    const rows = buildPdfFillRows(buildPdfFillColumns(identityFields, cols), one, computeGridForEmployees(one, cols, getColumnsByKey(cols)))
    expect(rows[0].Daily).toBe('Error')
  })
})

describe('Import from Excel: an outside file, mapped by hand', () => {
  const fields = getImportableSystemFields(identityFields, columns)

  function workbookBytes(rows) {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  }

  const external = () =>
    workbookBytes([
      ['TEST Co A - payroll input'],
      [],
      ['id', 'NAME', 'Surname', 'Salary', 'govt increment', 'Status', 'Allowances', 'Age 60+', 'Bonus Base', 'EDF', 'Remarks'],
      ['TST101', 'Uno', 'Importee', 21000, 500, 'Full Time', 1500.5, 'No', 100, 390000, 'x'],
      ['TST102', 'Dos', 'Importee', 34500.75, '', 'Part Time', '', 'Yes', '', '', ''],
      [],
      ['TST103', 'Tres', 'Importee', 60000, 0, '', 0, 'TRUE', 0, 0, ''],
    ])

  test('only input columns and identity fields can be imported into', () => {
    expect(fields.map((f) => f.key)).toEqual(['id', 'name', 'surname', 'basicSalary', 'govtIncrement', 'status', 'allowances', 'age60', 'bonusBase', 'edf'])
  })

  test('the header row is found below the banner, and is not imported as a row', async () => {
    const { headers, rows, meta } = await parseWorkbookFile(asFile(external()))
    expect(meta).toBeNull()
    expect(headers).toEqual(['id', 'NAME', 'Surname', 'Salary', 'govt increment', 'Status', 'Allowances', 'Age 60+', 'Bonus Base', 'EDF', 'Remarks'])
    expect(rows.map((r) => r[0])).toEqual(['TST101', 'TST102', 'TST103'])
  })

  test('headers are matched to fields whatever their case; the rest is left to map by hand', async () => {
    const { headers } = await parseWorkbookFile(asFile(external()))
    const mapping = guessMapping(fields, headers)
    expect(mapping).toEqual({ id: 0, name: 1, surname: 2, basicSalary: null, govtIncrement: 4, status: 5, allowances: 6, age60: 7, bonusBase: 8, edf: 9 })
  })

  test('every mapped column is filled; text stays text, a blank number is 0', async () => {
    const { headers, rows } = await parseWorkbookFile(asFile(external()))
    const mapping = { ...guessMapping(fields, headers), basicSalary: 3 }
    let n = 0
    const imported = buildImportedEmployees({ rows, systemFields: fields, mapping, makeId: () => `new-${++n}` })
    expect(imported).toEqual([
      { id: 'new-1', values: { id: 'TST101', name: 'Uno', surname: 'Importee', basicSalary: 21000, govtIncrement: 500, status: 'Full Time', allowances: 1500.5, age60: false, bonusBase: 100, edf: 390000 } },
      { id: 'new-2', values: { id: 'TST102', name: 'Dos', surname: 'Importee', basicSalary: 34500.75, govtIncrement: 0, status: 'Part Time', allowances: 0, age60: true, bonusBase: 0, edf: 0 } },
      { id: 'new-3', values: { id: 'TST103', name: 'Tres', surname: 'Importee', basicSalary: 60000, govtIncrement: 0, status: '', allowances: 0, age60: true, bonusBase: 0, edf: 0 } },
    ])
  })

  test('a text column never turns into 0', async () => {
    const { headers, rows } = await parseWorkbookFile(asFile(external()))
    const imported = buildImportedEmployees({ rows, systemFields: fields, mapping: guessMapping(fields, headers), makeId })
    expect(imported.map((e) => e.values.status)).toEqual(['Full Time', 'Part Time', ''])
  })

  test('a numeric ID in the file is kept as text', async () => {
    const bytes = workbookBytes([['ID', 'Name'], [1001, 'Uno'], ['007', 'Dos']])
    const { headers, rows } = await parseWorkbookFile(asFile(bytes))
    const imported = buildImportedEmployees({ rows, systemFields: fields, mapping: guessMapping(fields, headers), makeId })
    expect(imported.map((e) => e.values.id)).toEqual(['1001', '007'])
  })

  test.each([
    ['Yes', true], ['yes', true], ['Y', true], ['TRUE', true], [true, true], [1, true], ['x', true],
    ['No', false], ['', false], [undefined, false], [0, false], ['maybe', false],
  ])('checkbox cell %o is read as %o', (raw, expected) => {
    expect(parseCheckboxValue(raw)).toBe(expected)
  })

  // Many payroll files hold figures as text. They are read as the numbers
  // they are; anything that is not a number is left blank and reported.
  test('"18,115.00" stored as text in the file is imported as 18115', async () => {
    const bytes = workbookBytes([['ID', 'Basic Salary'], ['TST201', '18,115.00']])
    const { headers, rows } = await parseWorkbookFile(asFile(bytes))
    const imported = buildImportedEmployees({ rows, systemFields: fields, mapping: guessMapping(fields, headers), makeId })
    expect(imported[0].values.basicSalary).toBe(18115)
  })

  test('"Rs 18115" stored as text in the file is imported as 18115', async () => {
    const bytes = workbookBytes([['ID', 'Basic Salary'], ['TST202', 'Rs 18115']])
    const { headers, rows } = await parseWorkbookFile(asFile(bytes))
    const imported = buildImportedEmployees({ rows, systemFields: fields, mapping: guessMapping(fields, headers), makeId })
    expect(imported[0].values.basicSalary).toBe(18115)
  })

  test.each([
    [18115, 18115],
    ['18115', 18115],
    ['18,115.00', 18115],
    ['1,234,567.89', 1234567.89],
    ['Rs 18115', 18115],
    ['Rs. 18,115.50', 18115.5],
    ['Rs18,115', 18115],
    ['MUR 18 115.25', 18115.25],
    ['18 115', 18115],
    ['  18115.75  ', 18115.75],
    ['18115 Rs', 18115],
    ['-250.5', -250.5],
    ['(1,200.00)', -1200],
    ['+42', 42],
    ['.5', 0.5],
    ['0', 0],
    ['1e3', 1000],
  ])('the cell %o is read as %f', (raw, expected) => {
    expect(parseNumberCell(raw)).toEqual({ ok: true, value: expected })
  })

  test.each([[''], [undefined], [null], ['   ']])('a blank cell %o is 0, as before', (raw) => {
    expect(parseNumberCell(raw)).toEqual({ ok: true, value: 0 })
  })

  test.each([['n/a'], ['abc'], ['-'], ['Rs'], ['12,34'], ['1.2.3'], ['18115 per month'], ['TBC'], [true]])('the cell %o is not a number', (raw) => {
    expect(parseNumberCell(raw)).toEqual({ ok: false })
  })

  test('a cell that is not a number is left blank and reported, never written as 0', async () => {
    const bytes = workbookBytes([
      ['ID', 'Name', 'Basic Salary', 'Allowances', 'Status'],
      ['TST301', 'Uno', 'n/a', '1,500.50', 'n/a'],
      ['TST302', 'Dos', 20000, 'TBC', 'Full Time'],
      ['', '', 'pending', 5, ''],
    ])
    const { headers, rows } = await parseWorkbookFile(asFile(bytes))
    const mapping = guessMapping(fields, headers)
    const imported = buildImportedEmployees({ rows, systemFields: fields, mapping, makeId })
    expect(imported.map((e) => [e.values.basicSalary, e.values.allowances, e.values.status])).toEqual([
      ['', 1500.5, 'n/a'],
      [20000, '', 'Full Time'],
      ['', 5, ''],
    ])
    // Reported with who and which column. A text column holding "n/a" is not a problem.
    expect(findUnreadableValues({ rows, systemFields: fields, mapping })).toEqual([
      { rowIndex: 0, employee: 'TST301 Uno', field: 'Basic Salary', raw: 'n/a' },
      { rowIndex: 1, employee: 'TST302 Dos', field: 'Allowances', raw: 'TBC' },
      { rowIndex: 2, employee: 'Row 3', field: 'Basic Salary', raw: 'pending' },
    ])
    // A blank cell left blank calculates as 0, like any empty cell in the table.
    const regrid = computeGridForEmployees(imported, columns, getColumnsByKey(columns))
    expect(regrid[imported[0].id].newBasic.value).toBe(0)
  })

  test('a file with nothing unreadable reports nothing', async () => {
    const { headers, rows } = await parseWorkbookFile(asFile(external()))
    expect(findUnreadableValues({ rows, systemFields: fields, mapping: { ...guessMapping(fields, headers), basicSalary: 3 } })).toEqual([])
  })

  // Was an audit bug (report M7): both were pointed at the same file column,
  // and the mapping screen listed them both as just "Rate".
  test('two input columns with the same name are not both mapped to the same file column', () => {
    const twins = [input('Rate', 'rate', { category: 'employeeContribution' }), input('Rate', 'rate_employer', { category: 'employerContribution' })]
    const mapping = guessMapping(getImportableSystemFields([], twins), ['Rate'])
    expect(mapping.rate).not.toBe(mapping.rate_employer)
  })

  test('two input columns with the same name are labelled with their category, and each finds its own column by that label', () => {
    const twins = [input('Rate', 'rate', { category: 'employeeContribution' }), input('Rate', 'rate_employer', { category: 'employerContribution' })]
    const fields = getImportableSystemFields(identityFields, twins)
    expect(fields.map((f) => f.label)).toEqual(['ID', 'Name', 'Surname', 'Rate (Employee Contribution)', 'Rate (Employer Contribution)'])
    expect(guessMapping(fields, ['ID', 'Rate (Employer Contribution)', 'Rate (Employee Contribution)'])).toEqual({ id: 0, name: null, surname: null, rate: 2, rate_employer: 1 })
    // Two plain "Rate" columns in the file: one each, in order.
    expect(guessMapping(fields, ['Rate', 'Rate'])).toMatchObject({ rate: 0, rate_employer: 1 })
  })

  test("a guess never takes a column that the export's metadata gave to another field", () => {
    const fields = getImportableSystemFields([], [input('Basic Salary', 'basicSalary'), input('Basic Salary', 'basicPay', { category: 'otherDeductions' })])
    expect(resolveImportMapping(fields, ['Basic Salary'], { columnKeys: ['basicSalary'] })).toEqual({ basicSalary: 0, basicPay: null })
  })

  // Was an audit bug (report M5): the header row was the first row with two
  // or more filled cells, so a two-cell banner was taken for the headers.
  test('a banner with two filled cells is not taken for the header row', async () => {
    const bytes = workbookBytes([['TEST Co A', 'September 2026'], [], ['ID', 'Name', 'Basic Salary'], ['TST301', 'Uno', 100]])
    const { headers } = await parseWorkbookFile(asFile(bytes))
    expect(headers).toEqual(['ID', 'Name', 'Basic Salary'])
  })

  test('the header row is the one that names the most fields, even below a fuller banner, with figures held as text', async () => {
    const bytes = workbookBytes([['TEST Co A', 'Payroll', 'September 2026', 'Draft'], ['ID', 'Basic Salary', 'Notes'], ['TST301', '18,115.00', 'n/a']])
    const { headers, rows } = await parseWorkbookFile(asFile(bytes), ['ID', 'Name', 'Basic Salary'])
    // The banner makes the sheet 4 columns wide; the blank header cell is named, as always.
    expect(headers).toEqual(['ID', 'Basic Salary', 'Notes', 'Column 4'])
    expect(rows).toEqual([['TST301', '18,115.00', 'n/a', '']])
  })

  test('with no field names to go by, the fullest row before the first figures is the header row', async () => {
    const bytes = workbookBytes([['TEST Co A', 'September 2026'], ['Code', 'Person', 'Pay', 'Extra'], ['TST301', 'Uno', '18,115.00', '']])
    const { headers } = await parseWorkbookFile(asFile(bytes), ['Something else'])
    expect(headers).toEqual(['Code', 'Person', 'Pay', 'Extra'])
  })

  // Was report M12 (KNOWN_ISSUES no. 3): a text file renamed .xlsx was read
  // as a one-column sheet.
  test('a file that is not a workbook is refused before it is read', async () => {
    const text = (t) => asFile(new TextEncoder().encode(t).buffer)
    await expect(parseWorkbookFile(text('this is not an Excel file'))).rejects.toThrow('ZIP signature')
    await expect(parseWorkbookFile(text('ID,Name\nTST301,Uno'))).rejects.toThrow('ZIP signature')
    await expect(parseWorkbookFile(asFile(new ArrayBuffer(0)))).rejects.toThrow('ZIP signature')
  })
})

describe('Import from Excel: the app\'s own export', () => {
  const fields = getImportableSystemFields(identityFields, columns)
  const currentKeys = new Set([...identityFields.map((f) => f.key), ...columns.map((c) => c.key)])

  async function roundTrip(exportMode) {
    const bytes = await buildWorkbookBuffer(planFor(exportMode))
    const parsed = await parseWorkbookFile(asFile(bytes))
    const mapping = resolveImportMapping(fields, parsed.headers, parsed.meta)
    const imported = buildImportedEmployees({ rows: parsed.rows, systemFields: fields, mapping, makeId, meta: parsed.meta })
    return { parsed, mapping, imported }
  }

  test.each(['values', 'formulas'])('exported with %s: recognised, so mapping is skipped', async (mode) => {
    const { parsed, mapping } = await roundTrip(mode)
    expect(isRecognizedExport(parsed.meta, COMPANY_ID, currentKeys)).toBe(true)
    expect(parsed.headers.slice(0, HEADERS.length)).toEqual(HEADERS)
    // By key and position, not by header text: the excluded column has none.
    expect(mapping).toEqual({ id: 0, name: 1, surname: 2, basicSalary: 3, govtIncrement: 4, status: 6, allowances: 7, age60: 9, bonusBase: null, edf: 16 })
  })

  test.each(['values', 'formulas'])('exported with %s: the title, header and TOTAL rows are not imported', async (mode) => {
    const { imported } = await roundTrip(mode)
    expect(imported.map((e) => e.values.id)).toEqual(['TST001', 'TST002', 'TST003'])
  })

  test.each(['values', 'formulas'])('exported with %s: every figure calculates the same after re-import', async (mode) => {
    const { imported } = await roundTrip(mode)
    const regrid = computeGridForEmployees(imported, columns, getColumnsByKey(columns))
    imported.forEach((employee, index) => {
      for (const column of columns) {
        expect(regrid[employee.id][column.key].value, `${employee.values.id} ${column.key}`).toBe(appValue(index, column.key))
      }
    })
  })

  test('the excluded column comes back from the hidden sheet', async () => {
    const { imported } = await roundTrip('values')
    expect(imported.map((e) => e.values.bonusBase)).toEqual([1000, 0, 250.75])
    expect(imported.map((e) => e.values.status)).toEqual(['Full Time', 'Part Time', ''])
    expect(imported.map((e) => e.values.age60)).toEqual([false, true, false])
  })

  test('a file from another company is not auto-applied', async () => {
    const { parsed } = await roundTrip('values')
    expect(isRecognizedExport(parsed.meta, 'test-co-b', currentKeys)).toBe(false)
    expect(describeUnrecognizedMeta(parsed.meta, 'test-co-b', currentKeys)).toBe('This file was exported from a different company — please review the mapping below.')
  })

  test('after a column is deleted it falls back to mapping, with a best guess', async () => {
    const { parsed } = await roundTrip('values')
    const remaining = columns.filter((c) => c.key !== 'edf')
    const remainingKeys = new Set([...identityFields.map((f) => f.key), ...remaining.map((c) => c.key)])
    const remainingFields = getImportableSystemFields(identityFields, remaining)
    expect(isRecognizedExport(parsed.meta, COMPANY_ID, remainingKeys)).toBe(false)
    expect(describeUnrecognizedMeta(parsed.meta, COMPANY_ID, remainingKeys)).toBe(
      'This looks like a previous export, but 1 column has since been removed from this company — please review the mapping below.'
    )
    expect(resolveImportMapping(remainingFields, parsed.headers, parsed.meta)).toEqual({ id: 0, name: 1, surname: 2, basicSalary: 3, govtIncrement: 4, status: 6, allowances: 7, age60: 9, bonusBase: null })
  })

  test('a Totals export is never treated as one month\'s data', async () => {
    const bytes = await buildWorkbookBuffer(planFor('values', { kind: 'totals' }))
    const { meta } = await parseWorkbookFile(asFile(bytes))
    expect(isRecognizedExport(meta, COMPANY_ID, currentKeys)).toBe(false)
    expect(describeUnrecognizedMeta(meta, COMPANY_ID, currentKeys)).toContain('Totals export')
  })

  // Was an audit bug (report M6): with every identity field deleted there is
  // no "TOTAL" label, so the totals row was imported as one more employee
  // carrying the sums.
  test.each(['values', 'formulas'])('exported with %s and no identity fields, the TOTAL row is not imported as an employee', async (mode) => {
    const plan = planFor(mode, { identityFields: [] })
    const parsed = await parseWorkbookFile(asFile(await buildWorkbookBuffer(plan)))
    expect(parsed.rows).toHaveLength(employees.length)
    expect(parsed.meta.rowCount).toBe(employees.length)
  })

  test('a file exported before the row count was recorded still leaves out its TOTAL row', async () => {
    const workbook = await openWorkbook(await buildWorkbookBuffer(planFor('values')))
    const metaCell = workbook.getWorksheet('_meta').getCell('A1')
    const { rowCount, ...older } = JSON.parse(metaCell.value)
    expect(rowCount).toBe(employees.length)
    metaCell.value = JSON.stringify(older)
    const parsed = await parseWorkbookFile(asFile(await workbook.xlsx.writeBuffer()))
    expect(parsed.meta.rowCount).toBeUndefined()
    expect(parsed.rows.map((r) => r[0])).toEqual(['TST001', 'TST002', 'TST003'])
  })

  test('an empty month exported with no identity fields gives no rows', async () => {
    const plan = planFor('values', { identityFields: [], employees: [] })
    const parsed = await parseWorkbookFile(asFile(await buildWorkbookBuffer(plan)))
    expect(parsed.rows).toEqual([])
  })
})

describe('Export for PDF fill', () => {
  const allColumns = buildPdfFillColumns(identityFields, columns)
  const pick = (...names) => allColumns.filter((c) => names.includes(c.name))

  test('only the selected columns, headered by column name', () => {
    const rows = buildPdfFillRows(pick('ID', 'Surname', 'Basic Salary', 'New Basic', 'NSF'), employees, grid)
    expect(rows).toEqual([
      { ID: 'TST001', Surname: 'Tester', 'Basic Salary': 18115, 'New Basic': 18750, NSF: 187.5 },
      { ID: 'TST002', Surname: 'Tester', 'Basic Salary': 95000, 'New Basic': 100000, NSF: 0 },
      { ID: 'TST003', Surname: 'Tester', 'Basic Salary': 60000, 'New Basic': 60000, NSF: 297.1 },
    ])
    expect(JSON.stringify(rows)).not.toContain('basicSalary')
  })

  test('text and checkbox columns: text stays text, a checkbox is Yes / No', () => {
    const rows = buildPdfFillRows(pick('Status', 'Age 60+'), employees, grid)
    expect(rows).toEqual([{ Status: 'Full Time', 'Age 60+': 'No' }, { Status: 'Part Time', 'Age 60+': 'Yes' }, { Status: '', 'Age 60+': 'No' }])
  })

  test('figures are rounded to the column\'s decimals', () => {
    const rows = buildPdfFillRows(pick('Bonus', 'Net Pay'), employees, grid)
    // Net Pay is 57,978.425: an exact half cent, rounded up.
    expect(rows[2]).toEqual({ Bonus: 25.08, 'Net Pay': 57978.43 })
  })

  test('Company Details, when ticked, repeat on every row', () => {
    const fields = buildCompanyDetailFields('TEST Co A', DETAILS)
    expect(fields.map((f) => f.label)).toEqual(['Company Name', 'Address', 'BRN', 'VAT No'])
    const resolved = resolveCompanyFieldHeaders(fields, ['ID'])
    const rows = buildPdfFillRows(pick('ID'), employees, grid, resolved)
    for (const row of rows) {
      expect(row['Company Name']).toBe('TEST Co A')
      expect(row.Address).toBe('1 Test Street\nTestville')
      expect(row.BRN).toBe('TEST-BRN-A')
      expect(row['VAT No']).toBe('TEST-VAT-1')
    }
  })

  test('Company Details are left out when not ticked', () => {
    const rows = buildPdfFillRows(pick('ID'), employees, grid, [])
    expect(Object.keys(rows[0])).toEqual(['ID'])
  })

  test('a company field with the same name as a column is prefixed "Company: "', () => {
    const fields = buildCompanyDetailFields('TEST Co A', { ...DETAILS, customFields: [{ id: 'c1', label: 'NSF', value: 'NSF-REF-1' }, { id: 'c2', label: 'Name', value: 'Trading name' }] })
    const resolved = resolveCompanyFieldHeaders(fields, ['ID', 'Name', 'NSF'])
    expect(resolved.map((f) => f.header)).toEqual(['Company Name', 'Address', 'BRN', 'Company: NSF', 'Company: Name'])
    const rows = buildPdfFillRows(pick('ID', 'Name', 'NSF'), employees, grid, resolved)
    expect(rows[0]).toMatchObject({ Name: 'Alpha', NSF: 187.5, 'Company: NSF': 'NSF-REF-1', 'Company: Name': 'Trading name' })
  })

  test('CSV: one header line, one line per employee, commas and quotes escaped', () => {
    const cols = pick('ID', 'Surname', 'Basic Salary')
    const tricky = [{ id: 'e1', values: { id: 'TST001', surname: 'Tester, "Jr"', basicSalary: '18115' } }]
    const g = computeGridForEmployees(tricky, columns, getColumnsByKey(columns))
    const resolved = resolveCompanyFieldHeaders(buildCompanyDetailFields('TEST Co A', DETAILS).slice(0, 2), cols.map((c) => c.name))
    const headers = [...cols.map((c) => c.name), ...resolved.map((f) => f.header)]
    const csv = buildCsvContent(headers, buildPdfFillRows(cols, tricky, g, resolved))
    expect(csv).toBe('ID,Surname,Basic Salary,Company Name,Address\r\nTST001,"Tester, ""Jr""",18115,TEST Co A,"1 Test Street\nTestville"')
  })

  test('JSON: an array with one object per employee', () => {
    const parsed = JSON.parse(buildJsonContent(buildPdfFillRows(pick('ID', 'NSF'), employees, grid)))
    expect(parsed).toEqual([{ ID: 'TST001', NSF: 187.5 }, { ID: 'TST002', NSF: 0 }, { ID: 'TST003', NSF: 297.1 }])
  })

  test('the file name carries the company and the month', () => {
    expect(buildPdfFillFilename('json', 'TEST Co A', 2026, 9)).toBe('TEST Co A-pdf-fill-2026-09.json')
    expect(buildPdfFillFilename('csv', 'TEST/Co: A', 2026, 12)).toBe('TESTCo A-pdf-fill-2026-12.csv')
  })

  // Rows are keyed by the exported name, so two columns must never share
  // one. Columns that share a name are both exported with their category.
  const bothCsg = allColumns.filter((c) => c.key === 'csg' || c.key === 'csg_employer')

  test('two columns called "CSG" are exported as "CSG (Employee Contribution)" and "CSG (Employer Contribution)"', () => {
    expect(bothCsg.map((c) => c.name)).toEqual(['CSG (Employee Contribution)', 'CSG (Employer Contribution)'])
  })

  test('employee CSG and employer CSG are both in the JSON, each with its own figure', () => {
    expect(buildPdfFillRows(bothCsg, employees, grid)).toEqual([
      { 'CSG (Employee Contribution)': 281.25, 'CSG (Employer Contribution)': 562.5 },
      { 'CSG (Employee Contribution)': 3000, 'CSG (Employer Contribution)': 6000 },
      { 'CSG (Employee Contribution)': 1800, 'CSG (Employer Contribution)': 3600 },
    ])
  })

  test('in the CSV the two CSG columns have their own headers and figures', () => {
    const csv = buildCsvContent(bothCsg.map((c) => c.name), buildPdfFillRows(bothCsg, employees, grid))
    expect(csv.split('\r\n')).toEqual(['CSG (Employee Contribution),CSG (Employer Contribution)', '281.25,562.5', '3000,6000', '1800,3600'])
  })

  test('the picker lists the same names as the file uses', () => {
    const names = buildPdfFillColumnGroups(identityFields, columns).flatMap((g) => g.columns.map((c) => c.name))
    expect(names).toEqual(allColumns.map((c) => c.name))
    expect(names.filter((n) => n.startsWith('CSG'))).toEqual(['CSG (Employee Contribution)', 'CSG (Employer Contribution)'])
  })

  test('a column whose name is unique keeps its plain name', () => {
    expect(allColumns.filter((c) => !c.name.startsWith('CSG')).map((c) => c.name)).toEqual([
      'ID', 'Name', 'Surname', 'Basic Salary', 'Govt Increment', 'New Basic', 'Status', 'Allowances', 'Emoluments', 'Age 60+', 'Bonus Base', 'Bonus', 'Net Pay', 'NSF', 'PAYE', 'EDF', 'Chargeable',
    ])
  })

  test('every exported name is different, whatever the columns are called', () => {
    const awkward = [
      input('Name', 'name_2'),
      input('Rate', 'rate', { category: 'employeeContribution' }),
      input('Rate', 'rate_2', { category: 'employeeContribution' }),
      input('Rate', 'rate_employer', { category: 'employerContribution' }),
    ]
    const names = buildPdfFillColumns(identityFields, awkward).map((c) => c.name)
    expect(names).toEqual(['ID', 'Name (Identifiers)', 'Surname', 'Name (General)', 'Rate (Employee Contribution)', 'Rate (Employee Contribution) (2)', 'Rate (Employer Contribution)'])
    expect(new Set(names).size).toBe(names.length)
    const one = [{ id: 'e1', values: { id: 'TST001', name: 'Alpha', name_2: '7', rate: '1', rate_2: '2', rate_employer: '3' } }]
    const row = buildPdfFillRows(buildPdfFillColumns(identityFields, awkward), one, computeGridForEmployees(one, awkward, getColumnsByKey(awkward)))[0]
    expect(Object.values(row)).toEqual(['TST001', 'Alpha', '', 7, 1, 2, 3])
  })

  test('a company field is prefixed against the exported names, including the category ones', () => {
    const fields = buildCompanyDetailFields('TEST Co A', { address: '', brn: '', customFields: [{ id: 'c1', label: 'CSG (Employee Contribution)', value: 'ref' }, { id: 'c2', label: 'CSG', value: 'plain' }] }).slice(3)
    expect(resolveCompanyFieldHeaders(fields, bothCsg.map((c) => c.name)).map((f) => f.header)).toEqual(['Company: CSG (Employee Contribution)', 'CSG'])
  })

  // Was an audit bug (report M11): two custom company fields with the same
  // label overwrote each other. As decided, such an export is refused, and
  // the label is named; nothing is written with one value lost.
  test('two company fields with the same label are never exported over each other: the export is refused, naming the label', () => {
    const fields = buildCompanyDetailFields('TEST Co A', { address: '', brn: '', customFields: [{ id: 'c1', label: 'Ref', value: 'one' }, { id: 'c2', label: 'Ref', value: 'two' }] }).slice(3)
    const resolved = resolveCompanyFieldHeaders(fields, ['ID'])
    expect(findClashingHeaders(pdfFillHeaders(pick('ID'), resolved))).toEqual(['Ref'])
    expect(() => downloadPdfFillExport('json', pick('ID'), employees, grid, resolved, { companyName: 'TEST Co A', year: 2026, month: 9 })).toThrow(
      'Two exported fields share a header: Ref'
    )
    // With one of them left out, nothing clashes.
    expect(findClashingHeaders(pdfFillHeaders(pick('ID'), resolved.slice(0, 1)))).toEqual([])
  })
})
