// @vitest-environment jsdom

// Rehearsal fix F2 (17 Oct 2026, problem H4): "Import from Excel" into a month that already has
// employees updates them, matched by the ID field, instead of adding them again; never imports a
// totals line or a row without an ID; and the delete question tells two copies of an ID apart.
// TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import * as XLSX from 'xlsx'
import { afterEach, describe, expect, test, vi } from 'vitest'
import EmployeeTable from '../../src/components/EmployeeTable'
import ImportMappingModal from '../../src/components/ImportMappingModal'
import { applyMonthImport, getImportableSystemFields, guessMapping, parseWorkbookFile, planMonthImport } from '../../src/lib/excelImport'
import { computeGridForEmployees } from '../../src/lib/formulaEngine'
import { getColumnsByKey } from '../../src/lib/model'
import { identityFields, idFieldKey, input } from './build'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const columns = [input('Basic Salary', 'basicSalary'), input('Presence Bonus', 'presenceBonus'), input('Department', 'department', { valueType: 'text' })]
const fields = getImportableSystemFields(identityFields, columns)
const asFile = (bytes) => ({ name: 'october.xlsx', arrayBuffer: async () => bytes })
function workbook(rows) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'October')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

// The month after "Copy from Previous Month": three people, the third has since left.
const month = () => [
  { id: 'm1', values: { id: 'TST001', name: 'Uno', surname: 'Tester', basicSalary: 18000, presenceBonus: 0, department: 'Admin' } },
  { id: 'm2', values: { id: 'TST002', name: 'Dos', surname: 'Tester', basicSalary: 50000, presenceBonus: 0, department: 'Finance' } },
  { id: 'm3', values: { id: 'TST008', name: 'Ocho', surname: 'Tester', basicSalary: 0, presenceBonus: 0, department: 'Finance' } },
]
// The file: a banner, the headers (no Department column), two changes, one new person, a TOTAL line.
const octoberFile = () =>
  workbook([
    ['TEST Co A', 'Salaries for October 2026'],
    ['ID', 'Name', 'Surname', 'Basic Salary', 'Presence Bonus'],
    ['TST001', 'Uno', 'Tester', 19000, 0],
    ['TST002', 'Dos', 'Tester', 50000, 1000],
    ['TST009', 'Nueve', 'Tester', 30000, 0],
    ['Total', null, null, 99000, 1000],
  ])

async function planFor(bytes, existing, opts = {}) {
  const { headers, rows, meta } = await parseWorkbookFile(asFile(bytes), fields.map((f) => f.name))
  let n = 0
  const mapping = { ...guessMapping(fields, headers), ...(opts.mapping ?? {}) }
  return { rows, mapping, meta, plan: planMonthImport({ rows, systemFields: fields, mapping, meta, existing, idFieldKey, identityFields, makeId: () => `new-${++n}` }) }
}

describe('Import from Excel into a month that has employees (rehearsal fix F2)', () => {
  test('the October rehearsal: 2 updated, 1 added, the leaver offered for removal, the TOTAL line never imported', async () => {
    const { plan } = await planFor(octoberFile(), month())
    expect(plan.updates.map((u) => [u.label, u.patch.basicSalary, u.patch.presenceBonus])).toEqual([
      ['TST001 Uno', 19000, 0],
      ['TST002 Dos', 50000, 1000],
    ])
    expect(plan.additions.map((a) => a.label)).toEqual(['TST009 Nueve'])
    expect(plan.removals.map((r) => r.label)).toEqual(['TST008 Ocho'])
    expect(plan.skipped).toEqual([{ row: 4, reason: 'total', label: 'TOTAL' }])
  })

  test('applied: same people in place, changed figures updated, unmapped values kept, the new person added; the leaver stays unless asked', async () => {
    const { plan } = await planFor(octoberFile(), month())
    const kept = applyMonthImport(month(), plan)
    expect(kept.map((e) => [e.id, e.values.id, e.values.basicSalary, e.values.presenceBonus, e.values.department])).toEqual([
      ['m1', 'TST001', 19000, 0, 'Admin'],
      ['m2', 'TST002', 50000, 1000, 'Finance'],
      ['m3', 'TST008', 0, 0, 'Finance'],
      [expect.stringMatching(/^new-/), 'TST009', 30000, 0, ''],
    ])
    const removed = applyMonthImport(month(), plan, { removeMissing: true })
    expect(removed.map((e) => e.values.id)).toEqual(['TST001', 'TST002', 'TST009'])
    // No ID twice, however it is applied.
    for (const result of [kept, removed]) expect(new Set(result.map((e) => e.values.id)).size).toBe(result.length)
  })

  test('a row with no ID, or with an ID already used earlier in the file, is not imported, and is named', async () => {
    const bytes = workbook([
      ['ID', 'Name', 'Surname', 'Basic Salary'],
      ['TST001', 'Uno', 'Tester', 19000],
      ['', 'Nadie', 'Tester', 5000],
      ['TST001', 'Uno', 'Again', 21000],
      ['total', '', '', 45000],
    ])
    const { plan } = await planFor(bytes, month())
    expect(plan.skipped).toEqual([
      { row: 2, reason: 'no-id', label: 'Nadie' },
      { row: 3, reason: 'repeated', label: 'TST001 Uno', firstRow: 1 },
      { row: 4, reason: 'total', label: 'TOTAL' },
    ])
    expect(plan.updates.map((u) => u.patch.basicSalary)).toEqual([19000])
  })

  test('an ID that is in the month twice already is not updated (which copy?); a totals line in an empty month is skipped too', async () => {
    const twice = [...month(), { id: 'm4', values: { id: 'TST001', name: 'Uno', surname: 'Copy', basicSalary: 18000 } }]
    const { plan } = await planFor(octoberFile(), twice)
    expect(plan.notUpdated).toEqual([{ row: 1, id: 'TST001', label: 'TST001 Uno', copies: 2 }])
    expect(plan.updates.map((u) => u.label)).toEqual(['TST002 Dos'])
    const empty = await planFor(octoberFile(), [])
    expect(empty.plan.additions.map((a) => a.label)).toEqual(['TST001 Uno', 'TST002 Dos', 'TST009 Nueve'])
    expect(empty.plan.skipped.map((s) => s.reason)).toEqual(['total'])
  })
})

let root
let container
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  root = container = null
})
async function show(element) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(element))
}
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim()

test('the import dialog says what it will do before anything changes, and removes the leaver only when ticked (F2)', async () => {
  const { headers, rows, meta } = await parseWorkbookFile(asFile(octoberFile()), fields.map((f) => f.name))
  const onConfirm = vi.fn()
  await show(
    <ImportMappingModal
      headers={headers}
      rows={rows}
      systemFields={fields}
      meta={meta}
      existingEmployees={month()}
      idFieldKey={idFieldKey}
      identityFields={identityFields}
      onConfirm={onConfirm}
      onClose={vi.fn()}
    />
  )
  const summary = document.querySelector('[data-testid="import-summary"]')
  expect([...summary.children].map(text).join(' ')).toBe(
    'This month already has 3 employees. People are matched by ID. Update 2 existing: TST001 Uno, TST002 Dos. Add 1 new: TST009 Nueve. ' +
      'Also remove 1 not in the file: TST008 Ocho. Not imported: row 4 (“TOTAL”, a totals line).'
  )
  const removeBox = summary.querySelector('input[type=checkbox]')
  expect(removeBox.checked).toBe(false)
  const confirm = [...document.querySelectorAll('button')].find((b) => /^Update/.test(text(b)))
  expect(text(confirm)).toBe('Update 2, add 1')
  await act(async () => removeBox.click())
  expect(text(confirm)).toBe('Update 2, add 1, remove 1')
  await act(async () => confirm.click())
  expect(onConfirm).toHaveBeenCalledWith(expect.any(Object), { removeMissing: true })
})

test('the delete question tells two copies of one ID apart by row and figure (F2); a single copy is asked as before', async () => {
  const employees = [
    { id: 'a', values: { id: 'TST001', name: 'Uno', surname: 'Tester', basicSalary: 18000 } },
    { id: 'b', values: { id: 'TST002', name: 'Dos', surname: 'Tester', basicSalary: 50000 } },
    { id: 'c', values: { id: 'TST001', name: 'Uno', surname: 'Tester', basicSalary: 19000 } },
  ]
  const grid = computeGridForEmployees(employees, columns, getColumnsByKey(columns))
  await show(
    <EmployeeTable
      employees={employees}
      identityFields={identityFields}
      idFieldKey={idFieldKey}
      effectiveColumns={columns}
      computedGrid={grid}
      columnWidths={{}}
      onResizeColumn={vi.fn()}
      onUpdateValue={vi.fn()}
      onSetForEveryone={vi.fn()}
      onAddEmployee={vi.fn()}
      onDeleteEmployee={vi.fn()}
      onOpenBreakdown={vi.fn()}
    />
  )
  const ask = async (rowIndex) => {
    const rowButtons = [...document.querySelectorAll('tbody tr')][rowIndex].querySelectorAll('button')
    await act(async () => [...rowButtons].at(-1).click())
    const dialog = document.querySelector('[role="dialog"]')
    const said = text(dialog)
    await act(async () => [...dialog.querySelectorAll('button')].find((b) => text(b) === 'Cancel').click())
    return said
  }
  expect(await ask(2)).toContain('Delete TST001 Uno (row 3, Basic Salary 19,000.00)?')
  expect(await ask(0)).toContain('Delete TST001 Uno (row 1, Basic Salary 18,000.00)?')
  expect(await ask(1)).toContain('Delete TST002 Dos?')
})
