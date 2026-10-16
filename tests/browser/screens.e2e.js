// Backlog batch E, in the real app: "tick all" on a checkbox column (audit
// M13), the Totals warning when two employees share an ID in one month (R7),
// the Export Preview's title lines on a wide sheet (known issue 5), and
// renaming a company in the narrow-width drawer (known issue 6). TEST data only.

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startApp, openSeeded, seededState, storedPeriod, readEmployeeTable, tab, dialog, periodStorageKey } from './app'
import { testEmployees } from '../audit/build'

let app
beforeAll(async () => {
  app = await startApp()
})
afterAll(async () => {
  await app?.close()
})

const A = 'test-co-a'
const ageBoxes = (page) => page.locator('table[style*="table-layout"] tbody').getByLabel('Age 60+', { exact: true })

describe('"Tick all" on a checkbox column (audit M13)', () => {
  test('the header box shows part-ticked, ticks everyone, then unticks everyone; each change is saved and recalculated', async () => {
    const { context, page } = await openSeeded(app)
    const header = page.getByRole('checkbox', { name: 'Tick all: Age 60+' })
    expect(await header.getAttribute('title')).toBe('Tick or untick Age 60+ for every employee this month')
    // The fake month has one employee of three ticked.
    expect(await header.evaluate((box) => [box.checked, box.indeterminate])).toEqual([false, true])

    await header.click()
    expect(await ageBoxes(page).evaluateAll((boxes) => boxes.map((b) => b.checked))).toEqual([true, true, true])
    expect(await header.evaluate((box) => [box.checked, box.indeterminate])).toEqual([true, false])
    expect((await readEmployeeTable(page)).map((row) => row.NSF)).toEqual(['0.00', '0.00', '0.00'])
    await expect.poll(async () => (await storedPeriod(page, A, '2026-09')).map((e) => e.values.age60)).toEqual([true, true, true])

    await header.click()
    expect(await ageBoxes(page).evaluateAll((boxes) => boxes.map((b) => b.checked))).toEqual([false, false, false])
    await expect.poll(async () => (await storedPeriod(page, A, '2026-09')).map((e) => e.values.age60)).toEqual([false, false, false])
    await context.close()
  })
})

describe('Totals with two employees sharing an ID in one month (audit R7)', () => {
  test('the row adds them together, as before, and a warning says so', async () => {
    const seed = seededState()
    const employees = testEmployees()
    employees[2].values.id = employees[0].values.id
    seed.periods[periodStorageKey(A, '2026-09')] = { employees }
    const { context, page } = await openSeeded(app, seed)
    await tab(page, 'Totals').click()
    const warning = page.getByRole('alert').filter({ hasText: 'employees have the ID' })
    expect((await warning.textContent()).replace(/\s+/g, ' ').trim()).toBe(
      `In September 2026, 2 employees have the ID "${employees[0].values.id}". Their figures are added together in one row here. Give each employee their own ID in the Employee Table.`
    )
    await context.close()
  })

  test('with every ID different there is no warning', async () => {
    const { context, page } = await openSeeded(app)
    await tab(page, 'Totals').click()
    await page.getByRole('button', { name: 'Export to Excel', exact: true }).waitFor()
    expect(await page.getByText('employees have the ID').count()).toBe(0)
    await context.close()
  })
})

describe('the Export Preview on a sheet wider than the dialog (known issue 5)', () => {
  test('the title lines are in view at the start, and stay in view when the sheet is scrolled to its far right', async () => {
    const { context, page } = await openSeeded(app)
    await page.setViewportSize({ width: 1000, height: 900 })
    await page.getByRole('button', { name: 'Export to Excel', exact: true }).click()
    const preview = dialog(page, 'Export Preview')
    await preview.waitFor()
    const title = preview.getByTestId('export-preview-title')
    const scroller = title.locator('xpath=../..')
    const inView = () =>
      title.evaluate((node) => {
        const box = node.getBoundingClientRect()
        const view = node.parentElement.parentElement.getBoundingClientRect()
        const name = node.firstElementChild.getBoundingClientRect()
        return name.left >= view.left - 0.5 && name.right <= view.right + 0.5 && box.width <= view.width
      })
    // The sheet really is wider than the dialog.
    expect(await scroller.evaluate((node) => node.scrollWidth > node.clientWidth + 100)).toBe(true)
    expect(await inView()).toBe(true)
    expect(await title.textContent()).toContain('TEST Co A')
    await scroller.evaluate((node) => {
      node.scrollLeft = node.scrollWidth
    })
    expect(await inView()).toBe(true)
    await context.close()
  })
})

describe('renaming a company at narrow widths (known issue 6)', () => {
  test('in the drawer, double-clicking the selected company opens its rename box there, and the drawer stays open', async () => {
    const { context, page } = await openSeeded(app)
    await page.setViewportSize({ width: 640, height: 900 })
    await page.getByRole('button', { name: 'Open company list' }).click()
    const drawerClose = page.getByRole('button', { name: 'Close company list' })
    await drawerClose.waitFor()
    await page.getByRole('button', { name: 'TEST Co A', exact: true }).dblclick()
    const box = page.locator('aside input[type="text"], aside input:not([type])').first()
    await box.waitFor()
    expect(await box.inputValue()).toBe('TEST Co A')
    expect(await box.isVisible()).toBe(true)
    expect(await drawerClose.isVisible()).toBe(true)
    await context.close()
  })

  test('choosing another company still closes the drawer', async () => {
    const { context, page } = await openSeeded(app)
    await page.setViewportSize({ width: 640, height: 900 })
    await page.getByRole('button', { name: 'Open company list' }).click()
    await page.getByRole('button', { name: 'TEST Co B', exact: true }).click()
    await page.getByRole('button', { name: 'Close company list' }).waitFor({ state: 'hidden' })
    await context.close()
  })
})
