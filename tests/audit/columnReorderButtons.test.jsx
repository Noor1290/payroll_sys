// @vitest-environment jsdom

// TODO C19 (rehearsal L4): columns could only be put in order by dragging. Each column now has
// "Move up" and "Move down" buttons, which a keyboard reaches, and which move it as a drop would.
// TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import ColumnManager from '../../src/components/ColumnManager'
import { reorderWithinCategory } from '../../src/lib/categories'
import { getColumnsByKey } from '../../src/lib/model'
import { EMPLOYEE, input, simple } from './build'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root
let container
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  root = container = null
})

function Manager({ columns, onReorder, readOnly = false }) {
  return (
    <ColumnManager
      title="Global Columns"
      columns={columns}
      referenceableColumns={columns}
      allColumnsForCycleCheck={getColumnsByKey(columns)}
      onAdd={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onReorder={onReorder}
      onImportColumns={vi.fn()}
      scope="global"
      totalCompanyCount={1}
      targetCompanyName="TEST Co A"
      getScopeBlockers={() => []}
      getKeyChangePreview={() => null}
      onRenameKey={vi.fn()}
      readOnly={readOnly}
    />
  )
}

const start = () => [
  input('Basic Salary', 'basicSalary'),
  input('Allowances', 'allowances'),
  input('Travelling', 'travelling'),
  simple('Employee CSG', 'employeeCsg', 'basicSalary * 0.015', { category: EMPLOYEE }),
]
const names = (columns) => columns.map((c) => c.name)
const button = (label) => container.querySelector(`button[aria-label="${label}"]`)

test('Move up and Move down move a column one place within its category, as a drop does', async () => {
  let columns = start()
  const onReorder = vi.fn((id, otherId) => {
    columns = reorderWithinCategory(columns, id, otherId)
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const draw = () => act(async () => root.render(<Manager columns={columns} onReorder={onReorder} />))
  await draw()

  expect(button('Move Basic Salary up').disabled).toBe(true)
  expect(button('Move Travelling down').disabled).toBe(true)
  // A column alone in its category moves neither way.
  expect([button('Move Employee CSG up').disabled, button('Move Employee CSG down').disabled]).toEqual([true, true])
  expect(button('Move Allowances up').title).toBe('Move up')

  await act(async () => button('Move Allowances up').click())
  await draw()
  expect(names(columns)).toEqual(['Allowances', 'Basic Salary', 'Travelling', 'Employee CSG'])

  await act(async () => button('Move Allowances down').click())
  await draw()
  expect(names(columns)).toEqual(['Basic Salary', 'Allowances', 'Travelling', 'Employee CSG'])

  await act(async () => button('Move Allowances down').click())
  await draw()
  expect(names(columns)).toEqual(['Basic Salary', 'Travelling', 'Allowances', 'Employee CSG'])
  expect(onReorder).toHaveBeenCalledTimes(3)
})

test('read-only (another tab holds the data): no buttons', async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<Manager columns={start()} onReorder={vi.fn()} readOnly />))
  expect(container.querySelector('button[aria-label^="Move "]')).toBeNull()
})
