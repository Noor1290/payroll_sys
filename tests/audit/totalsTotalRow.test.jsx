// @vitest-environment jsdom

// The TOTAL row of the Totals tab (MRA rehearsal, P9): the sum of every number
// column, on the screen and in the Totals export, the same figures in both. An
// account with no company (P10): one sentence, and nothing else offered.
// TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import DashboardStart from '../../src/components/DashboardStart'
import TotalsTable from '../../src/components/TotalsTable'
import { buildExportPlan } from '../../src/lib/excelExport'
import { ERROR_TEXT } from '../../src/lib/exportErrors'
import { computeTotals, grandTotal } from '../../src/lib/totals'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root
let host
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

function show(element) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(element))
  return host
}

const identityFields = [
  { key: 'id', name: 'ID', valueType: 'text' },
  { key: 'surname', name: 'Surname', valueType: 'text' },
]
const columns = [
  { id: 'c1', key: 'basic', name: 'Basic', type: 'input', valueType: 'number', decimals: 2 },
  { id: 'c2', key: 'paye', name: 'PAYE', type: 'input', valueType: 'number', decimals: 2 },
  { id: 'c3', key: 'note', name: 'Note', type: 'input', valueType: 'text' },
  { id: 'c4', key: 'senior', name: 'Senior', type: 'input', valueType: 'checkbox' },
]
const employees = [
  { id: 'a', values: { id: 'T1', surname: 'DOE' } },
  { id: 'b', values: { id: 'T2', surname: 'ROE' } },
]
const grid = {
  a: { basic: { value: 18750.25 }, paye: { value: 100 }, note: { value: 'x' }, senior: { value: 1 } },
  b: { basic: { value: 20000.5 }, paye: { value: 0 }, note: { value: 'y' }, senior: { value: 0 } },
}
const rowText = (node) => [...node.querySelector('[data-testid="totals-grand-total"]').children].map((cell) => cell.textContent)

test('the Totals tab ends with a TOTAL row: every number column added up, text left empty', () => {
  const screen = show(<TotalsTable identityFields={identityFields} idFieldKey="id" effectiveColumns={columns} employees={employees} computedGrid={grid} />)
  expect(rowText(screen)).toEqual(['TOTAL', '', '38,750.75', '100.00', '', '1 ticked'])
})

test('it says Error for a column with an error in it: never counted as 0', () => {
  const broken = { ...grid, b: { ...grid.b, paye: { value: NaN, error: 'In error in August 2026' } } }
  const screen = show(<TotalsTable identityFields={identityFields} idFieldKey="id" effectiveColumns={columns} employees={employees} computedGrid={broken} />)
  expect(rowText(screen)[3]).toBe(ERROR_TEXT)
})

test('no employees, no TOTAL row', () => {
  const screen = show(<TotalsTable identityFields={identityFields} idFieldKey="id" effectiveColumns={columns} employees={[]} computedGrid={{}} />)
  expect(screen.querySelector('[data-testid="totals-grand-total"]')).toBeNull()
})

test('the Totals export ends with the same figures as the screen', () => {
  const periods = [
    { year: 2026, month: 7, employees: [{ id: 'a', values: { id: 'T1', surname: 'DOE', basic: 100.5, paye: 10 } }] },
    { year: 2026, month: 8, employees: [{ id: 'a2', values: { id: 'T1', surname: 'DOE', basic: 200.25, paye: 20 } }, { id: 'b', values: { id: 'T2', surname: 'ROE', basic: 50, paye: 5 } }] },
  ]
  const figures = columns.slice(0, 2)
  const totals = computeTotals(periods, figures, Object.fromEntries(figures.map((c) => [c.key, c])), 'id')
  const plan = buildExportPlan({ title: 'TEST Co A', companyId: 'x', kind: 'totals', employees: totals.employees, identityFields, effectiveColumns: figures, computedGrid: totals.computedGrid })
  const onScreen = grandTotal(totals.employees, figures, totals.computedGrid)
  expect(plan.totalsRow).toEqual(['TOTAL', '', onScreen.basic.sum, onScreen.paye.sum])
  expect(onScreen).toEqual({ basic: { sum: 350.75 }, paye: { sum: 35 } })
})

const SENTENCE = "Your account isn't a member of any company in the dashboard yet. Ask an admin to add you."

test('an account with no company sees the sentence, and no Try again', () => {
  const screen = show(<DashboardStart mode="no-company" problem={SENTENCE} onRetry={() => {}} />)
  expect(screen.querySelector('[role="alert"]').textContent).toBe(SENTENCE)
  expect(screen.querySelector('button')).toBeNull()
})
