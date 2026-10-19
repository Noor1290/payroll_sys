// @vitest-environment jsdom

// A cap that cuts off the tier (the NSF trap): "Below 29,710 at 1%" with a cap
// of 29,710 gives 0 to anyone on 29,710 or more, where "From 0" was meant. The
// Tiered column form says so (and still saves), and the column list says it for
// a column already saved that way. TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import ColumnManager from '../../src/components/ColumnManager'
import { getColumnsByKey } from '../../src/lib/model'
import { compileTieredFormulaBeforeFix, describeTierStop, tierStopsBeforeCap } from '../../src/lib/tieredFormula'
import { computeValues, input, tiered } from './build'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const below = (threshold, rate) => ({ operator: 'below', threshold, rate })
const from = (threshold, rate) => ({ operator: 'from', threshold, rate })
const above = (threshold, rate) => ({ operator: 'above', threshold, rate })
const equal = (threshold, rate) => ({ operator: 'equal', threshold, rate })

const NSF_TRAP = { baseKey: 'grossPay', tiers: [below(29710, 1)], cap: 29710 }

describe('which rules leave everything from some point up at 0%, with a cap', () => {
  test('the NSF trap: the figures really are 0 from 29,710 up, and that is what is found', () => {
    const columns = [input('Gross Pay', 'grossPay'), tiered('Employee NSF', 'nsf', NSF_TRAP)]
    expect(computeValues(columns, { grossPay: 29709 }).nsf).toBeCloseTo(297.09, 6)
    expect(computeValues(columns, { grossPay: 29710 }).nsf).toBe(0)
    expect(computeValues(columns, { grossPay: 60000 }).nsf).toBe(0)

    expect(tierStopsBeforeCap(NSF_TRAP)).toEqual({ at: 29710, inclusive: true, tierCount: 1 })
    expect(describeTierStop('Gross Pay', tierStopsBeforeCap(NSF_TRAP))).toBe(
      'Anyone with Gross Pay of 29,710 or more gets 0%, because the tier stops at 29,710.'
    )
  })

  test.each([
    ['a cap below the tier', [below(29710, 1)], 20000, { at: 29710, inclusive: true, tierCount: 1 }],
    ['a cap above the tier', [below(29710, 1)], 50000, { at: 29710, inclusive: true, tierCount: 1 }],
    ['two "Below" tiers', [below(10000, 1), below(29710, 2)], 29710, { at: 29710, inclusive: true, tierCount: 2 }],
    ['an "Equal to" tier on its own', [equal(5000, 1)], 29710, { at: 5000, inclusive: false, tierCount: 1 }],
    ['a top tier at 0%', [from(0, 1), from(29710, 0)], 29710, { at: 29710, inclusive: true, tierCount: 2 }],
  ])('found: %s', (_, tiers, cap, expected) => {
    expect(tierStopsBeforeCap({ baseKey: 'grossPay', tiers, cap })).toEqual(expected)
  })

  test.each([
    ['"From 0" with a cap (what was meant)', [from(0, 1)], 29710],
    ['"Below" with no cap', [below(29710, 1)], null],
    ['a cap with no amount yet', [below(29710, 1)], ''],
    ['a gap in the middle, but a rate at the top', [below(10000, 1), above(50000, 2)], 60000],
    ['"Above" on its own', [above(10000, 1)], 29710],
    ['0% everywhere', [below(29710, 0)], 29710],
    ['a rate only below 0', [below(0, 1)], 29710],
  ])('not found: %s', (_, tiers, cap) => {
    expect(tierStopsBeforeCap({ baseKey: 'grossPay', tiers, cap })).toBeNull()
  })

  test('the wording for several tiers, and for "above"', () => {
    expect(describeTierStop('Gross Pay', { at: 29710, inclusive: true, tierCount: 2 })).toBe(
      'Anyone with Gross Pay of 29,710 or more gets 0%, because the tiers stop at 29,710.'
    )
    expect(describeTierStop('Basic Salary', { at: 5000, inclusive: false, tierCount: 1 })).toBe(
      'Anyone with Basic Salary above 5,000 gets 0%, because the tier stops at 5,000.'
    )
  })
})

// ---------- on the screen ----------

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
const nameCell = (name) => rowOf(name).querySelector('td:nth-child(2)').textContent
const buttonIn = (within, label) => [...within.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
const formNote = () => [...document.querySelectorAll('[role="dialog"] [role="note"]')].map((n) => n.textContent.replace(/\s+/g, ' ').trim())

async function setNumber(el, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  await act(async () => {
    setter.call(el, String(value))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function setSelect(el, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
  await act(async () => {
    setter.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

test('the column list notes a column already saved with the trap; not one saved right, nor one still on the old rule', async () => {
  await showColumns([
    input('Gross Pay', 'grossPay'),
    tiered('Employee NSF', 'nsf', NSF_TRAP),
    tiered('Right NSF', 'rightNsf', { baseKey: 'grossPay', tiers: [from(0, 1)], cap: 29710 }),
    // Saved before the October 2026 fix: its figures still ignore the condition (its own note says so).
    { ...tiered('Old NSF', 'oldNsf', NSF_TRAP), formula: compileTieredFormulaBeforeFix(NSF_TRAP) },
  ])
  expect(nameCell('Employee NSF')).toBe('Employee NSFAnyone with Gross Pay of 29,710 or more gets 0%, because the tier stops at 29,710.')
  expect(nameCell('Right NSF')).toBe('Right NSF')
  expect(nameCell('Old NSF')).not.toContain('Anyone with')
})

test('the Tiered form warns as the trap is built, and still saves it', async () => {
  const onEdit = vi.fn()
  await showColumns([input('Gross Pay', 'grossPay'), tiered('Employee NSF', 'nsf', { baseKey: 'grossPay', tiers: [from(0, 1)], cap: 29710 })], onEdit)
  await act(async () => buttonIn(rowOf('Employee NSF'), 'Edit').click())
  expect(formNote()).toEqual([])

  // "From" turned into "Below 29,710": the cap now cuts off the tier.
  await setSelect(document.querySelector('[role="dialog"] select[aria-label="Tiers"]'), 'below')
  await setNumber(document.querySelector('[role="dialog"] input[aria-label="amount"]'), 29710)
  expect(formNote()).toEqual(["Anyone with Gross Pay of 29,710 or more gets 0%, because the tier stops at 29,710. Did you mean 'From 0'?"])

  await act(async () => buttonIn(document.querySelector('[role="dialog"]'), 'Save').click())
  expect(onEdit).toHaveBeenCalledTimes(1)
  expect(onEdit.mock.calls[0][1].tiered).toEqual(NSF_TRAP)
})

test('with several tiers the form asks whether the last tier should start with "From"', async () => {
  await showColumns([
    input('Gross Pay', 'grossPay'),
    tiered('Levy', 'levy', { baseKey: 'grossPay', tiers: [below(10000, 1), below(29710, 2)], cap: 29710 }),
  ])
  await act(async () => buttonIn(rowOf('Levy'), 'Edit').click())
  expect(formNote()).toEqual(["Anyone with Gross Pay of 29,710 or more gets 0%, because the tiers stop at 29,710. Did you mean the last tier to start with 'From'?"])
})
