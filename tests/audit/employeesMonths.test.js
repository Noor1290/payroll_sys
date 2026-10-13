// @vitest-environment jsdom

// Audit, part 4: employees and months - storage per company and month, Copy
// from Previous Month, and Totals across a month range. TEST data only.
//
// `test.fails` marks a bug: see the note at the top of formulaEngine.test.js.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getColumnsByKey } from '../../src/lib/model'
import {
  loadState,
  saveState,
  loadPeriod,
  savePeriod,
  deletePeriodsForCompany,
  countPeriodsHoldingKey,
  renameValueKeyInPeriods,
} from '../../src/lib/storage'
import { shiftPeriod, enumeratePeriods, periodKey, formatPeriodLabel } from '../../src/lib/periods'
import { buildCopyableColumnGroups, matchPreviousEmployees, applyCopyFromPreviousMonth } from '../../src/lib/copyPreviousMonth'
import { computeTotals } from '../../src/lib/totals'
import { computeGridForEmployees } from '../../src/lib/formulaEngine'
import { buildExportPlan } from '../../src/lib/excelExport'
import { identityFields, idFieldKey, testColumns, testEmployees } from './build'

const columns = testColumns()
const columnsByKey = getColumnsByKey(columns)

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('months', () => {
  test('moving back and forward rolls the year over', () => {
    expect(shiftPeriod(2026, 1, -1)).toEqual({ year: 2025, month: 12 })
    expect(shiftPeriod(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftPeriod(2026, 9, 1)).toEqual({ year: 2026, month: 10 })
    expect(formatPeriodLabel(2026, 9)).toBe('September 2026')
    expect(periodKey(2026, 9)).toBe('2026-09')
  })

  test('a month range lists every month, whichever end is given first', () => {
    const expected = [{ year: 2025, month: 11 }, { year: 2025, month: 12 }, { year: 2026, month: 1 }, { year: 2026, month: 2 }]
    expect(enumeratePeriods(2025, 11, 2026, 2)).toEqual(expected)
    expect(enumeratePeriods(2026, 2, 2025, 11)).toEqual(expected)
  })
})

describe('storage: one entry per company and month', () => {
  const sept = [{ id: 'e1', values: { id: 'TST001', basicSalary: '18115' } }]
  const oct = [{ id: 'e2', values: { id: 'TST001', basicSalary: '20000' } }]

  test('a month that was never saved starts empty', () => {
    expect(loadPeriod('test-co-a', 2026, 9)).toEqual({ employees: [] })
  })

  test('saving one month does not change another month', () => {
    savePeriod('test-co-a', 2026, 9, { employees: sept })
    savePeriod('test-co-a', 2026, 10, { employees: oct })
    savePeriod('test-co-a', 2026, 10, { employees: [] })
    expect(loadPeriod('test-co-a', 2026, 9).employees).toEqual(sept)
    expect(loadPeriod('test-co-a', 2026, 10).employees).toEqual([])
    expect(loadPeriod('test-co-a', 2026, 11).employees).toEqual([])
  })

  test('two companies with the same month and the same employee IDs do not mix', () => {
    savePeriod('test-co-a', 2026, 9, { employees: sept })
    savePeriod('test-co-b', 2026, 9, { employees: oct })
    expect(loadPeriod('test-co-a', 2026, 9).employees).toEqual(sept)
    expect(loadPeriod('test-co-b', 2026, 9).employees).toEqual(oct)
    expect(Object.keys(localStorage).sort()).toEqual(['payroll_period_test-co-a_2026-09', 'payroll_period_test-co-b_2026-09'])
  })

  test('the app state survives a save and a load', () => {
    const state = { identityFields, idFieldKey, globalColumns: columns, companies: [{ id: 'test-co-a', name: 'TEST Co A', columns: [], columnWidths: { basicSalary: 200 }, viewYear: 2026, viewMonth: 9, details: { address: '1 Test Street', brn: 'TEST-BRN-A', customFields: [] } }], activeCompanyId: 'test-co-a' }
    saveState(state)
    // The one difference: on load a checkbox column is given "decimals: 2",
    // which nothing uses.
    const expected = JSON.parse(JSON.stringify(state))
    expected.globalColumns.find((c) => c.key === 'age60').decimals = 2
    expect(loadState()).toEqual(expected)
    saveState(loadState())
    expect(loadState()).toEqual(expected)
  })

  // RISK, kept as evidence: unreadable saved data is treated as "nothing
  // saved", and the app then saves a fresh empty state over it.
  test('evidence: saved data that cannot be read loads as nothing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    localStorage.setItem('payroll_app_state_v1', '{"companies":[{"id":"test-co-a"')
    expect(loadState()).toBeNull()
  })

  // When the browser refuses the write (storage full) the caller is told, so
  // the app can warn that the change was NOT saved and take it off the screen.
  test('a save the browser refuses is reported to the caller', () => {
    expect(savePeriod('test-co-a', 2026, 9, { employees: sept })).toBe(true)
    expect(saveState({ companies: [] })).toBe(true)

    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    })
    expect(savePeriod('test-co-a', 2026, 9, { employees: oct })).toBe(false)
    expect(saveState({ companies: [{ id: 'x' }] })).toBe(false)
    vi.restoreAllMocks()
    // What was there before the refused save is still there.
    expect(loadPeriod('test-co-a', 2026, 9).employees).toEqual(sept)
  })

  test('deleting a company\'s months removes every month of that company, and nothing else', () => {
    savePeriod('test-co-a', 2026, 8, { employees: sept })
    savePeriod('test-co-a', 2026, 9, { employees: sept })
    savePeriod('test-co-a', 2027, 1, { employees: oct })
    savePeriod('test-co-b', 2026, 9, { employees: oct })
    // A company whose id merely starts with the other's id is not touched.
    savePeriod('test-co-a_x', 2026, 9, { employees: oct })
    saveState({ companies: [] })
    localStorage.setItem('pdf-editor:templates', '[]')

    deletePeriodsForCompany('test-co-a')
    expect(Object.keys(localStorage).sort()).toEqual(['payroll_app_state_v1', 'payroll_period_test-co-a_x_2026-09', 'payroll_period_test-co-b_2026-09', 'pdf-editor:templates'])
    expect(loadPeriod('test-co-b', 2026, 9).employees).toEqual(oct)
  })

  test('a changed column key moves the saved values in every month of the companies concerned', () => {
    const other = [{ id: 'e3', values: { id: 'TST003', name: 'No salary yet' } }]
    savePeriod('test-co-a', 2026, 8, { employees: sept })
    savePeriod('test-co-a', 2026, 9, { employees: oct })
    savePeriod('test-co-a', 2026, 10, { employees: other })
    savePeriod('test-co-b', 2026, 9, { employees: sept })
    savePeriod('test-co-c', 2026, 9, { employees: sept })

    expect(countPeriodsHoldingKey(['test-co-a', 'test-co-b'], 'basicSalary')).toEqual({ periods: 3, companies: 2 })
    expect(renameValueKeyInPeriods(['test-co-a', 'test-co-b'], 'basicSalary', 'basePay')).toBe(true)

    expect(loadPeriod('test-co-a', 2026, 8).employees).toEqual([{ id: 'e1', values: { id: 'TST001', basePay: '18115' } }])
    expect(loadPeriod('test-co-a', 2026, 9).employees).toEqual([{ id: 'e2', values: { id: 'TST001', basePay: '20000' } }])
    expect(loadPeriod('test-co-a', 2026, 10).employees).toEqual(other)
    expect(loadPeriod('test-co-b', 2026, 9).employees).toEqual([{ id: 'e1', values: { id: 'TST001', basePay: '18115' } }])
    // A company outside the column's reach keeps the old key.
    expect(loadPeriod('test-co-c', 2026, 9).employees).toEqual(sept)
    expect(countPeriodsHoldingKey(['test-co-a', 'test-co-b'], 'basicSalary')).toEqual({ periods: 0, companies: 0 })
  })
})

describe('Copy from Previous Month', () => {
  const previous = deepFreeze([
    { id: 'p1', values: { id: 'TST001', name: 'Alpha', surname: 'Tester', basicSalary: '18115', govtIncrement: '635', status: 'Full Time', allowances: '100', age60: false, edf: '9000' } },
    { id: 'p2', values: { id: 'TST002', name: 'Beta', surname: 'Tester', basicSalary: '95000', govtIncrement: '5000', status: 'Part Time', allowances: '200', age60: true, edf: '390000' } },
    { id: 'p3', values: { id: 'TST003', name: 'Gamma', surname: 'Tester', basicSalary: '60000', govtIncrement: '0', status: '', allowances: '300', age60: false, edf: '0' } },
  ])
  const current = deepFreeze([
    { id: 'c1', values: { id: 'TST001', name: 'Alpha', surname: 'Tester', basicSalary: '1', govtIncrement: '2', status: 'Old', allowances: '3', age60: true, edf: '4' } },
    { id: 'c9', values: { id: 'TST009', name: 'Iota', surname: 'Stayer', basicSalary: '5000', allowances: '50' } },
  ])

  const copy = (selectedEmployeeIds, selectedColumnKeys, extra = {}) =>
    applyCopyFromPreviousMonth({
      previousEmployees: previous,
      currentEmployees: current,
      identityFields,
      idFieldKey,
      selectedEmployeeIds: new Set(selectedEmployeeIds),
      selectedColumnKeys: new Set(selectedColumnKeys),
      ...extra,
    })

  test('formula columns cannot be selected', () => {
    const offered = buildCopyableColumnGroups(identityFields, columns).flatMap((g) => g.columns.map((c) => c.key))
    expect(offered).toEqual(['id', 'name', 'surname', 'basicSalary', 'govtIncrement', 'status', 'allowances', 'age60', 'bonusBase', 'edf'])
    for (const column of columns.filter((c) => c.type === 'formula')) expect(offered).not.toContain(column.key)
  })

  test('who already exists this month, matched by ID', () => {
    expect(matchPreviousEmployees(previous, current, idFieldKey).map((m) => [m.prevEmp.values.id, m.existing?.id ?? null])).toEqual([
      ['TST001', 'c1'],
      ['TST002', null],
      ['TST003', null],
    ])
  })

  test('only the selected employees and only the selected columns are copied', () => {
    const next = copy(['p1', 'p2'], ['basicSalary', 'status'])
    expect(next).toHaveLength(3)
    // TST001 already existed: two columns overwritten, the rest untouched.
    expect(next[0]).toEqual({ id: 'c1', values: { id: 'TST001', name: 'Alpha', surname: 'Tester', basicSalary: '18115', govtIncrement: '2', status: 'Full Time', allowances: '3', age60: true, edf: '4' } })
    // TST009 was not involved at all.
    expect(next[1]).toBe(current[1])
    // TST002 is new: its identity fields plus the two selected columns.
    expect(next[2].values).toEqual({ id: 'TST002', name: 'Beta', surname: 'Tester', basicSalary: '95000', status: 'Part Time' })
    // TST003 was not selected.
    expect(next.some((e) => e.values.id === 'TST003')).toBe(false)
  })

  test('the previous month is not changed', () => {
    // `previous` and `current` are frozen: any write to them would throw.
    const before = JSON.stringify(previous)
    copy(['p1', 'p2', 'p3'], ['basicSalary', 'govtIncrement', 'status', 'allowances', 'age60', 'edf'])
    expect(JSON.stringify(previous)).toBe(before)
  })

  test('with nothing selected, nothing changes', () => {
    expect(copy([], ['basicSalary'])).toEqual(current)
    expect(copy(['p1'], [])).toEqual(current)
  })

  // Worth knowing: without an ID field nobody can be matched, so everyone is
  // added again as a new row.
  test('with no ID field designated, every copied employee is added as new', () => {
    const next = copy(['p1'], ['basicSalary'], { idFieldKey: null })
    expect(next).toHaveLength(3)
    expect(next.filter((e) => e.values.id === 'TST001')).toHaveLength(2)
  })
})

describe('Totals across a month range', () => {
  const [first, second, third] = testEmployees()
  // September: TST001 and TST002. October: TST001 (with a rise) and TST003.
  const september = [first, second]
  const octoberFirst = { id: 'o1', values: { ...first.values, basicSalary: '20000', govtIncrement: '0', status: 'Part Time' } }
  const october = [octoberFirst, third]
  const periods = [
    { year: 2026, month: 9, employees: september },
    { year: 2026, month: 10, employees: october },
  ]
  const totals = () => computeTotals(periods, columns, columnsByKey, idFieldKey)
  const sum = (id, key) => totals().computedGrid[`id:${id}`][key].value

  test('one row per employee, including those present in only one month', () => {
    expect(totals().employees.map((e) => e.values.id)).toEqual(['TST001', 'TST002', 'TST003'])
  })

  test('an employee in both months: each figure is the sum of the two months', () => {
    // New Basic 18,750 + 20,000; CSG 281.25 + 300; NSF 187.50 + 200
    expect(sum('TST001', 'basicSalary')).toBe(38115)
    expect(sum('TST001', 'newBasic')).toBe(38750)
    expect(sum('TST001', 'csg')).toBe(581.25)
    expect(sum('TST001', 'nsf')).toBe(387.5)
  })

  test('an employee in one month only: that month\'s figures', () => {
    expect(sum('TST002', 'newBasic')).toBe(100000)
    expect(sum('TST002', 'paye')).toBe(8600)
    expect(sum('TST003', 'nsf')).toBeCloseTo(297.1, 8)
  })

  test('formulas are worked out month by month, then added (PAYE is not recalculated on the total)', () => {
    const twoMonths = [
      { year: 2026, month: 9, employees: [second] },
      { year: 2026, month: 10, employees: [{ id: 'o2', values: second.values }] },
    ]
    const t = computeTotals(twoMonths, columns, columnsByKey, idFieldKey)
    // 8,600 + 8,600, not PAYE on 200,000 (which would be 28,600)
    expect(t.computedGrid['id:TST002'].paye.value).toBe(17200)
  })

  test('identity fields come from the first month the employee appears in', () => {
    expect(totals().employees[0].values.name).toBe('Alpha')
  })

  test('a text column is never turned into a number: it is carried as text, from the first month', () => {
    const grid = totals().computedGrid['id:TST001']
    // September says "Full Time", October "Part Time".
    expect(grid.status).toEqual({ value: 'Full Time' })
    expect(totals().computedGrid['id:TST003'].status).toEqual({ value: '' })
  })

  test('a checkbox column is carried as ticked / not ticked, from the first month', () => {
    expect(totals().computedGrid['id:TST001'].age60).toEqual({ value: 0 })
    expect(totals().computedGrid['id:TST002'].age60).toEqual({ value: 1 })
  })

  test('an empty range gives no rows', () => {
    expect(computeTotals([{ year: 2026, month: 1, employees: [] }], columns, columnsByKey, idFieldKey)).toEqual({ employees: [], computedGrid: {} })
  })

  test('employees with no ID are kept as rows of their own', () => {
    const blank = (id) => ({ id, values: { id: '', name: 'Nameless', basicSalary: '100' } })
    const t = computeTotals([{ year: 2026, month: 9, employees: [blank('x1')] }, { year: 2026, month: 10, employees: [blank('x2')] }], columns, columnsByKey, idFieldKey)
    expect(t.employees).toHaveLength(2)
  })

  // Worth knowing: two different people given the same ID in one month are
  // added together into one Totals row. The Employee Table flags the
  // duplicate; Totals does not.
  test('evidence: two employees sharing an ID in one month are merged into one Totals row', () => {
    const twin = { id: 't2', values: { ...first.values, name: 'Someone Else' } }
    const t = computeTotals([{ year: 2026, month: 9, employees: [first, twin] }], columns, columnsByKey, idFieldKey)
    expect(t.employees).toHaveLength(1)
    expect(t.computedGrid['id:TST001'].newBasic.value).toBe(37500)
  })

  // The Totals screen and the Totals export read the same grid, so the
  // export shows the text and checkbox columns exactly as the screen does.
  describe('the Totals export', () => {
    const plan = () => {
      const t = totals()
      return buildExportPlan({ title: 'TEST Co A — Totals', companyId: 'test-co-a', kind: 'totals', employees: t.employees, identityFields, effectiveColumns: columns, computedGrid: t.computedGrid })
    }
    const cell = (rowIndex, key) => {
      const p = plan()
      return p.rows[rowIndex][p.columns.findIndex((c) => c.key === key)]
    }

    test('the figures in the export are the summed figures', () => {
      expect(cell(0, 'newBasic')).toBe(38750)
      expect(cell(0, 'csg')).toBe(581.25)
      expect(cell(1, 'paye')).toBe(8600)
    })

    test('the text column keeps its text in the export', () => {
      expect([0, 1, 2].map((i) => cell(i, 'status'))).toEqual(['Full Time', 'Part Time', ''])
    })

    test('a ticked checkbox is "Yes" in the export, and the total row counts the ticks', () => {
      expect(second.values.age60).toBe(true)
      expect([0, 1, 2].map((i) => cell(i, 'age60'))).toEqual(['No', 'Yes', 'No'])
      const p = plan()
      expect(p.totalsRow[p.columns.findIndex((c) => c.key === 'age60')]).toBe('1 ticked')
    })
  })
})

describe('the Employee Table\'s grid for one month', () => {
  test('the same figures whether a month is computed alone or next to another', () => {
    const [first] = testEmployees()
    const alone = computeGridForEmployees([first], columns, columnsByKey)
    const together = computeGridForEmployees(testEmployees(), columns, columnsByKey)
    for (const column of columns) expect(together[first.id][column.key].value).toBe(alone[first.id][column.key].value)
  })
})
