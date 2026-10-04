// @vitest-environment jsdom

// Safety net, part 4: data coming IN. Runs the whole app (fake data only),
// feeds a small fake .xlsx through "Import from Excel" and its real mapping
// dialog, and uses the real "Copy from Previous Month" dialog, then compares
// the employee data the app stored for the month with the recorded result.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import * as XLSX from 'xlsx'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { expectRecorded } from './recorded'
import {
  identityFields,
  idFieldKey,
  globalColumns,
  company,
  effectiveColumns,
  octoberEmployees,
  septemberEmployees,
  octoberGrid,
} from './fixture'
import { buildExportPlan, buildWorkbookBuffer } from '../../src/lib/excelExport'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const OCTOBER_KEY = `payroll_period_${company.id}_2026-10`
const SEPTEMBER_KEY = `payroll_period_${company.id}_2026-09`

let App
beforeAll(async () => {
  await import('../../src/payrollHubBridge.js')
  App = (await import('../../src/App.jsx')).default
})

let root = null
let container = null

function seed({ october = [], september = [] }) {
  localStorage.clear()
  localStorage.setItem(
    'payroll_app_state_v1',
    JSON.stringify({ identityFields, idFieldKey, globalColumns, companies: [company], activeCompanyId: company.id })
  )
  localStorage.setItem(OCTOBER_KEY, JSON.stringify({ employees: october }))
  localStorage.setItem(SEPTEMBER_KEY, JSON.stringify({ employees: september }))
}

async function startApp() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<App />))
  await vi.waitFor(() => expect(document.body.textContent).toContain('October 2026'))
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function buttonByText(text) {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
  expect(button, `button "${text}"`).toBeTruthy()
  return button
}

async function click(element) {
  await act(async () => element.click())
}

// The employees the app stored for October, with the random ids of newly
// created rows replaced so the recording is stable.
function storedOctober(knownIds = []) {
  const { employees } = JSON.parse(localStorage.getItem(OCTOBER_KEY))
  return employees.map((e) => ({ id: knownIds.includes(e.id) ? e.id : '<new>', values: e.values }))
}

// Hands a workbook to the app's hidden file input, as picking a file would.
async function chooseFile(bytes, name) {
  const input = document.querySelector('input[type="file"][accept=".xlsx"]')
  expect(input, 'the Import from Excel file input').toBeTruthy()
  const file = { name, arrayBuffer: async () => bytes }
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  await vi.waitFor(() => expect(document.body.textContent).toContain('Preview (first'))
}

function mappingSelectFor(fieldName) {
  const row = [...document.querySelectorAll('span[title]')].find((s) => s.getAttribute('title') === fieldName)
  expect(row, `mapping row "${fieldName}"`).toBeTruthy()
  return row.parentElement.querySelector('select')
}

async function chooseOption(select, optionText) {
  const option = [...select.options].find((o) => o.textContent.trim() === optionText)
  expect(option, `option "${optionText}"`).toBeTruthy()
  await act(async () => {
    select.value = option.value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

// A workbook as another payroll tool might produce it: a banner row, a blank
// row, then headers - some matching the app's field names, some not.
function externalWorkbook() {
  const rows = [
    ['Fake Co Ltd - payroll input (fake data)'],
    [],
    ['id', 'Surname', 'Other Names', 'Salary', 'GOVT INCREMENT', 'Full time / Part time', 'Allowances', 'Travelling', 'Age 60+', 'EDF', 'Remarks'],
    ['F101', 'Importee', 'Uno Fake', 21000, '', 'Full time', 1500.5, 800, 'No', 390000, 'first'],
    ['F102', 'Importee, Jr', 'Dos "D" Fake', '34500.75', 250, 'Part time', '', 0, 'Yes', '', ''],
    ['F103', 'Importee', 'Tres Fake', 'n/a', 'abc', '', 0, '', 'x', 130000, 'not a number'],
    [],
    ['F104', 'Importee', 'Cuatro Fake', 60000, 0, 'Full time', 2500, 1200, 'TRUE', 500000, ''],
  ]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Payroll')
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
}

test('"Import from Excel": a fake external workbook, through the real mapping dialog', async () => {
  seed({})
  await startApp()
  await chooseFile(externalWorkbook(), 'fake-external.xlsx')

  // What the dialog matched on its own, before any manual choice.
  const autoMapping = Object.fromEntries(
    [...document.querySelectorAll('span[title]')]
      .filter((s) => s.parentElement.querySelector('select'))
      .map((s) => {
        const select = s.parentElement.querySelector('select')
        return [s.getAttribute('title'), select.selectedOptions[0].textContent.trim()]
      })
  )

  // "Salary" doesn't match "Basic Salary" by name, so it is mapped by hand;
  // "Remarks" is mapped onto the text column "Internal Note".
  await chooseOption(mappingSelectFor('Basic Salary'), 'Salary')
  await chooseOption(mappingSelectFor('Internal Note'), 'Remarks')

  await click(buttonByText('Import 4 rows'))
  await vi.waitFor(() => expect(JSON.parse(localStorage.getItem(OCTOBER_KEY)).employees).toHaveLength(4))

  expectRecorded('import-external-workbook', { autoMapping, employees: storedOctober() })
})

test('"Import from Excel": the app\'s own export, recognised and re-imported', async () => {
  // The file "Export to Excel" would produce for the fake October data.
  const plan = buildExportPlan({
    title: company.name,
    companyId: company.id,
    companyDetails: company.details,
    kind: 'period',
    exportMode: 'values',
    employees: octoberEmployees,
    identityFields,
    effectiveColumns,
    computedGrid: octoberGrid,
  })
  const bytes = await buildWorkbookBuffer(plan)

  seed({})
  await startApp()
  await chooseFile(bytes, 'fake-system-export.xlsx')
  expect(document.body.textContent).toContain('Recognized as a previous export from this company')

  await click(buttonByText('Import 6 rows'))
  await vi.waitFor(() => expect(JSON.parse(localStorage.getItem(OCTOBER_KEY)).employees).toHaveLength(6))

  expectRecorded('import-own-export', storedOctober())
})

test('"Copy from Previous Month": selected employees and columns, with overwrite', async () => {
  // October already has two of September's employees (with different figures) and one of its own.
  const october = [
    { id: 'oct-1', values: { id: 'F001', surname: 'Testeur', otherNames: 'Alpha Fake', basicSalary: '99999', allowances: '1', travelling: '77', aged60: true, fullTimePartTime: 'Part time', edf: '5' } },
    { id: 'oct-2', values: { id: 'F002', surname: 'Exemple, Jr', otherNames: 'Beta "B" Fake', basicSalary: '', allowances: '', travelling: '', aged60: false, fullTimePartTime: '', edf: '' } },
    { id: 'oct-9', values: { id: 'F009', surname: 'Stayer', otherNames: 'Iota Fake', basicSalary: '12345.67', allowances: '10', travelling: '20', aged60: false, fullTimePartTime: 'Full time', edf: '30' } },
  ]
  seed({ october, september: septemberEmployees })
  await startApp()

  await click(buttonByText('Copy from Previous Month'))
  const dialogText = () => document.body.textContent
  expect(dialogText()).toContain('Employees in September 2026')

  // Every September employee except the one with no ID ("Unnumbered").
  const employeeBox = (label) => [...document.querySelectorAll('label')].find((l) => l.textContent.includes(label)).querySelector('input')
  for (const label of ['F001', 'F002', 'F007']) await click(employeeBox(label))

  // Some columns, not all: Travelling and EDF are deliberately left alone.
  const columnBox = (name) => [...document.querySelectorAll('label')].find((l) => l.textContent.trim() === name).querySelector('input')
  for (const name of ['Basic Salary', 'Govt Increment', 'Full time / Part time', 'Allowances', 'Age 60+']) await click(columnBox(name))

  await click(buttonByText('Copy 3 Employees'))
  // Two of the three already exist in October, so the app asks first.
  expect(dialogText()).toContain('This will overwrite existing values for 2 employees')
  await click(buttonByText('Overwrite'))

  await vi.waitFor(() => expect(JSON.parse(localStorage.getItem(OCTOBER_KEY)).employees).toHaveLength(4))
  expectRecorded('copy-from-previous-month', storedOctober(['oct-1', 'oct-2', 'oct-9']))

  // The source month must be untouched.
  expect(JSON.parse(localStorage.getItem(SEPTEMBER_KEY)).employees).toEqual(septemberEmployees)
})
