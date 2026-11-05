// @vitest-environment jsdom

// The speed fixes of November 2026 (Payroll\SPEED_CHECK) change how often figures are worked out,
// never what they are. Here the new way is compared with the old one, kept unchanged in
// tests/audit/before/ (a copy of main before the fixes): every figure of every employee of
// TEST Co 20 and TEST Co 200 in all 12 months, every TOTAL, and what changes when one cell
// does. TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useComputedGrid } from '../../src/hooks/useComputedGrid'
import { buildExportPlan } from '../../src/lib/excelExport'
import { formatDecimal } from '../../src/lib/format'
import { computeGridForEmployees } from '../../src/lib/formulaEngine'
import { getColumnsByKey } from '../../src/lib/model'
import { computeTotals, grandTotal } from '../../src/lib/totals'
import * as before from './before/formulaEngine.js'
import * as beforeTotals from './before/totals.js'
import { formatDecimal as formatBefore } from './before/format.js'
import { identityFields, idFieldKey, speedColumns, speedCompany } from './speedData'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// ---------- the new way, as the Employee Table gets it: through the hook ----------

let root
let host
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
})
function GridProbe({ employees, columns, onGrid }) {
  onGrid(useComputedGrid(employees, columns))
  return null
}
/** A live grid: `show(employees, columns)` renders (again) and returns the grid on screen. */
function liveGrid() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  let grid = null
  return (employees, columns) => {
    act(() => root.render(<GridProbe employees={employees} columns={columns} onGrid={(g) => (grid = g)} />))
    return grid
  }
}

const oldGrid = (employees, columns) => before.computeGridForEmployees(employees, columns, getColumnsByKey(columns))

/** Every figure, the same number and the same to the cent; every explanation the same. */
function expectSameGrid(grid, expected, employees, columns) {
  const different = []
  for (const employee of employees) {
    for (const col of columns) {
      const now = grid[employee.id][col.key].value
      const then = expected[employee.id][col.key].value
      const same = Object.is(now, then) || (Number.isNaN(now) && Number.isNaN(then))
      if (!same || formatDecimal(now, 2) !== formatBefore(then, 2)) different.push(`${employee.values.id} ${col.key}: ${then} -> ${now}`)
    }
  }
  expect(different).toEqual([])
  expect(Object.fromEntries(employees.map((e) => [e.id, grid[e.id]]))).toEqual(Object.fromEntries(employees.map((e) => [e.id, expected[e.id]])))
}

// The old calculation is slow (that is what was fixed): these tests take a while.
vi.setConfig({ testTimeout: 180_000 })

const columns = speedColumns()
const companies = [
  ['TEST Co 20', speedCompany(20)],
  ['TEST Co 200', speedCompany(200)],
]

describe.each(companies)('%s, all 12 months', (_name, months) => {
  test('every figure of every employee is what the old calculation gives, to the cent', () => {
    const show = liveGrid()
    for (const { employees } of months) {
      const expected = oldGrid(employees, columns)
      expectSameGrid(show(employees, columns), expected, employees, columns)
      // Also the plain function the Totals, imports and History use.
      expectSameGrid(computeGridForEmployees(employees, columns, getColumnsByKey(columns)), expected, employees, columns)
    }
  })

  test('every total is what the old calculation gives: the Totals tab, its TOTAL row, each month\'s TOTAL row and export', () => {
    const byKey = getColumnsByKey(columns)
    const now = computeTotals(months, columns, byKey, idFieldKey)
    const then = beforeTotals.computeTotals(months, columns, byKey, idFieldKey)
    expect(now).toEqual(then)
    expect(grandTotal(now.employees, columns, now.computedGrid)).toEqual(beforeTotals.grandTotal(then.employees, columns, then.computedGrid))
    const show = liveGrid()
    for (const { employees } of months) {
      const grid = show(employees, columns)
      const expected = oldGrid(employees, columns)
      expect(grandTotal(employees, columns, grid)).toEqual(beforeTotals.grandTotal(employees, columns, expected))
      const plan = (g) => buildExportPlan({ title: 'TEST', companyId: 'x', kind: 'period', employees, identityFields, effectiveColumns: columns, computedGrid: g })
      expect(plan(grid).totalsRow).toEqual(plan(expected).totalsRow)
    }
  })
})

describe('one cell changed (TEST Co 200, November 2026)', () => {
  const months = speedCompany(200)
  const november = months[11].employees
  const changeOne = (list, index, key, value) => list.map((e, i) => (i === index ? { ...e, values: { ...e.values, [key]: value } } : e))

  test('only that employee is worked out again, and every figure, TOTAL and export total follows it', () => {
    const show = liveGrid()
    const first = show(november, columns)
    const totalBefore = grandTotal(november, columns, first)

    // Above 50,000: the higher CSG rate, and the NSF ceiling.
    const changed = changeOne(november, 56, 'basicSalary', '51234.56')
    const grid = show(changed, columns)

    expectSameGrid(grid, oldGrid(changed, columns), changed, columns)
    // The other 199 rows are the very same rows: not worked out again.
    const reused = changed.filter((e) => grid[e.id] === first[e.id]).length
    expect(reused).toBe(199)
    expect(grid[changed[56].id]).not.toBe(first[changed[56].id])
    expect(grid[changed[56].id].csg.value).not.toBe(first[changed[56].id].csg.value)

    // The TOTAL row and the export's totals follow the change, as a full calculation gives them.
    const totalAfter = grandTotal(changed, columns, grid)
    expect(totalAfter).toEqual(beforeTotals.grandTotal(changed, columns, oldGrid(changed, columns)))
    expect(totalAfter.netPay.sum).not.toBe(totalBefore.netPay.sum)
    const plan = (g) => buildExportPlan({ title: 'TEST', companyId: 'x', kind: 'period', employees: changed, identityFields, effectiveColumns: columns, computedGrid: g })
    expect(plan(grid).totalsRow).toEqual(plan(oldGrid(changed, columns)).totalsRow)

    // The Totals tab over the 12 months, with this November.
    const withChange = months.map((m, i) => (i === 11 ? { ...m, employees: changed } : m))
    const byKey = getColumnsByKey(columns)
    expect(computeTotals(withChange, columns, byKey, idFieldKey)).toEqual(beforeTotals.computeTotals(withChange, columns, byKey, idFieldKey))
  })

  test('a cell changed back, then a new or removed employee, still gives the full calculation', () => {
    const show = liveGrid()
    show(november, columns)
    const steps = [
      changeOne(november, 3, 'allowances', '1234.5'),
      november,
      [...november, { id: 'tst-new', values: { id: 'TST9999', basicSalary: '29710', govtIncrement: '0', age60: true } }],
      november.slice(1),
      changeOne(november, 10, 'age60', true),
      changeOne(november, 10, 'basicSalary', ''),
    ]
    for (const employees of steps) expectSameGrid(show(employees, columns), oldGrid(employees, columns), employees, columns)
  })

  test('a change of columns works every row out again', () => {
    const show = liveGrid()
    const first = show(november, columns)
    const changedColumns = columns.map((c) => (c.key === 'prgf' ? { ...c, formula: 'emoluments * 0.05' } : c))
    const grid = show(november, changedColumns)
    expectSameGrid(grid, oldGrid(november, changedColumns), november, changedColumns)
    expect(november.filter((e) => grid[e.id] === first[e.id])).toHaveLength(0)
  })
})

describe('the kept formulas', () => {
  test('a formula that cannot be worked out is still an error every time, as before', () => {
    const broken = [{ id: 'c1', key: 'a', name: 'A', type: 'input' }, { id: 'c2', key: 'b', name: 'B', type: 'formula', formula: 'a +* 2' }]
    const employees = [{ id: 'x', values: { a: '1' } }, { id: 'y', values: { a: '2' } }]
    for (let i = 0; i < 2; i++) {
      const grid = computeGridForEmployees(employees, broken, getColumnsByKey(broken))
      expect(grid).toEqual(oldGrid(employees, broken))
      expect(grid.x.b.trace.error).toBeTruthy()
    }
  })
})

describe('numbers shown on screen (F1)', () => {
  test('are the same text as before for every kind of display', () => {
    let s = 3
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
    const values = [0, -0, 0.005, 0.015, 1.005, 271.725, -271.725, 29710, 1e21, 123456789.125, -0.004]
    for (let i = 0; i < 3000; i++) values.push(((i % 7 === 0 ? -1 : 1) * Math.round(rnd() * 10 ** (1 + (i % 8)))) / 10 ** (i % 4))
    for (const value of values) {
      for (const decimals of [undefined, null, 0, 1, 2, 3, 4]) {
        for (const grouping of [true, false]) {
          expect(formatDecimal(value, decimals, { grouping })).toBe(formatBefore(value, decimals, { grouping }))
        }
      }
    }
    for (const odd of [NaN, 'Part Time', undefined, null]) expect(formatDecimal(odd, 2)).toBe(formatBefore(odd, 2))
  })

  test('no longer make a new formatter for every number (Number.toLocaleString is not called)', () => {
    const spy = vi.spyOn(Number.prototype, 'toLocaleString')
    try {
      for (let i = 0; i < 100; i++) formatDecimal(i * 1.5, 2)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})
