// Browser test 9: "Several companies…" inside a stand-in for the Payroll Hub
// dashboard that keeps the months (tests/helpers/fakeSetupHub.js), through the
// real, unmodified bridge: one Excel file for several companies, downloaded by
// the real browser, then read back. TEST data only (fake companies).
//
// With SEVERAL_SHOTS set to a folder, it also saves its screenshots there, the
// downloaded file as "example.xlsx", and a picture of each of its sheets.

import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { startApp } from './app'
import { createFakeSetupHub } from '../helpers/fakeSetupHub'
import { company, globalColumns, identityFields, idFieldKey, octoberEmployees } from '../safetyNet/fixture'

const HUB_ORIGIN = 'https://noor1290.github.io'
const STANDIN = `${HUB_ORIGIN}/payroll-hub/standin-with-several-companies/`
const SHOTS = process.env.SEVERAL_SHOTS || null
const SHARED_ID = '30000000-0000-4000-8000-000000000001'

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
</script>`

// Four fake companies where the user is an admin (two with the same long name, one with no
// October) and one where the user only views. A Date identity field, so the file has dates.
const LONG = 'Fake Trading Company of the Indian Ocean Ltd'
const companies = [
  { brn: 'C00000001', name: 'Fake Co Ltd', address: '1 Test Street\nPort Louis', role: 'admin' },
  { brn: 'C00000002', name: LONG, address: '2 Test Street', role: 'admin' },
  { brn: 'C00000003', name: LONG, address: '3 Test Street', role: 'admin' },
  { brn: 'C00000004', name: 'Empty Fake Ltd', address: null, role: 'admin' },
  { brn: 'C00000005', name: 'Viewer Fake Ltd', address: null, role: 'member' },
]
const dated = [...identityFields, { id: 'idf-date', name: 'Date of Employment', key: 'dateOfEmployment', valueType: 'date' }]
const withDates = (employees) => employees.map((e, i) => ({ ...e, values: { ...e.values, dateOfEmployment: `20${15 + i}-0${(i % 9) + 1}-01` } }))
const own = { columns: company.columns, customFields: company.details.customFields }

function hubSeed() {
  return {
    companies,
    selectedBrn: 'C00000001',
    shared: [{ id: SHARED_ID, name: 'Shared column setup', body: JSON.parse(JSON.stringify({ identityFields: dated, idFieldKey, globalColumns })), revision: 1 }],
    setups: Object.fromEntries(companies.map((c) => [c.brn, { shared_setup_id: SHARED_ID, body: JSON.parse(JSON.stringify(own)), revision: 1 }])),
    monthsSupported: true,
    months: {
      'C00000001|2026-10': { employees: withDates(octoberEmployees) },
      'C00000002|2026-10': { employees: withDates(octoberEmployees.slice(0, 3)) },
      'C00000003|2026-10': { employees: withDates(octoberEmployees.slice(3)) },
      'C00000005|2026-10': { employees: withDates(octoberEmployees) },
    },
  }
}

async function openStandin(hub) {
  const { context, outsideRequests } = await app.newContext()
  await context.addInitScript(
    ([appOrigin]) => {
      if (location.origin !== appOrigin || sessionStorage.getItem('seeded')) return
      sessionStorage.setItem('seeded', '1')
      localStorage.setItem('payroll_dashboard_prefs_v1', JSON.stringify({ C00000001: { columnWidths: {}, viewYear: 2026, viewMonth: 10 } }))
    },
    [app.origin]
  )
  await context.exposeFunction('hubHandle', async (type, payload) => (await hub.handle(type, payload)) ?? null)
  await context.route(STANDIN, (route) => route.fulfill({ contentType: 'text/html', body: standinHtml(app.url, app.origin) }))
  const page = await context.newPage()
  await page.goto(STANDIN)
  return { context, page, outsideRequests }
}
const appFrame = (page) => page.frames().find((f) => f.url().startsWith(app.url))

// A sheet drawn as a plain table, for a picture of the file (the file itself is what counts).
async function pictureOfSheet(context, book, name, file) {
  const html = XLSX.utils.sheet_to_html(book.Sheets[name], { header: '', footer: '' })
  const page = await context.newPage()
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>
      body{font:13px "Book Antiqua",Georgia,serif;margin:16px;background:#fff;color:#111}
      h1{font:600 14px system-ui,sans-serif;margin:0 0 8px}
      table{border-collapse:collapse} td{border:1px solid #bbb;padding:3px 6px;white-space:nowrap}
      td:only-child{white-space:normal;max-width:900px}
    </style><h1>Sheet "${name}"</h1>${html}`
  )
  await page.screenshot({ path: file, fullPage: true })
  await page.close()
}

test('several companies: one question, one file with a sheet per company with data, read back', async () => {
  const hub = createFakeSetupHub(hubSeed())
  const { context, page, outsideRequests } = await openStandin(hub)
  await page.waitForFunction(() => document.querySelector('iframe'))
  await expect.poll(() => Boolean(appFrame(page))).toBe(true)
  const frame = appFrame(page)
  await frame.getByText('kept in the dashboard').first().waitFor()
  await frame.locator('tbody input').first().waitFor()
  if (SHOTS) await page.locator('#app').screenshot({ path: path.join(SHOTS, '1-company-list-button.png') })

  await frame.getByRole('button', { name: 'Several companies…' }).click()
  const dialog = frame.getByRole('dialog', { name: 'Several companies' })
  await dialog.getByText('Companies where you are an admin').waitFor()
  // Only the admin companies; the one the user only views is not offered.
  await expect.poll(() => dialog.locator('li').count()).toBe(4)
  expect(await dialog.textContent()).not.toContain('Viewer Fake Ltd')
  if (SHOTS) await page.locator('#app').screenshot({ path: path.join(SHOTS, '2-choose-nothing-yet.png') })

  await dialog.getByRole('button', { name: 'Select all' }).click()
  if (SHOTS) await page.locator('#app').screenshot({ path: path.join(SHOTS, '3-choose-all.png') })
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export 4 companies' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('Payroll 2026-10 (4 companies).xlsx')
  await dialog.getByText('Downloaded Payroll 2026-10 (4 companies).xlsx').waitFor()
  if (SHOTS) await page.locator('#app').screenshot({ path: path.join(SHOTS, '4-downloaded.png') })

  // One question, naming the month and the four companies; then one load each.
  expect(hub.state.batchAsked).toEqual([{ from: '2026-10', to: '2026-10', companies: ['C00000001', 'C00000004', 'C00000002', 'C00000003'] }])
  expect(hub.state.log.filter((m) => m.dataType === 'payroll-batch' && m.action === 'load').map((m) => m.company_brn)).toEqual([
    'C00000001',
    'C00000004',
    'C00000002',
    'C00000003',
  ])

  const file = await download.path()
  const buffer = fs.readFileSync(file)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  expect(wb.worksheets.map((ws) => [ws.name, ws.state])).toEqual([
    ['Read me', 'visible'],
    ['Companies', 'visible'],
    ['Fake Co Ltd', 'visible'],
    ['Fake Trading Company of the Ind', 'visible'],
    ['Fake Trading Company of the (2)', 'visible'],
    ['_companies', 'veryHidden'],
  ])
  const companiesSheet = wb.getWorksheet('Companies')
  expect(companiesSheet.getRow(3).values.slice(1)).toEqual(['', 'Empty Fake Ltd', 'C00000004', 'October 2026', 'No data for this month'])
  const sheet = wb.getWorksheet('Fake Co Ltd')
  expect(sheet.getCell(2, 1).value).toBe('BRN: C00000001   •   October 2026')
  // The Date of Employment column (the 4th) holds real dates.
  expect(sheet.getCell(7, 4).value).toBeInstanceOf(Date)
  expect(sheet.getCell(7, 4).numFmt).toBe('dd/mm/yyyy')
  expect(sheet.getCell(7 + octoberEmployees.length, 1).value).toBe('TOTAL')
  // Nothing left the machine.
  expect(outsideRequests.filter((u) => !u.startsWith(STANDIN))).toEqual([])

  if (SHOTS) {
    fs.copyFileSync(file, path.join(SHOTS, 'example.xlsx'))
    const book = XLSX.read(buffer, { type: 'buffer', cellDates: true, dateNF: 'dd/mm/yyyy' })
    await pictureOfSheet(context, book, 'Read me', path.join(SHOTS, '5-file-read-me.png'))
    await pictureOfSheet(context, book, 'Companies', path.join(SHOTS, '6-file-companies.png'))
    await pictureOfSheet(context, book, 'Fake Co Ltd', path.join(SHOTS, '7-file-company-sheet.png'))
  }
  await context.close()
})

// Twelve months, July 2026 to June 2027, of the same fake companies: Fake Co Ltd has every month
// but January 2027 (a leaver from April), the first long-named company July to December only, the
// second only March 2027, and Empty Fake Ltd none.
const YEAR = ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06']
const monthOf = (period, i, people) =>
  withDates(people).map((e) => ({
    ...e,
    id: `${e.id}-${period}`,
    values: { ...e.values, basicSalary: e.values.basicSalary && !Number.isNaN(Number(e.values.basicSalary)) ? String(Number(e.values.basicSalary) + i * 250) : e.values.basicSalary },
  }))
function yearSeed() {
  const months = {}
  YEAR.forEach((period, i) => {
    if (period !== '2027-01') months[`C00000001|${period}`] = { employees: monthOf(period, i, period >= '2027-04' ? octoberEmployees.slice(0, 5) : octoberEmployees) }
    if (period <= '2026-12') months[`C00000002|${period}`] = { employees: monthOf(period, i, octoberEmployees.slice(0, 3)) }
    if (period === '2027-03') months[`C00000003|${period}`] = { employees: monthOf(period, i, octoberEmployees.slice(3)) }
    months[`C00000005|${period}`] = { employees: monthOf(period, i, octoberEmployees) }
  })
  return { ...hubSeed(), months }
}

test('several companies over twelve months: one question for the range, a sheet per company with its months, subtotals and a TOTAL', async () => {
  const hub = createFakeSetupHub(yearSeed())
  const { context, page } = await openStandin(hub)
  await expect.poll(() => Boolean(appFrame(page))).toBe(true)
  const frame = appFrame(page)
  await frame.locator('tbody input').first().waitFor()
  await frame.getByRole('button', { name: 'Several companies…' }).click()
  const dialog = frame.getByRole('dialog', { name: 'Several companies' })
  await dialog.getByText('Companies where you are an admin').waitFor()
  await dialog.getByLabel('From').fill('2026-07')
  await dialog.getByLabel('To').fill('2027-06')
  await dialog.getByRole('button', { name: 'Select all' }).click()
  await dialog.getByText('12 months').waitFor()
  if (SHOTS) await page.locator('#app').screenshot({ path: path.join(SHOTS, 'range-1-choose.png') })
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export 4 companies' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('Payroll 2026-07 to 2027-06 (4 companies).xlsx')
  await dialog.getByText('Downloaded Payroll 2026-07 to 2027-06 (4 companies).xlsx').waitFor()
  if (SHOTS) await page.locator('#app').screenshot({ path: path.join(SHOTS, 'range-2-downloaded.png') })
  expect(hub.state.batchAsked).toEqual([{ from: '2026-07', to: '2027-06', companies: ['C00000001', 'C00000004', 'C00000002', 'C00000003'] }])

  const file = await download.path()
  const buffer = fs.readFileSync(file)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  expect(wb.worksheets.map((ws) => ws.name)).toEqual([
    'Read me',
    'Companies',
    'Fake Co Ltd',
    'Fake Trading Company of the Ind',
    'Fake Trading Company of the (2)',
    '_companies',
  ])
  const companiesSheet = wb.getWorksheet('Companies')
  expect(companiesSheet.getRow(2).values.slice(1)).toEqual(['Fake Co Ltd', 'Fake Co Ltd', 'C00000001', 6, 6, 6, 6, 6, 6, 'No data', 6, 6, 5, 5, 5])
  expect(companiesSheet.getRow(3).values.slice(1)).toEqual(['', 'Empty Fake Ltd', 'C00000004', ...YEAR.map(() => 'No data')])
  const sheet = wb.getWorksheet('Fake Co Ltd')
  expect(sheet.getCell(6, 1).value).toBe('Month')
  expect(sheet.getCell(7, 1).value).toEqual(new Date('2026-07-01T00:00:00.000Z'))
  expect(sheet.getCell(7 + 6, 1).value).toBe('Subtotal July 2026')
  // 11 months of 6, 6, ... 5 employees, each with its subtotal, then the TOTAL.
  const rows = 6 * 8 + 5 * 3 + 11
  expect(sheet.getCell(7 + rows, 1).value).toBe('TOTAL')

  if (SHOTS) {
    fs.copyFileSync(file, path.join(SHOTS, 'example-12-months.xlsx'))
    const book = XLSX.read(buffer, { type: 'buffer', cellDates: true, dateNF: 'dd/mm/yyyy' })
    await pictureOfSheet(context, book, 'Read me', path.join(SHOTS, 'range-3-file-read-me.png'))
    await pictureOfSheet(context, book, 'Companies', path.join(SHOTS, 'range-4-file-companies.png'))
    await pictureOfSheet(context, book, 'Fake Trading Company of the Ind', path.join(SHOTS, 'range-5-file-company-sheet.png'))
  }
  await context.close()
})
