// @vitest-environment jsdom

// TODO C6 (rehearsal 2.5, 2.9): the tier builder had no "up to and including" operator, and a
// figure on a threshold no tier covers (exactly 50,000 with "Below 50,000" + "Above 50,000") was
// 0.00 with a warning only in the column form: the breakdown said "50,000.00 × 0% = 0.00" and the
// table showed nothing. TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import EmployeeTable from '../../src/components/EmployeeTable'
import TieredFormulaBuilder from '../../src/components/TieredFormulaBuilder'
import { translateFormulaToExcel } from '../../src/lib/excelFormulaTranslator'
import { computeGridForEmployees } from '../../src/lib/formulaEngine'
import { getColumnsByKey } from '../../src/lib/model'
import { savedTieredRule } from '../../src/lib/outdatedRules'
import { compileTieredFormula, describeTieredRule, resolveMatchedTier } from '../../src/lib/tieredFormula'
import { computeRow, computeValues, input, tiered } from './build'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const basic = () => input('Basic Salary', 'basicSalary')
const rule = (tiers, cap = null) => tiered('Employer CSG', 'employerCsg', { baseKey: 'basicSalary', tiers, cap })
const at = (column, value) => computeValues([basic(), column], { basicSalary: String(value) }).employerCsg

let root
let container
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  root = container = null
})
async function show(element) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(element))
}

describe('"At or below" (up to and including)', () => {
  // The rehearsal's Employer CSG as meant: 3% up to and including 50,000, 6% above.
  const employerCsg = [
    { operator: 'atOrBelow', threshold: 50000, rate: 3 },
    { operator: 'above', threshold: 50000, rate: 6 },
  ]

  test('holds for its threshold and every figure under it', () => {
    expect(at(rule(employerCsg), 49999)).toBeCloseTo(1499.97, 10)
    expect(at(rule(employerCsg), 50000)).toBe(1500)
    expect(at(rule(employerCsg), 50001)).toBeCloseTo(3000.06, 10)
    expect(compileTieredFormula({ baseKey: 'basicSalary', tiers: employerCsg, cap: null })).toBe(
      '(basicSalary) * (basicSalary <= 50000 ? 0.03 : basicSalary > 50000 ? 0.06 : 0)'
    )
  })

  test('is written in the summary and the breakdown as "50,000 or below", and leaves no gap', () => {
    expect(describeTieredRule('Basic Salary', employerCsg, null)).toBe('If Basic Salary is 50,000 or below, apply 3%. If Basic Salary is above 50,000, apply 6%.')
    expect(computeRow([basic(), rule(employerCsg)], { basicSalary: '50000' }).employerCsg.trace.tiered.sentence).toBe(
      'Basic Salary: 50,000.00. This is 50,000.00 or below → rate: 3%. 50,000.00 × 3% = 1,500.00.'
    )
  })

  test('the narrowest tier wins: "Below 50,000" before "50,000 or below", both before "Below 100,000"', () => {
    const tiers = [
      { operator: 'below', threshold: 100000, rate: 5 },
      { operator: 'atOrBelow', threshold: 50000, rate: 4 },
      { operator: 'below', threshold: 50000, rate: 3 },
    ]
    expect(resolveMatchedTier(tiers, 30000).rate).toBe(3)
    expect(resolveMatchedTier(tiers, 50000).rate).toBe(4)
    expect(resolveMatchedTier(tiers, 70000).rate).toBe(5)
  })

  test('goes to Excel as <=, and a column saved with it is never flagged as an old rule', () => {
    expect(translateFormulaToExcel('basicSalary <= 50000 ? 0.03 : 0', (key) => (key === 'basicSalary' ? 'C7' : null))).toBe('IF((C7<=50000),0.03,0)')
    expect(savedTieredRule(rule(employerCsg))).toBeNull()
  })

  test('is offered in the tier builder', async () => {
    await show(<TieredFormulaBuilder availableColumns={[basic()]} baseKey="basicSalary" tiers={employerCsg} cap={null} onChange={vi.fn()} />)
    const select = container.querySelector('select[aria-label="Tiers"]')
    expect([...select.options].map((o) => o.textContent)).toEqual(['Below', 'At or below', 'Equal to', 'Above', 'From'])
    expect(select.value).toBe('atOrBelow')
  })
})

describe('a figure on a threshold no tier covers', () => {
  const gap = [
    { operator: 'below', threshold: 50000, rate: 1.5 },
    { operator: 'above', threshold: 50000, rate: 3 },
  ]

  test('the breakdown says it matches no tier', () => {
    const traced = computeRow([basic(), rule(gap)], { basicSalary: '50000' }).employerCsg.trace.tiered
    expect(traced.sentence).toBe('Basic Salary: 50,000.00. This matches no tier → rate: 0%. 50,000.00 × 0% = 0.00.')
    expect(traced.inGap).toBe(true)
    // Next to it, a tier holds as before.
    expect(computeRow([basic(), rule(gap)], { basicSalary: '49999' }).employerCsg.trace.tiered.inGap).toBe(false)
  })

  test('a figure under every tier is not on a gap, though it matches none', () => {
    const tiers = [
      { operator: 'above', threshold: 10000, rate: 1 },
      { operator: 'above', threshold: 50000, rate: 2 },
    ]
    const traced = computeRow([basic(), rule(tiers)], { basicSalary: '5000' }).employerCsg.trace.tiered
    expect(traced.sentence).toBe('Basic Salary: 5,000.00. This matches no tier → rate: 0%. 5,000.00 × 0% = 0.00.')
    expect(traced.inGap).toBe(false)
  })

  test('the table marks the cell, for the eye and for a screen reader', async () => {
    const columns = [basic(), rule(gap)]
    const employees = [
      { id: 'e1', values: { id: 'TST001', basicSalary: 50000 } },
      { id: 'e2', values: { id: 'TST002', basicSalary: 40000 } },
    ]
    await show(
      <table>
        <EmployeeTableBody employees={employees} columns={columns} />
      </table>
    )
    const cells = [...container.querySelectorAll('button[title$="Click to see calculation breakdown"]')]
    expect(cells.map((b) => b.title)).toEqual(['Matches no tier, so the rate is 0%. Click to see calculation breakdown', 'Click to see calculation breakdown'])
    expect(cells[0].textContent).toBe('Matches no tier, so the rate is 0%.0.00')
    expect(cells[1].textContent).toBe('fx600.00')
  })
})

function EmployeeTableBody({ employees, columns }) {
  return (
    <EmployeeTable
      employees={employees}
      identityFields={[{ id: 'f1', name: 'Employee ID', key: 'id' }]}
      idFieldKey="id"
      effectiveColumns={columns}
      computedGrid={computeGridForEmployees(employees, columns, getColumnsByKey(columns))}
      columnWidths={{}}
      onResizeColumn={vi.fn()}
      onUpdateValue={vi.fn()}
      onSetForEveryone={vi.fn()}
      onAddEmployee={vi.fn()}
      onDeleteEmployee={vi.fn()}
      onOpenBreakdown={vi.fn()}
    />
  )
}
