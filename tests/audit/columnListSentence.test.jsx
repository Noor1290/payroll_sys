// @vitest-environment jsdom

// TODO C17 (rehearsal L2): the column list showed a built rule as code, e.g.
// "((Age 60+ === 1)) ? (0) : ((Math.min(Basic Salary, 29710)) * (0.01))". It now shows the
// plain sentence the column form shows; a formula typed by hand stays a formula.
// TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import ColumnManager from '../../src/components/ColumnManager'
import { getColumnsByKey } from '../../src/lib/model'
import { describeTieredRule, describeCompareRule } from '../../src/lib/tieredFormula'
import { describeProgressiveRule } from '../../src/lib/progressiveFormula'
import { compileExemptionWrapper, describeExemptionRule } from '../../src/lib/exemptionCondition'
import { checkboxExemption, compare, EMPLOYEE, input, progressive, simple, tiered } from './build'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root
let container
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  root = container = null
})

const nsfTier = { baseKey: 'basicSalary', tiers: [{ operator: 'from', threshold: 0, rate: 1 }], cap: 29710 }
const csgTiers = [
  { operator: 'atOrBelow', threshold: 50000, rate: 1.5 },
  { operator: 'above', threshold: 50000, rate: 3 },
]
const brackets = [
  { width: 38000, rate: 0 },
  { width: 38000, rate: 10 },
  { width: '', rate: 20 },
]

const columns = () => [
  input('Basic Salary', 'basicSalary'),
  input('EDF', 'edf'),
  input('Age 60+', 'age60', { valueType: 'checkbox' }),
  simple('Double Basic', 'doubleBasic', 'basicSalary * 2'),
  simple('Bonus', 'bonus', compileExemptionWrapper(checkboxExemption('age60'), 'basicSalary * 0.1'), { exemption: checkboxExemption('age60') }),
  tiered('Employee CSG', 'employeeCsg', { baseKey: 'basicSalary', tiers: csgTiers, cap: null }, { category: EMPLOYEE }),
  tiered('Employee NSF', 'employeeNsf', nsfTier, { category: EMPLOYEE, exemption: checkboxExemption('age60') }),
  progressive('PAYE', 'paye', { baseKey: 'basicSalary', brackets }, { category: EMPLOYEE }),
  compare('Chargeable', 'chargeable', { columnAKey: 'edf', operator: '>', columnBKey: 'basicSalary', trueExpr: '0', falseExpr: 'Column B - Column A' }),
]

async function draw(cols) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <ColumnManager
        title="Global Columns"
        columns={cols}
        referenceableColumns={cols}
        allColumnsForCycleCheck={getColumnsByKey(cols)}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
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

// The Formula cell (5th) of the row whose name cell starts with `name`.
function ruleOf(name) {
  const row = [...container.querySelectorAll('tbody tr')].find((tr) => tr.children[1]?.textContent.startsWith(name))
  return row.children[4].textContent
}

test('a built rule shows the plain sentence the form shows, not code', async () => {
  const cols = columns()
  await draw(cols)
  const byKey = getColumnsByKey(cols)

  expect(ruleOf('Employee CSG')).toBe('If Basic Salary is 50,000 or below, apply 1.5%. If Basic Salary is above 50,000, apply 3%.')
  expect(ruleOf('Employee NSF')).toBe(
    describeExemptionRule(checkboxExemption('age60'), byKey, describeTieredRule('Basic Salary', nsfTier.tiers, 29710))
  )
  expect(ruleOf('Employee NSF')).toMatch(/^If "Age 60\+" is ticked, this amount is 0\. Otherwise: /)
  expect(ruleOf('PAYE')).toBe(describeProgressiveRule(brackets))
  expect(ruleOf('Chargeable')).toBe(describeCompareRule('EDF', 'Basic Salary', '>', '0', 'Column B - Column A'))
  for (const name of ['Employee CSG', 'Employee NSF', 'PAYE', 'Chargeable']) {
    expect(ruleOf(name)).not.toMatch(/\?|===|Math\./)
  }
})

test('a formula typed by hand stays a readable formula, with its exemption in words', async () => {
  await draw(columns())
  expect(ruleOf('Double Basic')).toBe('Basic Salary * 2')
  expect(ruleOf('Bonus')).toBe('If "Age 60+" is ticked, this amount is 0. Otherwise: Basic Salary * 0.1')
  expect(ruleOf('Basic Salary')).toBe('—')
})
