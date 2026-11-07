// @vitest-environment jsdom

// TODO C15 (rehearsal 4.1, REPORT L11): "Copy from Previous Month" opened with nothing ticked
// ("Copy 0 Employees"), every column had to be ticked one by one (23 ticks), and the preview
// left the identity columns blank although they are copied. TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import CopyPreviousMonthModal from '../../src/components/CopyPreviousMonthModal'
import { identityFields, idFieldKey, input } from './build'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const columns = [input('Basic Salary', 'basicSalary'), input('Allowances', 'allowances')]
const september = [
  { id: 's1', values: { id: 'TST001', name: 'Uno', surname: 'Tester', basicSalary: 18000, allowances: 500 } },
  { id: 's2', values: { id: 'TST002', name: 'Dos', surname: 'Tester', basicSalary: 25000, allowances: 0 } },
]

let root
let container
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  root = container = null
})
async function open(currentEmployees, onConfirm = vi.fn()) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <CopyPreviousMonthModal
        previousEmployees={september}
        currentEmployees={currentEmployees}
        identityFields={identityFields}
        idFieldKey={idFieldKey}
        effectiveColumns={columns}
        previousPeriodLabel="September 2026"
        currentPeriodLabel="October 2026"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    )
  )
}
const buttons = () => [...document.querySelectorAll('button')]
const byText = (label) => buttons().find((b) => b.textContent.trim() === label)
const columnBoxes = () =>
  [...document.querySelectorAll('h3')]
    .find((h) => h.textContent === 'Columns to copy')
    .closest('div')
    .parentElement.querySelectorAll('input[type=checkbox]')
const employeeBoxes = () =>
  [...document.querySelectorAll('h3')]
    .find((h) => h.textContent.startsWith('Employees in'))
    .closest('div')
    .parentElement.querySelectorAll('input[type=checkbox]')

test('into an empty month: every employee and every column ticked, ready to copy, and the preview shows the identifiers', async () => {
  const onConfirm = vi.fn()
  await open([], onConfirm)
  expect([...employeeBoxes()].map((b) => b.checked)).toEqual([true, true])
  expect([...columnBoxes()].every((b) => b.checked)).toBe(true)
  const previewRows = [...document.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))
  expect(previewRows).toEqual([
    ['TST001 Uno Tester', 'Create new', 'TST001', 'Uno', 'Tester', '18,000.00', '500.00'],
    ['TST002 Dos Tester', 'Create new', 'TST002', 'Dos', 'Tester', '25,000.00', '0.00'],
  ])
  await act(async () => byText('Copy 2 Employees').click())
  expect(onConfirm.mock.calls[0][0].map((e) => e.values)).toEqual(september.map((e) => e.values))
})

test('into a month that has employees: every employee ticked, no column (nothing is overwritten unasked), and a Select All for the columns', async () => {
  await open([{ id: 'o1', values: { id: 'TST001', name: 'Uno', surname: 'Tester', basicSalary: 19000 } }])
  expect([...employeeBoxes()].map((b) => b.checked)).toEqual([true, true])
  expect([...columnBoxes()].some((b) => b.checked)).toBe(false)
  expect(byText('Copy 2 Employees').disabled).toBe(true)
  const selectColumns = buttons().find((b) => b.getAttribute('aria-label') === 'Select all columns')
  expect(selectColumns.textContent).toBe('Select All')
  await act(async () => selectColumns.click())
  expect([...columnBoxes()].every((b) => b.checked)).toBe(true)
  expect(byText('Copy 2 Employees').disabled).toBe(false)
  await act(async () => buttons().find((b) => b.getAttribute('aria-label') === 'Clear all columns').click())
  expect([...columnBoxes()].some((b) => b.checked)).toBe(false)
})
