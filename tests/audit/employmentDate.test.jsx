// @vitest-environment jsdom

// Rehearsal fix F6 (17 Oct 2026, problem M3): "Send to dashboard" sends the date of employment as
// "YYYY-MM-DD", converting dates typed day first (the Mauritian way); a date that cannot be read
// without guessing is not sent for that employee, and the user is told first. TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import SendToDashboardButton from '../../src/components/SendToDashboardButton'
import { readEmploymentDate, withIsoEmploymentDates } from '../../src/lib/employmentDate'
import { computeGridForEmployees } from '../../src/lib/formulaEngine'
import { getColumnsByKey } from '../../src/lib/model'
import { REQUIRED_NAMES } from '../../src/lib/requiredNames'
import { input } from './build'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('readEmploymentDate', () => {
  test.each([
    ['01/08/2026', '2026-08-01'],
    ['1/8/2026', '2026-08-01'],
    ['15/03/2019', '2019-03-15'],
    ['05-05-2020', '2020-05-05'],
    ['10.10.2022', '2022-10-10'],
    [' 20/02/2023 ', '2023-02-20'],
    ['2019-03-15', '2019-03-15'],
  ])('%j is %j (day first)', (raw, iso) => {
    expect(readEmploymentDate(raw)).toEqual({ value: iso })
  })
  test.each(['31/02/2026', '13/13/2020', '01/08/26', '2026-8-1', 'August 2026', '46235', '1899-12-31', '2026-02-30', '01/08/2026 x'])(
    '%j cannot be read without guessing',
    (raw) => expect(readEmploymentDate(raw)).toEqual({ unreadable: true })
  )
  test.each(['', '  ', undefined, null])('%j is nothing typed', (raw) => expect(readEmploymentDate(raw)).toEqual({ empty: true }))
})

describe('withIsoEmploymentDates', () => {
  test('converts, leaves out what cannot be read (listing it) and what is empty; other keys untouched', () => {
    const rows = [
      { ID: 'T1', 'Date of Employment': '01/08/2026', 'Basic Salary': 18000 },
      { ID: 'T2', 'Date of Employment': '13/13/2020', 'Basic Salary': 50000 },
      { ID: 'T3', 'Date of Employment': '', 'Basic Salary': 0 },
    ]
    const { rows: sent, unreadable } = withIsoEmploymentDates(rows, 'Date of Employment')
    expect(sent).toEqual([
      { ID: 'T1', 'Date of Employment': '2026-08-01', 'Basic Salary': 18000 },
      { ID: 'T2', 'Basic Salary': 50000 },
      { ID: 'T3', 'Basic Salary': 0 },
    ])
    expect(unreadable).toEqual([{ index: 1, raw: '13/13/2020' }])
  })
  test('a setup without the field sends the rows as they are', () => {
    const rows = [{ ID: 'T1' }]
    expect(withIsoEmploymentDates(rows, null)).toEqual({ rows, unreadable: [] })
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

test('"Send to dashboard" sends "2026-08-01" for "01/08/2026", and warns first about a date it cannot read, naming the person', async () => {
  const sendToDashboard = vi.fn(async () => ({ ok: true }))
  window.PayrollHubBridge = { isEmbedded: () => true, sendToDashboard }
  // Every name the other apps look for is present, so only the dates are asked about.
  const columns = REQUIRED_NAMES.filter((n) => !['ID', 'Surname'].includes(n.name)).map((n, i) => input(n.name, `c${i}`, n.name === 'Age 60+' ? { valueType: 'checkbox' } : {}))
  const identityFields = [
    { id: 'f1', name: 'ID', key: 'id' },
    { id: 'f2', name: 'Surname', key: 'surname' },
    { id: 'f3', name: 'Date of Employment', key: 'dateOfEmployment' },
  ]
  const employees = [
    { id: 'e1', values: { id: 'T0000000000001', surname: 'One', dateOfEmployment: '01/08/2026' } },
    { id: 'e2', values: { id: 'T0000000000002', surname: 'Two', dateOfEmployment: '13/13/2020' } },
  ]
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <SendToDashboardButton
        identityFields={identityFields}
        effectiveColumns={columns}
        employees={employees}
        computedGrid={computeGridForEmployees(employees, columns, getColumnsByKey(columns))}
        companyName="TEST Co A"
        companyDetails={{ address: '', brn: 'TEST-BRN', customFields: [] }}
        year={2026}
        month={9}
      />
    )
  )
  const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
  await act(async () => button('Send to dashboard').click())
  expect(sendToDashboard).not.toHaveBeenCalled()
  expect(document.querySelector('[data-testid="required-names"]')).toBeNull()
  const note = document.querySelector('[data-testid="unreadable-dates"]')
  expect([...note.children].map((p) => p.textContent).join(' | ')).toBe(
    'Dates of employment that can’t be read | T0000000000002 Two (“13/13/2020”). | These are not sent. Write the date as DD/MM/YYYY, for example 01/08/2026, or send anyway without them.'
  )
  await act(async () => button('Send anyway').click())
  const [, payload] = sendToDashboard.mock.calls[0]
  expect(payload.rows.map((r) => r['Date of Employment'])).toEqual(['2026-08-01', undefined])
  expect('Date of Employment' in payload.rows[1]).toBe(false)
})
