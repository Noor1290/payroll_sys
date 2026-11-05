// @vitest-environment jsdom

// The Employee Table draws a row again only when what that row shows changes (speed fix F4,
// Payroll\SPEED_CHECK): typing in one cell redraws that row, not all of them. What one row
// shows because of the others (a duplicate ID) still follows them. TEST data only.

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// Counts the figures formatted for the screen: one row drawn formats that row's figures.
vi.mock('../../src/lib/format', async (original) => {
  const real = await original()
  return { ...real, formatDecimal: vi.fn(real.formatDecimal) }
})
const { formatDecimal } = await import('../../src/lib/format')
const { default: EmployeeTable } = await import('../../src/components/EmployeeTable')
const { useComputedGrid } = await import('../../src/hooks/useComputedGrid')
const { identityFields, idFieldKey, speedColumns, speedCompany } = await import('./speedData')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const columns = speedColumns()
const ROWS = 'table[style*="table-layout"] tbody tr'

let root
let host
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

// The table as the app gives it: its employees in state, figures from the hook, and a new
// onUpdateValue function on every render (as App.jsx does).
let updates = []
function Screen({ start }) {
  const [employees, setEmployees] = useState(start)
  const grid = useComputedGrid(employees, columns)
  const onUpdateValue = (empId, key, value) => {
    updates.push([empId, key, value])
    setEmployees((prev) => prev.map((e) => (e.id === empId ? { ...e, values: { ...e.values, [key]: value } } : e)))
  }
  return (
    <EmployeeTable
      employees={employees}
      identityFields={identityFields}
      idFieldKey={idFieldKey}
      effectiveColumns={columns}
      computedGrid={grid}
      columnWidths={{}}
      onResizeColumn={() => {}}
      onUpdateValue={onUpdateValue}
      onSetForEveryone={() => {}}
      onAddEmployee={() => {}}
      onDeleteEmployee={() => {}}
      onOpenBreakdown={() => {}}
    />
  )
}

/** Types into an input as a person does: React sees an input event with the new value. */
function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const cell = (row, label) => host.querySelectorAll(ROWS)[row].querySelector(`input[aria-label="${label}"]`)
const netPay = (row) => [...host.querySelectorAll(ROWS)[row].querySelectorAll('button')].map((b) => b.textContent).at(-2)

test('typing in one cell draws that row again, not the 40 others', () => {
  updates = []
  const employees = speedCompany(40)[11].employees
  act(() => root.render(<Screen start={employees} />))
  const before = netPay(5)
  const formattedForOneRow = (() => {
    formatDecimal.mockClear()
    type(cell(5, 'Basic Salary'), '51234.56')
    return formatDecimal.mock.calls.length
  })()
  // That row's figures and their explanations were formatted again (about 3 per column); the
  // whole table, 40 rows, would be about 40 times as many.
  expect(formattedForOneRow).toBeGreaterThan(0)
  expect(formattedForOneRow).toBeLessThanOrEqual(columns.length * 8)
  expect(netPay(5)).not.toBe(before)
  expect(updates).toEqual([[employees[5].id, 'basicSalary', '51234.56']])
  // The latest handler is used every time, not the one of the first render.
  type(cell(6, 'Allowances'), '10')
  type(cell(5, 'Allowances'), '20')
  expect(updates.slice(1)).toEqual([
    [employees[6].id, 'allowances', '10'],
    [employees[5].id, 'allowances', '20'],
  ])
})

test('a duplicate ID is marked on both rows, though only one was typed in, and unmarked again', () => {
  const employees = speedCompany(40)[11].employees.slice(0, 5)
  act(() => root.render(<Screen start={employees} />))
  const marked = () => [...host.querySelectorAll(ROWS)].map((r) => Boolean(r.querySelector('[aria-label="Duplicate ID"]'))).slice(0, 5)
  expect(marked()).toEqual([false, false, false, false, false])
  type(cell(3, 'ID'), employees[0].values.id)
  expect(marked()).toEqual([true, false, false, true, false])
  type(cell(3, 'ID'), 'TST7777')
  expect(marked()).toEqual([false, false, false, false, false])
})

test('the cell being typed in shows the figure as typed; the others stay rounded', () => {
  const employees = speedCompany(40)[11].employees.slice(0, 3)
  act(() => root.render(<Screen start={employees} />))
  const input = cell(1, 'Basic Salary')
  act(() => input.focus())
  type(input, '1234.5')
  expect(cell(1, 'Basic Salary').value).toBe('1234.5')
  act(() => input.blur())
  expect(cell(1, 'Basic Salary').value).toBe('1234.50')
  expect(cell(0, 'Basic Salary').value).toMatch(/^\d+\.\d\d$/)
})
