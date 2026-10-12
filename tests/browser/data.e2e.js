// Browser test 2: employees, months, storage and structure, starting from
// saved TEST data (two companies sharing the global test columns).
// Each test opens its own fresh browser profile.
//
// A test named "evidence (BUG)" passes while the bug is present and records
// exactly what the app does; it will fail once the bug is fixed.

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  startApp,
  startServer,
  openSeeded,
  seededState,
  periodStorageKey,
  storedState,
  storedPeriod,
  storageKeys,
  readEmployeeTable,
  readPlainTable,
  readColumnList,
  groupHeaders,
  tab,
  dialog,
  confirm,
  addEmployee,
  addColumn,
  openEditColumn,
  employeeRow,
  setCell,
  switchCompany,
  goToMonth,
  STATE_KEY,
} from './app'
import { testEmployees } from '../audit/build'

let app
beforeAll(async () => {
  app = await startApp()
})
afterAll(async () => {
  await app?.close()
})

const A = 'test-co-a'
const B = 'test-co-b'
const monthLabel = (page) => page.locator('.card span.num').first().textContent()
const ids = async (page) => (await readEmployeeTable(page)).map((r) => r.ID)

function seedWith(change) {
  const seed = seededState()
  change(seed)
  return seed
}

describe('months', () => {
  test('moving between months; each month starts empty; one month never changes another', async () => {
    const seed = seededState()
    const { context, page } = await openSeeded(app, seed)
    const september = seed.periods[periodStorageKey(A, '2026-09')].employees

    expect(await monthLabel(page)).toBe('September 2026')
    expect(await ids(page)).toEqual(['TST001', 'TST002', 'TST003'])

    await goToMonth(page, /October →/)
    expect(await monthLabel(page)).toBe('October 2026')
    expect(await page.getByText('No employees this month').isVisible()).toBe(true)
    expect(await ids(page)).toEqual([])

    await addEmployee(page, { ID: 'TST010', Name: 'Kappa', 'Basic Salary': '1000' })
    expect(await ids(page)).toEqual(['TST010'])
    // September is exactly as it was.
    expect(await storedPeriod(page, A, '2026-09')).toEqual(september)

    await goToMonth(page, /← September/)
    expect(await monthLabel(page)).toBe('September 2026')
    expect(await ids(page)).toEqual(['TST001', 'TST002', 'TST003'])
    await setCell(page, 0, 'Basic Salary', '20000')
    expect((await readEmployeeTable(page))[0]['New Basic']).toBe('20,635.00')
    // October is exactly as it was.
    const october = await storedPeriod(page, A, '2026-10')
    expect(october.map((e) => e.values)).toEqual([{ id: 'TST010', name: 'Kappa', basicSalary: '1000' }])

    await goToMonth(page, /October →/)
    expect(await ids(page)).toEqual(['TST010'])
    await goToMonth(page, /November →/)
    expect(await ids(page)).toEqual([])
    await goToMonth(page, /December →/)
    await goToMonth(page, /January →/)
    expect(await monthLabel(page)).toBe('January 2027')
    expect(await ids(page)).toEqual([])

    // The other company saw none of it.
    await switchCompany(page, 'TEST Co B')
    expect(await monthLabel(page)).toBe('September 2026')
    expect(await ids(page)).toEqual([])
    await context.close()
  })

  test('the month a company was on is remembered after a reload', async () => {
    const { context, page } = await openSeeded(app)
    await goToMonth(page, /October →/)
    await page.reload()
    await page.getByRole('button', { name: 'TEST Co A', exact: true }).waitFor()
    expect(await monthLabel(page)).toBe('October 2026')
    await context.close()
  })

  // The month being left must never be written under the key of the month
  // being entered, not even for a moment.
  test('changing month writes only the new month\'s own data under its key', async () => {
    const { context, page } = await openSeeded(app, seededState(), {
      initScript: () => {
        window.__writes = []
        const original = Storage.prototype.setItem
        Storage.prototype.setItem = function (key, value) {
          window.__writes.push([key, String(value)])
          return original.call(this, key, value)
        }
      },
    })
    await page.evaluate(() => (window.__writes.length = 0))
    await goToMonth(page, /October →/)
    await page.waitForTimeout(300)
    const octoberWrites = await page.evaluate((key) => window.__writes.filter(([k]) => k === key).map(([, v]) => v), periodStorageKey(A, '2026-10'))
    expect(octoberWrites).toEqual(['{"employees":[]}'])
    expect(await storedPeriod(page, A, '2026-10')).toEqual([])
    // And back again: September is written only as September.
    await page.evaluate(() => (window.__writes.length = 0))
    await goToMonth(page, /← September/)
    const allWrites = await page.evaluate(() => window.__writes)
    for (const [key, value] of allWrites) {
      if (key.endsWith('2026-10')) expect(value).toBe('{"employees":[]}')
      if (key.endsWith('2026-09')) expect(JSON.parse(value).employees.map((e) => e.values.id)).toEqual(['TST001', 'TST002', 'TST003'])
    }
    await context.close()
  })
})

describe('employees', () => {
  const seed = () =>
    seedWith((s) => {
      s.periods[periodStorageKey(A, '2026-10')] = { employees: [{ id: 'oct-1', values: { id: 'TST001', name: 'Alpha', basicSalary: '500' } }] }
      // Another company, same month, same employee ID.
      s.periods[periodStorageKey(B, '2026-09')] = { employees: [{ id: 'b-1', values: { id: 'TST001', name: 'Other', surname: 'Company', basicSalary: '77000' } }] }
    })

  test('add one, delete one', async () => {
    const { context, page } = await openSeeded(app, seed())
    await addEmployee(page, { ID: 'TST004', Name: 'Delta', 'Basic Salary': '30000' })
    expect(await ids(page)).toEqual(['TST001', 'TST002', 'TST003', 'TST004'])
    expect((await readEmployeeTable(page))[3]['New Basic']).toBe('30,000.00')

    await employeeRow(page, 1).getByRole('button', { name: 'Delete', exact: true }).click()
    expect(await dialog(page, 'Delete employee').textContent()).toContain('Delete TST002 Beta?')
    await confirm(page, 'Delete employee', 'Delete')
    expect(await ids(page)).toEqual(['TST001', 'TST003', 'TST004'])
    expect((await storedPeriod(page, A, '2026-09')).map((e) => e.values.id)).toEqual(['TST001', 'TST003', 'TST004'])
    await context.close()
  })

  test('cancelling a delete keeps the employee', async () => {
    const { context, page } = await openSeeded(app, seed())
    await employeeRow(page, 1).getByRole('button', { name: 'Delete', exact: true }).click()
    await confirm(page, 'Delete employee', 'Cancel')
    expect(await ids(page)).toEqual(['TST001', 'TST002', 'TST003'])
    await context.close()
  })

  test('Delete All removes only the current company\'s current month', async () => {
    const s = seed()
    const { context, page } = await openSeeded(app, s)
    await page.getByRole('button', { name: 'Delete All Employees' }).click()
    expect(await dialog(page, 'Delete all employees').textContent()).toContain('Delete all 3 employees for TEST Co A — September 2026? This cannot be undone.')
    await confirm(page, 'Delete all employees', 'Delete All')

    expect(await ids(page)).toEqual([])
    expect(await page.getByRole('button', { name: 'Delete All Employees' }).isDisabled()).toBe(true)
    expect(await storedPeriod(page, A, '2026-09')).toEqual([])
    expect(await storedPeriod(page, A, '2026-10')).toEqual(s.periods[periodStorageKey(A, '2026-10')].employees)
    expect(await storedPeriod(page, B, '2026-09')).toEqual(s.periods[periodStorageKey(B, '2026-09')].employees)
    // The columns and both companies are untouched.
    const state = await storedState(page)
    expect(state.companies.map((c) => c.name)).toEqual(['TEST Co A', 'TEST Co B'])
    expect(state.globalColumns).toHaveLength(s.state.globalColumns.length)
    await context.close()
  })

  test('two companies with the same employee ID in the same month stay separate', async () => {
    const { context, page } = await openSeeded(app, seed())
    expect((await readEmployeeTable(page))[0]['Basic Salary']).toBe('18115.00')
    await switchCompany(page, 'TEST Co B')
    const rows = await readEmployeeTable(page)
    expect(rows.map((r) => [r.ID, r.Name, r['Basic Salary']])).toEqual([['TST001', 'Other', '77000.00']])
    await setCell(page, 0, 'Basic Salary', '78000')
    expect((await storedPeriod(page, A, '2026-09'))[0].values.basicSalary).toBe('18115')
    await context.close()
  })

  test('a duplicate ID is flagged on both rows, and the flag goes when it is corrected', async () => {
    const { context, page } = await openSeeded(app)
    expect(await page.getByLabel('Duplicate ID').count()).toBe(0)
    await addEmployee(page, { ID: 'TST001', Name: 'Twin' })
    expect(await page.getByLabel('Duplicate ID').count()).toBe(2)
    await employeeRow(page, 3).getByLabel('ID', { exact: true }).fill('TST009')
    expect(await page.getByLabel('Duplicate ID').count()).toBe(0)
    await context.close()
  })

  // Moving into a cell with Tab selects its content, so typing replaces it.
  // (The app swaps "18115.00" for "18115" as the cell takes focus; it now
  // selects the whole figure again once that swap is done.)
  test('tabbing into a figure and typing replaces it', async () => {
    const { context, page } = await openSeeded(app)
    await employeeRow(page, 0).getByLabel('Surname', { exact: true }).click()
    await page.keyboard.press('Tab')
    await page.keyboard.type('20000')
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    expect((await storedPeriod(page, A, '2026-09'))[0].values.basicSalary).toBe('20000')
    expect((await readEmployeeTable(page))[0]['New Basic']).toBe('20,635.00')

    // Tabbing on through several cells and typing in each one.
    await employeeRow(page, 1).getByLabel('Surname', { exact: true }).click()
    await page.keyboard.press('Tab')
    await page.keyboard.type('50000')
    await page.keyboard.press('Tab')
    await page.keyboard.type('250')
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    const second = (await storedPeriod(page, A, '2026-09'))[1].values
    expect([second.basicSalary, second.govtIncrement]).toEqual(['50000', '250'])
    await context.close()
  })

  test('clicking into a figure, then moving the caret, still lets one digit be changed', async () => {
    const { context, page } = await openSeeded(app)
    const cell = employeeRow(page, 0).getByLabel('Basic Salary', { exact: true })
    await cell.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('9')
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    expect((await storedPeriod(page, A, '2026-09'))[0].values.basicSalary).toBe('18119')
    await context.close()
  })

  test('a text column holds text: "Full Time" / "Part Time", blank stays blank', async () => {
    const { context, page } = await openSeeded(app)
    expect((await readEmployeeTable(page)).map((r) => r.Status)).toEqual(['Full Time', 'Part Time', ''])
    await employeeRow(page, 2).getByLabel('Status', { exact: true }).fill('Part Time')
    expect((await storedPeriod(page, A, '2026-09'))[2].values.status).toBe('Part Time')
    await context.close()
  })
})

describe('Copy from Previous Month', () => {
  const seed = () =>
    seedWith((s) => {
      s.state.companies[0].viewMonth = 10
      s.periods[periodStorageKey(A, '2026-10')] = {
        employees: [{ id: 'oct-1', values: { id: 'TST001', name: 'Alpha', surname: 'Tester', basicSalary: '1', govtIncrement: '2', status: 'Old', allowances: '3', age60: true, edf: '4' } }],
      }
    })

  test('only the selected employees and columns; formula columns are not offered; it warns before overwriting', async () => {
    const s = seed()
    const { context, page } = await openSeeded(app, s)
    expect(await monthLabel(page)).toBe('October 2026')

    await page.getByRole('button', { name: 'Copy from Previous Month' }).click()
    const box = dialog(page, 'Copy from Previous Month')
    expect(await box.textContent()).toContain('Employees in September 2026')

    // The column checklist is the right-hand list; formula columns are absent.
    const offered = await box.locator('.grid > div').nth(1).locator('label').allTextContents()
    expect(offered.map((t) => t.trim())).toEqual(['ID', 'Name', 'Surname', 'Basic Salary', 'Govt Increment', 'Status', 'Allowances', 'Age 60+', 'Bonus Base', 'EDF'])
    for (const formulaName of ['New Basic', 'Emoluments', 'Bonus', 'CSG', 'NSF', 'PAYE', 'Chargeable', 'Net Pay']) expect(offered.map((t) => t.trim())).not.toContain(formulaName)

    // Who is new and who already exists this month.
    const badges = await box.locator('.grid > div').nth(0).locator('label').allTextContents()
    expect(badges.map((t) => t.trim())).toEqual(['TST001 Alpha TesterExists', 'TST002 Beta TesterNew', 'TST003 Gamma TesterNew'])

    const copyButton = box.getByRole('button', { name: /^Copy \d+ Employee/ })
    expect(await copyButton.isDisabled()).toBe(true)
    await box.getByLabel(/^TST001/).check()
    await box.getByLabel(/^TST002/).check()
    await box.getByLabel('Basic Salary', { exact: true }).check()
    await box.getByLabel('Status', { exact: true }).check()
    expect(await copyButton.textContent()).toBe('Copy 2 Employees')
    await copyButton.click()

    expect(await dialog(page, 'Overwrite existing values?').textContent()).toContain('This will overwrite existing values for 1 employee in Basic Salary, Status.')
    await dialog(page, 'Overwrite existing values?').getByRole('button', { name: 'Overwrite', exact: true }).click()
    await box.waitFor({ state: 'hidden' })

    const october = await storedPeriod(page, A, '2026-10')
    expect(october.map((e) => e.values)).toEqual([
      { id: 'TST001', name: 'Alpha', surname: 'Tester', basicSalary: '18115', govtIncrement: '2', status: 'Full Time', allowances: '3', age60: true, edf: '4' },
      { id: 'TST002', name: 'Beta', surname: 'Tester', basicSalary: '95000', status: 'Part Time' },
    ])
    // The previous month is unchanged.
    expect(await storedPeriod(page, A, '2026-09')).toEqual(s.periods[periodStorageKey(A, '2026-09')].employees)
    await context.close()
  })

  test('Select All and Clear All for the employee list', async () => {
    const { context, page } = await openSeeded(app, seed())
    await page.getByRole('button', { name: 'Copy from Previous Month' }).click()
    const box = dialog(page, 'Copy from Previous Month')
    await box.getByRole('button', { name: 'Select All' }).click()
    expect(await box.getByRole('button', { name: /^Copy \d+ Employee/ }).textContent()).toBe('Copy 3 Employees')
    await box.getByRole('button', { name: 'Clear All' }).click()
    expect(await box.getByRole('button', { name: /^Copy \d+ Employee/ }).textContent()).toBe('Copy 0 Employees')
    await box.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await storedPeriod(page, A, '2026-10'))).toHaveLength(1)
    await context.close()
  })

  test('the button is off when the previous month has nobody', async () => {
    const { context, page } = await openSeeded(app)
    // September is on screen; August is empty.
    expect(await page.getByRole('button', { name: 'Copy from Previous Month' }).isDisabled()).toBe(true)
    await goToMonth(page, /October →/)
    expect(await page.getByRole('button', { name: 'Copy from Previous Month' }).isDisabled()).toBe(false)
    await context.close()
  })
})

describe('Totals', () => {
  const [first, , third] = testEmployees()
  const seed = () =>
    seedWith((s) => {
      s.periods[periodStorageKey(A, '2026-09')] = { employees: testEmployees().slice(0, 2) }
      s.periods[periodStorageKey(A, '2026-10')] = {
        employees: [{ id: 'o1', values: { ...first.values, basicSalary: '20000', govtIncrement: '0', status: 'Part Time' } }, third],
      }
    })

  test('one month, then a range: employees present in only some months are included', async () => {
    const { context, page } = await openSeeded(app, seed())
    await tab(page, 'Totals').click()
    await page.getByText('Summing September 2026').waitFor()
    let rows = await readPlainTable(page)
    expect(rows.map((r) => r.ID)).toEqual(['TST001', 'TST002'])
    expect(rows[0]['New Basic']).toBe('18,750.00')

    await page.getByLabel('To', { exact: true }).fill('2026-10')
    await page.getByText('Summing September 2026 to October 2026').waitFor()
    rows = await readPlainTable(page)
    expect(rows.map((r) => r.ID)).toEqual(['TST001', 'TST002', 'TST003'])
    // TST001: 18,750 + 20,000; CSG 281.25 + 300; NSF 187.50 + 200
    expect(rows[0]['New Basic']).toBe('38,750.00')
    expect(rows[0]['CSG (Employee Contribution)']).toBe('581.25')
    expect(rows[0].NSF).toBe('387.50')
    // TST002 (September only) and TST003 (October only)
    expect(rows[1].PAYE).toBe('8,600.00')
    expect(rows[2].NSF).toBe('297.10')
    // Text and checkbox columns are shown as they are, not as numbers.
    expect(rows.map((r) => r.Status)).toEqual(['Full Time', 'Part Time', ''])
    expect(rows.map((r) => r['Age 60+'])).toEqual(['No', 'Yes', 'No'])
    await context.close()
  })

  test('the range works whichever end is earlier', async () => {
    const { context, page } = await openSeeded(app, seed())
    await tab(page, 'Totals').click()
    await page.getByLabel('From', { exact: true }).fill('2026-10')
    await page.getByText('Summing September 2026 to October 2026').waitFor()
    expect((await readPlainTable(page)).map((r) => r.ID)).toEqual(['TST001', 'TST002', 'TST003'])
    await context.close()
  })

  test('a range with nobody in it says so', async () => {
    const { context, page } = await openSeeded(app, seed())
    await tab(page, 'Totals').click()
    await page.getByLabel('From', { exact: true }).fill('2025-01')
    await page.getByLabel('To', { exact: true }).fill('2025-02')
    await page.getByText('No employees found in the selected month range.').waitFor()
    await context.close()
  })

  // The Totals export shows the text and checkbox columns exactly as the
  // Totals screen does.
  test('the Totals export matches the Totals screen, text and checkbox columns included', async () => {
    const { context, page } = await openSeeded(app, seed())
    await tab(page, 'Totals').click()
    await page.getByLabel('To', { exact: true }).fill('2026-10')
    await page.getByText('Summing September 2026 to October 2026').waitFor()
    const screen = await readPlainTable(page)
    await page.getByRole('button', { name: 'Export to Excel' }).click()
    const preview = dialog(page, 'Export Preview')
    await preview.waitFor()
    const cells = await preview.evaluate((el) => {
      const headers = [...el.querySelectorAll('thead tr:nth-child(2) th')].map((th) => th.textContent.trim())
      return [...el.querySelectorAll('tbody tr')].slice(0, 3).map((tr) => Object.fromEntries([...tr.children].map((td, i) => [headers[i], td.textContent.trim()])))
    })
    expect(cells.map((r) => [r.ID, r.Status, r['Age 60+']])).toEqual([['TST001', 'Full Time', 'No'], ['TST002', 'Part Time', 'Yes'], ['TST003', '', 'No']])
    expect(cells.map((r) => [r.ID, r.Status, r['Age 60+']])).toEqual(screen.map((r) => [r.ID, r.Status, r['Age 60+']]))
    // The figures match the screen too.
    expect(cells.map((r) => r['New Basic (calc)'])).toEqual(screen.map((r) => r['New Basic']))
    expect(cells.map((r) => r['NSF (calc)'])).toEqual(screen.map((r) => r.NSF))
    await context.close()
  })
})

describe('what is kept in the browser', () => {
  test('data survives a reload and a restart of the app; on another port the app starts empty', async () => {
    const first = await startServer(5195)
    const { context } = await app.newContext()
    const page = await context.newPage()
    const seed = seededState()
    try {
      await page.goto(first.url)
      await page.getByText('No companies yet.').waitFor({ timeout: 120_000 })
      await page.evaluate(
        ([stateKey, state, periods]) => {
          localStorage.setItem(stateKey, JSON.stringify(state))
          for (const [key, value] of Object.entries(periods)) localStorage.setItem(key, JSON.stringify(value))
        },
        [STATE_KEY, seed.state, seed.periods]
      )
      await page.reload()
      await page.getByRole('button', { name: 'TEST Co A', exact: true }).waitFor()
      expect(await ids(page)).toEqual(['TST001', 'TST002', 'TST003'])

      // Restart on the same port: same address, same data.
      await first.server.close()
      const again = await startServer(Number(new URL(first.url).port))
      try {
        expect(again.origin).toBe(first.origin)
        await page.goto(again.url)
        await page.getByRole('button', { name: 'TEST Co A', exact: true }).waitFor({ timeout: 120_000 })
        expect(await ids(page)).toEqual(['TST001', 'TST002', 'TST003'])

        // The same app on another port: the browser treats it as another site.
        const other = await startServer(Number(new URL(first.url).port) + 1)
        try {
          expect(other.origin).not.toBe(first.origin)
          await page.goto(other.url)
          await page.getByText('No companies yet.').waitFor({ timeout: 120_000 })
          expect(await storageKeys(page)).not.toContain(periodStorageKey(A, '2026-09'))
          // Nothing was lost: back on the first port it is all still there.
          await page.goto(again.url)
          await page.getByRole('button', { name: 'TEST Co A', exact: true }).waitFor()
          expect(await ids(page)).toEqual(['TST001', 'TST002', 'TST003'])
        } finally {
          await other.server.close()
        }
      } finally {
        await again.server.close()
      }
    } finally {
      await context.close()
    }
  })

  test('when browser storage is full, a blocking warning says the change was NOT saved, and the screen shows only what is saved', async () => {
    const { context, page } = await openSeeded(app)
    const errors = []
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
    // Fill what is left of this site's storage, to the last character.
    await page.evaluate(() => {
      let size = 1024 * 1024
      let i = 0
      while (size >= 1) {
        try {
          localStorage.setItem(`zz_test_fill_${i}`, 'x'.repeat(size))
          i++
        } catch {
          size = Math.floor(size / 2)
        }
      }
      for (;;) {
        try {
          localStorage.setItem('zz_test_fill_0', `${localStorage.getItem('zz_test_fill_0')}x`)
        } catch {
          break
        }
      }
    })

    // Type a longer figure over 18115. The first five digits fit in the
    // space the old figure used; the sixth does not.
    const cell = employeeRow(page, 0).getByLabel('Basic Salary', { exact: true })
    await cell.click()
    await cell.press('Control+A')
    await page.keyboard.type('99999123')

    const warning = dialog(page, 'This change was NOT saved')
    await warning.waitFor()
    expect(await warning.textContent()).toContain("The browser's storage for this site is full, so your last change could not be kept.")
    expect(await warning.textContent()).toContain('export a backup first')
    expect(errors.some((e) => e.includes('Failed to save payroll period to localStorage'))).toBe(true)
    // It blocks: the table behind it cannot be reached until it is acknowledged.
    expect(await warning.getAttribute('aria-modal')).toBe('true')

    // What is on screen is exactly what is saved - the refused change is gone.
    const stored = (await storedPeriod(page, A, '2026-09'))[0].values.basicSalary
    expect(stored).toBe('99999')
    await warning.getByRole('button', { name: 'OK', exact: true }).click()
    await warning.waitFor({ state: 'hidden' })
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    const row = (await readEmployeeTable(page))[0]
    expect(row['Basic Salary']).toBe('99999.00')
    expect(row['New Basic']).toBe('100,634.00')

    await page.reload()
    await page.getByRole('button', { name: 'TEST Co A', exact: true }).waitFor()
    expect((await readEmployeeTable(page))[0]['Basic Salary']).toBe('99999.00')
    await context.close()
  })

  test('when browser storage is full, a new column is not shown as added, and the warning appears', async () => {
    const { context, page } = await openSeeded(app)
    await page.evaluate(() => {
      let size = 1024 * 1024
      let i = 0
      while (size >= 1) {
        try {
          localStorage.setItem(`zz_test_fill_${i}`, 'x'.repeat(size))
          i++
        } catch {
          size = Math.floor(size / 2)
        }
      }
      for (;;) {
        try {
          localStorage.setItem('zz_test_fill_0', `${localStorage.getItem('zz_test_fill_0')}x`)
        } catch {
          break
        }
      }
    })
    await tab(page, 'Global Columns').click()
    await page.getByRole('button', { name: '+ Add Column' }).click()
    const form = dialog(page, 'Add column')
    await form.getByLabel('Name', { exact: true }).fill('Overflow Column')
    await form.getByRole('button', { name: 'Save', exact: true }).click()

    const warning = dialog(page, 'This change was NOT saved')
    await warning.waitFor()
    await warning.getByRole('button', { name: 'OK', exact: true }).click()
    expect((await readColumnList(page)).some((c) => c.name === 'Overflow Column')).toBe(false)
    expect((await storedState(page)).globalColumns.some((c) => c.name === 'Overflow Column')).toBe(false)
    await context.close()
  })

  test('deleting a company removes every month of its employees\' data from the browser, and only that company\'s', async () => {
    const seed = seedWith((s) => {
      s.periods[periodStorageKey(B, '2026-09')] = { employees: [{ id: 'b-1', values: { id: 'TST001', name: 'Other', basicSalary: '77000' } }] }
      s.periods[periodStorageKey(B, '2026-10')] = { employees: [{ id: 'b-2', values: { id: 'TST001', name: 'Other', basicSalary: '78000' } }] }
      s.periods[periodStorageKey(B, '2025-12')] = { employees: [] }
    })
    const { context, page } = await openSeeded(app, seed)
    await page.getByRole('button', { name: 'Delete TEST Co B' }).click()
    expect(await dialog(page, 'Delete company').textContent()).toContain('Delete "TEST Co B" and all of its employees and columns? This cannot be undone.')
    await confirm(page, 'Delete company', 'Delete')
    expect((await storedState(page)).companies.map((c) => c.name)).toEqual(['TEST Co A'])
    expect((await storageKeys(page)).filter((k) => k.includes(B))).toEqual([])
    expect(await storedPeriod(page, B, '2026-09')).toBeNull()
    // The other company is untouched.
    expect(await storedPeriod(page, A, '2026-09')).toEqual(seed.periods[periodStorageKey(A, '2026-09')].employees)
    expect(await ids(page)).toEqual(['TST001', 'TST002', 'TST003'])
    // Still gone after a reload.
    await page.reload()
    await page.getByRole('button', { name: 'TEST Co A', exact: true }).waitFor()
    expect((await storageKeys(page)).filter((k) => k.includes(B))).toEqual([])
    await context.close()
  })

  test('deleting the company that is on screen removes its data too', async () => {
    const { context, page } = await openSeeded(app)
    await page.getByRole('button', { name: 'Delete TEST Co A' }).click()
    await confirm(page, 'Delete company', 'Delete')
    await page.getByText('No company selected').waitFor()
    await page.waitForTimeout(300)
    expect((await storageKeys(page)).filter((k) => k.startsWith('payroll_period_'))).toEqual([])
    expect((await storedState(page)).companies.map((c) => c.name)).toEqual(['TEST Co B'])
    await context.close()
  })
})

describe('column widths', () => {
  const handle = (page, name) => page.locator('table[style*="table-layout"] thead tr').nth(1).locator('th').filter({ hasText: name }).first().locator('div[title="Drag to resize"]')

  async function dragHandle(page, name, dx) {
    const box = await handle(page, name).boundingBox()
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx / 2, y, { steps: 4 })
    await page.mouse.move(x + dx, y, { steps: 4 })
    await page.mouse.up()
  }

  test('dragging a column edge resizes it, and the width is kept after a reload', async () => {
    const { context, page } = await openSeeded(app)
    await dragHandle(page, 'Basic Salary', 80)
    expect((await storedState(page)).companies[0].columnWidths).toEqual({ basicSalary: 200 })
    await page.reload()
    await page.getByRole('button', { name: 'TEST Co A', exact: true }).waitFor()
    const width = await page.evaluate(() => document.querySelectorAll('table[style*="table-layout"] colgroup col')[3].style.width)
    expect(width).toBe('200px')
    // The other company keeps its own widths.
    expect((await storedState(page)).companies[1].columnWidths).toEqual({})
    await context.close()
  })

  test('a column cannot be dragged narrower than 64 or wider than 600', async () => {
    const { context, page } = await openSeeded(app)
    await dragHandle(page, 'Basic Salary', -300)
    expect((await storedState(page)).companies[0].columnWidths.basicSalary).toBe(64)
    await dragHandle(page, 'Basic Salary', 900)
    expect((await storedState(page)).companies[0].columnWidths.basicSalary).toBe(600)
    await context.close()
  })
})

describe('identity fields', () => {
  test('add, rename, choose the ID field, delete', async () => {
    const { context, page } = await openSeeded(app)
    await tab(page, 'Global Columns').click()

    await page.getByRole('button', { name: '+ Add Identity Field' }).click()
    const add = dialog(page, 'Add identity field')
    await add.getByLabel('Name', { exact: true }).fill('Dept')
    expect(await add.getByLabel('Key', { exact: true }).inputValue()).toBe('dept')
    await add.getByRole('button', { name: 'Save', exact: true }).click()
    await add.waitFor({ state: 'hidden' })

    const fieldRow = (name) => page.locator('section', { hasText: 'Identity Fields' }).first().locator('tbody tr').filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^${name}$`) }) })
    await fieldRow('Name').getByRole('button', { name: 'Edit', exact: true }).click()
    const edit = dialog(page, 'Edit identity field')
    await edit.getByLabel('Name', { exact: true }).fill('First Name')
    await edit.getByRole('button', { name: 'Save', exact: true }).click()
    await edit.waitFor({ state: 'hidden' })

    let state = await storedState(page)
    expect(state.identityFields.map((f) => [f.name, f.key])).toEqual([['ID', 'id'], ['First Name', 'name'], ['Surname', 'surname'], ['Dept', 'dept']])

    await tab(page, 'Employee Table').click()
    expect((await groupHeaders(page))[0]).toEqual(['Identifiers', 4])
    const row = (await readEmployeeTable(page))[0]
    expect([row.ID, row['First Name'], row.Surname, row.Dept]).toEqual(['TST001', 'Alpha', 'Tester', ''])

    // Another field becomes the ID field.
    await tab(page, 'Global Columns').click()
    await fieldRow('Surname').getByRole('button', { name: 'Set as ID field' }).click()
    expect((await storedState(page)).idFieldKey).toBe('surname')
    await tab(page, 'Employee Table').click()
    // All three test employees share the surname "Tester".
    expect(await page.getByLabel('Duplicate ID').count()).toBe(3)

    // A key already used by a column is refused.
    await tab(page, 'Global Columns').click()
    await page.getByRole('button', { name: '+ Add Identity Field' }).click()
    await add.getByLabel('Name', { exact: true }).fill('Basic Salary')
    await add.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await add.getByRole('alert').textContent()).trim()).toBe('Key "basicSalary" is already used by another field or column')
    await add.getByRole('button', { name: 'Cancel', exact: true }).click()

    // Deleting a field hides it; deleting the ID field leaves none designated.
    await fieldRow('Dept').getByRole('button', { name: 'Delete', exact: true }).click()
    await confirm(page, 'Delete identity field', 'Delete')
    await fieldRow('Surname').getByRole('button', { name: 'Delete', exact: true }).click()
    expect(await dialog(page, 'Delete identity field').textContent()).toContain('Existing employee data for this field will no longer be shown.')
    await confirm(page, 'Delete identity field', 'Delete')
    state = await storedState(page)
    expect(state.identityFields.map((f) => f.name)).toEqual(['ID', 'First Name'])
    expect(state.idFieldKey).toBeNull()

    await tab(page, 'Totals').click()
    await page.getByText('No ID field is designated').waitFor()
    // The employees' own data was not deleted with the field.
    expect((await storedPeriod(page, A, '2026-09'))[0].values.surname).toBe('Tester')
    await context.close()
  })
})

// An identity field's key can be edited too. As for columns, the change is
// confirmed first, then carried through every saved month of every company
// and the ID field designation.
describe('identity field keys', () => {
  const fieldRow = (page, name) =>
    page.locator('section', { hasText: 'Identity Fields' }).first().locator('tbody tr').filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^${name}$`) }) })
  const question = (page) => dialog(page, "Change this field's key?")

  async function editKey(page, name, key) {
    await fieldRow(page, name).getByRole('button', { name: 'Edit', exact: true }).click()
    const edit = dialog(page, 'Edit identity field')
    await edit.getByLabel('Key', { exact: true }).fill(key)
    await edit.getByRole('button', { name: 'Save', exact: true }).click()
    return edit
  }

  const seed = () =>
    seedWith((s) => {
      s.periods[periodStorageKey(A, '2026-10')] = { employees: [{ id: 'oct-1', values: { id: 'TST001', name: 'Alpha', surname: 'Tester', basicSalary: '19000' } }] }
      s.periods[periodStorageKey(B, '2026-09')] = { employees: [{ id: 'b-1', values: { id: 'TST001', name: 'Other', surname: 'Sample', basicSalary: '77000' } }] }
      s.state.companies[0].columnWidths = { id: 140, surname: 200, basicSalary: 180 }
      s.state.companies[1].columnWidths = { surname: 210 }
    })

  test('changing an identity field\'s key asks first, then moves its values in every month and company and keeps the ID field', async () => {
    const { context, page } = await openSeeded(app, seed())
    const tableBefore = await readEmployeeTable(page)
    expect(tableBefore.map((r) => [r.ID, r.Name, r.Surname])).toEqual([['TST001', 'Alpha', 'Tester'], ['TST002', 'Beta', 'Tester'], ['TST003', 'Gamma', 'Tester']])
    await tab(page, 'Global Columns').click()

    // Cancelling the question changes nothing.
    let edit = await editKey(page, 'Surname', 'familyName')
    expect(await question(page).textContent()).toContain(
      'The key changes from "surname" to "familyName". Its saved values will be moved in 3 months across 2 companies. Nothing is lost.'
    )
    await question(page).getByRole('button', { name: 'Cancel', exact: true }).click()
    await edit.getByRole('button', { name: 'Cancel', exact: true }).click()
    await edit.waitFor({ state: 'hidden' })
    expect((await storedState(page)).identityFields.map((f) => f.key)).toEqual(['id', 'name', 'surname'])
    expect((await storedPeriod(page, A, '2026-09'))[0].values.surname).toBe('Tester')

    // The Surname field, confirmed.
    edit = await editKey(page, 'Surname', 'familyName')
    await question(page).getByRole('button', { name: 'Change key', exact: true }).click()
    await edit.waitFor({ state: 'hidden' })

    // The ID field: the question says it stays the ID field.
    edit = await editKey(page, 'ID', 'employeeNo')
    expect(await question(page).textContent()).toContain(
      'The key changes from "id" to "employeeNo". Its saved values will be moved in 3 months across 2 companies. It stays the ID field. Nothing is lost.'
    )
    await question(page).getByRole('button', { name: 'Change key', exact: true }).click()
    await edit.waitFor({ state: 'hidden' })

    const state = await storedState(page)
    expect(state.identityFields.map((f) => f.key)).toEqual(['employeeNo', 'name', 'familyName'])
    expect(state.idFieldKey).toBe('employeeNo')
    expect(await fieldRow(page, 'ID').getByRole('button', { name: 'ID field ✓' }).count()).toBe(1)
    // The remembered column widths follow the keys, in every company.
    expect(state.companies[0].columnWidths).toEqual({ basicSalary: 180, familyName: 200, employeeNo: 140 })
    expect(state.companies[1].columnWidths).toEqual({ familyName: 210 })

    // Everything on screen is exactly as before.
    await tab(page, 'Employee Table').click()
    expect(await readEmployeeTable(page)).toEqual(tableBefore)

    // Every saved month of every company holds the values under the new keys only.
    for (const [company, period, expected] of [[A, '2026-09', ['TST001', 'Tester']], [A, '2026-10', ['TST001', 'Tester']], [B, '2026-09', ['TST001', 'Sample']]]) {
      const [first] = await storedPeriod(page, company, period)
      expect([first.values.employeeNo, first.values.familyName], `${company} ${period}`).toEqual(expected)
      expect('id' in first.values || 'surname' in first.values, `${company} ${period}`).toBe(false)
    }

    // The ID field still does its job: a duplicate ID is flagged.
    await addEmployee(page, { ID: 'TST001' })
    expect(await page.getByLabel('Duplicate ID').count()).toBe(2)

    // The other months and the other company show their values too.
    await goToMonth(page, /October →/)
    expect((await readEmployeeTable(page)).map((r) => [r.ID, r.Name, r.Surname])).toEqual([['TST001', 'Alpha', 'Tester']])
    await switchCompany(page, 'TEST Co B')
    expect((await readEmployeeTable(page)).map((r) => [r.ID, r.Name, r.Surname])).toEqual([['TST001', 'Other', 'Sample']])

    // And it all survives a reload.
    await page.reload()
    await page.getByRole('button', { name: 'TEST Co A', exact: true }).waitFor()
    await switchCompany(page, 'TEST Co A')
    await goToMonth(page, /← September/)
    expect((await readEmployeeTable(page)).slice(0, 3)).toEqual(tableBefore)
    expect((await storedState(page)).idFieldKey).toBe('employeeNo')
    await context.close()
  })

  test('Totals still adds an employee\'s months together after the ID field\'s key is changed', async () => {
    const { context, page } = await openSeeded(app, seed())
    await tab(page, 'Global Columns').click()
    const edit = await editKey(page, 'ID', 'employeeNo')
    await question(page).getByRole('button', { name: 'Change key', exact: true }).click()
    await edit.waitFor({ state: 'hidden' })

    await tab(page, 'Totals').click()
    await page.getByLabel('To', { exact: true }).fill('2026-10')
    await page.getByText('Summing September 2026 to October 2026').waitFor()
    const rows = await readPlainTable(page)
    // TST001 has 18,115 in September and 19,000 in October: one row, added up.
    const first = rows.filter((r) => r.ID === 'TST001')
    expect(first.length).toBe(1)
    expect(first[0]['Basic Salary']).toBe('37,115.00')
    await context.close()
  })

  test('changing only an identity field\'s name asks nothing, and a key already in use is still refused', async () => {
    const { context, page } = await openSeeded(app)
    await tab(page, 'Global Columns').click()

    await fieldRow(page, 'Surname').getByRole('button', { name: 'Edit', exact: true }).click()
    let edit = dialog(page, 'Edit identity field')
    await edit.getByLabel('Name', { exact: true }).fill('Family Name')
    await edit.getByRole('button', { name: 'Save', exact: true }).click()
    await edit.waitFor({ state: 'hidden' })
    expect(await question(page).count()).toBe(0)
    expect((await storedState(page)).identityFields[2]).toEqual({ id: 'idf-surname', name: 'Family Name', key: 'surname' })

    edit = await editKey(page, 'ID', 'basicSalary')
    expect((await edit.getByRole('alert').textContent()).trim()).toBe('Key "basicSalary" is already used by another field or column')
    expect(await question(page).count()).toBe(0)
    await context.close()
  })
})

describe('Global and Company columns', () => {
  test('a company column is seen by that company only; a global column by every company', async () => {
    const { context, page } = await openSeeded(app)
    await tab(page, 'Company Columns').click()
    await page.getByText('Company Columns — TEST Co A').waitFor()
    const saved = await addColumn(page, { name: 'Site Allowance', category: 'General' })
    expect(saved.key).toBe('siteAllowance')
    // A company formula may use global columns and its own.
    await addColumn(page, { name: 'Site Total', type: 'formula', fill: (form) => form.getByLabel('Formula expression').fill('newBasic + siteAllowance') })

    await tab(page, 'Employee Table').click()
    expect(Object.keys((await readEmployeeTable(page))[0])).toContain('Site Allowance')
    await employeeRow(page, 0).getByLabel('Site Allowance', { exact: true }).fill('250')
    expect((await readEmployeeTable(page))[0]['Site Total']).toBe('19,000.00')

    await switchCompany(page, 'TEST Co B')
    await addEmployee(page, { ID: 'TST001', 'Basic Salary': '1000' })
    const rowB = (await readEmployeeTable(page))[0]
    expect(Object.keys(rowB)).not.toContain('Site Allowance')
    expect(rowB['New Basic']).toBe('1,000.00')

    // A global formula cannot use a company column.
    await switchCompany(page, 'TEST Co A')
    await tab(page, 'Global Columns').click()
    const refused = await addColumn(page, { name: 'Bad Global', type: 'formula', fill: (form) => form.getByLabel('Formula expression').fill('siteAllowance * 2'), expectError: true })
    expect(refused.error).toBe('Unknown column reference: siteAllowance')
    // And a key used by any company's column is refused for a global column.
    const clash = await addColumn(page, { name: 'Site Allowance Copy', fill: (form) => form.getByLabel('Key', { exact: true }).fill('siteAllowance'), expectError: true })
    expect(clash.error).toBe('Key "siteAllowance" is already used by another field or column')
    await context.close()
  })

  test('Global to "This company only" and back again, with the warnings', async () => {
    const { context, page } = await openSeeded(app)
    await tab(page, 'Global Columns').click()

    let form = await openEditColumn(page, 'Status')
    await form.getByRole('button', { name: 'This company only' }).click()
    expect(await form.locator('.hint.text-warn').textContent()).toBe(
      'This will convert this column from Global to Company-specific, scoped only to TEST Co A. It will be removed from every other company (their data for it is preserved but hidden).'
    )
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    expect(await dialog(page, 'Convert to Company-specific?').textContent()).toContain(
      'This column currently applies to all 2 companies. Converting it to "This company only" will remove it from the other 1 company.'
    )
    await dialog(page, 'Convert to Company-specific?').getByRole('button', { name: 'Convert', exact: true }).click()
    await form.waitFor({ state: 'hidden' })

    let state = await storedState(page)
    expect(state.globalColumns.some((c) => c.key === 'status')).toBe(false)
    expect(state.companies[0].columns.map((c) => c.key)).toEqual(['status'])
    expect(state.companies[1].columns).toEqual([])

    // TEST Co A still shows it, with its data; TEST Co B no longer has it.
    await tab(page, 'Employee Table').click()
    expect((await readEmployeeTable(page))[0].Status).toBe('Full Time')
    await switchCompany(page, 'TEST Co B')
    await addEmployee(page, { ID: 'TST001' })
    expect(Object.keys((await readEmployeeTable(page))[0])).not.toContain('Status')

    // Back to Global.
    await switchCompany(page, 'TEST Co A')
    await tab(page, 'Company Columns').click()
    form = await openEditColumn(page, 'Status')
    await form.getByRole('button', { name: 'Global', exact: true }).click()
    expect(await form.locator('.hint.text-warn').textContent()).toBe(
      "This will make this column available to all companies. Other companies won't have any existing data for it - it'll just start empty."
    )
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await form.waitFor({ state: 'hidden' })
    state = await storedState(page)
    expect(state.globalColumns.some((c) => c.key === 'status')).toBe(true)
    expect(state.companies[0].columns).toEqual([])
    await tab(page, 'Employee Table').click()
    expect((await readEmployeeTable(page))[0].Status).toBe('Full Time')
    await context.close()
  })

  test('cancelling the "Convert" question changes nothing', async () => {
    const { context, page } = await openSeeded(app)
    await tab(page, 'Global Columns').click()
    const form = await openEditColumn(page, 'Status')
    await form.getByRole('button', { name: 'This company only' }).click()
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await dialog(page, 'Convert to Company-specific?').getByRole('button', { name: 'Cancel', exact: true }).click()
    await form.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await storedState(page)).globalColumns.some((c) => c.key === 'status')).toBe(true)
    await context.close()
  })

  test('making a company column Global is refused when its key is taken, or it uses a company-only column', async () => {
    const seed = seedWith((s) => {
      const [status] = s.state.globalColumns.filter((c) => c.key === 'status')
      s.state.globalColumns = s.state.globalColumns.filter((c) => c.key !== 'status')
      // Both companies have their own column with the key "status".
      s.state.companies[0].columns = [
        { ...status, id: 'a-status' },
        { id: 'a-site', name: 'Site Allowance', key: 'siteAllowance', type: 'input', category: 'general', valueType: 'number', decimals: 2 },
        { id: 'a-total', name: 'Site Total', key: 'siteTotal', type: 'formula', category: 'general', decimals: 2, builderMode: 'simple', formula: 'newBasic + siteAllowance' },
      ]
      s.state.companies[1].columns = [{ ...status, id: 'b-status' }]
    })
    const { context, page } = await openSeeded(app, seed)
    await tab(page, 'Company Columns').click()

    let form = await openEditColumn(page, 'Status')
    await form.getByRole('button', { name: 'Global', exact: true }).click()
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await form.getByRole('alert').textContent()).trim()).toBe(
      'Can\'t make this column Global: the key "status" is already used by another column there. Rename the key first, then try again.'
    )
    await form.getByRole('button', { name: 'Cancel', exact: true }).click()
    await form.waitFor({ state: 'hidden' })

    form = await openEditColumn(page, 'Site Total')
    await form.getByRole('button', { name: 'Global', exact: true }).click()
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await form.getByRole('alert').textContent()).trim()).toBe(
      "Can't make this column Global: it references siteAllowance, a company-specific column other companies don't have. Remove that reference first, or keep this column Company-specific."
    )
    await form.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await storedState(page)).globalColumns.some((c) => c.key === 'siteTotal')).toBe(false)
    await context.close()
  })

  // A Global column that formulas use cannot be made company-only: the form
  // lists those formulas and refuses until they are changed.
  test('making "Basic Salary" company-only is refused while formulas use it, and the formulas are listed', async () => {
    const seed = seedWith((s) => {
      s.periods[periodStorageKey(B, '2026-09')] = { employees: [{ id: 'b-1', values: { id: 'TST001', name: 'Other', basicSalary: '77000', govtIncrement: '0' } }] }
      // TEST Co B also has a formula of its own that uses Basic Salary.
      s.state.companies[1].columns = [{ id: 'b-shift', name: 'Shift Pay', key: 'shiftPay', type: 'formula', category: 'general', decimals: 2, builderMode: 'simple', formula: 'basicSalary * 0.1' }]
    })
    const { context, page } = await openSeeded(app, seed)
    const before = await storedState(page)
    await tab(page, 'Global Columns').click()
    const form = await openEditColumn(page, 'Basic Salary')
    await form.getByRole('button', { name: 'This company only' }).click()
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await form.getByRole('alert').textContent()).trim()).toBe(
      "Can't make this column Company-specific yet. These formulas use it and would stop working: New Basic (Global), Shift Pay (TEST Co B). Change those formulas first, or keep this column Global."
    )
    // It did not get as far as the "Convert" question, and nothing changed.
    expect(await dialog(page, 'Convert to Company-specific?').count()).toBe(0)
    await form.getByRole('button', { name: 'Cancel', exact: true }).click()
    await form.waitFor({ state: 'hidden' })
    expect(await storedState(page)).toEqual(before)

    await switchCompany(page, 'TEST Co B')
    const rowB = (await readEmployeeTable(page))[0]
    expect(rowB['New Basic']).toBe('77,000.00')
    expect(rowB['Shift Pay']).toBe('7,700.00')
    await context.close()
  })

  test('once no formula uses the column any more, it can be made company-only', async () => {
    const { context, page } = await openSeeded(app)
    await tab(page, 'Global Columns').click()
    // "Bonus Base" is used by "Bonus": refused.
    let form = await openEditColumn(page, 'Bonus Base')
    await form.getByRole('button', { name: 'This company only' }).click()
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await form.getByRole('alert').textContent()).trim()).toContain('These formulas use it and would stop working: Bonus (Global).')
    await form.getByRole('button', { name: 'Cancel', exact: true }).click()
    await form.waitFor({ state: 'hidden' })

    // Change the formula that used it, then try again.
    form = await openEditColumn(page, 'Bonus')
    await form.getByLabel('Formula expression').fill('allowances * 0.1')
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await form.waitFor({ state: 'hidden' })

    form = await openEditColumn(page, 'Bonus Base')
    await form.getByRole('button', { name: 'This company only' }).click()
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await dialog(page, 'Convert to Company-specific?').getByRole('button', { name: 'Convert', exact: true }).click()
    await form.waitFor({ state: 'hidden' })
    const state = await storedState(page)
    expect(state.globalColumns.some((c) => c.key === 'bonusBase')).toBe(false)
    expect(state.companies[0].columns.map((c) => c.key)).toEqual(['bonusBase'])
    await context.close()
  })

  // The Edit form lets the key be changed. The change is confirmed first,
  // then carried through every formula and every saved month.
  test('changing a column\'s key asks first, then moves its figures and updates the formulas that use it', async () => {
    const seed = seedWith((s) => {
      s.periods[periodStorageKey(A, '2026-10')] = { employees: [{ id: 'oct-1', values: { id: 'TST001', name: 'Alpha', basicSalary: '19000', govtIncrement: '100' } }] }
      s.periods[periodStorageKey(B, '2026-09')] = { employees: [{ id: 'b-1', values: { id: 'TST001', name: 'Other', basicSalary: '77000', govtIncrement: '0' } }] }
      s.state.companies[0].columnWidths = { basicSalary: 180 }
    })
    const { context, page } = await openSeeded(app, seed)
    const figuresBefore = await readEmployeeTable(page)
    await tab(page, 'Global Columns').click()

    // Cancelling the question changes nothing.
    let form = await openEditColumn(page, 'Basic Salary')
    await form.getByLabel('Key', { exact: true }).fill('basePay')
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    const question = dialog(page, "Change this column's key?")
    expect(await question.textContent()).toContain(
      'The key changes from "basicSalary" to "basePay". 1 formula that uses it will be updated: New Basic. Its saved figures will be moved in 3 months across 2 companies. Nothing is lost.'
    )
    await question.getByRole('button', { name: 'Cancel', exact: true }).click()
    await form.getByRole('button', { name: 'Cancel', exact: true }).click()
    await form.waitFor({ state: 'hidden' })
    expect((await storedState(page)).globalColumns.find((c) => c.name === 'Basic Salary').key).toBe('basicSalary')

    // Confirming it.
    form = await openEditColumn(page, 'Basic Salary')
    await form.getByLabel('Key', { exact: true }).fill('basePay')
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await question.getByRole('button', { name: 'Change key', exact: true }).click()
    await form.waitFor({ state: 'hidden' })

    const state = await storedState(page)
    expect(state.globalColumns.find((c) => c.name === 'Basic Salary').key).toBe('basePay')
    expect(state.globalColumns.find((c) => c.key === 'newBasic').formula).toBe('basePay + govtIncrement')
    expect(state.companies[0].columnWidths).toEqual({ basePay: 180 })
    expect((await readColumnList(page)).find((c) => c.name === 'New Basic').formula).toBe('Basic Salary + Govt Increment')

    // Every figure on screen is exactly as before.
    await tab(page, 'Employee Table').click()
    expect(await readEmployeeTable(page)).toEqual(figuresBefore)

    // Every saved month of every company now holds the figure under the new key.
    for (const [company, period, expected] of [[A, '2026-09', '18115'], [A, '2026-10', '19000'], [B, '2026-09', '77000']]) {
      const [first] = await storedPeriod(page, company, period)
      expect(first.values.basePay, `${company} ${period}`).toBe(expected)
      expect('basicSalary' in first.values, `${company} ${period}`).toBe(false)
    }
    await goToMonth(page, /October →/)
    expect((await readEmployeeTable(page))[0]['New Basic']).toBe('19,100.00')
    await switchCompany(page, 'TEST Co B')
    expect((await readEmployeeTable(page))[0]['New Basic']).toBe('77,000.00')

    // And it all survives a reload.
    await page.reload()
    await page.getByRole('button', { name: 'TEST Co A', exact: true }).waitFor()
    await switchCompany(page, 'TEST Co A')
    await goToMonth(page, /← September/)
    expect(await readEmployeeTable(page)).toEqual(figuresBefore)
    await context.close()
  })

  test('changing the key of a column that tiered rules and an exemption are built on keeps those builders working', async () => {
    const { context, page } = await openSeeded(app)
    const figuresBefore = await readEmployeeTable(page)
    await tab(page, 'Global Columns').click()

    for (const [name, key, formulas] of [
      ['New Basic', 'revisedBasic', '4 formulas that use it will be updated: Emoluments, CSG, NSF, CSG.'],
      ['Age 60+', 'over60', '1 formula that uses it will be updated: NSF.'],
    ]) {
      const form = await openEditColumn(page, name)
      await form.getByLabel('Key', { exact: true }).fill(key)
      await form.getByRole('button', { name: 'Save', exact: true }).click()
      const question = dialog(page, "Change this column's key?")
      expect(await question.textContent()).toContain(formulas)
      await question.getByRole('button', { name: 'Change key', exact: true }).click()
      await form.waitFor({ state: 'hidden' })
    }

    // The NSF rule still opens in its visual builder, on the renamed columns.
    const nsf = await openEditColumn(page, 'NSF')
    expect(await nsf.getByLabel('Base value column').inputValue()).toBe('revisedBasic')
    expect(await nsf.getByLabel('Checkbox column').inputValue()).toBe('over60')
    expect(await nsf.getByLabel('maximum amount').inputValue()).toBe('29710')
    // Saving it again from the builder gives the same rule.
    await nsf.getByRole('button', { name: 'Save', exact: true }).click()
    await nsf.waitFor({ state: 'hidden' })
    expect((await storedState(page)).globalColumns.find((c) => c.key === 'nsf').formula).toBe('((over60 === 1)) ? (0) : ((Math.min(revisedBasic, 29710)) * (0.01))')

    await tab(page, 'Employee Table').click()
    expect(await readEmployeeTable(page)).toEqual(figuresBefore)
    // Ticking and unticking still drives the exemption.
    await employeeRow(page, 0).getByLabel('Age 60+', { exact: true }).check()
    expect((await readEmployeeTable(page))[0].NSF).toBe('0.00')
    await context.close()
  })

  test('a key that is already in use is still refused', async () => {
    const { context, page } = await openSeeded(app)
    await tab(page, 'Global Columns').click()
    const form = await openEditColumn(page, 'Basic Salary')
    await form.getByLabel('Key', { exact: true }).fill('allowances')
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await form.getByRole('alert').textContent()).trim()).toBe('Key "allowances" is already used by another field or column')
    expect(await dialog(page, "Change this column's key?").count()).toBe(0)
    await context.close()
  })

  // What a figure in error looks like on screen: the broken column and
  // everything calculated from it say "Error", never "NaN".
  test('deleting a column warns that formulas using it will break, and they show Error', async () => {
    const { context, page } = await openSeeded(app)
    await tab(page, 'Global Columns').click()
    await page.locator('tr[draggable="true"]').filter({ has: page.locator('td:nth-child(2)', { hasText: /^Govt Increment$/ }) }).getByRole('button', { name: 'Delete', exact: true }).click()
    expect(await dialog(page, 'Delete column').textContent()).toContain('Delete column "Govt Increment"? Any formulas referencing "govtIncrement" will break.')
    await confirm(page, 'Delete column', 'Delete')
    await tab(page, 'Employee Table').click()
    const row = (await readEmployeeTable(page))[0]
    expect(row['New Basic']).toBe('Error')
    expect(Object.keys(row)).not.toContain('Govt Increment')
    // Everything calculated from New Basic says Error too - not "NaN".
    for (const label of ['Emoluments', 'CSG (Employee Contribution)', 'NSF', 'PAYE', 'Net Pay', 'Chargeable']) expect(row[label], label).toBe('Error')
    expect(JSON.stringify(row)).not.toContain('NaN')
    // Columns that do not depend on it are unaffected.
    expect(row.Bonus).toBe('100.00')

    // The breakdown gives the reason and lets the cause be opened.
    const index = Object.keys(row).indexOf('Net Pay')
    await employeeRow(page, 0).locator('td').nth(index).getByRole('button').click()
    const box = page.getByRole('dialog')
    expect(await box.textContent()).toContain('Error: "Emoluments" is in error')
    await box.getByRole('button', { name: /Emoluments/ }).click()
    expect(await box.textContent()).toContain('Error: "New Basic" is in error')
    await context.close()
  })
})

describe('reordering columns', () => {
  const order = async (page) => (await readColumnList(page)).map((c) => c.key)

  test('a column can be dragged to a new place within its category', async () => {
    const { context, page } = await openSeeded(app)
    // Tall enough that nothing scrolls while a row is being dragged.
    await page.setViewportSize({ width: 1600, height: 2400 })
    await tab(page, 'Global Columns').click()
    const row = (name, nth = 0) => page.locator('tr[draggable="true"]').filter({ has: page.locator('td:nth-child(2)', { hasText: new RegExp(`^${name}$`) }) }).nth(nth)
    const before = await order(page)
    expect(before.slice(before.indexOf('csg'), before.indexOf('csg') + 3)).toEqual(['csg', 'nsf', 'paye'])

    await row('PAYE').dragTo(row('CSG', 0))
    const after = await order(page)
    expect(after.slice(after.indexOf('paye'), after.indexOf('paye') + 3)).toEqual(['paye', 'csg', 'nsf'])

    await tab(page, 'Employee Table').click()
    const headers = Object.keys((await readEmployeeTable(page))[0])
    expect(headers.slice(headers.indexOf('PAYE'), headers.indexOf('PAYE') + 3)).toEqual(['PAYE', 'CSG (Employee Contribution)', 'NSF'])
    // The figures did not move with the headers.
    expect((await readEmployeeTable(page))[0].NSF).toBe('187.50')
    await context.close()
  })

  test('dragging onto a column of another category changes nothing', async () => {
    const { context, page } = await openSeeded(app)
    await page.setViewportSize({ width: 1600, height: 2400 })
    await tab(page, 'Global Columns').click()
    const row = (name) => page.locator('tr[draggable="true"]').filter({ has: page.locator('td:nth-child(2)', { hasText: new RegExp(`^${name}$`) }) }).first()
    const before = await order(page)
    await row('PAYE').dragTo(row('EDF'))
    expect(await order(page)).toEqual(before)
    await context.close()
  })
})
