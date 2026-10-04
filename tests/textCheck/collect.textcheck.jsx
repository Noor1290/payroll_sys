// @vitest-environment jsdom

// Text check, collector. Renders the whole app with FAKE data, walks every
// screen and dialog, and writes down all the text a user can see or hover:
// text on screen, tooltips (title), screen-reader labels (aria-label),
// placeholders and browser alert() messages.
//
// Run through scripts/text-check.mjs, which points this at two versions of
// src/ (a base commit and the working tree) and compares the results.
//   TEXT_CHECK_SRC  absolute path of the src/ folder to load
//   TEXT_CHECK_OUT  file to write the collected text to

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import * as XLSX from 'xlsx'
import { beforeAll, expect, test, vi } from 'vitest'
import { identityFields, idFieldKey, globalColumns, company, effectiveColumns, octoberEmployees, septemberEmployees, octoberGrid } from '../safetyNet/fixture'
import { buildExportPlan, buildWorkbookBuffer } from '../../src/lib/excelExport'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SRC = process.env.TEXT_CHECK_SRC ?? path.resolve(import.meta.dirname, '../../src')
const OUT = process.env.TEXT_CHECK_OUT
const load = (file) => import(/* @vite-ignore */ pathToFileURL(path.join(SRC, file)).href)

const collected = {}
const alerts = []
let App
let root
let container

beforeAll(async () => {
  window.alert = (message) => alerts.push(String(message))
  await load('payrollHubBridge.js')
  App = (await load('App.jsx')).default
})

// ---- what counts as "visible text" ----
function squash(s) {
  return s.replace(/\s+/g, ' ').trim()
}

function snapshot() {
  const out = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  for (let el = walker.currentNode; el; el = walker.nextNode()) {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue
    // Text written directly inside this element (pieces joined, so "Summing " + "May" is one string).
    const own = squash([...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(''))
    if (own) out.push(`text: ${own}`)
    for (const attr of ['title', 'aria-label', 'placeholder', 'alt']) {
      const value = el.getAttribute?.(attr)
      if (value && squash(value)) out.push(`${attr}: ${squash(value)}`)
    }
  }
  for (const a of alerts.splice(0)) out.push(`alert/error message: ${squash(a)}`)
  return out
}

// Form controls with no accessible name (aria-label, aria-labelledby, title,
// a wrapping <label>, or a <label for>). Placeholders and option text don't count.
const unlabelled = new Set()
function sweepUnlabelled(step) {
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (el.type === 'file' || el.type === 'hidden') continue
    const named =
      el.getAttribute('aria-label') ||
      el.getAttribute('aria-labelledby') ||
      el.getAttribute('title') ||
      el.closest('label') ||
      (el.id && document.querySelector(`label[for="${el.id}"]`))
    if (!named) unlabelled.add(`${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ''} placeholder="${el.getAttribute('placeholder') ?? ''}" (first seen: ${step})`)
  }
}

function snap(name) {
  expect(collected[name], `duplicate step name ${name}`).toBeUndefined()
  collected[name] = snapshot()
  sweepUnlabelled(name)
}

// ---- driving the app ----
function seed({ october = octoberEmployees, september = septemberEmployees, idField = idFieldKey, companies = [company], active = company.id } = {}) {
  localStorage.clear()
  localStorage.setItem(
    'payroll_app_state_v1',
    JSON.stringify({ identityFields, idFieldKey: idField, globalColumns, companies, activeCompanyId: active })
  )
  localStorage.setItem(`payroll_period_${company.id}_2026-10`, JSON.stringify({ employees: october }))
  localStorage.setItem(`payroll_period_${company.id}_2026-09`, JSON.stringify({ employees: september }))
}

async function start() {
  if (root) {
    await act(async () => root.unmount())
    container.remove()
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(App)))
}

const all = (selector) => [...document.querySelectorAll(selector)]
const textOf = (el) => squash(el.textContent)

function button(text, { last = false } = {}) {
  const matches = all('button').filter((b) => textOf(b) === text)
  expect(matches.length, `button "${text}"`).toBeGreaterThan(0)
  return last ? matches[matches.length - 1] : matches[0]
}
const byLabel = (label) => {
  const el = document.querySelector(`[aria-label="${label}"]`)
  expect(el, `control labelled "${label}"`).toBeTruthy()
  return el
}

async function click(el) {
  await act(async () => el.click())
}
const clickButton = (text, opts) => click(button(text, opts))
const closeDialog = () => click(all('[aria-label="Close"]').pop())
const cancel = () => clickButton('Cancel', { last: true })
const tab = (name) => clickButton(name)

async function setValue(el, value) {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function chooseFile(accept, file) {
  const input = document.querySelector(`input[type="file"][accept="${accept}"]`)
  expect(input, `file input ${accept}`).toBeTruthy()
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  await act(async () => new Promise((r) => setTimeout(r, 50)))
}

function columnRow(name) {
  const row = all('tr').find((tr) => [...tr.querySelectorAll('td')].some((td) => textOf(td) === name) && [...tr.querySelectorAll('button')].some((b) => textOf(b) === 'Edit'))
  expect(row, `column row "${name}"`).toBeTruthy()
  return row
}
const rowButton = (name, label) => [...columnRow(name).querySelectorAll('button')].find((b) => textOf(b) === label)

function externalWorkbook() {
  const rows = [
    ['Fake Co Ltd - payroll input (fake data)'],
    [],
    ['id', 'Surname', 'Other Names', 'Salary', 'Allowances', 'Age 60+', 'Remarks'],
    ['F101', 'Importee', 'Uno Fake', 21000, 1500.5, 'No', 'first'],
    ['F102', 'Importee, Jr', 'Dos Fake', '34500.75', '', 'Yes', ''],
  ]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Payroll')
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
}

test('collect every visible string', async () => {
  // ---------- No company ----------
  localStorage.clear()
  await start()
  snap('01 no company selected')

  // ---------- Employee Table ----------
  seed({ companies: [company, { ...company, id: 'company-fake-2', name: 'Sample Traders Ltd', columns: [] }] })
  await start()
  await vi.waitFor(() => expect(document.body.textContent).toContain('October 2026'))
  snap('02 employee table')

  await click(byLabel('More export options'))
  snap('03 export menu')
  await click(byLabel('More export options'))

  await click(all('tbody tr')[0].querySelector('td:last-child button'))
  snap('04 delete employee confirm')
  await cancel()

  await clickButton('Delete All Employees')
  snap('05 delete all employees confirm')
  await cancel()

  // Calculation breakdown for every formula cell of two employees
  // (F001: nothing exempt; F004: aged 60+, exemption applies).
  for (const rowIndex of [0, 3]) {
    const cells = all('tbody tr')[rowIndex].querySelectorAll('button[title="Click to see calculation breakdown"]')
    for (let i = 0; i < cells.length; i++) {
      await click(all('tbody tr')[rowIndex].querySelectorAll('button[title="Click to see calculation breakdown"]')[i])
      snap(`06 breakdown, employee ${rowIndex + 1}, formula ${String(i + 1).padStart(2, '0')}`)
      await closeDialog()
    }
  }

  await clickButton('Export to Excel')
  snap('07 export preview (values)')
  // Its "include company details" toggle, if there is one.
  const detailsToggle = all('label').find((l) => /company details/i.test(l.textContent))?.querySelector('input')
  if (detailsToggle) {
    await click(detailsToggle)
    snap('07b export preview with company details')
  }
  await closeDialog()

  await click(byLabel('More export options'))
  await clickButton('Export with Live FormulasFormula columns as working Excel formulas')
  snap('08 export preview (live formulas)')
  await closeDialog()

  for (const [format, label] of [['csv', 'Export for PDF fill (CSV)Pick columns, one row per employee, plain-name headers'], ['json', 'Export for PDF fill (JSON)Pick columns, one object per employee, plain-name keys']]) {
    await click(byLabel('More export options'))
    await clickButton(label)
    snap(`09 pdf fill export (${format})`)
    await clickButton('Select None')
    snap(`09b pdf fill export (${format}), nothing selected`)
    await cancel()
  }

  await clickButton('Copy from Previous Month')
  snap('10 copy from previous month')
  await clickButton('Select All')
  for (const name of ['Basic Salary', 'Age 60+']) await click(all('label').find((l) => textOf(l) === name).querySelector('input'))
  snap('10b copy from previous month, with a selection')
  await click(all('button').find((b) => /^Copy \d+ Employees?$/.test(textOf(b))))
  snap('10c copy from previous month, overwrite confirm')
  await cancel()
  await cancel()

  await chooseFile('.xlsx', { name: 'fake-external.xlsx', arrayBuffer: async () => externalWorkbook() })
  snap('11 import mapping (external file)')
  await cancel()

  const plan = buildExportPlan({
    title: company.name, companyId: company.id, companyDetails: company.details, kind: 'period', exportMode: 'values',
    employees: octoberEmployees, identityFields, effectiveColumns, computedGrid: octoberGrid,
  })
  const ownExport = await buildWorkbookBuffer(plan)
  await chooseFile('.xlsx', { name: 'fake-own-export.xlsx', arrayBuffer: async () => ownExport })
  snap('11b import mapping (own export, recognised)')
  await cancel()

  const otherCompanyPlan = { ...plan, meta: { ...plan.meta, companyId: 'some-other-company' } }
  const otherExport = await buildWorkbookBuffer(otherCompanyPlan)
  await chooseFile('.xlsx', { name: 'fake-other-company.xlsx', arrayBuffer: async () => otherExport })
  snap('11c import mapping (export from another company)')
  await cancel()

  await chooseFile('.xlsx', { name: 'corrupt.xlsx', arrayBuffer: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(64).fill(0xff)]).buffer })
  snap('11d import, unreadable file')

  await click(byLabel('Fake Co Ltd details'))
  snap('12 company details')
  await clickButton('+ Add Field')
  snap('12b company details, new custom field')
  await setValue(all('input[placeholder="Label, e.g. VAT No"]').pop(), 'Extra')
  await closeDialog()
  snap('12c company details, discard changes confirm')
  await click(all('button').filter((b) => /discard/i.test(textOf(b))).pop())

  await click(byLabel('Delete Fake Co Ltd'))
  snap('13 delete company confirm')
  await cancel()

  // ---------- Empty month, and duplicate IDs ----------
  await click(all('button').find((b) => /November/.test(textOf(b))))
  snap('14 employee table, empty month')
  await click(all('button').find((b) => /October/.test(textOf(b))))

  seed({ october: [octoberEmployees[0], { ...octoberEmployees[1], values: { ...octoberEmployees[1].values, id: 'F001' } }] })
  await start()
  await vi.waitFor(() => expect(document.body.textContent).toContain('October 2026'))
  snap('15 employee table, duplicate ID')

  // ---------- Global Columns ----------
  seed()
  await start()
  await vi.waitFor(() => expect(document.body.textContent).toContain('October 2026'))
  await tab('Global Columns')
  snap('20 global columns')

  await clickButton('+ Add Identity Field')
  snap('21 add identity field')
  await clickButton('Save')
  snap('21b add identity field, validation error')
  await cancel()

  await click(all('tr').find((tr) => [...tr.querySelectorAll('td')].some((td) => textOf(td) === 'Surname')).querySelectorAll('button')[1])
  snap('21c edit identity field')
  await cancel()
  await click([...all('tr').find((tr) => [...tr.querySelectorAll('td')].some((td) => textOf(td) === 'Surname')).querySelectorAll('button')].pop())
  snap('21d delete identity field confirm')
  await cancel()

  await clickButton('+ Add Column')
  snap('22 add column (input, number)')
  await clickButton('Text')
  snap('22b add column (input, text)')
  await clickButton('Checkbox (Yes/No)')
  snap('22c add column (input, checkbox)')
  await click(all('label').find((l) => textOf(l) === 'Include in Excel export').querySelector('input'))
  snap('22d add column, not included in export')
  await clickButton('Formula')
  snap('23 add column (formula, simple)')
  await clickButton('Save')
  snap('23b add column, validation error')
  await clickButton('Tiered / Conditional')
  snap('24 add column (tiered, threshold)')
  await clickButton('+ Add Tier')
  await click(all('label').find((l) => /Cap \/ Ceiling/.test(textOf(l))).querySelector('input'))
  snap('24b add column (tiered, two tiers and a cap)')
  await clickButton('Compare Two Columns')
  snap('25 add column (compare two columns)')
  await clickButton('Progressive Brackets')
  snap('26 add column (progressive)')
  await clickButton('+ Add Bracket')
  snap('26b add column (progressive, three brackets)')
  await click(all('label').find((l) => textOf(l) === 'Add an exemption / override condition').querySelector('input'))
  snap('27 add column, exemption (checkbox condition)')
  await clickButton('Compare columns')
  snap('27b add column, exemption (compare condition)')
  await clickButton('+ Add Condition')
  snap('27c add column, exemption (two conditions)')
  await cancel()

  for (const name of ['Basic Salary', 'New Basic Salary', 'Full time / Part time', 'Age 60+', 'CSG', 'NSF', 'PAYE']) {
    await click(rowButton(name, 'Edit'))
    snap(`28 edit global column: ${name}`)
    if (name === 'CSG') {
      await clickButton('This company only')
      snap('28b edit global column, scope changed to company')
      await clickButton('Save')
      snap('28c edit global column, save result')
    }
    if (all('button').some((b) => textOf(b) === 'Cancel')) await cancel()
    if (all('button').some((b) => textOf(b) === 'Cancel')) await cancel()
  }

  await click(rowButton('Net Pay', 'Delete'))
  snap('29 delete column confirm')
  await cancel()

  const setupFile = (obj) => ({ name: 'setup.json', text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) })
  await chooseFile('.json', setupFile('this is not json'))
  snap('30 column setup import, unreadable file')
  await chooseFile('.json', setupFile({ nothing: true }))
  snap('30b column setup import, wrong kind of file')

  // ---------- Company Columns ----------
  await tab('Company Columns')
  snap('40 company columns')
  for (const name of ['Levy', 'PRGF', 'Total MRA contributions', 'EDF', 'Total', 'Internal Note']) {
    await click(rowButton(name, 'Edit'))
    snap(`41 edit company column: ${name}`)
    if (name === 'Levy') {
      await clickButton('Global')
      snap('41b edit company column, scope changed to global')
    }
    await cancel()
  }

  // ---------- Totals ----------
  await tab('Totals')
  snap('50 totals, one month')
  await setValue(all('input[type="month"]')[0], '2026-09')
  snap('51 totals, two months')
  await clickButton('Export to Excel')
  snap('52 totals export preview')
  await closeDialog()
  await setValue(all('input[type="month"]')[0], '2025-01')
  await setValue(all('input[type="month"]')[1], '2025-02')
  snap('53 totals, empty range')

  seed({ idField: null })
  await start()
  await vi.waitFor(() => expect(document.body.textContent).toContain('October 2026'))
  snap('54 employee table, no ID field designated')
  await tab('Totals')
  snap('55 totals, no ID field designated')
  await tab('Global Columns')
  snap('56 global columns, no ID field designated')

  expect(OUT, 'TEXT_CHECK_OUT').toBeTruthy()
  fs.writeFileSync(OUT, JSON.stringify(collected, null, 2))
  fs.writeFileSync(OUT.replace(/\.json$/, '.unlabelled.json'), JSON.stringify([...unlabelled].sort(), null, 2))
}, 120000)
