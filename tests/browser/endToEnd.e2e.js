// Browser test 4: the whole flow across the apps, with TEST data.
//
//   payroll app (figures) -> "Export for PDF fill (JSON)" -> PDF form filler
//                                                         -> payslip app (Excel and PDF)
//                                                         -> Payroll Hub dashboard (demo mode)
//   then a second month with one salary changed -> only that employee is flagged.
//
// It starts the sister apps from the folders next to this one ("PDF Editor",
// "payslip", "payroll_hub"), each on a test port of its own, and drives every
// app in a throwaway browser profile. The dashboard runs in its demo mode
// (fake data kept in memory); the payslip app's month review runs inside its
// own stand-in dashboard. Nothing connects to the live database.
//
// A test named "evidence" records what the apps do today where that is a
// limitation someone has to act on.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { getColumnsByKey } from '../../src/lib/model'
import { EMPLOYEE, EMPLOYER, OTHER, checkboxExemption, input, simple, tiered } from '../audit/build'
import { readPdfText } from '../../../PDF Editor/tests/helpers/read-pdf.mjs'
import { createFakeHub } from '../../../payslip/scripts/lib/fake-hub.mjs'
import {
  startApp,
  openSeeded,
  periodStorageKey,
  readEmployeeTable,
  dialog,
  download,
  openExportMenu,
  setCell,
  goToMonth,
} from './app'

const DESKTOP = path.resolve(import.meta.dirname, '../../..')
const FOLDERS = { pdf: path.join(DESKTOP, 'PDF Editor'), payslip: path.join(DESKTOP, 'payslip'), hub: path.join(DESKTOP, 'payroll_hub') }
const HUB_ORIGIN = 'https://noor1290.github.io'

// What the dashboard requires in every row of a payroll file (payroll_hub: src/config/payrollFields.ts).
const HUB_REQUIRED_KEYS = [
  'ID', 'Surname', 'Basic Salary', 'Govt Increment', 'New Basic Salary', 'Allowances', 'Emoluments', 'Travelling', 'Gross Pay', 'Age 60+',
  'CSG', 'NSF', 'PAYE', 'Total deductions', 'Net Pay', 'Levy', 'PRGF', 'Total MRA contributions', 'EDF', 'EDF (monthly)', 'Total', 'Company Name', 'BRN',
]

// ------------------------------------------------------------- the sister apps

const children = []

// Starts one sister app with its own copy of Vite, on a test port, and waits until it answers.
async function startSisterApp(folder, port, basePath, extraArgs = []) {
  const vite = path.join(folder, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!fs.existsSync(vite)) throw new Error(`${folder} has no node_modules: run "npm install" there first.`)
  const child = spawn(process.execPath, [vite, '--port', String(port), '--strictPort', ...extraArgs], { cwd: folder, stdio: 'ignore' })
  children.push(child)
  const url = `http://localhost:${port}${basePath}`
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      if ((await fetch(url)).ok) return url
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`${folder} did not start on port ${port}.`)
}

let app
let urls
beforeAll(async () => {
  app = await startApp()
  urls = {
    pdf: await startSisterApp(FOLDERS.pdf, 5283, '/pdf-form-filler/'),
    payslip: await startSisterApp(FOLDERS.payslip, 5285, '/payslip/'),
    hub: await startSisterApp(FOLDERS.hub, 5286, '/payroll-hub/', ['--mode', 'demo']),
  }
})
afterAll(async () => {
  for (const child of children) child.kill()
  await app?.close()
})

// ------------------------------------------------------------------ TEST data

const IDENTITY = [
  { id: 'idf-id', name: 'ID', key: 'id' },
  { id: 'idf-surname', name: 'Surname', key: 'surname' },
  { id: 'idf-other', name: 'Other names', key: 'otherNames' },
]

// The columns of a payroll set up with the names the payslip app and the
// dashboard expect: the employee's deductions are "Employee CSG" and
// "Employee NSF", the employer's are "CSG" and "NSF".
// With `clashingNames`, the employee's CSG column is ALSO called "CSG".
function payrollColumns({ clashingNames = false } = {}) {
  const csgTiers = (low, high) => ({
    baseKey: 'newBasicSalary',
    tiers: [
      { operator: 'below', threshold: 50000, rate: low },
      { operator: 'equal', threshold: 50000, rate: low },
      { operator: 'above', threshold: 50000, rate: high },
    ],
    cap: null,
  })
  return [
    input('Basic Salary', 'basicSalary'),
    input('Govt Increment', 'govtIncrement'),
    simple('New Basic Salary', 'newBasicSalary', 'basicSalary + govtIncrement'),
    input('Full time / Part time', 'fullTimePartTime', { valueType: 'text' }),
    input('Allowances', 'allowances'),
    simple('Emoluments', 'emoluments', 'newBasicSalary + allowances'),
    input('Travelling', 'travelling'),
    simple('Gross Pay', 'grossPay', 'emoluments + travelling'),
    input('Age 60+', 'age60', { valueType: 'checkbox' }),
    simple('Net Pay', 'netPay', 'grossPay - totalDeductions'),
    tiered(clashingNames ? 'CSG' : 'Employee CSG', 'employeeCsg', csgTiers(1.5, 3), { category: EMPLOYEE }),
    tiered('Employee NSF', 'employeeNsf', { baseKey: 'grossPay', tiers: [{ operator: 'from', threshold: 0, rate: 1 }], cap: 29710 }, { category: EMPLOYEE, exemption: checkboxExemption('age60') }),
    input('PAYE', 'paye', { category: EMPLOYEE }),
    simple('Total deductions', 'totalDeductions', 'employeeCsg + employeeNsf + paye', { category: EMPLOYEE }),
    tiered('CSG', 'csg', csgTiers(3, 6), { category: EMPLOYER }),
    simple('NSF', 'nsf', 'grossPay * 0.025', { category: EMPLOYER }),
    input('Levy', 'levy', { category: EMPLOYER }),
    simple('PRGF', 'prgf', 'emoluments * 0.045', { category: EMPLOYER }),
    simple('Total MRA contributions', 'totalMra', 'csg + nsf + levy + prgf', { category: EMPLOYER }),
    input('EDF', 'edf', { category: OTHER }),
    simple('EDF (monthly)', 'edfMonthly', 'edf / 13', { category: OTHER }),
    simple('Total', 'total', 'edfMonthly * 0', { category: OTHER }),
  ]
}

const SEPTEMBER = [
  // 18,115 + 635 = 18,750; + 1,250 travelling = 20,000 gross; CSG 281.25; NSF 200.00; net 19,518.75
  { id: 'e1', values: { id: 'TST001', surname: 'TESTER', otherNames: 'Alpha', basicSalary: '18115', govtIncrement: '635', fullTimePartTime: 'Full Time', allowances: '0', travelling: '1250', age60: false, paye: '0', levy: '0', edf: '390000' } },
  // 100,000 gross; CSG 3% = 3,000; aged 60+ so NSF 0; PAYE 8,600; net 88,400
  { id: 'e2', values: { id: 'TST002', surname: 'TESTER', otherNames: 'Beta', basicSalary: '95000', govtIncrement: '5000', fullTimePartTime: 'Part Time', allowances: '0', travelling: '0', age60: true, paye: '8600', levy: '0', edf: '390000' } },
  // 60,000 + 2,500.50 = 62,500.50 gross; CSG 1,800; NSF 297.10; PAYE 2,450.05; net 57,953.35
  { id: 'e3', values: { id: 'TST003', surname: 'TESTER', otherNames: 'Gamma', basicSalary: '60000', govtIncrement: '0', fullTimePartTime: 'Full Time', allowances: '2500.5', travelling: '0', age60: false, paye: '2450.05', levy: '0', edf: '390000' } },
]

function payrollSeed(options) {
  const company = {
    id: 'test-co-a',
    name: 'TEST Co A',
    columns: [],
    columnWidths: {},
    viewYear: 2026,
    viewMonth: 9,
    details: { address: '1 Test Street\nTestville', brn: 'TEST-BRN-A', customFields: [] },
  }
  const globalColumns = payrollColumns(options)
  // Fails here, not in a browser, if the TEST columns do not fit together.
  expect(Object.keys(getColumnsByKey(globalColumns))).toHaveLength(globalColumns.length)
  return {
    state: { identityFields: IDENTITY, idFieldKey: 'id', globalColumns, companies: [company], activeCompanyId: company.id },
    periods: { [periodStorageKey(company.id, '2026-09')]: { employees: SEPTEMBER } },
  }
}

const money = (text) => Number(String(text).replace(/,/g, ''))

// Exports the month on screen through "Export for PDF fill (JSON)", all columns, with Company Details.
async function exportForPdfFill(page) {
  await openExportMenu(page, 'Export for PDF fill (JSON)')
  const box = dialog(page, 'Export for PDF fill (JSON)')
  await box.waitFor()
  for (const field of ['Company Name', 'Address', 'BRN']) await box.getByLabel(field, { exact: true }).check()
  const file = await download(page, () => box.getByRole('button', { name: 'Export JSON' }).click())
  return { ...file, rows: JSON.parse(file.bytes.toString('utf8')) }
}

// A blank one-page A4 form, written out by hand so no PDF library is needed here.
function blankPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((object, index) => {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

// A PDF form filler template with one field per name given, stacked down the page.
function pdfTemplate(fieldNames) {
  return {
    id: 'tpl-test-e2e',
    name: 'TEST E2E Form',
    pdfFileName: 'test-e2e.pdf',
    pdfData: blankPdf().toString('base64'),
    boxes: fieldNames.map((name, index) => ({
      id: `box-${index}`,
      name,
      page: 1,
      x: 60,
      y: 60 + index * 30,
      width: 300,
      height: 20,
      fontSize: 11,
      fontFamily: 'Helvetica',
      bold: false,
      align: 'left',
      color: '#000000',
      validationType: 'text',
    })),
    createdAt: '2026-01-02T03:04:05.000Z',
    updatedAt: '2026-01-02T03:04:05.000Z',
  }
}

// Imports a payroll JSON file into a PDF form filler template and returns, for each page of the
// downloaded PDF, the value printed in each field (by field name).
async function fillPdfForm(fieldNames, file) {
  const { context } = await app.newContext()
  const page = await context.newPage()
  try {
    await page.goto(urls.pdf)
    await page.getByText('Your templates').waitFor({ timeout: 120_000 })
    const template = pdfTemplate(fieldNames)
    await page.evaluate((stored) => localStorage.setItem('pdf-editor:templates', JSON.stringify([stored])), template)
    await page.reload()
    await page.getByRole('button', { name: /^TEST E2E Form Last updated/ }).click()
    await page.waitForFunction(() => (document.querySelector('canvas')?.width ?? 0) > 310)

    await page.locator('input[type="file"]').setInputFiles({ name: file.name, mimeType: 'application/json', buffer: file.bytes })
    const preview = page.getByRole('dialog').last()
    await preview.waitFor()
    const previewText = await preview.textContent()
    await preview.getByRole('button', { name: /^Import \d+ (person|people)$/ }).click()
    await page.getByRole('dialog').first().waitFor({ state: 'hidden' })

    const pdf = await download(page, () => page.getByRole('button', { name: 'Download PDF' }).click())
    const pages = await readPdfText(pdf.bytes)
    // Each field's value is the text drawn on that field's line (y is measured from the bottom).
    const printed = pages.map((p) =>
      Object.fromEntries(
        template.boxes.map((b) => {
          const baseline = 842 - (b.y + b.height / 2 + b.fontSize * 0.32)
          return [b.name, p.items.find((item) => Math.abs(item.y - baseline) < 2)?.text ?? null]
        })
      )
    )
    return { previewText, printed }
  } finally {
    await context.close()
  }
}

async function openPayslipApp(file) {
  const { context, outsideRequests } = await app.newContext()
  const page = await context.newPage()
  await page.goto(urls.payslip)
  await page.getByRole('button', { name: 'Import payroll JSON' }).waitFor({ timeout: 120_000 })
  await page.locator('input[type="file"]').setInputFiles({ name: file.name, mimeType: 'application/json', buffer: file.bytes })
  await page.getByRole('region', { name: 'Employees' }).waitFor()
  return { context, page, outsideRequests }
}

const payslipRows = (page) =>
  page.getByRole('region', { name: 'Employees' }).locator('tbody tr').evaluateAll((rows) =>
    rows.map((tr) => ({ name: tr.children[1].querySelector('.font-medium').textContent.trim(), net: tr.children[2].textContent.trim(), status: tr.children[3].textContent.trim() }))
  )

// What is shared between the steps of the flow.
const flow = {}

// ====================================================== month 1, as set up

describe('the flow with the column names the payslip app and the dashboard expect', () => {
  test('payroll app: the month\'s figures, worked out by hand', async () => {
    const { context, page } = await openSeeded(app, payrollSeed())
    flow.payroll = { context, page }
    const rows = await readEmployeeTable(page)
    flow.screen = rows
    const pick = (r) => [r.ID, r['New Basic Salary'], r['Gross Pay'], r['Employee CSG'], r['Employee NSF'], r.PAYE, r['Total deductions'], r['Net Pay'], r.CSG, r.NSF]
    expect(rows.map(pick)).toEqual([
      ['TST001', '18,750.00', '20,000.00', '281.25', '200.00', '0.00', '481.25', '19,518.75', '562.50', '500.00'],
      ['TST002', '100,000.00', '100,000.00', '3,000.00', '0.00', '8600.00', '11,600.00', '88,400.00', '6,000.00', '2,500.00'],
      ['TST003', '60,000.00', '62,500.50', '1,800.00', '297.10', '2450.05', '4,547.15', '57,953.35', '3,600.00', '1,562.51'],
    ])
  })

  test('payroll app: "Export for PDF fill (JSON)" with Company Details carries exactly the figures on screen', async () => {
    const file = await exportForPdfFill(flow.payroll.page)
    flow.september = file
    expect(file.name).toBe('TEST Co A-pdf-fill-2026-09.json')
    expect(file.rows).toHaveLength(3)
    file.rows.forEach((row, index) => {
      const screen = flow.screen[index]
      for (const key of ['New Basic Salary', 'Gross Pay', 'Employee CSG', 'Employee NSF', 'PAYE', 'Total deductions', 'Net Pay', 'CSG', 'NSF', 'PRGF']) {
        expect(row[key], `${row.ID} ${key}`).toBe(money(screen[key]))
      }
      expect([row['Company Name'], row.Address, row.BRN]).toEqual(['TEST Co A', '1 Test Street\nTestville', 'TEST-BRN-A'])
      expect(row['Age 60+']).toBe(screen['Age 60+'] ? 'Yes' : 'No')
    })
    expect(file.rows.map((r) => r['Net Pay'])).toEqual([19518.75, 88400, 57953.35])
    // Employee and employer CSG are two keys with two figures.
    expect(file.rows.map((r) => [r['Employee CSG'], r.CSG])).toEqual([[281.25, 562.5], [3000, 6000], [1800, 3600]])
    // Everything the dashboard requires is there, and no figure has more than 2 decimals.
    for (const key of HUB_REQUIRED_KEYS) expect(Object.keys(file.rows[0]), key).toContain(key)
    for (const row of file.rows) {
      for (const [key, value] of Object.entries(row)) if (typeof value === 'number') expect(Math.round(value * 100) / 100, `${row.ID} ${key}`).toBe(value)
    }
  })

  test('PDF form filler: the file fills one page per person, with the employee\'s and the employer\'s CSG in their own fields', async () => {
    const fields = ['ID', 'Surname', 'Other names', 'Basic Salary', 'Employee CSG', 'CSG', 'Employee NSF', 'Net Pay', 'Company Name', 'BRN']
    const { previewText, printed } = await fillPdfForm(fields, flow.september)
    expect(previewText).toContain('3 people found in this file.')
    expect(printed).toHaveLength(3)
    printed.forEach((values, index) => {
      const row = flow.september.rows[index]
      // The form filler prints each value exactly as the file has it.
      for (const field of fields) expect(values[field], `page ${index + 1}, ${field}`).toBe(String(row[field]))
    })
    expect(printed.map((v) => [v['Employee CSG'], v.CSG, v['Net Pay']])).toEqual([
      ['281.25', '562.5', '19518.75'],
      ['3000', '6000', '88400'],
      ['1800', '3600', '57953.35'],
    ])
  })

  test('payslip app: every payslip is ready, and Total Earnings, Total Deductions and Net Pay match the payroll', async () => {
    const { context, page, outsideRequests } = await openPayslipApp(flow.september)
    flow.payslip = { context, page, outsideRequests }
    await page.getByRole('img', { name: 'Payslip of TESTER Alpha for September 2026' }).waitFor()

    const rows = await payslipRows(page)
    expect(rows.map((r) => [r.name, r.status])).toEqual([['TESTER Alpha', 'Ready'], ['TESTER Beta', 'Ready'], ['TESTER Gamma', 'Ready']])
    // Net pay beside each employee is the payroll app's Net Pay.
    expect(rows.map((r) => money(r.net))).toEqual(flow.screen.map((r) => money(r['Net Pay'])))
    expect(await page.getByRole('region', { name: 'Employees' }).locator('.card-header .badge').allTextContents()).toEqual(['3 ready'])

    for (const [index, name] of ['TESTER Alpha', 'TESTER Beta', 'TESTER Gamma'].entries()) {
      await page.getByRole('button', { name, exact: true }).click()
      const checks = page.getByRole('region', { name: `Checks for ${name}` })
      const table = await checks.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent.trim())))
      const screen = flow.screen[index]
      // Each total: [what it is checked against, the payslip's figure, the payroll's figure, "Matches"].
      expect(table.map((cells) => [money(cells[1]), money(cells[2]), cells[3]])).toEqual([
        [money(screen['Gross Pay']), money(screen['Gross Pay']), 'Matches'],
        [money(screen['Total deductions']), money(screen['Total deductions']), 'Matches'],
        [money(screen['Net Pay']), money(screen['Net Pay']), 'Matches'],
      ])
    }
  })

  test('payslip app: the employee\'s CSG and NSF are on the payslip; the employer\'s are not', async () => {
    const { page } = flow.payslip
    await page.getByRole('button', { name: 'TESTER Alpha', exact: true }).click()
    const paper = await page.getByTestId('payslip-page').locator('text').allTextContents()
    expect(paper).toEqual(expect.arrayContaining(['TESTER Alpha', '18,115', '635', '1,250', '281.25', '200', '20,000', '481.25', '19,518.75']))
    expect(paper).not.toContain('562.50')
    expect(paper).not.toContain('500')
  })

  test('payslip app: "Pay period" is the month of the file; the date beside the signatures starts at today', async () => {
    const { page } = flow.payslip
    const today = new Date().toISOString().slice(0, 10)
    expect(await page.getByLabel('Pay month').inputValue()).toBe('2026-09')
    expect(await page.getByLabel('Date on the payslip').inputValue()).toBe(today)
    const [year, month, day] = today.split('-')
    const short = `${Number(day)}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1]}-${year.slice(2)}`
    const paper = await page.getByTestId('payslip-page').locator('text').allTextContents()
    expect(paper).toContain('Pay period: September 2026')
    expect(paper).toContain(short)
    flow.shortDate = short

    // Choosing another month changes the pay period on the page, not the date.
    await page.getByLabel('Pay month').fill('2026-10')
    await page.getByRole('img', { name: 'Payslip of TESTER Alpha for October 2026' }).waitFor()
    const moved = await page.getByTestId('payslip-page').locator('text').allTextContents()
    expect(moved).toContain('Pay period: October 2026')
    expect(moved).toContain(short)
    await page.getByLabel('Pay month').fill('2026-09')
    await page.getByRole('img', { name: 'Payslip of TESTER Alpha for September 2026' }).waitFor()
  })

  test('payslip app: only the ticked employees are exported; PDFs are one file per employee in a zip', async () => {
    const { page } = flow.payslip
    await page.getByLabel('Include TESTER Beta').uncheck()
    await page.getByText('2 payslips for September 2026 ready to download.').waitFor()
    const zip = await download(page, () => page.getByRole('button', { name: 'Download PDFs (zip)' }).click())
    expect(zip.name).toBe('TEST Co A - payslips - 2026-09.zip')
    const entries = await JSZip.loadAsync(zip.bytes)
    expect(Object.keys(entries.files).sort()).toEqual(['TESTER Alpha - 2026-09.pdf', 'TESTER Gamma - 2026-09.pdf'])

    const texts = async (name) => (await readPdfText(await entries.file(name).async('nodebuffer')))[0].items.map((i) => i.text)
    const alpha = await texts('TESTER Alpha - 2026-09.pdf')
    expect(alpha).toEqual(expect.arrayContaining(['Pay period: September 2026', flow.shortDate, 'TESTER Alpha', '19,518.75', '281.25']))
    expect(await texts('TESTER Gamma - 2026-09.pdf')).toEqual(expect.arrayContaining(['TESTER Gamma', '57,953.35', '297.10', '2,450.05']))

    // Unticking everyone blocks the download and says why.
    await page.getByLabel('Select all employees').check()
    await page.getByLabel('Select all employees').uncheck()
    await page.getByText('Select at least one employee.').waitFor()
    expect(await page.getByRole('button', { name: 'Download PDFs (zip)' }).isDisabled()).toBe(true)
    await page.getByLabel('Select all employees').check()
  })

  test('payslip app: the Excel file has a sheet per employee, and its totals are the payroll\'s', async () => {
    const { page, outsideRequests } = flow.payslip
    await page.getByText('3 payslips for September 2026 ready to download.').waitFor()
    const file = await download(page, () => page.getByRole('button', { name: 'Download Excel' }).click())
    expect(file.name).toBe('TEST Co A - payslips - 2026-09.xlsx')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(file.bytes)
    expect(workbook.worksheets).toHaveLength(3)
    workbook.worksheets.forEach((sheet, index) => {
      const formulas = []
      const values = []
      sheet.eachRow((row) =>
        row.eachCell((cell) => {
          if (cell.formula) formulas.push(cell.result)
          else if (typeof cell.value === 'number') values.push(cell.value)
          else if (typeof cell.value === 'string') values.push(cell.value)
        })
      )
      const screen = flow.screen[index]
      // The three totals are live formulas, each with the payroll's figure cached.
      expect(formulas.sort((a, b) => a - b)).toEqual([money(screen['Total deductions']), money(screen['Net Pay']), money(screen['Gross Pay'])].sort((a, b) => a - b))
      expect(values).toContain(money(screen['Employee CSG']))
      expect(values.some((v) => typeof v === 'string' && v.includes('September 2026'))).toBe(true)
    })

    // The payslip app keeps nothing in the browser and asked nothing of any outside server.
    const stored = await page.evaluate(() => localStorage.length + sessionStorage.length)
    expect(stored).toBe(0)
    expect(outsideRequests).toEqual([])
    await flow.payslip.context.close()
  })

  test('dashboard (demo mode): the same file is read with no problem; saving it would need the company to exist there', async () => {
    const { context } = await app.newContext()
    const page = await context.newPage()
    await page.goto(urls.hub)
    await page.getByRole('button', { name: 'Enter demo workspace' }).click({ timeout: 120_000 })
    await page.goto(`${urls.hub}#/import`)
    await page.getByLabel('Choose payroll JSON files').setInputFiles({ name: flow.september.name, mimeType: 'application/json', buffer: flow.september.bytes })
    await page.getByRole('heading', { name: flow.september.name }).waitFor()
    const card = await page.locator('main').textContent()
    expect(card).toContain('Employees in file')
    expect(card).toContain('No company with BRN TEST-BRN-A')
    expect(card).not.toContain("This file can't be imported")
    expect(await page.getByLabel('Problems found in the file').count()).toBe(0)
    await context.close()
  })
})

// ============================================================== month 2

describe('a second month with one change', () => {
  test('payroll app: October is copied from September, one Basic Salary is changed, and only that employee\'s figures differ', async () => {
    const { page } = flow.payroll
    await goToMonth(page, /October →/)
    await page.getByRole('button', { name: 'Copy from Previous Month' }).click()
    const box = dialog(page, 'Copy from Previous Month')
    await box.getByRole('button', { name: 'Select All' }).click()
    for (const tick of await box.locator('.grid > div').nth(1).locator('input[type="checkbox"]').all()) await tick.check()
    await box.getByRole('button', { name: 'Copy 3 Employees' }).click()
    await box.waitFor({ state: 'hidden' })
    expect((await readEmployeeTable(page)).map((r) => r['Net Pay'])).toEqual(['19,518.75', '88,400.00', '57,953.35'])

    // TST001 gets a rise of 1,000: new basic 19,750; CSG 296.25; gross 21,000; NSF 210; net 20,493.75.
    await setCell(page, 0, 'Basic Salary', '19115')
    const rows = await readEmployeeTable(page)
    expect([rows[0]['New Basic Salary'], rows[0]['Employee CSG'], rows[0]['Employee NSF'], rows[0]['Net Pay']]).toEqual(['19,750.00', '296.25', '210.00', '20,493.75'])

    const file = await exportForPdfFill(page)
    flow.october = file
    expect(file.name).toBe('TEST Co A-pdf-fill-2026-10.json')
    const changedKeys = (index) => Object.keys(file.rows[index]).filter((key) => file.rows[index][key] !== flow.september.rows[index][key])
    expect(changedKeys(0)).toEqual(['Basic Salary', 'New Basic Salary', 'Emoluments', 'Gross Pay', 'Net Pay', 'CSG (Employee Contribution)', 'Employee CSG', 'Employee NSF', 'Total deductions', 'CSG', 'NSF', 'PRGF', 'Total MRA contributions'].filter((key) => key in file.rows[0]))
    expect(changedKeys(1)).toEqual([])
    expect(changedKeys(2)).toEqual([])
    await flow.payroll.context.close()
  })

  test('payslip app in its stand-in dashboard: September is issued; in October only the changed employee is flagged, with the right differences', async () => {
    const dist = path.join(FOLDERS.payslip, 'dist')
    if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('The payslip app is not built: run "npm run build" in the payslip folder first.')
    const body = JSON.parse(fs.readFileSync(path.join(FOLDERS.payslip, 'tests', 'expected', 'template-body.json'), 'utf8'))
    const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.otf': 'font/otf' }
    // The stand-in dashboard: embeds the built app, answers it from an in-memory store.
    const DASHBOARD = `<!doctype html><meta charset="utf-8"><title>Stand-in dashboard (test)</title>
<iframe id="app" title="Payslip" src="${HUB_ORIGIN}/payslip/" style="width:1440px;height:960px;border:0"></iframe>
<script>
  const frame = document.getElementById('app')
  const post = (type, payload, id) => frame.contentWindow.postMessage({ type, from: 'dashboard', to: 'payslip', version: 1, id, payload }, '${HUB_ORIGIN}')
  ${createFakeHub.toString()}
  window.hub = createFakeHub()
  window.hub.state.company = { name: 'TEST Co A', brn: 'TEST-BRN-A' }
  const template = ${JSON.stringify(body)}
  const id = '20000000-0000-4000-8000-0000000000aa'
  window.hub.state.templates.push({ id, name: 'Monthly payslip', body: template, revision: 1, updatedAt: '2026-08-20T09:00:00+04:00', by: 'you' })
  window.hub.state.versions.push({ templateId: id, version: 1, name: 'Monthly payslip', body: template, publishedAt: '2026-08-20T09:05:00+04:00', by: 'you' })
  window.send = (messageId, payload) => post('send-data', payload, messageId)
  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow) return
    if (event.data.type === 'ready') post('ping', {}, 'ping-' + String(Date.now()).padStart(13, '0'))
    const { type, id: messageId, payload } = event.data
    if (type !== 'request-data' && type !== 'send-data') return
    const answer = window.hub.handle(type, payload)
    if (answer !== undefined) post(type === 'request-data' ? 'response-data' : 'received', answer, messageId)
  })
</script>`

    const context = await app.browser.newContext({ viewport: { width: 1500, height: 1000 }, locale: 'en-US', timezoneId: 'UTC' })
    context.setDefaultTimeout(20_000)
    const outside = []
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== HUB_ORIGIN) {
        outside.push(url.href)
        return route.abort()
      }
      if (url.pathname === '/payroll-hub/') return route.fulfill({ contentType: 'text/html', body: DASHBOARD })
      if (url.pathname.startsWith('/payslip/')) {
        const file = path.join(dist, url.pathname.slice('/payslip/'.length) || 'index.html')
        if (fs.existsSync(file)) return route.fulfill({ contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) })
      }
      return route.fulfill({ status: 404, body: 'Not found' })
    })
    const page = await context.newPage()
    await page.goto(`${HUB_ORIGIN}/payroll-hub/`)
    const frame = page.frameLocator('#app')
    await frame.getByText('Dashboard connected').waitFor()
    const send = (id, rows, period) => page.evaluate(([messageId, payload]) => window.send(messageId, payload), [id, { dataType: 'payroll-result', rows, meta: { period } }])
    const review = frame.getByTestId('month-review')
    const panel = frame.getByTestId('issue-panel')

    // September, straight from the payroll app's export.
    await send('test-delivery-01', flow.september.rows, '2026-09')
    await frame.getByRole('dialog', { name: 'Import payroll data' }).getByRole('button', { name: 'Import 3 employees' }).click()
    await frame.getByRole('img', { name: 'Payslip of TESTER Alpha for September 2026' }).waitFor()
    await frame.getByTestId('template-chip').filter({ hasText: 'Monthly payslip, version 1 (published)' }).waitFor()
    await panel.getByRole('button', { name: /Check what is issued/ }).click()
    await frame.getByTestId('issued-count').filter({ hasText: '0 issued in the dashboard' }).waitFor()
    // First month: nothing was issued for August and the dashboard has no August payroll either.
    await review.getByRole('button', { name: 'Compare with August 2026' }).click()
    await frame.getByTestId('review-none-issued').filter({ hasText: 'No payslip was issued for August 2026' }).waitFor()
    await review.getByRole('button', { name: 'Compare with the payroll figures of August 2026' }).click()
    await frame.getByTestId('review-nothing').filter({ hasText: 'Nothing to compare with for August 2026' }).waitFor()
    await panel.getByRole('button', { name: /^Issue \d* ?payslips?$/ }).click()
    const confirm = frame.getByRole('dialog', { name: 'Issue 3 payslips for September 2026?' })
    await confirm.getByRole('button', { name: 'Issue', exact: true }).click()
    await frame.getByTestId('issue-summary').filter({ hasText: 'Issued: 3. Not issued: 0.' }).waitFor()
    expect(await page.evaluate(() => window.hub.state.issued.map((row) => [row.period, row.national_id]))).toEqual([['2026-09', 'TST001'], ['2026-09', 'TST002'], ['2026-09', 'TST003']])

    // October replaces September in the app, and is compared with September as it was issued.
    await send('test-delivery-02', flow.october.rows, '2026-10')
    await frame.getByRole('dialog', { name: 'Import payroll data' }).getByRole('button', { name: 'Replace with 3 employees' }).click()
    await frame.getByRole('img', { name: 'Payslip of TESTER Alpha for October 2026' }).waitFor()
    await panel.getByRole('button', { name: /Check what is issued/ }).click()
    await frame.getByTestId('issued-count').filter({ hasText: '0 issued in the dashboard' }).waitFor()
    await review.getByTestId('review-row').first().waitFor()
    expect(await review.textContent()).toContain('Month review: compared with September 2026')

    const rows = review.getByTestId('review-row')
    const statuses = await rows.evaluateAll((found) => found.map((row) => row.querySelector('[data-testid="review-status"]').textContent.trim()))
    const names = await rows.allTextContents()
    expect(statuses).toEqual(['Changed', 'Unchanged', 'Unchanged'])
    expect(names[0]).toContain('TESTER Alpha')
    // The row shows by how much Net Pay moved; opening it spells out each line: last month, this month, difference.
    const netDifferences = await rows.evaluateAll((found) => found.map((row) => row.lastElementChild.textContent.trim()))
    expect(netDifferences).toEqual(['+975', '0', '0'])
    await review.getByRole('button', { name: 'Show the lines of TESTER Alpha' }).click()
    const lines = await review.getByTestId('review-lines').locator('tbody tr').evaluateAll((trs) =>
      trs.filter((tr) => tr.children.length === 4).map((tr) => [...tr.children].map((td) => td.textContent.replace(/Changed/g, '').trim()))
    )
    const line = (label) => lines.find((cells) => cells[0] === label)
    expect(line('Basic Salary')).toEqual(['Basic Salary', '18,115', '19,115', '+1,000'])
    expect(line('CSG')).toEqual(['CSG', '281.25', '296.25', '+15'])
    expect(line('NSF')).toEqual(['NSF', '200', '210', '+10'])
    expect(line('Govt Increment')).toEqual(['Govt Increment', '635', '635', '0'])
    expect(line('Total Earnings')).toEqual(['Total Earnings', '20,000', '21,000', '+1,000'])
    expect(line('Total Deductions')).toEqual(['Total Deductions', '481.25', '506.25', '+25'])
    expect(line('Net Pay')).toEqual(['Net Pay', '19,518.75', '20,493.75', '+975'])

    // Nothing left the machine: every request was for the stand-in address and was answered here.
    expect(outside).toEqual([])
    await context.close()
  })
})

// ===================================================== two columns named CSG

describe('the same flow when the employee\'s and the employer\'s column are both called "CSG"', () => {
  test('payroll app: the export holds both figures, as "CSG (Employee Contribution)" and "CSG (Employer Contribution)"', async () => {
    const { context, page } = await openSeeded(app, payrollSeed({ clashingNames: true }))
    const screen = await readEmployeeTable(page)
    expect([screen[0]['CSG (Employee Contribution)'], screen[0]['CSG (Employer Contribution)']]).toEqual(['281.25', '562.50'])
    const file = await exportForPdfFill(page)
    flow.clashing = file
    expect(file.rows.map((r) => [r['CSG (Employee Contribution)'], r['CSG (Employer Contribution)']])).toEqual([[281.25, 562.5], [3000, 6000], [1800, 3600]])
    expect(Object.keys(file.rows[0])).not.toContain('CSG')
    expect(Object.keys(file.rows[0])).not.toContain('Employee CSG')
    // The rest of the payroll is as before.
    expect(file.rows.map((r) => r['Net Pay'])).toEqual([19518.75, 88400, 57953.35])
    await context.close()
  })

  test('PDF form filler: fields named with the new names are filled separately', async () => {
    const fields = ['ID', 'CSG (Employee Contribution)', 'CSG (Employer Contribution)', 'Net Pay']
    const { printed } = await fillPdfForm(fields, flow.clashing)
    expect(printed.map((v) => [v.ID, v['CSG (Employee Contribution)'], v['CSG (Employer Contribution)'], v['Net Pay']])).toEqual([
      ['TST001', '281.25', '562.5', '19518.75'],
      ['TST002', '3000', '6000', '88400'],
      ['TST003', '1800', '3600', '57953.35'],
    ])
  })

  test('evidence: a PDF template field still called "CSG" or "Employee CSG" is left empty, and the import says the new columns were ignored', async () => {
    const { previewText, printed } = await fillPdfForm(['ID', 'CSG', 'Employee CSG'], flow.clashing)
    expect(printed.map((v) => [v.ID, v.CSG, v['Employee CSG']])).toEqual([['TST001', null, null], ['TST002', null, null], ['TST003', null, null]])
    expect(previewText).toContain('CSG (Employee Contribution)')
    expect(previewText).toContain('CSG (Employer Contribution)')
    expect(previewText).toContain('no matching field')
  })

  test('payslip app: every payslip is held back with an error about "Employee CSG"; nothing is printed with a zero', async () => {
    const { context, page } = await openPayslipApp(flow.clashing)
    flow.payslipClashing = { context, page }
    const rows = await payslipRows(page)
    expect(rows.map((r) => [r.name, r.net, r.status])).toEqual([['TESTER Alpha', '', 'Fix needed'], ['TESTER Beta', '', 'Fix needed'], ['TESTER Gamma', '', 'Fix needed']])
    expect(await page.getByRole('alert').filter({ hasText: 'Employee CSG' }).count()).toBe(1)
    expect(await page.getByTestId('payslip-page').count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Download PDFs (zip)' }).isDisabled()).toBe(true)
  })

  test('payslip app: after pointing the CSG line at "CSG (Employee Contribution)" in the template, the payslips match the payroll again', async () => {
    const { context, page } = flow.payslipClashing
    await page.getByRole('button', { name: 'Template', exact: true }).click()
    await page.getByRole('heading', { name: 'Where each line comes from' }).waitFor()
    const source = page.getByLabel('Payroll column for CSG', { exact: true })
    const offered = await source.locator('option').allTextContents()
    expect(offered.some((o) => o.includes('CSG (Employee Contribution)'))).toBe(true)
    await source.selectOption({ label: offered.find((o) => o.includes('CSG (Employee Contribution)')) })
    await page.getByRole('button', { name: 'Payslips', exact: true }).click()
    await page.getByRole('img', { name: 'Payslip of TESTER Alpha for September 2026' }).waitFor()

    const rows = await payslipRows(page)
    expect(rows.map((r) => [r.name, money(r.net), r.status])).toEqual([['TESTER Alpha', 19518.75, 'Ready'], ['TESTER Beta', 88400, 'Ready'], ['TESTER Gamma', 57953.35, 'Ready']])
    const paper = await page.getByTestId('payslip-page').locator('text').allTextContents()
    expect(paper).toEqual(expect.arrayContaining(['281.25', '19,518.75']))
    expect(paper).not.toContain('562.50')
    flow.csgOptions = offered
    await context.close()
  })

  // The template editor never offers the employer's "CSG" for a payslip line. Under its new
  // name the employer's column is offered like any other.
  test('evidence (BUG): the employer\'s column, as "CSG (Employer Contribution)", is offered for the payslip\'s CSG line', () => {
    expect(flow.csgOptions.some((o) => o.includes('CSG (Employer Contribution)'))).toBe(true)
    expect(flow.csgOptions.filter((o) => o.trim() === 'NSF')).toEqual([])
  })
})
