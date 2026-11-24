// Hotfix 4 (24 November 2026), in the real app: at every width, no button lies outside its card,
// panel or dialog, on the company screen, its tabs and the dialogs it opens. TEST data only.

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startApp, openSeeded, tab } from './app'
import { buttonsOutside, WIDTHS } from './overflow'

let app
beforeAll(async () => {
  app = await startApp()
})
afterAll(async () => {
  await app?.close()
})

async function sweep(page, where) {
  const found = []
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1000 })
    await page.waitForTimeout(150)
    for (const line of await page.evaluate(buttonsOutside)) found.push(`${where}, ${width} px: ${line}`)
  }
  await page.setViewportSize({ width: 1600, height: 1000 })
  return found
}

describe('Buttons stay inside their card or window (hotfix 4)', () => {
  test('the company screen, each tab, and the dialogs opened from it', async () => {
    const { context, page } = await openSeeded(app)
    // The sweep sees the screen's buttons (a guard against a check that looks at nothing).
    expect(await page.locator('.card button, .panel button').count()).toBeGreaterThan(5)
    const found = await sweep(page, 'Company screen')
    for (const name of ['Global Columns', 'Company Columns', 'Totals', 'Employee Table']) {
      await tab(page, name).click()
      found.push(...(await sweep(page, `Tab ${name}`)))
    }
    for (const name of ['Copy this month to…', /^Automatic copy/, 'TEST Co A details', "Clear this browser's data…", '+ New Company']) {
      await page.getByRole('button', { name, exact: typeof name === 'string' }).first().click()
      const open = page.getByRole('dialog')
      await open.first().waitFor()
      found.push(...(await sweep(page, `Dialog ${await open.first().getAttribute('aria-labelledby') ? (await page.locator('#' + (await open.first().getAttribute('aria-labelledby'))).textContent()) : name}`)))
      await page.keyboard.press('Escape')
      await open.first().waitFor({ state: 'detached' }).catch(() => {})
    }
    expect(found).toEqual([])
    await context.close()
  })
})
