// @vitest-environment jsdom

// TODO C3 (rehearsal M2): "-500" as a Basic Salary gave an Employee CSG of -7.50, and an empty Basic
// Salary counted as 0, with no word before "Send to dashboard". Both are now listed before sending.
// A warning, never a block. TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import SendToDashboardButton from '../../src/components/SendToDashboardButton'
import { computeGridForEmployees } from '../../src/lib/formulaEngine'
import { getColumnsByKey } from '../../src/lib/model'
import { buildPdfFillColumns } from '../../src/lib/pdfFillExport'
import { REQUIRED_NAMES } from '../../src/lib/requiredNames'
import { findSendWarnings, listNames } from '../../src/lib/sendChecks'
import { EMPLOYEE, input, simple } from './build'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ids = [
  { id: 'f1', name: 'ID', key: 'id' },
  { id: 'f2', name: 'Surname', key: 'surname' },
]
// Every required name, so that only the new warnings can be asked; Employee CSG is worked out.
const columns = [
  ...REQUIRED_NAMES.filter((n) => !['ID', 'Surname', 'Employee CSG'].includes(n.name)).map((n, i) =>
    n.name === 'Basic Salary' ? input('Basic Salary', 'basicSalary') : input(n.name, `c${i}`, n.name === 'Age 60+' ? { valueType: 'checkbox' } : {})
  ),
  simple('Employee CSG', 'employeeCsg', 'basicSalary * 0.015', { category: EMPLOYEE }),
]
const filled = (values) => ({
  ...Object.fromEntries(columns.filter((c) => c.type === 'input').map((c) => [c.key, c.valueType === 'checkbox' ? 0 : 1000])),
  ...values,
})
const people = [
  { id: 'e1', values: filled({ id: 'TST001', surname: 'Alpha', basicSalary: -500 }) },
  { id: 'e2', values: filled({ id: 'TST002', surname: 'Beta', basicSalary: '' }) },
  { id: 'e3', values: filled({ id: 'TST003', surname: 'Gamma', basicSalary: 18000 }) },
]
const gridOf = (emps) => computeGridForEmployees(emps, columns, getColumnsByKey(columns))

describe('findSendWarnings', () => {
  test('lists each negative figure, typed or worked out, and each required input left empty', () => {
    const found = findSendWarnings(people, buildPdfFillColumns(ids, columns), gridOf(people), ids)
    expect(found.negatives).toEqual([
      { column: 'Basic Salary', entries: [{ employee: 'TST001 Alpha', value: -500 }] },
      { column: 'Employee CSG', entries: [{ employee: 'TST001 Alpha', value: -7.5 }] },
    ])
    expect(found.empty).toEqual([{ column: 'Basic Salary', employees: ['TST002 Beta'] }])
  })

  test('nothing to say when every figure is 0 or more and every required input is filled in', () => {
    const fine = [{ id: 'e3', values: filled({ id: 'TST003', surname: 'Gamma', basicSalary: 18000 }) }]
    expect(findSendWarnings(fine, buildPdfFillColumns(ids, columns), gridOf(fine), ids)).toEqual({ negatives: [], empty: [] })
  })

  test('an empty input that is not a required name is not listed', () => {
    const extra = [...columns, input('Bonus', 'bonus')]
    const emps = [{ id: 'e3', values: filled({ id: 'TST003', surname: 'Gamma', basicSalary: 18000 }) }]
    const grid = computeGridForEmployees(emps, extra, getColumnsByKey(extra))
    expect(findSendWarnings(emps, buildPdfFillColumns(ids, extra), grid, ids).empty).toEqual([])
  })

  // Owner's choice after Stage 2: realistic months leave Allowances, EDF, Govt Increment or
  // Travelling empty on purpose, so only an empty Basic Salary is worth a word. Negative figures
  // are still listed in every column.
  test('an empty required input other than Basic Salary is not listed; a negative one still is', () => {
    const travelling = columns.find((c) => c.name === 'Travelling')
    const emps = [{ id: 'e3', values: filled({ id: 'TST003', surname: 'Gamma', basicSalary: 18000, [travelling.key]: '' }) }]
    expect(findSendWarnings(emps, buildPdfFillColumns(ids, columns), gridOf(emps), ids).empty).toEqual([])
    const minus = [{ id: 'e3', values: filled({ id: 'TST003', surname: 'Gamma', basicSalary: 18000, [travelling.key]: -50 }) }]
    expect(findSendWarnings(minus, buildPdfFillColumns(ids, columns), gridOf(minus), ids).negatives).toEqual([
      { column: 'Travelling', entries: [{ employee: 'TST003 Gamma', value: -50 }] },
    ])
  })

  test('-0.004 rounds to 0.00, so it is not negative', () => {
    const emps = [{ id: 'e1', values: filled({ id: 'TST001', surname: 'Alpha', basicSalary: -0.004 }) }]
    expect(findSendWarnings(emps, buildPdfFillColumns(ids, columns), gridOf(emps), ids).negatives).toEqual([])
  })

  test('a long list is shortened', () => {
    expect(listNames(['A'])).toBe('A')
    expect(listNames(['A', 'B', 'C'])).toBe('A, B and C')
    expect(listNames(['A', 'B', 'C', 'D', 'E', 'F', 'G'])).toBe('A, B, C, D, E and 2 more')
  })
})

let root
let container
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  root = container = null
  delete window.PayrollHubBridge
})
const text = (el) => [...el.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()).join(' | ')
const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label)

test('"Send to dashboard" asks first, in plain words; Cancel sends nothing, "Send anyway" sends', async () => {
  const send = vi.fn(async () => ({ ok: true }))
  window.PayrollHubBridge = { isEmbedded: () => true, sendToDashboard: send }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const props = {
    identityFields: ids,
    effectiveColumns: columns,
    employees: people,
    computedGrid: gridOf(people),
    companyName: 'TEST Co A',
    companyDetails: { address: '', brn: 'TEST-BRN', customFields: [] },
    year: 2026,
    month: 10,
  }
  await act(async () => root.render(<SendToDashboardButton {...props} />))
  await act(async () => button('Send to dashboard').click())
  expect(send).not.toHaveBeenCalled()
  expect(document.querySelector('[data-testid="required-names"]')).toBeNull()
  expect(text(document.querySelector('[data-testid="negative-figures"]'))).toBe(
    ['Negative figures', 'Basic Salary: TST001 Alpha (-500.00).', 'Employee CSG: TST001 Alpha (-7.50).', 'Check that they are meant, or send anyway.'].join(' | ')
  )
  expect(text(document.querySelector('[data-testid="empty-required"]'))).toBe(
    ['Required figures left empty', 'Basic Salary: TST002 Beta.', 'An empty cell counts as 0. Fill them in, or send anyway.'].join(' | ')
  )
  await act(async () => button('Cancel').click())
  expect(send).not.toHaveBeenCalled()
  await act(async () => button('Send to dashboard').click())
  await act(async () => button('Send anyway').click())
  expect(send).toHaveBeenCalledTimes(1)
})
