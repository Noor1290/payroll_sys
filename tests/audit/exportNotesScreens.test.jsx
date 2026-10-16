// @vitest-environment jsdom

// Backlog batch D on the screen: the export preview names the formula
// columns a Live-Formulas file writes as fixed figures (audit M4), and
// "Export for PDF fill" refuses two company details with one label, naming
// it (audit M11). TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import ExportPreviewModal from '../../src/components/ExportPreviewModal'
import PdfFillExportModal from '../../src/components/PdfFillExportModal'
import { buildExportPlan } from '../../src/lib/excelExport'
import { computeGridForEmployees } from '../../src/lib/formulaEngine'
import { getColumnsByKey } from '../../src/lib/model'
import { identityFields, input, simple } from './build'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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

const columns = [input('Basic Salary', 'basicSalary'), simple('Rounded', 'rounded', 'Math.round(basicSalary * 0.015)'), simple('Logged', 'logged', 'Math.log(basicSalary)')]
const employees = [{ id: 'e1', values: { id: 'TST001', name: 'Uno', surname: 'Tester', basicSalary: '18115' } }]
const grid = computeGridForEmployees(employees, columns, getColumnsByKey(columns))
const planIn = (exportMode) => buildExportPlan({ title: 'TEST Co A', companyId: 'test-co-a', exportMode, employees, identityFields, effectiveColumns: columns, computedGrid: grid })
const noteText = () => [...document.querySelectorAll('.note-warn')].map((n) => n.textContent.replace(/\s+/g, ' ').trim())

test('a Live-Formulas preview names the columns written as fixed figures; a Values preview says nothing', async () => {
  await show(<ExportPreviewModal plan={planIn('formulas')} onClose={vi.fn()} />)
  expect(noteText()).toEqual(['Written as fixed figures, not formulas: Logged. These cells will not recalculate if the sheet is changed.'])
  await act(async () => root.unmount())
  root = null
  container.remove()
  await show(<ExportPreviewModal plan={planIn('values')} onClose={vi.fn()} />)
  expect(noteText()).toEqual([])
})

test('two company details with one label: the PDF fill export is refused, naming the label, until one is left out', async () => {
  const details = { address: '', brn: '', customFields: [{ id: 'c1', label: 'Ref', value: 'one' }, { id: 'c2', label: 'Ref', value: 'two' }] }
  await show(
    <PdfFillExportModal
      format="json"
      identityFields={identityFields}
      effectiveColumns={columns}
      employees={employees}
      computedGrid={grid}
      companyName="TEST Co A"
      companyDetails={details}
      year={2026}
      month={9}
      onClose={vi.fn()}
    />
  )
  const exportButton = () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Export JSON')
  const refBoxes = () => [...document.querySelectorAll('label')].filter((l) => l.textContent === 'Ref').map((l) => l.querySelector('input'))
  expect(exportButton().disabled).toBe(false)
  await act(async () => refBoxes()[0].click())
  expect(noteText()).toEqual([])
  await act(async () => refBoxes()[1].click())
  expect(noteText()).toEqual([
    'More than one company detail is called "Ref". Each would overwrite the other in the file. Untick all but one, or rename them in Company Details, to export.',
  ])
  expect(document.querySelector('[role="alert"]').textContent).toContain('"Ref"')
  expect(exportButton().disabled).toBe(true)
  await act(async () => refBoxes()[0].click())
  expect(noteText()).toEqual([])
  expect(exportButton().disabled).toBe(false)
})
