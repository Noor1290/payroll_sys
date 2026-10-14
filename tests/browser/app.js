// Starts the real app (Vite dev server on a local port) and a browser for the
// browser tests. Every browser context is a fresh, empty profile: nothing in
// your own Chrome or Edge is read or written. Requests to anything but the
// local app are blocked and recorded, so a test can check nothing left the
// machine.
//
// TEST data only: companies "TEST Co A" / "TEST Co B", IDs starting "TST".

import fs from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { identityFields, idFieldKey, testColumns, testEmployees } from '../audit/build'

export const STATE_KEY = 'payroll_app_state_v1'
export const periodStorageKey = (companyId, period) => `payroll_period_${companyId}_${period}`

export async function startServer(port = 5190) {
  const server = await createServer({ mode: 'development', logLevel: 'silent', server: { port, strictPort: false } })
  await server.listen()
  const url = server.resolvedUrls.local[0]
  return { server, url, origin: new URL(url).origin }
}

export async function startApp() {
  const { server, url, origin } = await startServer()
  // A page served from the dashboard's address may frame the app on this machine
  // (tests/browser/dashboard.e2e.js); Chrome otherwise refuses it as a public page
  // reaching the local network.
  const browser = await chromium.launch({ args: ['--disable-features=LocalNetworkAccessChecks'] })

  async function newContext() {
    const context = await browser.newContext({
      locale: 'en-US',
      timezoneId: 'UTC',
      viewport: { width: 1600, height: 1000 },
      acceptDownloads: true,
    })
    context.setDefaultTimeout(15_000)
    const outsideRequests = []
    await context.route('**/*', (route) => {
      const requestUrl = route.request().url()
      if (requestUrl.startsWith('http://localhost:') || requestUrl.startsWith('http://127.0.0.1:') || requestUrl.startsWith('data:') || requestUrl.startsWith('blob:')) {
        return route.continue()
      }
      outsideRequests.push(requestUrl)
      return route.abort()
    })
    return { context, outsideRequests }
  }

  // The dev server prepares its dependencies on first use and can reload the
  // page once while doing so; get that out of the way before any test.
  {
    const { context } = await newContext()
    const page = await context.newPage()
    await page.goto(url)
    await page.getByText('No companies yet.').waitFor({ timeout: 120_000 })
    await page.waitForTimeout(1500)
    await context.close()
  }

  return {
    url,
    origin,
    browser,
    newContext,
    async close() {
      await browser.close()
      await server.close()
    },
  }
}

// ---- TEST data ---------------------------------------------------------

export function testCompany(letter, extra = {}) {
  return {
    id: `test-co-${letter.toLowerCase()}`,
    name: `TEST Co ${letter}`,
    columns: [],
    columnWidths: {},
    viewYear: 2026,
    viewMonth: 9,
    details: { address: `${letter === 'A' ? 1 : 2} Test Street\nTestville`, brn: `TEST-BRN-${letter}`, customFields: [] },
    ...extra,
  }
}

// Two test companies sharing the global test columns. TEST Co A has three
// employees in September 2026; everything else is empty.
export function seededState() {
  const a = testCompany('A', {
    details: {
      address: '1 Test Street\nTestville',
      brn: 'TEST-BRN-A',
      customFields: [
        { id: 'cf-vat', label: 'VAT No', value: 'TEST-VAT-1' },
        // Same label as the "Surname" identity field, so an export has to tell them apart.
        { id: 'cf-surname', label: 'Surname', value: 'TEST trading name' },
      ],
    },
  })
  const b = testCompany('B')
  return {
    state: { identityFields, idFieldKey, globalColumns: testColumns(), companies: [a, b], activeCompanyId: a.id },
    periods: { [periodStorageKey(a.id, '2026-09')]: { employees: testEmployees() } },
  }
}

// Opens the app in a fresh profile with the given saved data already in place.
export async function openSeeded(app, seed = seededState(), { initScript } = {}) {
  const { context, outsideRequests } = await app.newContext()
  const page = await context.newPage()
  if (initScript) await page.addInitScript(initScript)
  await page.goto(app.url)
  await page.getByText('No companies yet.').waitFor()
  await page.evaluate(
    ([stateKey, state, periods]) => {
      localStorage.clear()
      localStorage.setItem(stateKey, JSON.stringify(state))
      for (const [key, value] of Object.entries(periods)) localStorage.setItem(key, JSON.stringify(value))
    },
    [STATE_KEY, seed.state, seed.periods]
  )
  await page.reload()
  await page.getByRole('button', { name: seed.state.companies[0].name, exact: true }).waitFor()
  return { context, page, outsideRequests }
}

export async function openEmpty(app) {
  const { context, outsideRequests } = await app.newContext()
  const page = await context.newPage()
  await page.goto(app.url)
  await page.getByText('No companies yet.').waitFor()
  return { context, page, outsideRequests }
}

// ---- reading what is on screen and what is stored ----------------------

export function storedState(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY)
}

// The app writes a moment after a change; give it that moment.
export async function storedPeriod(page, companyId, period) {
  await page.waitForTimeout(150)
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw).employees
  }, periodStorageKey(companyId, period))
}

export function storageKeys(page) {
  return page.evaluate(() => Object.keys(localStorage).sort())
}

// The Employee Table as an array of rows, each { [column label]: text }.
// Two columns with the same name are told apart the way the app does it: by
// the header's tooltip, e.g. "CSG (Employer Contribution)".
export function readEmployeeTable(page) {
  return page.evaluate(() => {
    const table = document.querySelector('table[style*="table-layout"]')
    if (!table) return []
    const headerCells = [...table.querySelectorAll('thead tr:nth-child(2) th')]
    const labels = headerCells.map((th) => th.getAttribute('title') || th.querySelector('span')?.textContent.trim() || th.textContent.trim())
    return [...table.querySelectorAll('tbody tr')]
      .filter((tr) => tr.querySelector('td input, td button.cursor-pointer'))
      .map((tr) => {
        const row = {}
        ;[...tr.children].forEach((td, i) => {
          const label = labels[i]
          if (label === 'Actions') return
          const box = td.querySelector('input[type="checkbox"]')
          const input = td.querySelector('input')
          const figure = td.querySelector('button span.num')
          if (box) row[label] = box.checked
          else if (input) row[label] = input.value
          else if (figure) row[label] = figure.textContent.trim()
          else row[label] = td.textContent.trim()
        })
        return row
      })
  })
}

// A read-only table (Totals) as an array of rows keyed by header text.
export function readPlainTable(page, tableLocator = 'table') {
  return page.evaluate((selector) => {
    const table = document.querySelector(selector)
    if (!table) return []
    const labels = [...table.querySelectorAll('thead tr:nth-child(2) th')].map((th) => th.getAttribute('title') || th.querySelector('span')?.firstChild?.textContent.trim() || th.textContent.trim())
    return [...table.querySelectorAll('tbody tr')].map((tr) => Object.fromEntries([...tr.children].map((td, i) => [labels[i], td.textContent.trim()])))
  }, tableLocator)
}

export function groupHeaders(page) {
  return page.evaluate(() => {
    const table = document.querySelector('table[style*="table-layout"]') ?? document.querySelector('table')
    return [...table.querySelectorAll('thead tr:first-child th')].map((th) => [th.textContent.trim(), th.colSpan]).filter(([text]) => text)
  })
}

// ---- driving the app ---------------------------------------------------

export const tab = (page, name) => page.getByRole('button', { name, exact: true })
export const dialog = (page, name) => page.getByRole('dialog', { name })
export const employeeRow = (page, index) => page.locator('table[style*="table-layout"] tbody tr').nth(index)

// Replaces a cell's content the way a person does: click in, select all, type.
export async function setCell(page, rowIndex, label, value) {
  const field = employeeRow(page, rowIndex).getByLabel(label, { exact: true })
  await field.click()
  await field.press('Control+A')
  await field.pressSequentially(String(value))
  await page.locator('body').click({ position: { x: 5, y: 5 } })
}

// Switching company or month loads that month a moment after the click.
export async function switchCompany(page, name) {
  await page.getByRole('button', { name, exact: true }).click()
  await page.waitForTimeout(250)
}

export async function goToMonth(page, buttonName) {
  await page.getByRole('button', { name: buttonName }).click()
  await page.waitForTimeout(250)
}

export async function addEmployee(page, values) {
  const before = await page.locator('table[style*="table-layout"] tbody tr').filter({ has: page.locator('td input') }).count()
  await page.getByRole('button', { name: '+ Add Employee' }).click()
  const row = employeeRow(page, before)
  for (const [label, value] of Object.entries(values)) {
    const field = row.getByLabel(label, { exact: true })
    if (typeof value === 'boolean') await field.setChecked(value)
    else await field.fill(String(value))
  }
  // Leave the last cell, so a number shows rounded as it does at rest.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  return row
}

// Fills in and saves the Add column form. `fill` receives the dialog for
// anything specific to the kind of column.
export async function addColumn(page, { name, category, type = 'input', valueType, decimals, fill, expectError }) {
  await page.getByRole('button', { name: '+ Add Column' }).click()
  const form = dialog(page, 'Add column')
  await form.getByLabel('Name', { exact: true }).fill(name)
  if (category) await form.getByLabel('Category', { exact: true }).selectOption({ label: category })
  if (type === 'formula') await form.getByRole('button', { name: 'Formula', exact: true }).click()
  if (valueType) await form.getByRole('button', { name: valueType, exact: true }).click()
  if (decimals !== undefined) await form.getByLabel('Decimal places', { exact: true }).selectOption(String(decimals))
  if (fill) await fill(form)
  const key = await form.getByLabel('Key', { exact: true }).inputValue()
  await form.getByRole('button', { name: 'Save', exact: true }).click()
  if (expectError) {
    const message = await form.getByRole('alert').textContent()
    await form.getByRole('button', { name: 'Cancel', exact: true }).click()
    await form.waitFor({ state: 'hidden' })
    return { key, error: message.trim() }
  }
  await form.waitFor({ state: 'hidden' })
  return { key }
}

export async function openEditColumn(page, columnName, nth = 0) {
  const row = page.locator('tr[draggable="true"]').filter({ has: page.locator('td:nth-child(2)', { hasText: new RegExp(`^${columnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).nth(nth)
  await row.getByRole('button', { name: 'Edit', exact: true }).click()
  const form = dialog(page, 'Edit column')
  await form.waitFor()
  return form
}

// What the column list shows for each column: [name, key, type, formula].
export function readColumnList(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('tr[draggable="true"]')].map((tr) => {
      const cells = [...tr.children].map((td) => td.textContent.trim())
      return { name: cells[1], key: cells[2], type: cells[3], formula: cells[4] }
    })
  )
}

export async function confirm(page, title, buttonName) {
  const box = dialog(page, title)
  await box.getByRole('button', { name: buttonName, exact: true }).click()
  await box.waitFor({ state: 'hidden' })
}

// Clicks something that starts a download and returns the file.
export async function download(page, trigger) {
  const started = page.waitForEvent('download')
  await trigger()
  const file = await started
  return { name: file.suggestedFilename(), bytes: fs.readFileSync(await file.path()) }
}

export async function openExportMenu(page, item) {
  await page.getByRole('button', { name: 'More export options' }).click()
  await page.getByRole('button', { name: new RegExp(`^${item.replace(/[()]/g, '\\$&')}`) }).click()
}
