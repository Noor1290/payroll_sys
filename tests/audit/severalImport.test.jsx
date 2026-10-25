// @vitest-environment jsdom

// "Several companies…" > Import, against the stand-in dashboard (tests/helpers/fakeSetupHub.js,
// the rules of the dashboard's migration 0019): a file made by Export read back by its hidden
// sheet, matched to companies by BRN (a renamed company still matched), the question about the
// companies not in the dashboard, months added, skipped, replaced and an approved one refused,
// the problems (a column the setup lacks, a BRN twice or empty, a sheet that no longer matches,
// a company where the user is not an admin), one company failing while the others go through,
// and the round trip: Export, then Import into a fresh dashboard, gives the same companies and
// months, figure for figure. TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from '../../src/App'
import { resetDataStore } from '../../src/lib/dataStore'
import { connectDashboard, forgetDashboardSetup, heldShared, PREFS_KEY } from '../../src/lib/dashboardSetup'
import { forgetDashboardMonths } from '../../src/lib/dashboardMonths'
import { checkCompanies, exportCompanies, importCompanies } from '../../src/lib/dashboardBatch'
import { computeGridForEmployees } from '../../src/lib/formulaEngine'
import { getColumnsByKey, getEffectiveColumns } from '../../src/lib/model'
import { HIDDEN_SHEET } from '../../src/lib/severalCompanies'
import { defaultImportChoices, NOT_OURS, planImport, readCompaniesFile } from '../../src/lib/severalImport'
import { buildExportPlan, buildWorkbookBuffer } from '../../src/lib/excelExport'
import { createFakeSetupHub, installFakeBridge } from '../helpers/fakeSetupHub'
import { company, globalColumns, identityFields, idFieldKey, octoberEmployees, octoberGrid, septemberEmployees } from '../safetyNet/fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const json = (value) => JSON.parse(JSON.stringify(value))
const S1 = '30000000-0000-4000-8000-000000000001'
const S2 = '30000000-0000-4000-8000-000000000002'
const datedIdentity = [...identityFields, { id: 'idf-date', name: 'Date of Employment', key: 'dateOfEmployment', valueType: 'date' }]
const sharedBody = json({ identityFields: datedIdentity, idFieldKey, globalColumns })
const otherShared = json({
  identityFields: datedIdentity,
  idFieldKey,
  globalColumns: [...globalColumns, { id: 'col-bonus', name: 'Bonus', key: 'bonus', type: 'input', category: 'general', decimals: 2 }],
})
const companyBody = json({ columns: company.columns, customFields: company.details.customFields })
// The safety net's September has a person with no ID on purpose; the import refuses that (below).
const september = septemberEmployees.filter((e) => String(e.values.id ?? '').trim() !== '')
const withDates = (employees) => employees.map((e, i) => ({ ...e, values: { ...e.values, dateOfEmployment: `201${i}-0${(i % 9) + 1}-15` } }))

const A = { brn: 'C00000001', name: 'Fake Co Ltd', address: '1 Test Street\nPort Louis', role: 'admin' }
const B = { brn: 'C00000002', name: 'Second Fake Ltd', address: '2 Test Street', role: 'admin' }
const C = { brn: 'C00000003', name: 'Third Fake Ltd', address: null, role: 'admin' }
const OWNER = { brn: 'C00000099', name: 'Owner Fake Ltd', address: null, role: 'admin' }

// The dashboard the file is exported from: A and B on one shared setup, C on another.
function sourceSeed() {
  return {
    companies: [A, B, C],
    selectedBrn: A.brn,
    shared: [
      { id: S1, name: 'Shared column setup', body: sharedBody, revision: 1 },
      { id: S2, name: 'Other shared setup', body: otherShared, revision: 1 },
    ],
    setups: {
      [A.brn]: { shared_setup_id: S1, body: companyBody, revision: 1 },
      [B.brn]: { shared_setup_id: S1, body: json({ columns: company.columns, customFields: [] }), revision: 1 },
      [C.brn]: { shared_setup_id: S2, body: json({ columns: company.columns, customFields: [] }), revision: 1 },
    },
    monthsSupported: true,
    months: {
      [`${A.brn}|2026-09`]: { employees: withDates(september) },
      [`${A.brn}|2026-10`]: { employees: withDates(octoberEmployees) },
      [`${B.brn}|2026-10`]: { employees: withDates(octoberEmployees.slice(0, 3)) },
      [`${C.brn}|2026-09`]: { employees: withDates(octoberEmployees.slice(2)).map((e) => ({ ...e, values: { ...e.values, bonus: '1250.5' } })) },
    },
  }
}

const SEP_OCT = { from: '2026-09', to: '2026-10' }

// Exports from the source dashboard; the file's bytes.
async function exported(seed = sourceSeed(), range = SEP_OCT, companies = [A, B, C]) {
  const source = createFakeSetupHub(seed)
  installFakeBridge(source)
  forgetDashboardSetup()
  const result = await exportCompanies(range, companies)
  expect(result.ok, result.error).toBe(true)
  return { buffer: new Uint8Array(await new Blob([result.buffer]).arrayBuffer()), source }
}

// The dashboard the file is imported into, connected as the app connects.
async function target(seed) {
  const hub = createFakeSetupHub(seed)
  installFakeBridge(hub)
  forgetDashboardSetup()
  forgetDashboardMonths()
  await connectDashboard()
  return hub
}

async function plan(buffer) {
  const file = readCompaniesFile(buffer)
  expect(file.ok, file.error).toBe(true)
  const answer = await checkCompanies(file)
  expect(answer.ok, answer.error).toBe(true)
  return planImport(file, answer.rows, heldShared())
}

// A fresh dashboard: one company, made in the SQL editor, with no column setup yet.
const freshSeed = () => ({ companies: [OWNER], selectedBrn: OWNER.brn, monthsSupported: true })

// The figures a dashboard's month gives, worked out with that company's setup there: per
// employee (in order), every column's value.
function figures(hub, brn, period) {
  const own = hub.state.setups.get(brn)
  const shared = hub.state.shared.get(own.shared_setup_id).body
  const columns = getEffectiveColumns({ columns: own.body.columns }, shared.globalColumns)
  const employees = hub.state.months.get(`${brn}|${period}`).employees
  const grid = computeGridForEmployees(employees, columns, getColumnsByKey(columns))
  return employees.map((e) => [
    ...shared.identityFields.map((f) => String(e.values[f.key] ?? '')),
    ...columns.map((c) => {
      const value = grid[e.id][c.key].value
      return typeof value === 'number' ? Math.round(value * 1e9) / 1e9 : value
    }),
  ])
}

afterEach(() => {
  forgetDashboardSetup()
  forgetDashboardMonths()
  resetDataStore()
})

describe('reading the file', () => {
  test('a file made by Export is read by its hidden sheet: the companies, their months and every row', async () => {
    const { buffer } = await exported()
    const file = readCompaniesFile(buffer)
    expect(file).toMatchObject({ ok: true, from: '2026-09', to: '2026-10' })
    expect(file.companies.map((c) => [c.brn, c.name, c.months.map((m) => [m.period, m.cells.length])])).toEqual([
      ['C00000001', 'Fake Co Ltd', [['2026-09', september.length], ['2026-10', octoberEmployees.length]]],
      ['C00000002', 'Second Fake Ltd', [['2026-10', 3]]],
      ['C00000003', 'Third Fake Ltd', [['2026-09', octoberEmployees.length - 2]]],
    ])
    expect(file.companies.every((c) => c.problems.length === 0)).toBe(true)
  })

  test('anything else is refused before anything is asked: a single-company export, a text file', async () => {
    const single = buildExportPlan({
      title: company.name,
      companyId: company.id,
      companyDetails: company.details,
      kind: 'period',
      employees: octoberEmployees,
      identityFields,
      effectiveColumns: [...globalColumns, ...company.columns],
      computedGrid: octoberGrid,
    })
    expect(readCompaniesFile(await buildWorkbookBuffer(single))).toEqual({ ok: false, error: NOT_OURS })
    expect(readCompaniesFile(new TextEncoder().encode('not a workbook'))).toEqual({
      ok: false,
      error: 'Could not read that file. Please make sure it is a valid .xlsx file.',
    })
  })

  test('a sheet that no longer matches its hidden part, a BRN twice or missing: a problem for that company only', async () => {
    const { buffer } = await exported()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    // A row added under Fake Co Ltd's TOTAL.
    const sheet = wb.getWorksheet('Fake Co Ltd')
    sheet.getCell(sheet.rowCount + 2, 2).value = 'F999'
    // Third Fake Ltd's BRN changed to Second Fake Ltd's, in the hidden sheet.
    const hidden = wb.getWorksheet(HIDDEN_SHEET)
    hidden.getCell(4, 2).value = 'C00000002'
    const file = readCompaniesFile(new Uint8Array(await wb.xlsx.writeBuffer()))
    expect(file.companies.map((c) => c.problems)).toEqual([
      ['Its sheet does not match the hidden part of the file: rows were added under its TOTAL row.'],
      ['Its BRN is on more than one sheet of the file.'],
      ['Its BRN is on more than one sheet of the file.', 'Its sheet does not match the hidden part of the file: its BRN on the sheet is not the one in the hidden part of the file.'],
    ])
    hidden.getCell(4, 2).value = ''
    const again = readCompaniesFile(new Uint8Array(await wb.xlsx.writeBuffer()))
    expect(again.companies[2].problems).toContain('It has no BRN in the file.')
  })
})

describe('the preview', () => {
  test('matched by BRN, never by name: a company renamed in the dashboard is still matched', async () => {
    const { buffer } = await exported()
    const seed = sourceSeed()
    seed.companies = [A, { ...B, name: 'Second Fake (renamed) Ltd' }, C]
    seed.months = {}
    await target(seed)
    const made = await plan(buffer)
    expect(made.companies.map((c) => [c.brn, c.status, c.dashboardName])).toEqual([
      ['C00000001', 'existing', 'Fake Co Ltd'],
      ['C00000002', 'existing', 'Second Fake (renamed) Ltd'],
      ['C00000003', 'existing', 'Third Fake Ltd'],
    ])
    expect(made.newCompanies).toEqual([])
  })

  test('months not saved are added; saved ones are kept unless Replace is chosen; an approved one is never replaced', async () => {
    const { buffer } = await exported()
    const seed = sourceSeed()
    seed.approvedRuns = ['C00000001|2026-09']
    seed.months = { [`${A.brn}|2026-09`]: seed.months[`${A.brn}|2026-09`], [`${A.brn}|2026-10`]: seed.months[`${A.brn}|2026-10`] }
    await target(seed)
    const made = await plan(buffer)
    expect(made.companies[0].months.map((m) => [m.period, m.action])).toEqual([
      ['2026-09', 'approved'],
      ['2026-10', 'saved'],
    ])
    expect(made.companies[1].months.map((m) => m.action)).toEqual(['add'])
    expect(defaultImportChoices(made).replace).toEqual({})
  })

  test('a column of the file the company does not have: not imported, the columns named, not ticked', async () => {
    const { buffer } = await exported()
    const seed = sourceSeed()
    // Third Fake Ltd's shared setup has no Bonus column in this dashboard.
    seed.shared[1] = { id: S2, name: 'Other shared setup', body: sharedBody, revision: 1 }
    seed.months = {}
    await target(seed)
    const made = await plan(buffer)
    expect(made.companies[2]).toMatchObject({ status: 'problem', problems: ['These columns of the file are not in its column setup: Bonus.'] })
    expect(defaultImportChoices(made).companies[made.companies[2].key]).toBe(false)
  })

  test('figures that would not be the same with its setup: a warning naming the columns, not ticked, but it can be ticked', async () => {
    const { buffer } = await exported()
    const seed = sourceSeed()
    const changed = json(companyBody)
    const netPay = changed.columns.find((c) => c.key === 'netPay') ?? null
    const target_ = netPay ?? changed.columns.find((c) => c.type === 'formula')
    target_.formula = `(${target_.formula}) + 1`
    seed.setups[A.brn] = { shared_setup_id: S1, body: changed, revision: 1 }
    seed.months = {}
    await target(seed)
    const made = await plan(buffer)
    expect(made.companies[0].status).toBe('existing')
    expect(made.companies[0].warning).toMatch(new RegExp(`^With its column setup, these figures would not be the same as in the file: .*${target_.name}`))
    expect(defaultImportChoices(made).companies[made.companies[0].key]).toBe(false)
  })

  test('checked as "Import from Excel" checks: a row with no ID, an ID on two rows', async () => {
    const seed = sourceSeed()
    seed.months[`${A.brn}|2026-09`] = { employees: withDates(septemberEmployees) }
    seed.months[`${B.brn}|2026-10`] = { employees: withDates([octoberEmployees[0], { ...octoberEmployees[1], values: { ...octoberEmployees[1].values, id: 'F001' } }]) }
    const { buffer } = await exported(seed)
    await target(freshSeed())
    const made = await plan(buffer)
    const noId = septemberEmployees.findIndex((e) => String(e.values.id ?? '').trim() === '') + 1
    expect(made.companies[0]).toMatchObject({ status: 'problem', problems: [`September 2026: row ${noId} has no ID.`] })
    expect(made.companies[1]).toMatchObject({ status: 'problem', problems: ['October 2026: these IDs are on more than one row: F001.'] })
    expect(made.newCompanies.map((c) => c.brn)).toEqual([C.brn])
  })

  test('a company where the user is not an admin: a problem; and the dashboard refuses it when the app is bypassed', async () => {
    const { buffer } = await exported()
    const seed = sourceSeed()
    seed.companies = [A, { ...B, role: 'member' }, C]
    seed.months = {}
    const hub = await target(seed)
    const made = await plan(buffer)
    expect(made.companies[1]).toMatchObject({ status: 'problem', problems: ['You are not an admin of this company in the dashboard.'] })
    const direct = await hub.handle('send-data', {
      dataType: 'payroll-import',
      rows: [{ action: 'company', brn: A.brn, company_brn: B.brn, months: [{ period: '2026-10', employees: [], expected_revision: 0, replace: false }] }],
    })
    expect(direct).toMatchObject({ ok: false, code: 'forbidden' })
    expect(hub.state.months.size).toBe(0)
  })
})

describe('importing', () => {
  test('the companies not in the dashboard: nothing is created without the answer; a ticked one is created, an unticked one is not', async () => {
    const { buffer } = await exported()
    const hub = await target(freshSeed())
    const made = await plan(buffer)
    expect(made.newCompanies.map((c) => [c.name, c.brn, c.setupUse])).toEqual([
      ['Fake Co Ltd', 'C00000001', 'new'],
      ['Second Fake Ltd', 'C00000002', 'new'],
      ['Third Fake Ltd', 'C00000003', 'new'],
    ])
    const choices = defaultImportChoices(made)
    // Nothing answered: every new company left out, nothing sent.
    const none = await importCompanies(made, choices)
    expect(none.map((o) => o.outcome)).toEqual(['not-added', 'not-added', 'not-added'])
    expect(hub.state.companies.map((c) => c.brn)).toEqual([OWNER.brn])
    expect(hub.state.log.filter((m) => m.dataType === 'payroll-import' && m.action === 'company')).toEqual([])
    // Fake Co Ltd and Third Fake Ltd ticked, Second Fake Ltd not.
    choices.add[made.companies[0].key] = true
    choices.add[made.companies[2].key] = true
    const outcomes = await importCompanies(made, choices)
    expect(outcomes.map((o) => [o.company.brn, o.outcome, o.added])).toEqual([
      ['C00000001', 'created', ['2026-09', '2026-10']],
      ['C00000002', 'not-added', []],
      ['C00000003', 'created', ['2026-09']],
    ])
    expect(hub.state.companies.map((c) => [c.brn, c.name, c.address])).toEqual([
      [OWNER.brn, OWNER.name, null],
      [A.brn, A.name, A.address],
      [C.brn, C.name, null],
    ])
    expect(hub.state.importSummaries.at(-1)).toMatchObject({ created: 2, added: 3, replaced: 0, failed: 0 })
  })

  test('a new company uses your shared setup when it is the same as the file\'s, and gets a new one otherwise', async () => {
    const { buffer } = await exported()
    const seed = {
      companies: [OWNER],
      selectedBrn: OWNER.brn,
      shared: [{ id: S1, name: 'Shared column setup', body: sharedBody, revision: 1 }],
      setups: { [OWNER.brn]: { shared_setup_id: S1, body: { columns: [], customFields: [] }, revision: 1 } },
      monthsSupported: true,
    }
    const hub = await target(seed)
    const made = await plan(buffer)
    expect(made.newCompanies.map((c) => c.setupUse)).toEqual(['yours', 'yours', 'new'])
    const choices = defaultImportChoices(made)
    for (const c of made.newCompanies) choices.add[c.key] = true
    await importCompanies(made, choices)
    expect(hub.state.setups.get(A.brn).shared_setup_id).toBe(S1)
    expect(hub.state.setups.get(B.brn).shared_setup_id).toBe(S1)
    expect(hub.state.setups.get(C.brn).shared_setup_id).not.toBe(S1)
    expect(hub.state.shared.get(hub.state.setups.get(C.brn).shared_setup_id).body).toEqual(otherShared)
  })

  test('a saved month replaced as a new revision, its people kept in their places; an approved one refused by the dashboard too', async () => {
    const { buffer } = await exported()
    const seed = sourceSeed()
    const hub = await target(seed)
    const made = await plan(buffer)
    const choices = defaultImportChoices(made)
    const fake = made.companies[0]
    choices.replace[`${fake.key}|2026-10`] = true
    const placesBefore = hub.state.months.get(`${A.brn}|2026-10`).employees.map((e) => e.id)
    const outcomes = await importCompanies(made, choices)
    expect(outcomes[0]).toMatchObject({ outcome: 'imported', replaced: ['2026-10'], skipped: [{ period: '2026-09', why: 'saved' }] })
    const month = hub.state.months.get(`${A.brn}|2026-10`)
    expect(month.revision).toBe(2)
    expect(month.employees.map((e) => e.id)).toEqual(placesBefore)
    // The month replaced was kept, for History and Restore.
    expect(hub.state.monthHistory.find((h) => h.key === `${A.brn}|2026-10` && h.revision === 1).employees).not.toBeNull()

    // Approved since the preview: the dashboard refuses, and nothing of that company is stored.
    const again = await plan(buffer)
    const choices2 = defaultImportChoices(again)
    choices2.replace[`${again.companies[0].key}|2026-10`] = true
    hub.state.approvedRuns.add(`${A.brn}|2026-10`)
    const refused = await importCompanies(again, choices2)
    expect(refused[0]).toMatchObject({ outcome: 'failed', reason: expect.stringContaining('approved run') })
    expect(hub.state.months.get(`${A.brn}|2026-10`).revision).toBe(2)
  })

  test('one company failing does not stop the others, and nothing of the failed one is stored', async () => {
    const { buffer } = await exported()
    const hub = await target(freshSeed())
    const made = await plan(buffer)
    const choices = defaultImportChoices(made)
    for (const c of made.newCompanies) choices.add[c.key] = true
    let calls = 0
    const handle = hub.handle
    hub.handle = async (type, payload) => {
      if (payload.dataType === 'payroll-import' && payload.rows?.[0]?.action === 'company' && ++calls === 2) {
        return { ok: false, code: 'invalid', error: 'Not valid: a month is missing or malformed.' }
      }
      return handle(type, payload)
    }
    installFakeBridge(hub)
    const outcomes = await importCompanies(made, choices)
    expect(outcomes.map((o) => o.outcome)).toEqual(['created', 'failed', 'created'])
    expect(outcomes[1].reason).toBe('Not valid: a month is missing or malformed.')
    expect(hub.state.companies.map((c) => c.brn)).toEqual([OWNER.brn, A.brn, C.brn])
    expect([...hub.state.months.keys()].filter((key) => key.startsWith(B.brn))).toEqual([])
    expect(hub.state.importSummaries.at(-1)).toMatchObject({ created: 2, failed: 1 })
  })

  test('a failure inside one company leaves nothing of it: the company is not left without its months', async () => {
    const { buffer } = await exported()
    const hub = await target(freshSeed())
    const made = await plan(buffer)
    const choices = defaultImportChoices(made)
    choices.add[made.companies[0].key] = true
    // The second month of Fake Co Ltd is refused by the dashboard after the first was stored.
    const realSave = hub.handle
    let months = 0
    hub.handle = async (type, payload) => {
      if (payload.dataType === 'payroll-import' && payload.rows?.[0]?.action === 'company') {
        const row = payload.rows[0]
        row.months[1] = { ...row.months[1], employees: 'broken' }
      }
      months += 1
      return realSave(type, payload)
    }
    installFakeBridge(hub)
    const outcomes = await importCompanies(made, choices)
    expect(months).toBeGreaterThan(0)
    expect(outcomes[0].outcome).toBe('failed')
    expect(hub.state.companies.map((c) => c.brn)).toEqual([OWNER.brn])
    expect(hub.state.months.size).toBe(0)
    expect(hub.state.shared.size).toBe(0)
  })
})

describe('the round trip', () => {
  test('Export, then Import into a fresh dashboard: the same companies and months, figure for figure', async () => {
    const { buffer, source } = await exported(sourceSeed(), { from: '2026-07', to: '2027-06' })
    const hub = await target(freshSeed())
    const made = await plan(buffer)
    const choices = defaultImportChoices(made)
    for (const c of made.newCompanies) choices.add[c.key] = true
    const outcomes = await importCompanies(made, choices)
    expect(outcomes.map((o) => o.outcome)).toEqual(['created', 'created', 'created'])
    expect(hub.state.companies.slice(1).map((c) => [c.brn, c.name, c.address])).toEqual([A, B, C].map((c) => [c.brn, c.name, c.address]))
    const keys = [...source.state.months.keys()].sort()
    expect([...hub.state.months.keys()].sort()).toEqual(keys)
    for (const key of keys) {
      const [brn, period] = key.split('|')
      expect(figures(hub, brn, period), key).toEqual(figures(source, brn, period))
    }
    // Their column setups are the file's: the same shared setups (two) and company columns.
    // Fake Co Ltd and Second Fake Ltd shared one in the file, Third Fake Ltd another: two, as there.
    expect(new Set([...hub.state.setups.values()].map((s) => s.shared_setup_id)).size).toBe(2)
    expect(hub.state.shared.get(hub.state.setups.get(A.brn).shared_setup_id).body).toEqual(sharedBody)
    expect(hub.state.setups.get(A.brn).shared_setup_id).toBe(hub.state.setups.get(B.brn).shared_setup_id)
    expect(hub.state.setups.get(A.brn).body).toEqual(companyBody)
  })
})

// ---------- the screen ----------

let root
let container
const all = (selector) => [...document.querySelectorAll(selector)]
const button = (label) => all('button').find((b) => b.textContent.trim() === label)
const dialog = () => document.querySelector('[role="dialog"]')
const text = () => document.body.textContent.replace(/\s+/g, ' ')

async function click(target_) {
  expect(target_, 'the control').toBeTruthy()
  await act(async () => target_.click())
}

async function chooseFile(bytes, name = 'Payroll 2026-09 to 2026-10 (3 companies).xlsx') {
  const input = dialog().querySelector('input[type="file"]')
  const file = new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}

describe('"Several companies…" > Import, on screen', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(async () => {
    await act(async () => root?.unmount())
    container?.remove()
  })

  test('from a fresh dashboard: the question, the preview, the import and what happened', async () => {
    const { buffer } = await exported()
    localStorage.setItem(PREFS_KEY, JSON.stringify({}))
    const hub = createFakeSetupHub(freshSeed())
    installFakeBridge(hub)
    forgetDashboardSetup()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<App />))
    await vi.waitFor(() => expect(text()).toContain('Owner Fake Ltd has no column setup in the dashboard yet'))
    await vi.waitFor(() => expect(button('Several companies…')).toBeTruthy())
    await click(button('Several companies…'))
    await click(button('Import'))
    await chooseFile(buffer)
    await vi.waitFor(() => expect(dialog().textContent).toContain("These companies aren't in the dashboard yet. Do you want to add them?"))
    const boxes = all('[role="dialog"] li input[type="checkbox"]')
    expect(boxes.map((b) => b.checked)).toEqual([false, false, false])
    expect(button('Add the ticked companies').disabled).toBe(true)
    await click(boxes[0])
    await click(boxes[1])
    await click(button('Add the ticked companies'))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Nothing has been saved yet.'))
    expect(dialog().textContent).toContain('New company: it will be added to the dashboard, and gets a new shared setup.')
    expect(dialog().textContent).toContain("Not added: it isn't in the dashboard.")
    expect(dialog().textContent).toContain('Will be added (')
    expect(hub.state.companies).toHaveLength(1)
    await click(button('Import 2 companies'))
    await vi.waitFor(() => expect(dialog().textContent).toContain('Created in the dashboard.'))
    expect(dialog().textContent).toContain('Fake Co Ltd · BRN C00000001: Created in the dashboard. Added: September 2026, October 2026.')
    expect(dialog().textContent).toContain('Third Fake Ltd · BRN C00000003: Not added.')
    expect(hub.state.companies.map((c) => c.brn)).toEqual([OWNER.brn, A.brn, B.brn])
  })
})
