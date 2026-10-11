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
import { simple } from '../audit/build'
import { formatDecimal } from '../../src/lib/format'
import { seededState } from './app'

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
// A figure as the app shows it: two decimals, half cents rounded up.
const money = (n) => formatDecimal(n, 2)

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

    // Worked out as a spreadsheet would, for every employee.
    const getCell = (ref) => (sheet.getCell(ref).formula ? { formula: sheet.getCell(ref).formula } : (sheet.getCell(ref).value ?? null))
    for (const row of [7, 8, 9]) {
      for (const c of FORMULA_COLUMNS) {
        const live = evaluateExcelFormula(sheet.getCell(row, c).formula, getCell)
        expect(money(live), sheet.getCell(row, c).address).toBe(screen[row - 7][SCREEN[c - 1]])
      }
    }
    await context.close()
  })

  test('in the live-formula file, NSF for the employee ticked "Age 60+" recalculates to 0.00, as the app shows', async () => {
    const { context, page } = await openSeeded(app)
    const screen = await readEmployeeTable(page)
    expect(screen[1]['Age 60+']).toBe(true)
    expect(screen[1].NSF).toBe('0.00')
    expect(screen[1]['Net Pay']).toBe('88,400.00')

    const file = await downloadExcel(page, 'formulas')
    const sheet = (await openWorkbook(file.bytes)).getWorksheet('Payroll')
    const getCell = (ref) => (sheet.getCell(ref).formula ? { formula: sheet.getCell(ref).formula } : (sheet.getCell(ref).value ?? null))
    // The checkbox cell holds the number 1 (shown as "Yes"), so the formula's test against 1 works.
    expect(['J7', 'J8', 'J9'].map((ref) => sheet.getCell(ref).value)).toEqual([0, 1, 0])
    expect(sheet.getCell('J8').numFmt).toBe('"Yes";"Yes";"No"')
    expect(sheet.getCell('N8').formula).toBe('IF((J8=1),0,(MIN(F8,29710)*0.01))')
    expect(money(evaluateExcelFormula(sheet.getCell('N8').formula, getCell))).toBe('0.00')
    expect(money(evaluateExcelFormula(sheet.getCell('L8').formula, getCell))).toBe('88,400.00')
    // The totals recalculate to the app's totals too: 187.50 + 0 + 297.10.
    expect(money(evaluateExcelFormula(sheet.getCell('N10').formula, getCell))).toBe('484.60')
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

  function textFiguresWorkbook(rows) {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['ID', 'Name', 'Basic Salary', 'Govt Increment', 'Allowances'], ...rows]), 'Sheet1')
    return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
  }

  test('figures held as text ("18,115.00", "Rs 635", "1 250.50") are imported as the numbers they are; the preview shows the same', async () => {
    const { context, page } = await openSeeded(app)
    await chooseExcel(page, textFiguresWorkbook([['TST201', 'Texty', '18,115.00', 'Rs 635', '1 250.50']]), 'text-figures.xlsx')
    const box = dialog(page, 'Import from Excel')
    await box.waitFor()
    // The preview shows what will be stored, not the raw text.
    const previewRow = await box.locator('tbody tr').first().locator('td').allTextContents()
    expect(previewRow.slice(0, 5)).toEqual(['TST201', 'Texty', 'empty', '18115', '635'])
    expect(await box.getByRole('alert').count()).toBe(0)
    await box.getByRole('button', { name: 'Import 1 row' }).click()
    await box.waitFor({ state: 'hidden' })

    const row = (await readEmployeeTable(page))[3]
    expect([row.ID, row['Basic Salary'], row['Govt Increment'], row.Allowances, row['New Basic'], row.Emoluments]).toEqual(['TST201', '18115.00', '635.00', '1250.50', '18,750.00', '20,000.50'])
    const stored = (await storedPeriod(page, A, '2026-09'))[3].values
    expect([stored.basicSalary, stored.govtIncrement, stored.allowances]).toEqual([18115, 635, 1250.5])
    // Nothing to report, so no summary.
    expect(await page.getByRole('alert').count()).toBe(0)
    await context.close()
  })

  test('a cell that is not a number is flagged in the preview, left blank on import, and listed in a summary afterwards', async () => {
    const { context, page } = await openSeeded(app)
    await chooseExcel(page, textFiguresWorkbook([['TST202', 'Texty', 'n/a', 100, 'TBC'], ['TST203', 'Fine', 5000, '', 0]]), 'unreadable.xlsx')
    const box = dialog(page, 'Import from Excel')
    await box.waitFor()

    const flagged = box.getByRole('alert')
    expect((await flagged.locator('p').textContent()).replace(/\s+/g, ' ').trim()).toBe("2 values can't be read as a number and will be left blank (not imported as 0):")
    expect(await flagged.locator('li').allTextContents()).toEqual(['TST202 Texty — Basic Salary: “n/a”', 'TST202 Texty — Allowances: “TBC”'])
    const previewRow = await box.locator('tbody tr').first().locator('td').allTextContents()
    expect(previewRow[3]).toBe('n/a (not a number)')
    expect(previewRow[4]).toBe('100')

    await box.getByRole('button', { name: 'Import 2 rows' }).click()
    await box.waitFor({ state: 'hidden' })

    // Left blank - not 0 - and the rest of the row is imported normally.
    const rows = await readEmployeeTable(page)
    expect([rows[3].ID, rows[3]['Basic Salary'], rows[3]['Govt Increment'], rows[3].Allowances]).toEqual(['TST202', '', '100.00', ''])
    expect([rows[4].ID, rows[4]['Basic Salary'], rows[4]['Govt Increment'], rows[4].Allowances]).toEqual(['TST203', '5000.00', '0.00', '0.00'])
    const stored = (await storedPeriod(page, A, '2026-09'))[3].values
    expect([stored.basicSalary, stored.allowances]).toEqual(['', ''])

    // The summary after the import repeats what was left blank.
    const summary = page.getByRole('alert')
    expect((await summary.locator('p').textContent()).replace(/\s+/g, ' ').trim()).toBe('Imported 2 rows. 2 values could not be read as a number and were left blank:')
    expect(await summary.locator('li').allTextContents()).toEqual(['TST202 Texty — Basic Salary: “n/a”', 'TST202 Texty — Allowances: “TBC”'])
    await summary.getByRole('button', { name: 'Dismiss' }).click()
    expect(await page.getByRole('alert').count()).toBe(0)
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

  test('the two "CSG" columns are named with their category in the picker and in the files, each with its own figure', async () => {
    const { context, page } = await openSeeded(app)
    const screen = (await readEmployeeTable(page))[0]
    expect([screen['CSG (Employee Contribution)'], screen['CSG (Employer Contribution)']]).toEqual(['281.25', '562.50'])

    let box = await openPdfFill(page, 'JSON')
    // No plain "CSG" any more: one tick box each, named as the file will name them.
    expect(await box.getByLabel('CSG', { exact: true }).count()).toBe(0)
    await box.getByRole('button', { name: 'Select None' }).click()
    await box.getByLabel('ID', { exact: true }).check()
    await box.getByLabel('CSG (Employee Contribution)', { exact: true }).check()
    await box.getByLabel('CSG (Employer Contribution)', { exact: true }).check()
    const json = await download(page, () => box.getByRole('button', { name: 'Export JSON' }).click())
    expect(JSON.parse(json.bytes.toString('utf8'))).toEqual([
      { ID: 'TST001', 'CSG (Employee Contribution)': 281.25, 'CSG (Employer Contribution)': 562.5 },
      { ID: 'TST002', 'CSG (Employee Contribution)': 3000, 'CSG (Employer Contribution)': 6000 },
      { ID: 'TST003', 'CSG (Employee Contribution)': 1800, 'CSG (Employer Contribution)': 3600 },
    ])

    box = await openPdfFill(page, 'CSV')
    await box.getByRole('button', { name: 'Select None' }).click()
    await box.getByLabel('ID', { exact: true }).check()
    await box.getByLabel('CSG (Employee Contribution)', { exact: true }).check()
    await box.getByLabel('CSG (Employer Contribution)', { exact: true }).check()
    const csv = await download(page, () => box.getByRole('button', { name: 'Export CSV' }).click())
    expect(csv.bytes.toString('utf8').split('\r\n')).toEqual([
      'ID,CSG (Employee Contribution),CSG (Employer Contribution)',
      'TST001,281.25,562.5',
      'TST002,3000,6000',
      'TST003,1800,3600',
    ])

    // Exporting only the employee's column gives the employee's figure.
    box = await openPdfFill(page, 'JSON')
    await box.getByRole('button', { name: 'Select None' }).click()
    await box.getByLabel('CSG (Employee Contribution)', { exact: true }).check()
    const one = await download(page, () => box.getByRole('button', { name: 'Export JSON' }).click())
    expect(JSON.parse(one.bytes.toString('utf8'))[0]).toEqual({ 'CSG (Employee Contribution)': 281.25 })
    await context.close()
  })

  test('half cents are rounded up in the file, as on screen', async () => {
    const { context, page } = await openSeeded(app)
    // TST003's Net Pay is 57,978.425.
    expect((await readEmployeeTable(page))[2]['Net Pay']).toBe('57,978.43')
    const box = await openPdfFill(page, 'JSON')
    await box.getByRole('button', { name: 'Select None' }).click()
    await box.getByLabel('Net Pay', { exact: true }).check()
    const file = await download(page, () => box.getByRole('button', { name: 'Export JSON' }).click())
    expect(JSON.parse(file.bytes.toString('utf8')).map((r) => r['Net Pay'])).toEqual([18381.25, 88400, 57978.43])
    await context.close()
  })
})

describe('a figure in error is never exported as a number', () => {
  // "Rate Check" uses a column that no longer exists; "After Check" is worked out from it.
  const seed = () => {
    const s = seededState()
    s.state.globalColumns.push(simple('Rate Check', 'rateCheck', 'basicSalary * rateThatWasDeleted'), simple('After Check', 'afterCheck', 'rateCheck + 1'))
    return s
  }

  async function openPdfFill(page, format) {
    await openExportMenu(page, `Export for PDF fill (${format})`)
    const box = dialog(page, `Export for PDF fill (${format})`)
    await box.waitFor()
    return box
  }

  test('on screen both columns say Error', async () => {
    const { context, page } = await openSeeded(app, seed())
    const rows = await readEmployeeTable(page)
    expect(rows.map((r) => [r['Rate Check'], r['After Check']])).toEqual([['Error', 'Error'], ['Error', 'Error'], ['Error', 'Error']])
    expect(rows[0]['Net Pay']).toBe('18,381.25')
    await context.close()
  })

  test('Export to Excel warns first, listing the employees and columns; Cancel exports nothing', async () => {
    const { context, page } = await openSeeded(app, seed())
    await page.getByRole('button', { name: 'Export to Excel', exact: true }).click()
    const warning = dialog(page, '6 figures are in error')
    await warning.waitFor()
    expect(await warning.textContent()).toContain('If you export anyway, each one is written as the text "Error", never as a number.')
    expect(await warning.locator('li').allTextContents()).toEqual([
      'TST001 Alpha Tester — Rate Check',
      'TST001 Alpha Tester — After Check',
      'TST002 Beta Tester — Rate Check',
      'TST002 Beta Tester — After Check',
      'TST003 Gamma Tester — Rate Check',
      'TST003 Gamma Tester — After Check',
    ])
    await warning.getByRole('button', { name: 'Cancel', exact: true }).click()
    await warning.waitFor({ state: 'hidden' })
    expect(await dialog(page, 'Export Preview').count()).toBe(0)
    await context.close()
  })

  for (const mode of ['values', 'formulas']) {
    test(`"Export anyway" (${mode}): the cells and their totals are the text "Error" in the preview and in the file`, async () => {
      const { context, page } = await openSeeded(app, seed())
      if (mode === 'formulas') await openExportMenu(page, 'Export with Live Formulas')
      else await page.getByRole('button', { name: 'Export to Excel', exact: true }).click()
      await dialog(page, '6 figures are in error').getByRole('button', { name: 'Export anyway', exact: true }).click()

      const preview = dialog(page, 'Export Preview')
      await preview.waitFor()
      const headers = await preview.locator('thead tr').nth(1).locator('th').allTextContents()
      const at = headers.indexOf('Rate Check (calc)')
      expect(at).toBeGreaterThan(0)
      const firstRow = await preview.locator('tbody tr').first().locator('td').allTextContents()
      expect([firstRow[at], firstRow[at + 1]]).toEqual(['Error', 'Error'])

      const file = await download(page, () => preview.getByRole('button', { name: 'Download .xlsx' }).click())
      const sheet = (await openWorkbook(file.bytes)).getWorksheet('Payroll')
      for (const row of [7, 8, 9, 10]) {
        for (const column of [at + 1, at + 2]) {
          expect(sheet.getCell(row, column).value, sheet.getCell(row, column).address).toBe('Error')
          expect(sheet.getCell(row, column).formula).toBeUndefined()
        }
      }
      // Every other figure is exported as usual.
      expect(sheet.getCell(7, headers.indexOf('Net Pay (calc)') + 1).result ?? sheet.getCell(7, headers.indexOf('Net Pay (calc)') + 1).value).toBe(18381.25)
      await context.close()
    })
  }

  test('Export for PDF fill warns only when a chosen column is in error, and writes "Error"', async () => {
    const { context, page } = await openSeeded(app, seed())

    // Without the two broken columns: no warning.
    let box = await openPdfFill(page, 'JSON')
    await box.getByLabel('Rate Check', { exact: true }).uncheck()
    await box.getByLabel('After Check', { exact: true }).uncheck()
    const clean = await download(page, () => box.getByRole('button', { name: 'Export JSON' }).click())
    expect(JSON.stringify(JSON.parse(clean.bytes.toString('utf8')))).not.toContain('Error')

    // With them: a warning first; Cancel keeps the picker open and exports nothing.
    box = await openPdfFill(page, 'JSON')
    await box.getByRole('button', { name: 'Select None' }).click()
    await box.getByLabel('ID', { exact: true }).check()
    await box.getByLabel('Rate Check', { exact: true }).check()
    await box.getByRole('button', { name: 'Export JSON' }).click()
    const warning = dialog(page, '3 figures are in error')
    expect(await warning.locator('li').allTextContents()).toEqual(['TST001 Alpha Tester — Rate Check', 'TST002 Beta Tester — Rate Check', 'TST003 Gamma Tester — Rate Check'])
    await warning.getByRole('button', { name: 'Cancel', exact: true }).click()
    await warning.waitFor({ state: 'hidden' })
    expect(await box.isVisible()).toBe(true)

    await box.getByRole('button', { name: 'Export JSON' }).click()
    const json = await download(page, () => warning.getByRole('button', { name: 'Export anyway', exact: true }).click())
    expect(JSON.parse(json.bytes.toString('utf8'))).toEqual([
      { ID: 'TST001', 'Rate Check': 'Error' },
      { ID: 'TST002', 'Rate Check': 'Error' },
      { ID: 'TST003', 'Rate Check': 'Error' },
    ])

    box = await openPdfFill(page, 'CSV')
    await box.getByRole('button', { name: 'Select None' }).click()
    await box.getByLabel('ID', { exact: true }).check()
    await box.getByLabel('After Check', { exact: true }).check()
    await box.getByRole('button', { name: 'Export CSV' }).click()
    const csv = await download(page, () => dialog(page, '3 figures are in error').getByRole('button', { name: 'Export anyway', exact: true }).click())
    expect(csv.bytes.toString('utf8')).toBe('ID,After Check\r\nTST001,Error\r\nTST002,Error\r\nTST003,Error')
    await context.close()
  })

  test('Totals shows Error and its export warns too', async () => {
    const { context, page } = await openSeeded(app, seed())
    await tab(page, 'Totals').click()
    await page.getByText('Summing September 2026').waitFor()
    const cells = await page.locator('table tbody tr').first().locator('td').allTextContents()
    expect(cells.filter((c) => c.trim() === 'Error')).toHaveLength(2)
    expect(cells.join('|')).not.toContain('NaN')

    await page.getByRole('button', { name: 'Export to Excel' }).click()
    const warning = dialog(page, '6 figures are in error')
    await warning.waitFor()
    await warning.getByRole('button', { name: 'Export anyway', exact: true }).click()
    const preview = dialog(page, 'Export Preview')
    await preview.waitFor()
    const file = await download(page, () => preview.getByRole('button', { name: 'Download .xlsx' }).click())
    const sheet = (await openWorkbook(file.bytes)).getWorksheet('Payroll')
    const headers = Array.from({ length: sheet.columnCount }, (_, i) => String(sheet.getCell(6, i + 1).value))
    expect(sheet.getCell(7, headers.indexOf('Rate Check (calc)') + 1).value).toBe('Error')
    expect(sheet.getCell(7, headers.indexOf('New Basic (calc)') + 1).value).toBe(18750)
    await context.close()
  })

  test('when nothing is in error there is no warning: the export opens straight away', async () => {
    const { context, page } = await openSeeded(app)
    await page.getByRole('button', { name: 'Export to Excel', exact: true }).click()
    await dialog(page, 'Export Preview').waitFor()
    expect(await page.getByRole('dialog').count()).toBe(1)
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
