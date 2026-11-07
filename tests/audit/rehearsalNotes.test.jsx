// @vitest-environment jsdom

// TODO C21, the Payroll System's small notes from the rehearsal of 17 October 2026:
//   2.14 the delete question told two "CSG" columns apart only by their keys;
//   5.x  the CSV export had no byte order mark, so Excel showed accents garbled;
//   2.9  the summary of overlapping tiers did not say which one applies.
// TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import ColumnManager from '../../src/components/ColumnManager'
import { getColumnsByKey } from '../../src/lib/model'
import { buildCsvContent, CSV_BOM, csvFileContent } from '../../src/lib/pdfFillExport'
import { describeTieredRule } from '../../src/lib/tieredFormula'
import { EMPLOYEE, EMPLOYER, input, simple } from './build'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root
let container
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  root = container = null
})

describe('the delete question names the column as the formula list does (2.14)', () => {
  const columns = [
    input('Basic Salary', 'basicSalary'),
    simple('CSG', 'csg', 'basicSalary * 0.015', { category: EMPLOYEE }),
    simple('CSG', 'csgEmployer', 'basicSalary * 0.03', { category: EMPLOYER }),
    simple('Total deductions', 'totalDeductions', 'csg', { category: EMPLOYEE }),
  ]
  async function ask(rowIndex) {
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
    const deletes = [...container.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Delete')
    await act(async () => deletes[rowIndex].click())
    const dialog = document.querySelector('[role="alertdialog"], [role="dialog"]')
    return dialog.textContent
  }

  test('two columns called "CSG": each named with its category, with the formulas that use it', async () => {
    // Rows in category order: Basic Salary; CSG, Total deductions (Employee); CSG (Employer).
    expect(await ask(1)).toContain(
      'Delete column "CSG (Employee Contribution)"? Any formulas referencing "csg" will break. It is used by Total deductions.'
    )
  })

  test('the other one, which nothing uses', async () => {
    const text = await ask(3)
    expect(text).toContain('Delete column "CSG (Employer Contribution)"? Any formulas referencing "csgEmployer" will break.')
    expect(text).not.toContain('It is used by')
  })

  test('a name nobody else has is written as before', async () => {
    expect(await ask(0)).toContain('Delete column "Basic Salary"? Any formulas referencing "basicSalary" will break. It is used by CSG (Employee Contribution), CSG (Employer Contribution).')
  })
})

describe('the CSV file starts with a byte order mark', () => {
  test('so Excel reads it as UTF-8; the rows are as before', () => {
    const rows = [{ ID: 'TST001', Name: 'Hélène' }]
    expect(CSV_BOM).toBe(String.fromCharCode(0xfeff))
    expect(csvFileContent(['ID', 'Name'], rows)).toBe(CSV_BOM + 'ID,Name\r\nTST001,Hélène')
    expect(csvFileContent(['ID', 'Name'], rows).slice(1)).toBe(buildCsvContent(['ID', 'Name'], rows))
  })

  test('a reader that decodes UTF-8, as the PDF Editor does (file.text()), drops the mark', async () => {
    const text = await new Blob([csvFileContent(['ID'], [{ ID: 'TST001' }])]).text()
    expect(text).toBe('ID\r\nTST001')
  })
})

describe('the summary of overlapping tiers says which one applies (2.9)', () => {
  test('"0 or above" with "above 50,000": the higher one, above 50,000', () => {
    const tiers = [
      { operator: 'from', threshold: 0, rate: 3 },
      { operator: 'above', threshold: 50000, rate: 6 },
    ]
    expect(describeTieredRule('Basic Salary', tiers, null)).toBe(
      'If Basic Salary is 0 or above, apply 3%. If Basic Salary is above 50,000, apply 6%. Where "0 or above" and "above 50,000" both hold, "above 50,000" applies.'
    )
  })

  test('two "Below" tiers: the narrower; an "Equal to" tier: always', () => {
    expect(
      describeTieredRule('Basic Salary', [
        { operator: 'below', threshold: 50000, rate: 3 },
        { operator: 'below', threshold: 100000, rate: 5 },
      ])
    ).toBe('If Basic Salary is below 50,000, apply 3%. If Basic Salary is below 100,000, apply 5%. Where "below 100,000" and "below 50,000" both hold, "below 50,000" applies.')
    expect(
      describeTieredRule('Basic Salary', [
        { operator: 'equal', threshold: 30000, rate: 4 },
        { operator: 'below', threshold: 50000, rate: 3 },
      ])
    ).toBe('If Basic Salary is equal to 30,000, apply 4%. If Basic Salary is below 50,000, apply 3%. Where "below 50,000" and "equal to 30,000" both hold, "equal to 30,000" applies.')
  })

  test('tiers that never overlap, or overlap at one rate, are summed up as before', () => {
    expect(
      describeTieredRule('Basic Salary', [
        { operator: 'below', threshold: 50000, rate: 1.5 },
        { operator: 'from', threshold: 50000, rate: 3 },
      ])
    ).toBe('If Basic Salary is below 50,000, apply 1.5%. If Basic Salary is 50,000 or above, apply 3%.')
    expect(
      describeTieredRule('Basic Salary', [
        { operator: 'below', threshold: 50000, rate: 3 },
        { operator: 'below', threshold: 100000, rate: 3 },
      ])
    ).toBe('If Basic Salary is below 50,000, apply 3%. If Basic Salary is below 100,000, apply 3%.')
  })
})
