// Browser test 1: starting from an empty app, build a company and one column
// of every kind through the real forms, then check the figures on screen.
// TEST data only. Tests in this file run in order and share one page.

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  startApp,
  openEmpty,
  storedState,
  storedPeriod,
  readEmployeeTable,
  readColumnList,
  groupHeaders,
  tab,
  dialog,
  addColumn,
  addEmployee,
  openEditColumn,
  employeeRow,
} from './app'

let app
let page
let context
let outsideRequests

beforeAll(async () => {
  app = await startApp()
  ;({ context, page, outsideRequests } = await openEmpty(app))
})
afterAll(async () => {
  await context?.close()
  await app?.close()
})

const firstRow = async () => (await readEmployeeTable(page))[0]

describe('a new company', () => {
  test('the app starts with no company', async () => {
    expect(await page.getByText('No company selected').isVisible()).toBe(true)
  })

  test('"+ New Company" opens its details: name, address, BRN and a custom field', async () => {
    await page.getByRole('button', { name: '+ New Company' }).click()
    const details = dialog(page, 'Company 1 — Details')
    await details.getByLabel('Company Name', { exact: true }).fill('TEST Co A')
    await details.getByLabel('Address', { exact: true }).fill('1 Test Street\nTestville')
    await details.getByLabel('BRN', { exact: true }).fill('TEST-BRN-A')
    await details.getByRole('button', { name: '+ Add Field' }).click()
    await details.getByLabel('Label, e.g. VAT No').fill('VAT No')
    await details.getByLabel('Value', { exact: true }).fill('TEST-VAT-1')
    await details.getByRole('button', { name: 'Save', exact: true }).click()
    await details.waitFor({ state: 'hidden' })

    await page.getByRole('button', { name: 'TEST Co A', exact: true }).waitFor()
    const state = await storedState(page)
    expect(state.companies).toHaveLength(1)
    expect(state.companies[0].name).toBe('TEST Co A')
    expect(state.companies[0].details).toMatchObject({ address: '1 Test Street\nTestville', brn: 'TEST-BRN-A' })
    expect(state.companies[0].details.customFields.map((f) => [f.label, f.value])).toEqual([['VAT No', 'TEST-VAT-1']])
  })

  test('the default identity fields are ID, Name and Surname, with ID as the ID field', async () => {
    const state = await storedState(page)
    expect(state.identityFields.map((f) => [f.name, f.key])).toEqual([['ID', 'id'], ['Name', 'name'], ['Surname', 'surname']])
    expect(state.idFieldKey).toBe('id')
  })
})

describe('global columns, built in the forms', () => {
  test('input columns: number, text and checkbox', async () => {
    await tab(page, 'Global Columns').click()
    expect((await addColumn(page, { name: 'Basic Salary' })).key).toBe('basicSalary')
    expect((await addColumn(page, { name: 'Govt Increment' })).key).toBe('govtIncrement')
    expect((await addColumn(page, { name: 'Status', valueType: 'Text' })).key).toBe('status')
    expect((await addColumn(page, { name: 'Age 60+', valueType: 'Checkbox (Yes/No)' })).key).toBe('age60')
    expect((await addColumn(page, { name: 'EDF', category: 'Other Deductions' })).key).toBe('edf')
  })

  test('a simple formula', async () => {
    const saved = await addColumn(page, {
      name: 'New Basic',
      type: 'formula',
      fill: (form) => form.getByLabel('Formula expression').fill('basicSalary + govtIncrement'),
    })
    expect(saved.key).toBe('newBasic')
  })

  test('invalid syntax is rejected on save', async () => {
    const result = await addColumn(page, {
      name: 'Broken One',
      type: 'formula',
      fill: (form) => form.getByLabel('Formula expression').fill('basicSalary +'),
      expectError: true,
    })
    expect(result.error).toContain('Syntax error')
  })

  test('a formula that names a column that does not exist is rejected on save', async () => {
    const result = await addColumn(page, {
      name: 'Broken Two',
      type: 'formula',
      fill: (form) => form.getByLabel('Formula expression').fill('basicSalary + nothingHere'),
      expectError: true,
    })
    expect(result.error).toBe('Unknown column reference: nothingHere')
  })

  test('an empty formula is rejected on save', async () => {
    const result = await addColumn(page, { name: 'Broken Three', type: 'formula', expectError: true })
    expect(result.error).toBe('Formula cannot be empty')
  })

  test('nothing rejected was saved', async () => {
    const state = await storedState(page)
    expect(state.globalColumns.map((c) => c.name)).toEqual(['Basic Salary', 'Govt Increment', 'Status', 'Age 60+', 'EDF', 'New Basic'])
  })

  test('tiered: CSG for the employee, 1.5% below 50,001 and 3% above 50,000', async () => {
    const saved = await addColumn(page, {
      name: 'CSG',
      category: 'Employee Contribution',
      type: 'formula',
      fill: async (form) => {
        await form.getByRole('button', { name: 'Tiered / Conditional' }).click()
        await form.getByLabel('Base value column').selectOption({ label: 'New Basic' })
        await form.getByLabel('Tiers').nth(0).selectOption({ label: 'Below' })
        await form.getByLabel('amount', { exact: true }).nth(0).fill('50001')
        await form.getByLabel('rate', { exact: true }).nth(0).fill('1.5')
        await form.getByRole('button', { name: '+ Add Tier' }).click()
        await form.getByLabel('Tiers').nth(1).selectOption({ label: 'Above' })
        await form.getByLabel('amount', { exact: true }).nth(1).fill('50000')
        await form.getByLabel('rate', { exact: true }).nth(1).fill('3')
        expect(await form.locator('.note-accent').textContent()).toBe('If New Basic is above 50,000, apply 3%. If New Basic is below 50,001, apply 1.5%.')
      },
    })
    expect(saved.key).toBe('csg')
  })

  test('a second column called "CSG", for the employer, gets its own key and says so', async () => {
    const saved = await addColumn(page, {
      name: 'CSG',
      category: 'Employer Contribution',
      type: 'formula',
      fill: async (form) => {
        expect(await form.getByText('auto-adjusted to avoid a naming collision').isVisible()).toBe(true)
        await form.getByLabel('Formula expression').fill('newBasic * 0.03')
      },
    })
    expect(saved.key).toBe('csg_employer')
  })

  test('one rate with a cap and a checkbox exemption: NSF', async () => {
    await addColumn(page, {
      name: 'NSF',
      category: 'Employee Contribution',
      type: 'formula',
      fill: async (form) => {
        await form.getByRole('button', { name: 'Tiered / Conditional' }).click()
        await form.getByLabel('Base value column').selectOption({ label: 'New Basic' })
        await form.getByLabel('Tiers').nth(0).selectOption({ label: 'From' })
        await form.getByLabel('amount', { exact: true }).nth(0).fill('0')
        await form.getByLabel('rate', { exact: true }).nth(0).fill('1')
        await form.getByLabel(/Cap \/ Ceiling/).check()
        await form.getByLabel('maximum amount').fill('29710')
        await form.getByLabel('Add an exemption / override condition').check()
        await form.getByLabel('Checkbox column').selectOption({ label: 'Age 60+' })
        expect(await form.locator('.note-warn').textContent()).toBe('If "Age 60+" is ticked, this amount is 0. Otherwise: 1% of New Basic, up to a maximum of 29,710.')
      },
    })
  })

  test('progressive brackets: PAYE', async () => {
    await addColumn(page, {
      name: 'PAYE',
      category: 'Employee Contribution',
      type: 'formula',
      fill: async (form) => {
        await form.getByRole('button', { name: 'Progressive Brackets' }).click()
        await form.getByLabel('Base value column').selectOption({ label: 'New Basic' })
        await form.getByRole('button', { name: '+ Add Bracket' }).click()
        await form.getByLabel('width', { exact: true }).nth(0).fill('38000')
        await form.getByLabel('rate', { exact: true }).nth(0).fill('0')
        await form.getByLabel('width', { exact: true }).nth(1).fill('38000')
        await form.getByLabel('rate', { exact: true }).nth(1).fill('10')
        await form.getByLabel('rate', { exact: true }).nth(2).fill('20')
        expect(await form.locator('.note-accent').textContent()).toBe('First 38,000 taxed at 0%. Next 38,000 (38,000–76,000) taxed at 10%. Remainder above 76,000 taxed at 20%.')
      },
    })
  })

  test('compare two columns: EDF against New Basic', async () => {
    await addColumn(page, {
      name: 'Chargeable',
      category: 'Other Deductions',
      type: 'formula',
      fill: async (form) => {
        await form.getByRole('button', { name: 'Tiered / Conditional' }).click()
        await form.getByRole('button', { name: 'Compare Two Columns' }).click()
        await form.getByLabel('Column A', { exact: true }).selectOption({ label: 'EDF' })
        await form.getByLabel('Comparison', { exact: true }).selectOption({ label: 'Greater than (>)' })
        await form.getByLabel('Column B', { exact: true }).selectOption({ label: 'New Basic' })
        await form.getByLabel('Result if TRUE').fill('0')
        await form.getByLabel('Result if FALSE').fill('Column B - Column A')
        expect(await form.locator('.note-accent').textContent()).toBe('If EDF is greater than New Basic, use 0. Otherwise, use New Basic − EDF.')
      },
    })
  })

  test('the saved formulas are the expected expressions', async () => {
    const state = await storedState(page)
    const formula = (key) => state.globalColumns.find((c) => c.key === key).formula
    expect(formula('newBasic')).toBe('basicSalary + govtIncrement')
    expect(formula('csg')).toBe('(newBasic) * (newBasic < 50001 ? 0.015 : newBasic > 50000 ? 0.03 : 0)')
    expect(formula('nsf')).toBe('((age60 === 1)) ? (0) : ((Math.min(newBasic, 29710)) * (0.01))')
    expect(formula('paye')).toBe('(Math.max(0, Math.min(newBasic, 38000) - 0)) * 0 + (Math.max(0, Math.min(newBasic, 76000) - 38000)) * 0.1 + (Math.max(0, newBasic - 76000)) * 0.2')
    expect(formula('chargeable')).toBe('(edf > newBasic) ? (0) : (newBasic - edf)')
  })

  test('a circular reference is flagged on save, with its path', async () => {
    const form = await openEditColumn(page, 'New Basic')
    await form.getByLabel('Formula expression').fill('basicSalary + chargeable')
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await form.getByRole('alert').textContent()).trim()).toBe('Circular reference detected: newBasic → chargeable → newBasic')
    await form.getByRole('button', { name: 'Cancel', exact: true }).click()
    await form.waitFor({ state: 'hidden' })
    const state = await storedState(page)
    expect(state.globalColumns.find((c) => c.key === 'newBasic').formula).toBe('basicSalary + govtIncrement')
  })

  test('the column list shows formulas with column names, not keys', async () => {
    const list = await readColumnList(page)
    const formula = (name, nth = 0) => list.filter((c) => c.name === name)[nth].formula
    expect(formula('New Basic')).toBe('Basic Salary + Govt Increment')
    expect(formula('NSF')).toBe('((Age 60+ === 1)) ? (0) : ((Math.min(New Basic, 29710)) * (0.01))')
    expect(formula('CSG', 1)).toBe('New Basic * 0.03')
    expect(formula('Chargeable')).toBe('(EDF > New Basic) ? (0) : (New Basic - EDF)')
    for (const column of list) expect(column.formula, column.name).not.toMatch(/newBasic|basicSalary|govtIncrement|age60/)
  })
})

describe('the Employee Table', () => {
  test('a new month starts empty', async () => {
    await tab(page, 'Employee Table').click()
    expect(await page.getByText('No employees this month').isVisible()).toBe(true)
  })

  test('the header has the grouped categories and both CSG columns', async () => {
    await addEmployee(page, { ID: 'TST001', Name: 'Alpha', Surname: 'Tester', 'Basic Salary': '18115', 'Govt Increment': '635', Status: 'Full Time', EDF: '9000' })
    expect(await groupHeaders(page)).toEqual([
      ['Identifiers', 3],
      ['General', 5],
      ['Employee Contribution', 3],
      ['Employer Contribution', 1],
      ['Other Deductions', 2],
    ])
    expect(Object.keys(await firstRow())).toEqual([
      'ID', 'Name', 'Surname',
      'Basic Salary', 'Govt Increment', 'Status', 'Age 60+', 'New Basic',
      'CSG (Employee Contribution)', 'NSF', 'PAYE',
      'CSG (Employer Contribution)',
      'EDF', 'Chargeable',
    ])
  })

  test('the regression example: 18,115 + 635 = 18,750; CSG 281.25; NSF 187.50', async () => {
    const row = await firstRow()
    expect(row['New Basic']).toBe('18,750.00')
    expect(row['CSG (Employee Contribution)']).toBe('281.25')
    expect(row.NSF).toBe('187.50')
    expect(row.PAYE).toBe('0.00')
    expect(row['CSG (Employer Contribution)']).toBe('562.50')
    expect(row.Chargeable).toBe('9,750.00')
  })

  test('number inputs show the column\'s decimals at rest; the stored value is what was typed', async () => {
    const row = await firstRow()
    expect(row['Basic Salary']).toBe('18115.00')
    const [stored] = await storedPeriod(page, (await storedState(page)).companies[0].id, currentPeriod())
    expect(stored.values.basicSalary).toBe('18115')
  })

  test('a text column keeps its text and never becomes 0', async () => {
    expect((await firstRow()).Status).toBe('Full Time')
  })

  test('ticking Age 60+ makes NSF 0; unticking brings it back', async () => {
    await employeeRow(page, 0).getByLabel('Age 60+', { exact: true }).check()
    expect((await firstRow()).NSF).toBe('0.00')
    await employeeRow(page, 0).getByLabel('Age 60+', { exact: true }).uncheck()
    expect((await firstRow()).NSF).toBe('187.50')
  })

  // The brief asks for "select all / clear all" on a checkbox column.
  test('evidence (MISSING): there is no "select all / clear all" for a checkbox column', async () => {
    expect(await page.getByRole('button', { name: /select all|clear all/i }).count()).toBe(0)
  })

  test('a salary over the cap and into the top bracket', async () => {
    await addEmployee(page, { ID: 'TST002', Name: 'Beta', Surname: 'Tester', 'Basic Salary': '95000', 'Govt Increment': '5000', EDF: '390000' })
    const row = (await readEmployeeTable(page))[1]
    expect(row['New Basic']).toBe('100,000.00')
    expect(row['CSG (Employee Contribution)']).toBe('3,000.00')
    expect(row.NSF).toBe('297.10')
    expect(row.PAYE).toBe('8,600.00')
    expect(row.Chargeable).toBe('0.00')
  })

  test('number inputs have no spinner arrows', async () => {
    // A page cannot measure the arrows themselves, so this checks the rules
    // that remove them are loaded and apply to every number input.
    const rules = await page.evaluate(() => {
      const found = []
      const walk = (list) => {
        for (const rule of list) {
          if (rule.cssRules) walk(rule.cssRules)
          if (rule.selectorText?.includes('spin-button')) found.push([rule.selectorText.replace(/\s+/g, ' '), rule.style.getPropertyValue('-webkit-appearance') || rule.style.getPropertyValue('appearance')])
        }
      }
      for (const sheet of document.styleSheets) walk(sheet.cssRules)
      return found
    })
    const selectors = rules.map((r) => r[0]).join(', ')
    expect(selectors).toContain('input[type="number"]::-webkit-outer-spin-button')
    expect(selectors).toContain('input[type="number"]::-webkit-inner-spin-button')
    const own = rules.filter(([selector]) => selector.includes('input[type="number"]'))
    expect(own.length).toBeGreaterThan(0)
    for (const [selector, appearance] of own) expect(appearance, selector).toBe('none')
    expect(await employeeRow(page, 0).getByLabel('Basic Salary', { exact: true }).getAttribute('type')).toBe('number')
  })

  test('default column widths: 140 for the ID, 160 for other identity fields, 120 for the rest', async () => {
    const widths = await page.evaluate(() => [...document.querySelectorAll('table[style*="table-layout"] colgroup col')].map((c) => c.style.width))
    expect(widths.slice(0, 5)).toEqual(['140px', '160px', '160px', '120px', '120px'])
    const rendered = await page.evaluate(() => [...document.querySelectorAll('table[style*="table-layout"] thead tr:nth-child(2) th')].slice(0, 4).map((th) => Math.round(th.getBoundingClientRect().width)))
    expect(rendered).toEqual([140, 160, 160, 120])
  })
})

describe('the breakdown view', () => {
  async function openBreakdown(rowIndex, columnLabel) {
    const index = Object.keys(await firstRow()).indexOf(columnLabel)
    await employeeRow(page, rowIndex).locator('td').nth(index).getByRole('button').click()
    const box = page.getByRole('dialog')
    await box.waitFor()
    return box
  }
  async function close(box) {
    await box.getByRole('button', { name: 'Close' }).click()
    await box.waitFor({ state: 'hidden' })
  }

  test('simple formula: names in the formula, figures substituted', async () => {
    const box = await openBreakdown(0, 'New Basic')
    const text = await box.textContent()
    expect(text).toContain('Breakdown: New Basic')
    expect(text).toContain('Basic Salary + Govt Increment')
    expect(text).toContain('18115.00 + 635.00')
    expect(text).toContain('18,750.00')
    expect(text).not.toMatch(/basicSalary|govtIncrement/)
    await close(box)
  })

  test('tiered with an exemption that does not apply', async () => {
    const box = await openBreakdown(0, 'NSF')
    const text = await box.textContent()
    expect(text).toContain("'Age 60+' is not ticked, so the normal calculation applies:")
    expect(text).toContain('New Basic: 18,750.00. 18,750.00 × 1% = 187.50.')
    expect(text).not.toMatch(/newBasic|age60/)
    await close(box)
  })

  test('over the cap', async () => {
    const box = await openBreakdown(1, 'NSF')
    expect(await box.textContent()).toContain('New Basic: 100,000.00. Capped at 29,710.00 → 29,710.00 × 1% = 297.10.')
    await close(box)
  })

  test('progressive', async () => {
    const box = await openBreakdown(1, 'PAYE')
    expect(await box.textContent()).toContain(
      'New Basic: 100,000.00. First 38,000 @ 0% = 0.00. Next 38,000 (38,000–76,000) @ 10% = 3,800.00. Remainder (24,000.00 above 76,000.00) @ 20% = 4,800.00. Total: 8,600.00.'
    )
    await close(box)
  })

  test('compare two columns', async () => {
    const box = await openBreakdown(0, 'Chargeable')
    expect(await box.textContent()).toContain('EDF: 9,000.00. New Basic: 18,750.00. 9,000.00 is not greater than 18,750.00 → 18,750.00 − 9,000.00 = 9,750.00.')
    await close(box)
  })

  test('nested: a dependency opens to its own breakdown', async () => {
    const box = await openBreakdown(0, 'CSG (Employee Contribution)')
    expect(await box.textContent()).toContain('New Basic: 18,750.00. This is below 50,001.00 → rate: 1.5%. 18,750.00 × 1.5% = 281.25.')
    const dependency = box.getByRole('button', { name: /New Basic/ })
    expect(await dependency.getAttribute('aria-expanded')).toBe('false')
    await dependency.click()
    expect(await dependency.getAttribute('aria-expanded')).toBe('true')
    const text = await box.textContent()
    expect(text).toContain('Basic Salary + Govt Increment')
    expect(text).toContain('18115.00 + 635.00')
    await close(box)
  })
})

describe('renaming and reopening', () => {
  test('renaming a column does not break the formulas that use it', async () => {
    await tab(page, 'Global Columns').click()
    const form = await openEditColumn(page, 'Basic Salary')
    await form.getByLabel('Name', { exact: true }).fill('Base Pay')
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await form.waitFor({ state: 'hidden' })

    const list = await readColumnList(page)
    expect(list.find((c) => c.name === 'Base Pay').key).toBe('basicSalary')
    expect(list.find((c) => c.name === 'New Basic').formula).toBe('Base Pay + Govt Increment')

    await tab(page, 'Employee Table').click()
    const row = await firstRow()
    expect(row['Base Pay']).toBe('18115.00')
    expect(row['New Basic']).toBe('18,750.00')
    expect(row.NSF).toBe('187.50')
  })

  test('a tiered column reopens in the visual builder with its settings', async () => {
    await tab(page, 'Global Columns').click()
    const form = await openEditColumn(page, 'NSF')
    expect(await form.getByLabel('Base value column').inputValue()).toBe('newBasic')
    expect(await form.getByLabel('Tiers').nth(0).inputValue()).toBe('from')
    expect(await form.getByLabel('rate', { exact: true }).nth(0).inputValue()).toBe('1')
    expect(await form.getByLabel('maximum amount').inputValue()).toBe('29710')
    expect(await form.getByLabel('Add an exemption / override condition').isChecked()).toBe(true)
    expect(await form.getByLabel('Checkbox column').inputValue()).toBe('age60')
    await form.getByRole('button', { name: 'Cancel', exact: true }).click()
    await form.waitFor({ state: 'hidden' })
  })

  test('a progressive column reopens in the visual builder with its brackets', async () => {
    const form = await openEditColumn(page, 'PAYE')
    expect(await form.getByLabel('width', { exact: true }).nth(0).inputValue()).toBe('38000')
    expect(await form.getByLabel('width', { exact: true }).nth(1).inputValue()).toBe('38000')
    expect(await form.getByLabel('rate', { exact: true }).nth(2).inputValue()).toBe('20')
    expect(await form.getByText('Remainder', { exact: true }).isVisible()).toBe(true)
    await form.getByRole('button', { name: 'Cancel', exact: true }).click()
    await form.waitFor({ state: 'hidden' })
  })

  // KNOWN_ISSUES.md no. 4 (fixed): a Simple formula with an exemption is
  // covered in tests/audit/dashboardApp.test.jsx.
  test('saving a tiered column again without changes leaves its formula as it was', async () => {
    const before = (await storedState(page)).globalColumns.find((c) => c.key === 'nsf').formula
    const form = await openEditColumn(page, 'NSF')
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await form.waitFor({ state: 'hidden' })
    expect((await storedState(page)).globalColumns.find((c) => c.key === 'nsf').formula).toBe(before)
  })
})

describe('after a reload', () => {
  test('the company, the columns, the employees and the figures are all still there', async () => {
    const before = await storedState(page)
    // The one difference a reload makes: a checkbox column is given
    // "decimals: 2", which nothing uses.
    before.globalColumns.find((c) => c.key === 'age60').decimals = 2
    await page.reload()
    await page.getByRole('button', { name: 'TEST Co A', exact: true }).waitFor()
    await tab(page, 'Employee Table').click()
    const rows = await readEmployeeTable(page)
    expect(rows.map((r) => r.ID)).toEqual(['TST001', 'TST002'])
    expect(rows[0]['New Basic']).toBe('18,750.00')
    expect(rows[0]['CSG (Employee Contribution)']).toBe('281.25')
    expect(rows[0].NSF).toBe('187.50')
    expect(rows[0].Status).toBe('Full Time')
    expect(await storedState(page)).toEqual(before)
  })

  test('nothing was requested from outside the machine', () => {
    expect(outsideRequests).toEqual([])
  })
})

// A company created through the app opens on the current real month.
function currentPeriod() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
