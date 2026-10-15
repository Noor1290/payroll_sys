// What restoring an earlier column setup would change (src/lib/setupChanges.js): names
// and keys only, followed by each column's id. TEST data only.

import { describe, expect, test } from 'vitest'
import { describeSetupChange } from '../../src/lib/setupChanges'
import { identityFields, idFieldKey, globalColumns, company } from '../safetyNet/fixture'

const json = (value) => JSON.parse(JSON.stringify(value))
const shared = json({ identityFields, idFieldKey, globalColumns })
const own = json({ columns: company.columns, customFields: company.details.customFields })

// As the database gives an object back: its properties in another order.
function reordered(value) {
  if (Array.isArray(value)) return value.map(reordered)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reordered(value[key])]))
}

describe('describeSetupChange', () => {
  test('the same setup is no change, whatever the order of its properties', () => {
    expect(describeSetupChange(shared, reordered(shared), 'shared').none).toBe(true)
    expect(describeSetupChange(own, reordered(own), 'company').none).toBe(true)
  })

  test('a key that changes is one change of key, followed by the column id, not a column gone and another added', () => {
    const then = json(shared)
    then.globalColumns.find((c) => c.key === 'travelling').key = 'travel'
    const change = describeSetupChange(shared, then, 'shared')
    expect(change.keys).toEqual([{ name: 'Travelling', from: 'travelling', to: 'travel' }])
    expect(change.added).toEqual([])
    expect(change.removed).toEqual([])
  })

  test('names every formula that changes, with both expressions', () => {
    const then = json(shared)
    then.globalColumns.find((c) => c.key === 'netPay').formula = 'grossPay - totalDeductions - 100'
    expect(describeSetupChange(shared, then, 'shared').formulas).toEqual([
      { name: 'Net Pay', key: 'netPay', from: 'grossPay - totalDeductions', to: 'grossPay - totalDeductions - 100' },
    ])
  })

  test('columns that come back and columns that go, an identity field, and the ID field', () => {
    const then = json(shared)
    then.globalColumns = then.globalColumns.filter((c) => c.key !== 'netPay')
    then.globalColumns.push({ id: 'col-bonus', key: 'bonus', name: 'Bonus', type: 'input' })
    then.identityFields = then.identityFields.filter((f) => f.key !== 'otherNames')
    then.idFieldKey = 'surname'
    const change = describeSetupChange(shared, then, 'shared')
    expect(change.added).toEqual([{ name: 'Bonus', key: 'bonus', kind: 'column' }])
    expect(change.removed).toEqual([
      { name: 'Other names', key: 'otherNames', kind: 'identity' },
      { name: 'Net Pay', key: 'netPay', kind: 'column' },
    ])
    expect(change.idField).toEqual({ from: 'id', to: 'surname' })
  })

  test("a company's custom details and other settings of a column", () => {
    const then = json(own)
    then.customFields[0].value = 'VAT-FAKE-2'
    then.columns.find((c) => c.key === 'levy').decimals = 2
    const change = describeSetupChange(own, then, 'company')
    expect(change.details).toBe(true)
    expect(change.settings).toEqual([{ name: 'Levy', key: 'levy' }])
    expect(change.formulas).toEqual([])
  })
})
