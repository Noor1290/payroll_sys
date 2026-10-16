// @vitest-environment jsdom

// Backlog batch A on the screen: a Tiered column still saved with the old
// rule is flagged in the column list, and a formula that could only ever
// show Error is refused in the column form with a plain first line and a
// hint. TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import ColumnManager from '../../src/components/ColumnManager'
import { getColumnsByKey } from '../../src/lib/model'
import { compileTieredFormulaBeforeFix } from '../../src/lib/tieredFormula'
import { input, simple, tiered } from './build'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root
let container
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  root = container = null
})

async function showColumns(columns, onEdit = vi.fn()) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <ColumnManager
        title="Global Columns"
        columns={columns}
        referenceableColumns={columns}
        allColumnsForCycleCheck={getColumnsByKey(columns)}
        onAdd={vi.fn()}
        onEdit={onEdit}
        onDelete={vi.fn()}
        onReorder={vi.fn()}
        onImportColumns={vi.fn()}
        scope="global"
        totalCompanyCount={1}
        targetCompanyName="TEST Co A"
        getScopeBlockers={() => []}
        getKeyChangePreview={() => null}
        onRenameKey={vi.fn()}
      />
    )
  )
}

const rowOf = (name) => [...container.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('td:nth-child(2)')?.textContent.startsWith(name))

const savedBefore = (name, key, tiers, cap = null) => {
  const state = { baseKey: 'basicSalary', tiers, cap }
  return { ...tiered(name, key, state), formula: compileTieredFormulaBeforeFix(state) }
}

test('a Tiered column still saved with the old rule is flagged in the column list; a corrected one and an unaffected one are not', async () => {
  const twoBelow = [
    { operator: 'below', threshold: 50000, rate: 3 },
    { operator: 'below', threshold: 100000, rate: 5 },
  ]
  await showColumns([
    input('Basic Salary', 'basicSalary'),
    savedBefore('Old Levy', 'oldLevy', twoBelow),
    savedBefore('Old Capped', 'oldCapped', [{ operator: 'above', threshold: 10000, rate: 1 }], 29710),
    tiered('New Levy', 'newLevy', { baseKey: 'basicSalary', tiers: twoBelow, cap: null }),
    savedBefore('NSF Like', 'nsfLike', [{ operator: 'from', threshold: 0, rate: 1 }], 29710),
  ])
  expect(rowOf('Old Levy').querySelector('td:nth-child(2)').textContent).toBe(
    "Old LevyFigures use the old rule, which picked the wrong 'Below' tier. Open and save this column to apply the corrected rule. Its figures will change."
  )
  expect(rowOf('Old Capped').querySelector('td:nth-child(2)').textContent).toBe(
    "Old CappedFigures use the old rule, which ignored this tier's condition because of the cap. Open and save this column to apply the corrected rule. Its figures will change."
  )
  for (const name of ['Basic Salary', 'New Levy', 'NSF Like']) expect(rowOf(name).querySelector('td:nth-child(2)').textContent).toBe(name)
})

function typeInto(field, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

test.each([
  ['min(basicSalary, 5)', ["This formula can't be saved:", 'Unknown column reference: min', 'Did you mean Math.min, Math.max or Math.round?']],
  [
    'basicSalary > 5',
    [
      "This formula can't be saved:",
      'Formula did not return a number (got boolean)',
      'The formula must give a number. For a yes/no rule, use a condition such as (x > 5 ? 1 : 0).',
    ],
  ],
])('the column form refuses "%s", each part on its own line, and saves nothing', async (formula, lines) => {
  const onEdit = vi.fn()
  await showColumns([input('Basic Salary', 'basicSalary'), simple('Doubled', 'doubled', 'basicSalary * 2')], onEdit)
  const edit = [...rowOf('Doubled').querySelectorAll('button')].find((b) => b.textContent === 'Edit')
  await act(async () => edit.click())
  await act(async () => typeInto(document.querySelector('textarea[aria-label="Formula expression"]'), formula))
  const save = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save')
  await act(async () => save.click())
  const message = document.querySelector('[role="alert"] span')
  expect(message.textContent.split('\n')).toEqual(lines)
  expect(message.className).toContain('whitespace-pre-line')
  expect(onEdit).not.toHaveBeenCalled()
})
