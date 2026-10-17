// @vitest-environment jsdom

// Rehearsal fix F4 (17 Oct 2026, problem H1): before "Send to dashboard" and in "Export for PDF fill",
// the names the dashboard and the payslip app look for that are missing, or written differently, are
// listed in plain words. A warning, never a block. One list of names here, which must stay the same
// as the dashboard's own and the payslip app's (read from the sibling repositories). TEST data only.

import fs from 'node:fs'
import path from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import PdfFillExportModal from '../../src/components/PdfFillExportModal'
import SendToDashboardButton from '../../src/components/SendToDashboardButton'
import { computeGridForEmployees } from '../../src/lib/formulaEngine'
import { getColumnsByKey } from '../../src/lib/model'
import { checkRequiredNames, REQUIRED_NAMES } from '../../src/lib/requiredNames'
import { EMPLOYEE, EMPLOYER, OTHER, input, simple } from './build'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const sibling = (repo, file) => fs.readFileSync(path.resolve(import.meta.dirname, '../../..', repo, file), 'utf8')

describe('one list of required names, the same as the other apps (rehearsal fix F4)', () => {
  test("the dashboard's: every required payroll field, in its order, apart from the company fields this app always sends", () => {
    const source = sibling('payroll_hub', 'src/config/payrollFields.ts')
    const list = source.slice(source.indexOf('export const PAYROLL_FIELDS'), source.indexOf('];', source.indexOf('export const PAYROLL_FIELDS')))
    const fields = []
    for (const m of list.matchAll(/(optionalMoney|money)\("([^"]+)"|\{\s*jsonKey:\s*"([^"]+)"[\s\S]*?required:\s*(true|false)/g)) {
      if (m[2]) fields.push({ name: m[2], required: m[1] === 'money' })
      else fields.push({ name: m[3], required: m[4] === 'true' })
    }
    expect(fields.length).toBeGreaterThan(20)
    const hubRequired = fields.filter((f) => f.required && !['Company Name', 'BRN'].includes(f.name)).map((f) => f.name)
    expect(REQUIRED_NAMES.filter((n) => n.dashboard).map((n) => n.name)).toEqual(hubRequired)
    // What the dashboard knows but does not require is not listed as required by it.
    const hubOptional = new Set(fields.filter((f) => !f.required).map((f) => f.name))
    for (const n of REQUIRED_NAMES.filter((r) => !r.dashboard)) expect(hubOptional.has(n.name), n.name).toBe(true)
  })

  test("the payslip app's: the name and NIC it reads, the CSG and NSF it copies, the three totals it checks", () => {
    const file = sibling('payslip', 'src/lib/payrollFile.ts')
    const template = sibling('payslip', 'src/lib/template.ts')
    const payslipNeeds = new Set()
    for (const m of file.matchAll(/\$\{rowNumber\}: (\w+) is missing/g)) payslipNeeds.add(m[1])
    const checks = template.match(/checks: \{ gross: '([^']+)', deductions: '([^']+)', net: '([^']+)' \}/)
    checks.slice(1).forEach((name) => payslipNeeds.add(name))
    for (const m of template.matchAll(/key: '([^']+)'[^}]*required: true/g)) payslipNeeds.add(m[1])
    expect([...payslipNeeds].sort()).toEqual(REQUIRED_NAMES.filter((n) => n.payslip).map((n) => n.name).sort())
  })
})

describe('checkRequiredNames', () => {
  // The rehearsal's setup as written, before it was adapted.
  const asWritten = ['Employee ID', 'Name', 'NIC', 'Date of Employment', 'Basic Salary', 'Govt Increment', 'Total Earnings', 'Total Deductions', 'Net Pay', 'Employee CSG', 'Employee NSF', 'PAYE', 'Employer CSG', 'Employer NSF']

  test('the rehearsal setup as written: what is missing, and a name that differs only in capitals', () => {
    const problems = checkRequiredNames(asWritten)
    expect(problems.filter((p) => p.kind === 'missing').map((p) => p.name)).toEqual([
      'ID', 'Surname', 'New Basic Salary', 'Allowances', 'Emoluments', 'Travelling', 'Gross Pay', 'Age 60+', 'CSG', 'NSF', 'Levy', 'PRGF', 'Total MRA contributions', 'EDF', 'EDF (monthly)', 'Total',
    ])
    expect(problems.filter((p) => p.kind === 'capitals')).toEqual([{ name: 'Total deductions', dashboard: true, payslip: true, kind: 'capitals', found: ['Total Deductions'] }])
  })

  test('two columns with one name go out with their categories: the plain name is reported as shared', () => {
    const problems = checkRequiredNames(['PAYE (Employee Contribution)', 'PAYE (Other Deductions)'])
    expect(problems.find((p) => p.name === 'PAYE')).toMatchObject({ kind: 'shared', found: ['PAYE (Employee Contribution)', 'PAYE (Other Deductions)'] })
  })

  test('every name present: nothing to say', () => {
    expect(checkRequiredNames(REQUIRED_NAMES.map((n) => n.name))).toEqual([])
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
async function show(element) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(element))
}
const text = (el) => [...el.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()).join(' | ')
const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label)

const identity = [{ id: 'f1', name: 'Employee ID', key: 'id' }, { id: 'f2', name: 'Name', key: 'name' }]
const someColumns = [
  input('Basic Salary', 'basicSalary'),
  simple('Total Deductions', 'totalDeductions', 'basicSalary * 0'),
  simple('PAYE', 'paye', 'basicSalary * 0', { category: EMPLOYEE }),
  simple('PAYE', 'payeOther', 'basicSalary * 0', { category: OTHER }),
  simple('CSG', 'csg', 'basicSalary * 0.03', { category: EMPLOYER }),
]
const employees = [{ id: 'e1', values: { id: 'TST001', name: 'Uno', basicSalary: 18000 } }]

test('"Export for PDF fill" lists the names in plain words, and still exports', async () => {
  const grid = computeGridForEmployees(employees, someColumns, getColumnsByKey(someColumns))
  await show(
    <PdfFillExportModal
      format="json"
      identityFields={identity}
      effectiveColumns={someColumns}
      employees={employees}
      computedGrid={grid}
      companyName="TEST Co A"
      companyDetails={{ address: '', brn: 'TEST-BRN', customFields: [] }}
      year={2026}
      month={10}
      onClose={vi.fn()}
    />
  )
  const note = document.querySelector('[data-testid="required-names"]')
  expect(text(note)).toBe(
    [
      'Names the dashboard and the payslip app look for',
      'Missing: ID (both), Surname (both), Govt Increment (the dashboard), New Basic Salary (the dashboard), Allowances (the dashboard), Emoluments (the dashboard), Travelling (the dashboard), Gross Pay (both), Age 60+ (the dashboard), NSF (the dashboard), Employee CSG (the payslip app), Employee NSF (the payslip app), Net Pay (both), Levy (the dashboard), PRGF (the dashboard), Total MRA contributions (the dashboard), EDF (the dashboard), EDF (monthly) (the dashboard), Total (the dashboard).',
      '“Total Deductions” should be written “Total deductions” (both).',
      'Two columns are called “PAYE”, so they go out as “PAYE (Employee Contribution)” and “PAYE (Other Deductions)”, and “PAYE” itself is missing (the dashboard). Rename one of them.',
      'This only matters if the file goes to the dashboard or the payslip app. You can still export.',
    ].join(' | ')
  )
  expect(button('Export JSON').disabled).toBe(false)
})

describe('"Send to dashboard" with the names checked first', () => {
  function bridge() {
    const sendToDashboard = vi.fn(async () => ({ ok: true }))
    window.PayrollHubBridge = { isEmbedded: () => true, sendToDashboard }
    return sendToDashboard
  }
  const props = (columns, emps = employees) => ({
    identityFields: identity,
    effectiveColumns: columns,
    employees: emps,
    computedGrid: computeGridForEmployees(emps, columns, getColumnsByKey(columns)),
    companyName: 'TEST Co A',
    companyDetails: { address: '', brn: 'TEST-BRN', customFields: [] },
    year: 2026,
    month: 10,
  })

  test('names missing: asks, Cancel sends nothing, "Send anyway" sends', async () => {
    const send = bridge()
    await show(<SendToDashboardButton {...props(someColumns)} />)
    await act(async () => button('Send to dashboard').click())
    expect(send).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="required-names"]').textContent).toContain('Add or rename the columns under Global Columns or Company Columns, or send anyway.')
    await act(async () => button('Cancel').click())
    expect(send).not.toHaveBeenCalled()
    await act(async () => button('Send to dashboard').click())
    await act(async () => button('Send anyway').click())
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('every name right: sent at once, nothing asked', async () => {
    const send = bridge()
    const allNames = REQUIRED_NAMES.filter((n) => !['ID', 'Surname'].includes(n.name)).map((n, i) => input(n.name, `c${i}`, n.name === 'Age 60+' ? { valueType: 'checkbox' } : {}))
    const ids = [{ id: 'f1', name: 'ID', key: 'id' }, { id: 'f2', name: 'Surname', key: 'surname' }]
    const emps = [{ id: 'e1', values: { id: 'T001', surname: 'Tester' } }]
    await show(<SendToDashboardButton {...props(allNames, emps)} identityFields={ids} />)
    await act(async () => button('Send to dashboard').click())
    expect(document.querySelector('[data-testid="required-names"]')).toBeNull()
    expect(send).toHaveBeenCalledTimes(1)
  })
})
