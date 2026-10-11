// Browser test 3: everything that leaves or enters the app as a file -
// Excel export (values and live formulas), Import from Excel, Export for PDF
// fill (CSV and JSON), column setup export / import - and Company Details.
// The downloaded files are opened and read. TEST data only.
//
// A test named "evidence (BUG)" passes while the bug is present.

import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  startApp,
  openSeeded,
  storedState,
  storedPeriod,
  readEmployeeTable,
  readColumnList,
  tab,
  dialog,
  confirm,
  download,
  openExportMenu,
  openEditColumn,
  switchCompany,
} from './app'
import { evaluateExcelFormula } from '../audit/excelEval'

let app
beforeAll(async () => {
  app = await startApp()
})
afterAll(async () => {
  await app?.close()
})

const A = 'test-co-a'
const XLSX_INPUT = 'input[type="file"][accept=".xlsx"]'
const JSON_INPUT = 'input[type="file"][accept=".json"]'
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const money = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const HEADERS = ['ID', 'Name', 'Surname', 'Basic Salary', 'Govt Increment', 'New Basic (calc)', 'Status', 'Allowances', 'Emoluments (calc)', 'Age 60+', 'Bonus (calc)', 'Net Pay (calc)', 'CSG (calc)', 'NSF (calc)', 'PAYE (calc)', 'CSG (calc)', 'EDF', 'Chargeable (calc)']
// The same columns as the Employee Table labels them (Bonus Base is on screen but not exported).
const SCREEN = ['ID', 'Name', 'Surname', 'Basic Salary', 'Govt Increment', 'New Basic', 'Status', 'Allowances', 'Emoluments', 'Age 60+', 'Bonus', 'Net Pay', 'CSG (Employee Contribution)', 'NSF', 'PAYE', 'CSG (Employer Contribution)', 'EDF', 'Chargeable']
const FORMULA_COLUMNS = HEADERS.map((h, i) => (h.endsWith('(calc)') ? i + 1 : null)).filter(Boolean)

async function openWorkbook(bytes) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)
  return workbook
}

async function downloadExcel(page, mode) {
  if (mode === 'formulas') await openExportMenu(page, 'Export with Live Formulas')
  else await page.getByRole('button', { name: 'Export to Excel', exact: true }).click()
  const preview = dialog(page, 'Export Preview')
  await preview.waitFor()
  const file = await download(page, () => preview.getByRole('button', { name: 'Download .xlsx' }).click())
  await preview.waitFor({ state: 'hidden' })
  return file
}

async function chooseExcel(page, bytes, name = 'test.xlsx') {
  await page.locator(XLSX_INPUT).setInputFiles({ name, mimeType: XLSX_TYPE, buffer: Buffer.from(bytes) })
}

describe('Export to Excel', () => {
  test('with values: the preview, the file name and every figure in the file match the screen', async () => {
    const { context, page, outsideRequests } = await openSeeded(app)
    const screen = await readEmployeeTable(page)

    await page.getByRole('button', { name: 'Export to Excel', exact: true }).click()
    const preview = dialog(page, 'Export Preview')
    await preview.waitFor()
    expect(await preview.getByLabel('Include company details in header').isChecked()).toBe(true)
    const previewText = await preview.textContent()
    expect(previewText).toContain('1 Test Street, Testville   •   BRN: TEST-BRN-A')
    expect(previewText).not.toContain('Bonus Base')
    const previewHeaders = await preview.locator('thead tr').nth(1).locator('th').allTextContents()
    expect(previewHeaders).toEqual(HEADERS)
    const previewGroups = await preview.locator('thead tr').nth(0).locator('th').allTextContents()
    expect(previewGroups).toEqual(['Identifiers', 'General', 'Employee Contribution', 'Employer Contribution', 'Other Deductions'])

    const file = await download(page, () => preview.getByRole('button', { name: 'Download .xlsx' }).click())
    expect(file.name).toBe('TEST Co A-payroll.xlsx')

    const sheet = (await openWorkbook(file.bytes)).getWorksheet('Payroll')
    expect(sheet.getCell('A1').value).toBe('TEST Co A')
    expect(sheet.getCell('A3').value).toBe('1 Test Street, Testville   •   BRN: TEST-BRN-A')
    expect(Array.from({ length: HEADERS.length }, (_, i) => sheet.getCell(6, i + 1).value)).toEqual(HEADERS)
    screen.forEach((row, index) => {
      SCREEN.forEach((label, c) => {
        const cell = sheet.getCell(7 + index, c + 1).value
        const shown = row[label]
        if (typeof shown === 'boolean') expect(cell, label).toBe(shown ? 'Yes' : 'No')
        else if (typeof cell === 'number') expect(money(cell), `${row.ID} ${label}`).toBe(shown.includes(',') || /\.\d\d$/.test(shown) ? (shown.includes(',') ? shown : money(Number(shown))) : money(Number(shown || 0)))
        else expect(cell ?? '', label).toBe(shown)
      })
    })
    expect(sheet.getCell(10, 1).value).toBe('TOTAL')
    expect(sheet.getCell(10, 4).value).toBe(173115)
    expect(outsideRequests).toEqual([])
    await context.close()
  })

  test('unticking "Include company details in header" leaves that line out of the file', async () => {
    const { context, page } = await openSeeded(app)
    await page.getByRole('button', { name: 'Export to Excel', exact: true }).click()
    const preview = dialog(page, 'Export Preview')
    await preview.getByLabel('Include company details in header').uncheck()
    expect(await preview.textContent()).not.toContain('BRN: TEST-BRN-A')
    const file = await download(page, () => preview.getByRole('button', { name: 'Download .xlsx' }).click())
    const sheet = (await openWorkbook(file.bytes)).getWorksheet('Payroll')
    expect(sheet.getCell('A3').value ?? '').toBe('')
    expect(sheet.getCell(6, 1).value).toBe('ID')
    await context.close()
  })

  test('with live formulas: formula cells, a hidden column for the excluded field, and figures that match the screen', async () => {
    const { context, page } = await openSeeded(app)
    const screen = await readEmployeeTable(page)
    const file = await downloadExcel(page, 'formulas')
    const sheet = (await openWorkbook(file.bytes)).getWorksheet('Payroll')
    const raw = XLSX.read(file.bytes, { type: 'array' }).Sheets.Payroll

    // Every formula column has a formula in every row, with the app's figure cached beside it.
    for (const row of [7, 8, 9]) {
      for (const c of FORMULA_COLUMNS) {
        const address = sheet.getCell(row, c).address
        expect(sheet.getCell(row, c).formula, address).toBeTruthy()
        expect(money(raw[address].v), address).toBe(screen[row - 7][SCREEN[c - 1]])
      }
    }
    expect(sheet.getCell(6, 19).value).toBe('Bonus Base (hidden)')
    expect(sheet.getColumn(19).hidden).toBe(true)
    expect(sheet.getCell(10, 4).formula).toBe('SUM(D7:D9)')

    // Worked out as a spreadsheet would, for the two employees with no ticked checkbox.
    const getCell = (ref) => (sheet.getCell(ref).formula ? { formula: sheet.getCell(ref).formula } : (sheet.getCell(ref).value ?? null))
    for (const row of [7, 9]) {
      for (const c of FORMULA_COLUMNS) {
        const live = evaluateExcelFormula(sheet.getCell(row, c).formula, getCell)
        expect(money(live), sheet.getCell(row, c).address).toBe(screen[row - 7][SCREEN[c - 1]])
      }
    }
    await context.close()
  })

  test('evidence (BUG): in the live-formula file, NSF for the employee ticked "Age 60+" recalculates to 297.10; the app shows 0.00', async () => {
    const { context, page } = await openSeeded(app)
    const screen = await readEmployeeTable(page)
    expect(screen[1]['Age 60+']).toBe(true)
    expect(screen[1].NSF).toBe('0.00')
    expect(screen[1]['Net Pay']).toBe('88,400.00')

    const file = await downloadExcel(page, 'formulas')
    const sheet = (await openWorkbook(file.bytes)).getWorksheet('Payroll')
    const getCell = (ref) => (sheet.getCell(ref).formula ? { formula: sheet.getCell(ref).formula } : (sheet.getCell(ref).value ?? null))
    expect(sheet.getCell('J8').value).toBe('Yes')
    expect(sheet.getCell('N8').formula).toBe('IF((J8=1),0,(MIN(F8,29710)*0.01))')
    expect(money(evaluateExcelFormula(sheet.getCell('N8').formula, getCell))).toBe('297.10')
    expect(money(evaluateExcelFormula(sheet.getCell('L8').formula, getCell))).toBe('88,102.90')
    await context.close()
  })
})

describe('Import from Excel', () => {
  function outsideWorkbook() {
    const rows = [
      ['TEST Co A - payroll input'],
      [],
      ['id', 'NAME', 'Surname', 'Salary', 'govt increment', 'Status', 'Allowances', 'Age 60+', 'Bonus Base', 'EDF', 'Remarks'],
      ['TST101', 'Uno', 'Importee', 21000, 500, 'Full Time', 1500.5, 'No', 100, 390000, 'x'],
      ['TST102', 'Dos', 'Importee', 34500.75, '', 'Part Time', '', 'Yes', '', '', ''],
      [],
      ['TST103', 'Tres', 'Importee', 60000, 0, '', 0, 'TRUE', 0, 0, ''],
    ]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
    return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
  }

  test('the app\'s own export is recognised: no mapping step, rows are added, duplicate IDs are flagged', async () => {
    const { context, page } = await openSeeded(app)
    const before = await readEmployeeTable(page)
    const file = await downloadExcel(page, 'values')

    await chooseExcel(page, file.bytes, file.name)
    const box = dialog(page, 'Import from Excel')
    await box.waitFor()
    expect(await box.textContent()).toContain('Recognized as a previous export from this company — column mapping applied automatically.')
    expect(await box.locator('select').count()).toBe(0)
    // The preview shows the employees, not the title, header or TOTAL rows.
    const previewIds = await box.locator('tbody tr td:first-child').allTextContents()
    expect(previewIds).toEqual(['TST001', 'TST002', 'TST003'])
    await box.getByRole('button', { name: 'Import 3 rows' }).click()
    await box.waitFor({ state: 'hidden' })

    const after = await readEmployeeTable(page)
    expect(after).toHaveLength(6)
    // Each imported row shows exactly the figures of the row it came from.
    expect(after.slice(3)).toEqual(before)
    expect(after.slice(0, 3)).toEqual(before)
    expect(await page.getByLabel('Duplicate ID').count()).toBe(6)

    // A second import adds again; nothing is replaced.
    await chooseExcel(page, file.bytes, file.name)
    await box.getByRole('button', { name: 'Import 3 rows' }).click()
    await box.waitFor({ state: 'hidden' })
    expect(await readEmployeeTable(page)).toHaveLength(9)
    expect((await storedPeriod(page, A, '2026-09')).map((e) => e.values.id)).toEqual(['TST001', 'TST002', 'TST003', 'TST001', 'TST002', 'TST003', 'TST001', 'TST002', 'TST003'])
    await context.close()
  })

  test('a live-formula export is recognised and re-imported with the same figures', async () => {
    const { context, page } = await openSeeded(app)
    const before = await readEmployeeTable(page)
    const file = await downloadExcel(page, 'formulas')
    await page.getByRole('button', { name: 'Delete All Employees' }).click()
    await confirm(page, 'Delete all employees', 'Delete All')

    await chooseExcel(page, file.bytes, file.name)
    const box = dialog(page, 'Import from Excel')
    expect(await box.textContent()).toContain('Recognized as a previous export')
    await box.getByRole('button', { name: 'Import 3 rows' }).click()
    await box.waitFor({ state: 'hidden' })
    expect(await readEmployeeTable(page)).toEqual(before)
    await context.close()
  })

  test('an outside file goes through mapping: headers matched, the header row not imported, every mapped column filled', async () => {
    const { context, page } = await openSeeded(app)
    await chooseExcel(page, outsideWorkbook(), 'outside.xlsx')
    const box = dialog(page, 'Import from Excel')
    await box.waitFor()
    expect(await box.textContent()).toContain('Map file columns to fields (3 rows found)')
    expect(await box.textContent()).not.toContain('Recognized as a previous export')

    const chosen = async (field) => box.getByLabel(field, { exact: true }).evaluate((select) => select.selectedOptions[0].textContent.trim())
    // Matched whatever the case of the header...
    expect(await chosen('ID')).toBe('id')
    expect(await chosen('Name')).toBe('NAME')
    expect(await chosen('Govt Increment')).toBe('govt increment')
    expect(await chosen('Status')).toBe('Status')
    // ...and left for the user when the name differs.
    expect(await chosen('Basic Salary')).toBe('— Skip —')
    await box.getByLabel('Basic Salary', { exact: true }).selectOption({ label: 'Salary' })

    await box.getByRole('button', { name: 'Import 3 rows' }).click()
    await box.waitFor({ state: 'hidden' })

    const rows = await readEmployeeTable(page)
    expect(rows.map((r) => r.ID)).toEqual(['TST001', 'TST002', 'TST003', 'TST101', 'TST102', 'TST103'])
    expect(rows.some((r) => r.ID === 'id' || r.Name === 'NAME')).toBe(false)
    const picked = (r) => [r.ID, r.Name, r.Surname, r['Basic Salary'], r['Govt Increment'], r.Status, r.Allowances, r['Age 60+'], r['Bonus Base'], r.EDF, r['New Basic']]
    expect(rows.slice(3).map(picked)).toEqual([
      ['TST101', 'Uno', 'Importee', '21000.00', '500.00', 'Full Time', '1500.50', false, '100.00', '390000.00', '21,500.00'],
      ['TST102', 'Dos', 'Importee', '34500.75', '0.00', 'Part Time', '0.00', true, '0.00', '0.00', '34,500.75'],
      ['TST103', 'Tres', 'Importee', '60000.00', '0.00', '', '0.00', true, '0.00', '0.00', '60,000.00'],
    ])
    // A text column keeps its text; a ticked employee's NSF is 0.
    expect(rows[4].NSF).toBe('0.00')
    await context.close()
  })

  test('Cancel imports nothing', async () => {
    const { context, page } = await openSeeded(app)
    await chooseExcel(page, outsideWorkbook(), 'outside.xlsx')
    const box = dialog(page, 'Import from Excel')
    await box.getByRole('button', { name: 'Cancel', exact: true }).click()
    await box.waitFor({ state: 'hidden' })
    expect(await readEmployeeTable(page)).toHaveLength(3)
    await context.close()
  })

  test('after a column is deleted, the app\'s own export falls back to mapping, with a note and a best guess', async () => {
    const { context, page } = await openSeeded(app)
    const file = await downloadExcel(page, 'values')
    await tab(page, 'Global Columns').click()
    await page.locator('tr[draggable="true"]').filter({ has: page.locator('td:nth-child(2)', { hasText: /^Status$/ }) }).getByRole('button', { name: 'Delete', exact: true }).click()
    await confirm(page, 'Delete column', 'Delete')
    await tab(page, 'Employee Table').click()

    await chooseExcel(page, file.bytes, file.name)
    const box = dialog(page, 'Import from Excel')
    await box.waitFor()
    expect(await box.textContent()).toContain('This looks like a previous export, but 1 column has since been removed from this company — please review the mapping below.')
    const chosen = async (field) => box.getByLabel(field, { exact: true }).evaluate((select) => select.selectedOptions[0].textContent.trim())
    expect(await chosen('ID')).toBe('ID')
    expect(await chosen('Basic Salary')).toBe('Basic Salary')
    expect(await chosen('Allowances')).toBe('Allowances')
    expect(await chosen('EDF')).toBe('EDF')
    await box.getByRole('button', { name: 'Import 3 rows' }).click()
    await box.waitFor({ state: 'hidden' })
    const rows = await readEmployeeTable(page)
    expect(rows).toHaveLength(6)
    expect(rows[3]['New Basic']).toBe('18,750.00')
    await context.close()
  })

  test('a file exported from another company is not applied automatically', async () => {
    const { context, page } = await openSeeded(app)
    const file = await downloadExcel(page, 'values')
    await switchCompany(page, 'TEST Co B')
    await chooseExcel(page, file.bytes, file.name)
    const box = dialog(page, 'Import from Excel')
    await box.waitFor()
    expect(await box.textContent()).toContain('This file was exported from a different company — please review the mapping below.')
    await box.getByRole('button', { name: 'Cancel', exact: true }).click()
    await context.close()
  })

  test('a file that is not a workbook gives a plain message', async () => {
    const { context, page } = await openSeeded(app)
    await chooseExcel(page, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9]), 'broken.xlsx')
    const alert = page.getByRole('alert')
    await alert.waitFor()
    expect(await alert.textContent()).toContain('Could not read that file. Please make sure it is a valid .xlsx file.')
    expect(await readEmployeeTable(page)).toHaveLength(3)
    await context.close()
  })

  // KNOWN_ISSUES.md no. 3, still there.
  test('evidence (BUG, already known): a text file renamed .xlsx is accepted and goes to mapping', async () => {
    const { context, page } = await openSeeded(app)
    await chooseExcel(page, Buffer.from('this is not an Excel file'), 'not-a-workbook.xlsx')
    await dialog(page, 'Import from Excel').waitFor()
    expect(await page.getByRole('alert').count()).toBe(0)
    await context.close()
  })

  test('evidence (BUG): a figure held as text with a thousands separator is imported as 0, with no warning', async () => {
    const { context, page } = await openSeeded(app)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['ID', 'Name', 'Basic Salary'], ['TST201', 'Texty', '18,115.00']]), 'Sheet1')
    await chooseExcel(page, XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), 'text-figures.xlsx')
    const box = dialog(page, 'Import from Excel')
    await box.waitFor()
    // The preview shows the figure as it is in the file...
    expect(await box.locator('tbody').textContent()).toContain('18,115.00')
    expect(await box.getByRole('alert').count()).toBe(0)
    await box.getByRole('button', { name: 'Import 1 row' }).click()
    await box.waitFor({ state: 'hidden' })
    // ...and what arrives is 0.
    const row = (await readEmployeeTable(page))[3]
    expect([row.ID, row['Basic Salary'], row['New Basic']]).toEqual(['TST201', '0.00', '0.00'])
    await context.close()
  })
})

describe('Export for PDF fill', () => {
  async function openPdfFill(page, format) {
    await openExportMenu(page, `Export for PDF fill (${format})`)
    const box = dialog(page, `Export for PDF fill (${format})`)
    await box.waitFor()
    return box
  }

  test('JSON: only the selected columns, keyed by column name, with the ticked Company Details on every row', async () => {
    const { context, page } = await openSeeded(app)
    const box = await openPdfFill(page, 'JSON')
    // Everything is ticked to start with: 3 identity fields and 16 columns.
    const summary = (await box.locator('p.text-xs.text-muted').last().textContent()).replace(/\s+/g, ' ').trim()
    expect(summary).toBe('19 columns selected · 3 employees will be exported.')

    await box.getByRole('button', { name: 'Select None' }).click()
    expect(await box.getByRole('button', { name: 'Export JSON' }).isDisabled()).toBe(true)
    for (const name of ['ID', 'Basic Salary', 'New Basic', 'NSF']) await box.getByLabel(name, { exact: true }).check()
    // "Surname" is both an employee column (first) and a company field (second).
    await box.getByLabel('Surname', { exact: true }).nth(0).check()
    await box.getByLabel('Company Name', { exact: true }).check()
    await box.getByLabel('BRN', { exact: true }).check()
    await box.getByLabel('Surname', { exact: true }).nth(1).check()
    expect((await box.locator('p.text-xs.text-muted').last().textContent()).replace(/\s+/g, ' ').trim()).toBe('5 columns + 3 company detail fields selected · 3 employees will be exported.')

    const file = await download(page, () => box.getByRole('button', { name: 'Export JSON' }).click())
    expect(file.name).toBe('TEST Co A-pdf-fill-2026-09.json')
    const rows = JSON.parse(file.bytes.toString('utf8'))
    expect(rows).toEqual([
      { ID: 'TST001', Surname: 'Tester', 'Basic Salary': 18115, 'New Basic': 18750, NSF: 187.5, 'Company Name': 'TEST Co A', BRN: 'TEST-BRN-A', 'Company: Surname': 'TEST trading name' },
      { ID: 'TST002', Surname: 'Tester', 'Basic Salary': 95000, 'New Basic': 100000, NSF: 0, 'Company Name': 'TEST Co A', BRN: 'TEST-BRN-A', 'Company: Surname': 'TEST trading name' },
      { ID: 'TST003', Surname: 'Tester', 'Basic Salary': 60000, 'New Basic': 60000, NSF: 297.1, 'Company Name': 'TEST Co A', BRN: 'TEST-BRN-A', 'Company: Surname': 'TEST trading name' },
    ])
    expect(Object.keys(rows[0])).toEqual(['ID', 'Surname', 'Basic Salary', 'New Basic', 'NSF', 'Company Name', 'BRN', 'Company: Surname'])
    await context.close()
  })

  test('JSON: Company Details are off unless ticked; a company field is not prefixed when nothing clashes', async () => {
    const { context, page } = await openSeeded(app)
    const box = await openPdfFill(page, 'JSON')
    await box.getByRole('button', { name: 'Select None' }).click()
    await box.getByLabel('ID', { exact: true }).check()
    await box.getByLabel('Surname', { exact: true }).nth(1).check()
    const file = await download(page, () => box.getByRole('button', { name: 'Export JSON' }).click())
    expect(JSON.parse(file.bytes.toString('utf8'))[0]).toEqual({ ID: 'TST001', Surname: 'TEST trading name' })
    await context.close()
  })

  test('CSV: a header line of column names, then one line per employee', async () => {
    const { context, page } = await openSeeded(app)
    const box = await openPdfFill(page, 'CSV')
    await box.getByRole('button', { name: 'Select None' }).click()
    for (const name of ['ID', 'Name', 'Status', 'Age 60+', 'New Basic', 'PAYE']) await box.getByLabel(name, { exact: true }).check()
    await box.getByLabel('Address', { exact: true }).check()
    const file = await download(page, () => box.getByRole('button', { name: 'Export CSV' }).click())
    expect(file.name).toBe('TEST Co A-pdf-fill-2026-09.csv')
    expect(file.bytes.toString('utf8')).toBe(
      [
        'ID,Name,New Basic,Status,Age 60+,PAYE,Address',
        'TST001,Alpha,18750,Full Time,No,0,"1 Test Street\nTestville"',
        'TST002,Beta,100000,Part Time,Yes,8600,"1 Test Street\nTestville"',
        'TST003,Gamma,60000,,No,2450.05,"1 Test Street\nTestville"',
      ].join('\r\n')
    )
    await context.close()
  })

  test('evidence (BUG): the two "CSG" columns cannot be told apart in the picker, and the export gives both the employer figure', async () => {
    const { context, page } = await openSeeded(app)
    const screen = (await readEmployeeTable(page))[0]
    expect([screen['CSG (Employee Contribution)'], screen['CSG (Employer Contribution)']]).toEqual(['281.25', '562.50'])

    let box = await openPdfFill(page, 'JSON')
    expect(await box.getByLabel('CSG', { exact: true }).count()).toBe(2)
    expect(await box.textContent()).not.toContain('CSG (Employee Contribution)')
    await box.getByRole('button', { name: 'Select None' }).click()
    await box.getByLabel('ID', { exact: true }).check()
    await box.getByLabel('CSG', { exact: true }).nth(0).check()
    await box.getByLabel('CSG', { exact: true }).nth(1).check()
    const json = await download(page, () => box.getByRole('button', { name: 'Export JSON' }).click())
    // The employee's 281.25 is not in the file at all.
    expect(JSON.parse(json.bytes.toString('utf8'))[0]).toEqual({ ID: 'TST001', CSG: 562.5 })

    box = await openPdfFill(page, 'CSV')
    await box.getByRole('button', { name: 'Select None' }).click()
    await box.getByLabel('ID', { exact: true }).check()
    await box.getByLabel('CSG', { exact: true }).nth(0).check()
    await box.getByLabel('CSG', { exact: true }).nth(1).check()
    const csv = await download(page, () => box.getByRole('button', { name: 'Export CSV' }).click())
    expect(csv.bytes.toString('utf8').split('\r\n').slice(0, 2)).toEqual(['ID,CSG,CSG', 'TST001,562.5,562.5'])
    await context.close()
  })
})

describe('column setup: export, delete the columns, import', () => {
  // Without the random id, and without the "decimals" a checkbox column is
  // given when saved data is loaded (it is not used for anything).
  const portable = (columns) =>
    columns.map(({ id: _id, ...rest }) => {
      if (rest.valueType === 'checkbox') delete rest.decimals
      return rest
    })

  test('everything comes back identical, figures included, and the visual builders still open', async () => {
    const { context, page } = await openSeeded(app)
    const figuresBefore = await readEmployeeTable(page)
    await tab(page, 'Global Columns').click()
    const before = (await storedState(page)).globalColumns
    const listBefore = await readColumnList(page)

    const file = await download(page, () => page.getByRole('button', { name: 'Export Column Setup' }).click())
    expect(file.name).toMatch(/^column-setup-global-\d{4}-\d{2}-\d{2}\.json$/)
    const exported = JSON.parse(file.bytes.toString('utf8'))
    expect(exported._meta).toMatchObject({ app: 'payroll-sys-column-setup', version: 1, scope: 'global' })
    expect(exported.columns).toHaveLength(16)

    // Delete every test column.
    for (let i = 0; i < 16; i++) {
      await page.locator('tr[draggable="true"]').first().getByRole('button', { name: 'Delete', exact: true }).click()
      await confirm(page, 'Delete column', 'Delete')
    }
    expect((await storedState(page)).globalColumns).toEqual([])
    expect(await page.getByRole('button', { name: 'Export Column Setup' }).isDisabled()).toBe(true)

    await page.locator(JSON_INPUT).setInputFiles({ name: file.name, mimeType: 'application/json', buffer: file.bytes })
    const box = dialog(page, 'Import Column Setup')
    await box.waitFor()
    expect(await box.textContent()).toContain('This file contains 16 Global columns')
    expect(await box.textContent()).toContain('16 columns will be added.')
    await box.getByRole('button', { name: 'Import 16 Columns' }).click()
    await box.waitFor({ state: 'hidden' })

    const after = (await storedState(page)).globalColumns
    expect(portable(JSON.parse(JSON.stringify(after)))).toEqual(portable(JSON.parse(JSON.stringify(before))))
    expect(await readColumnList(page)).toEqual(listBefore)

    // The visual builders are intact.
    let form = await openEditColumn(page, 'NSF')
    expect(await form.getByLabel('maximum amount').inputValue()).toBe('29710')
    expect(await form.getByLabel('Checkbox column').inputValue()).toBe('age60')
    await form.getByRole('button', { name: 'Cancel', exact: true }).click()
    await form.waitFor({ state: 'hidden' })
    form = await openEditColumn(page, 'PAYE')
    expect(await form.getByLabel('width', { exact: true }).nth(1).inputValue()).toBe('38000')
    expect(await form.getByText('Remainder', { exact: true }).isVisible()).toBe(true)
    await form.getByRole('button', { name: 'Cancel', exact: true }).click()
    await form.waitFor({ state: 'hidden' })
    form = await openEditColumn(page, 'Chargeable')
    expect(await form.getByLabel('Column A', { exact: true }).inputValue()).toBe('edf')
    expect(await form.getByLabel('Result if FALSE').inputValue()).toBe('Column B - Column A')
    await form.getByRole('button', { name: 'Cancel', exact: true }).click()
    await form.waitFor({ state: 'hidden' })

    // The employees' figures were never deleted, and calculate as before.
    await tab(page, 'Employee Table').click()
    expect(await readEmployeeTable(page)).toEqual(figuresBefore)
    await context.close()
  })

  test('importing the same file again: existing columns are skipped unless "Import as new/duplicate" is chosen', async () => {
    const { context, page } = await openSeeded(app)
    await tab(page, 'Global Columns').click()
    const file = await download(page, () => page.getByRole('button', { name: 'Export Column Setup' }).click())
    await page.locator(JSON_INPUT).setInputFiles({ name: file.name, mimeType: 'application/json', buffer: file.bytes })
    const box = dialog(page, 'Import Column Setup')
    await box.waitFor()
    expect(await box.textContent()).toContain('0 columns will be added, 16 skipped.')
    expect(await box.getByRole('button', { name: /^Import 0 Columns/ }).isDisabled()).toBe(true)
    await box.getByRole('button', { name: 'Import as new/duplicate' }).click()
    expect(await box.textContent()).toContain('16 columns will be added.')
    expect(await box.textContent()).toContain('(was basicSalary)')
    await box.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await storedState(page)).globalColumns).toHaveLength(16)
    await context.close()
  })

  test('a Global file opened from the Company Columns tab is refused, and so is a file that is not a column setup', async () => {
    const { context, page } = await openSeeded(app)
    await tab(page, 'Global Columns').click()
    const file = await download(page, () => page.getByRole('button', { name: 'Export Column Setup' }).click())
    await tab(page, 'Company Columns').click()
    await page.locator(JSON_INPUT).setInputFiles({ name: file.name, mimeType: 'application/json', buffer: file.bytes })
    expect(await page.getByRole('alert').textContent()).toContain('This file contains Global columns - open it from the Global Columns tab instead.')
    await page.getByRole('button', { name: 'Dismiss' }).click()

    await page.locator(JSON_INPUT).setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('[{"ID":"TST001"}]') })
    expect(await page.getByRole('alert').textContent()).toContain('This file is not a recognized column-setup export.')
    expect((await storedState(page)).companies[0].columns).toEqual([])
    await context.close()
  })
})

describe('Company Details', () => {
  const openDetails = async (page, name) => {
    await page.getByRole('button', { name: `${name} details` }).click()
    const box = dialog(page, `${name} — Details`)
    await box.waitFor()
    return box
  }

  test('the default fields and the custom fields, kept apart for each company', async () => {
    const { context, page } = await openSeeded(app)
    let box = await openDetails(page, 'TEST Co A')
    expect(await box.getByLabel('Company Name', { exact: true }).inputValue()).toBe('TEST Co A')
    expect(await box.getByLabel('Address', { exact: true }).inputValue()).toBe('1 Test Street\nTestville')
    expect(await box.getByLabel('BRN', { exact: true }).inputValue()).toBe('TEST-BRN-A')
    expect(await box.getByLabel('Label, e.g. VAT No').count()).toBe(2)
    await box.getByRole('button', { name: 'Cancel', exact: true }).click()
    await box.waitFor({ state: 'hidden' })

    await switchCompany(page, 'TEST Co B')
    box = await openDetails(page, 'TEST Co B')
    expect(await box.getByLabel('BRN', { exact: true }).inputValue()).toBe('TEST-BRN-B')
    expect(await box.getByText('No custom fields yet.').isVisible()).toBe(true)

    // "Copy fields from" brings the labels across, not the other company's values.
    await box.getByLabel('Copy fields from…').selectOption({ label: 'TEST Co A' })
    expect(await box.getByLabel('Label, e.g. VAT No').evaluateAll((els) => els.map((el) => el.value))).toEqual(['VAT No', 'Surname'])
    expect(await box.getByLabel('Value', { exact: true }).evaluateAll((els) => els.map((el) => el.value))).toEqual(['', ''])
    await box.getByLabel('Value', { exact: true }).nth(0).fill('TEST-VAT-2')
    await box.getByRole('button', { name: 'Remove', exact: true }).nth(1).click()
    await box.getByRole('button', { name: 'Save', exact: true }).click()
    await box.waitFor({ state: 'hidden' })

    const state = await storedState(page)
    expect(state.companies[1].details.customFields.map((f) => [f.label, f.value])).toEqual([['VAT No', 'TEST-VAT-2']])
    expect(state.companies[0].details.customFields.map((f) => [f.label, f.value])).toEqual([['VAT No', 'TEST-VAT-1'], ['Surname', 'TEST trading name']])
    await context.close()
  })

  test('renaming the company in its details renames it everywhere; its data stays with it', async () => {
    const { context, page } = await openSeeded(app)
    const box = await openDetails(page, 'TEST Co A')
    await box.getByLabel('Company Name', { exact: true }).fill('TEST Co A Renamed')
    await box.getByRole('button', { name: 'Save', exact: true }).click()
    await box.waitFor({ state: 'hidden' })

    await page.getByRole('button', { name: 'TEST Co A Renamed', exact: true }).waitFor()
    expect((await readEmployeeTable(page)).map((r) => r.ID)).toEqual(['TST001', 'TST002', 'TST003'])
    await tab(page, 'Company Columns').click()
    await page.getByText('Company Columns — TEST Co A Renamed').waitFor()
    const state = await storedState(page)
    expect(state.companies.map((c) => [c.id, c.name])).toEqual([[A, 'TEST Co A Renamed'], ['test-co-b', 'TEST Co B']])

    // The exports carry the new name.
    await tab(page, 'Employee Table').click()
    const file = await downloadExcel(page, 'values')
    expect(file.name).toBe('TEST Co A Renamed-payroll.xlsx')
    expect((await openWorkbook(file.bytes)).getWorksheet('Payroll').getCell('A1').value).toBe('TEST Co A Renamed')
    await context.close()
  })

  test('renaming by double-clicking the name in the sidebar', async () => {
    const { context, page } = await openSeeded(app)
    await page.getByRole('button', { name: 'TEST Co B', exact: true }).dblclick()
    const field = page.getByLabel('Company name', { exact: true })
    await field.fill('TEST Co B2')
    await field.press('Enter')
    await page.getByRole('button', { name: 'TEST Co B2', exact: true }).waitFor()
    expect((await storedState(page)).companies[1].name).toBe('TEST Co B2')
    await context.close()
  })

  test('an empty company name is refused; closing with unsaved changes asks first', async () => {
    const { context, page } = await openSeeded(app)
    const box = await openDetails(page, 'TEST Co A')
    await box.getByLabel('Company Name', { exact: true }).fill('   ')
    await box.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await box.getByRole('alert').textContent()).trim()).toBe('Company Name is required')
    await box.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await dialog(page, 'Discard changes?').textContent()).toContain("You have unsaved changes to this company's details. Close without saving?")
    await dialog(page, 'Discard changes?').getByRole('button', { name: 'Discard', exact: true }).click()
    await box.waitFor({ state: 'hidden' })
    expect((await storedState(page)).companies[0].name).toBe('TEST Co A')
    await context.close()
  })
})
