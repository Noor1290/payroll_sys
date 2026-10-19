// Browser test 7: the app inside a stand-in for the Payroll Hub dashboard that
// keeps the column setup (its migration 0013), through the real, unmodified
// bridge. The stand-in page is served at the dashboard's own address, the app
// in its frame from this machine; the stand-in's memory lives in this test, so
// it outlasts a reload, as a database does. TEST data only.

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startApp, openSeeded, readEmployeeTable, addColumn, seededState, STATE_KEY } from './app'
import { createFakeSetupHub } from '../helpers/fakeSetupHub'

const HUB_ORIGIN = 'https://noor1290.github.io'
const STANDIN = `${HUB_ORIGIN}/payroll-hub/standin-with-payroll-setups/`

let app
beforeAll(async () => {
  app = await startApp()
})
afterAll(async () => {
  await app?.close()
})

const standinHtml = (appUrl, appOrigin) => `<!doctype html><meta charset="utf-8"><title>Stand-in dashboard (test)</title>
<iframe id="app" title="Payroll" src="${appUrl}" style="width:1500px;height:950px;border:0"></iframe>
<script>
  const frame = document.getElementById('app')
  const post = (type, payload, id) => frame.contentWindow.postMessage({ type, from: 'dashboard', to: 'payroll', version: 1, id, payload }, '${appOrigin}')
  window.addEventListener('message', async (event) => {
    if (event.source !== frame.contentWindow) return
    const { type, id, payload } = event.data
    if (type === 'ready') post('ping', {}, 'ping-' + String(Date.now()).padStart(13, '0'))
    if (type !== 'request-data' && type !== 'send-data') return
    const answer = await window.hubHandle(type, payload)
    if (answer !== null) post(type === 'request-data' ? 'response-data' : 'received', answer, id)
  })
  // What the dashboard sends by itself: whether its password gate is open.
  window.pushToApp = (payload) => post('send-data', payload, 'push-' + String(Date.now()).padStart(13, '0'))
</script>`

// Everything the payroll app keeps in the browser for itself, exactly as stored.
const payrollStorage = (frame) =>
  frame.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((key) => key === 'payroll_app_state_v1' || key.startsWith('payroll_period_'))
        .sort()
        .map((key) => [key, localStorage.getItem(key)])
    )
  )

const A = { brn: 'TEST-BRN-A', name: 'TEST Co A', address: '1 Test Street\nTestville', role: 'admin' }
const B = { brn: 'TEST-BRN-B', name: 'TEST Co B', address: '2 Test Street\nTestville', role: 'admin' }

// The app's frame keeps its own storage under the stand-in (a browser partitions a
// frame from another site), so this browser's data is put there, once per tab.
async function openStandin(hub, seed) {
  const { context, outsideRequests } = await app.newContext()
  await context.addInitScript(
    ([appOrigin, stateKey, state, periods]) => {
      if (location.origin !== appOrigin || sessionStorage.getItem('seeded')) return
      sessionStorage.setItem('seeded', '1')
      localStorage.setItem(stateKey, JSON.stringify(state))
      for (const [key, value] of Object.entries(periods)) localStorage.setItem(key, JSON.stringify(value))
    },
    [app.origin, STATE_KEY, seed.state, seed.periods]
  )
  await context.exposeFunction('hubHandle', async (type, payload) => (await hub.handle(type, payload)) ?? null)
  await context.route(STANDIN, (route) => route.fulfill({ contentType: 'text/html', body: standinHtml(app.url, app.origin) }))
  const page = await context.newPage()
  await page.goto(STANDIN)
  return { context, page, outsideRequests }
}
const appFrame = (page) => page.frames().find((f) => f.url().startsWith(app.url))

describe('inside a dashboard that keeps the column setup', () => {
  test('import once, then the months in this browser show exactly the same figures; a Global column change reaches the other company; read-only when not an admin of all', async () => {
    // This browser's data, opened on its own: TEST Co A with September's employees, TEST Co B.
    const seed = seededState()
    const alone = await openSeeded(app, seed)
    const figuresBefore = await readEmployeeTable(alone.page)
    expect(figuresBefore.length).toBeGreaterThan(0)
    await alone.context.close()

    // The same data, in the app inside the dashboard.
    const hub = createFakeSetupHub({ companies: [A, B], selectedBrn: A.brn })
    const { context, page, outsideRequests } = await openStandin(hub, seed)
    const frame = page.frameLocator('#app')
    await frame.getByText('TEST Co A has no column setup in the dashboard yet').waitFor()
    const storedBefore = await payrollStorage(appFrame(page))
    expect(Object.keys(storedBefore)).toEqual(['payroll_app_state_v1', 'payroll_period_test-co-a_2026-09'])

    // The import: a backup first, a preview that writes nothing, then each item checked.
    await frame.getByRole('button', { name: 'Import to the dashboard' }).click()
    const dialog = frame.getByRole('dialog', { name: 'Import to the dashboard' })
    const backup = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Download a backup file' }).click()
    expect((await backup).suggestedFilename()).toMatch(/^payroll-backup-\d{4}-\d{2}-\d{2}\.json$/)
    await dialog.getByRole('button', { name: 'Continue' }).click()
    await dialog.getByText('Nothing has been written to the dashboard yet.').waitFor()
    expect(hub.state.log.filter((m) => m.type === 'send-data')).toEqual([])
    await dialog.getByRole('button', { name: 'Import 2 companies' }).click()
    await dialog.getByText(/imported and checked/).nth(2).waitFor()
    expect(await dialog.getByText(/NOT imported/).count()).toBe(0)
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click()
    await frame.getByText('Column setup of TEST Co A, kept in the dashboard.', { exact: false }).waitFor()

    // Same months, same figures, to the cent; this browser's own copy untouched.
    await frame.getByRole('button', { name: 'Saved' }).or(frame.getByText('Saved', { exact: true })).first().waitFor()
    const inside = appFrame(page)
    expect(await readEmployeeTable(inside)).toEqual(figuresBefore)
    expect(await payrollStorage(inside)).toEqual(storedBefore)
    // "Clear this browser's data…" is not offered here: the columns are the dashboard's.
    await frame.getByRole('button', { name: 'Back up', exact: true }).waitFor()
    expect(await frame.getByRole('button', { name: "Clear this browser's data…" }).count()).toBe(0)

    // A Global column added here...
    await frame.getByRole('button', { name: 'Global Columns', exact: true }).click()
    await addColumn(inside, { name: 'TEST Bonus' })
    await frame.getByText('Saving…').or(frame.getByText('Saved', { exact: true })).first().waitFor()
    await expect.poll(() => hub.state.log.filter((m) => m.action === 'save-shared').length, { timeout: 5000 }).toBe(2)
    await frame.getByText('Saved', { exact: true }).waitFor()
    // ...is what the other company gets.
    hub.state.selectedBrn = B.brn
    await page.reload()
    await page.frameLocator('#app').getByText('Column setup of TEST Co B, kept in the dashboard.', { exact: false }).waitFor()
    await page.frameLocator('#app').getByRole('button', { name: 'Global Columns', exact: true }).click()
    await page.frameLocator('#app').getByRole('cell', { name: 'TEST Bonus', exact: true }).waitFor()

    // Another company attached by someone else, which this user is not an admin of: read-only.
    const [setupId] = [...hub.state.shared.keys()]
    hub.state.othersAttached.push({ brn: 'TEST-BRN-Z', role: null, shared_setup_id: setupId })
    await page.reload()
    const again = page.frameLocator('#app')
    await again.getByText('you are an admin of 2 of them', { exact: false }).waitFor()
    await again.getByRole('button', { name: 'Global Columns', exact: true }).click()
    await again.getByRole('cell', { name: 'TEST Bonus', exact: true }).waitFor()
    expect(await again.getByRole('button', { name: '+ Add Column' }).count()).toBe(0)

    expect(outsideRequests).toEqual([])
    await context.close()
  })
})

describe('inside a dashboard that keeps the months too (its migration 0014)', () => {
  test('import the months once with the same figures; the gate locks mid-entry and unlocking saves what was typed; two saves of the same month', async () => {
    const seed = seededState()
    const alone = await openSeeded(app, seed)
    const figuresBefore = await readEmployeeTable(alone.page)
    await alone.context.close()

    const hub = createFakeSetupHub({ companies: [A, B], selectedBrn: A.brn, monthsSupported: true })
    const { context, page, outsideRequests } = await openStandin(hub, seed)
    const frame = page.frameLocator('#app')
    const backUp = async (dialog) => {
      const backup = page.waitForEvent('download')
      await dialog.getByRole('button', { name: 'Download a backup file' }).click()
      await backup
      await dialog.getByRole('button', { name: 'Continue' }).click()
    }

    // The column setup first (Phase 2), then the months.
    await frame.getByRole('button', { name: 'Import to the dashboard' }).click()
    let dialog = frame.getByRole('dialog', { name: 'Import to the dashboard' })
    await backUp(dialog)
    await dialog.getByRole('button', { name: 'Import 2 companies' }).click()
    await dialog.getByText(/imported and checked/).nth(2).waitFor()
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click()
    await frame.getByText('Column setup and months of TEST Co A, kept in the dashboard.').waitFor()
    // Nothing of this browser's months is shown in place of the dashboard's.
    await frame.getByText('No employees this month').waitFor()

    await frame.getByRole('button', { name: 'Import months to the dashboard' }).click()
    dialog = frame.getByRole('dialog', { name: 'Import months to the dashboard' })
    await backUp(dialog)
    await dialog.getByText('Nothing has been written to the dashboard yet.').waitFor()
    expect(hub.state.log.filter((m) => m.type === 'send-data' && m.dataType === 'payroll-month')).toEqual([])
    await dialog.getByRole('button', { name: 'Import 1 month' }).click()
    await dialog.getByText('imported, and every figure checked.').waitFor()
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click()
    const inside = appFrame(page)
    await frame.locator('tbody input').first().waitFor()
    expect(await readEmployeeTable(inside)).toEqual(figuresBefore)
    expect(hub.state.months.get('TEST-BRN-A|2026-09').revision).toBe(1)

    // Typing, then the dashboard locks before it is saved: covered, NOT saved, nothing sent.
    const salary = frame.locator('tbody tr').first().getByLabel('Basic Salary', { exact: true })
    await salary.fill('19115')
    hub.state.unlocked = false
    await page.evaluate(() => window.pushToApp({ dataType: 'payroll-month', rows: [{ action: 'gate', unlocked: false }] }))
    await frame.getByText('Unlock the dashboard to continue').waitFor()
    await frame.getByText('NOT saved', { exact: true }).waitFor()
    expect(await frame.locator('table').count()).toBe(0)
    expect(hub.state.months.get('TEST-BRN-A|2026-09').revision).toBe(1)
    // Unlocking from the app: the dashboard asks for the password (here: answered), then it is saved.
    await frame.getByRole('region', { name: 'Locked' }).getByRole('button', { name: 'Unlock the dashboard' }).click()
    await expect.poll(() => hub.state.months.get('TEST-BRN-A|2026-09').revision, { timeout: 5000 }).toBe(2)
    expect(hub.state.months.get('TEST-BRN-A|2026-09').employees[0].values.basicSalary).toBe('19115')
    await frame.getByText('Saved', { exact: true }).waitFor()

    // Someone else saves the same month meanwhile: NOT saved, then "Save mine over it".
    hub.changeMonthElsewhere(A.brn, '2026-09', hub.state.months.get('TEST-BRN-A|2026-09').employees.slice(0, 1))
    await frame.locator('tbody tr').first().getByLabel('Basic Salary', { exact: true }).fill('20000')
    await frame.getByRole('button', { name: 'Save mine over it' }).click()
    await expect.poll(() => hub.state.months.get('TEST-BRN-A|2026-09').revision, { timeout: 5000 }).toBe(4)
    expect(hub.state.months.get('TEST-BRN-A|2026-09').employees[0].values.basicSalary).toBe('20000')

    // This browser's own copy was never written.
    expect(Object.keys(await payrollStorage(inside))).toEqual(['payroll_app_state_v1', 'payroll_period_test-co-a_2026-09'])
    expect(outsideRequests).toEqual([])
    await context.close()
  })
})
