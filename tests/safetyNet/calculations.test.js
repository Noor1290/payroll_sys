// Safety net, part 1: the numbers. Runs the fake fixture through the app's
// own calculation code and compares every figure with the recorded result.

import { test } from 'vitest'
import { expectRecorded } from './recorded'
import {
  identityFields,
  idFieldKey,
  company,
  effectiveColumns,
  columnsByKey,
  octoberEmployees,
  septemberEmployees,
  octoberGrid,
} from './fixture'
import { getOrderedEffectiveColumns } from '../../src/lib/categories'
import { formatDecimal } from '../../src/lib/format'
import { computeTotals } from '../../src/lib/totals'
import { buildExportPlan } from '../../src/lib/excelExport'

const orderedColumns = getOrderedEffectiveColumns(effectiveColumns)

// What the Employee Table shows in a cell, using the same formatting calls it makes.
function shownInTable(col, emp, cell) {
  if (col.type === 'formula') return cell?.trace?.error ? 'Error' : formatDecimal(cell?.value ?? 0, col.decimals ?? 2)
  const raw = emp.values?.[col.key] ?? ''
  if (col.valueType === 'checkbox') return Boolean(raw)
  if (col.valueType === 'text') return raw
  return raw === '' || Number.isNaN(Number(raw)) ? raw : formatDecimal(Number(raw), col.decimals ?? 2, { grouping: false })
}

test('column formulas compile to the recorded expressions', () => {
  expectRecorded(
    'column-formulas',
    orderedColumns.map((c) => ({
      key: c.key,
      name: c.name,
      category: c.category,
      type: c.type,
      valueType: c.valueType,
      decimals: c.decimals,
      builderMode: c.builderMode,
      tieredKind: c.tieredKind,
      formula: c.formula,
    }))
  )
})

test('every calculated figure for the month matches the recorded result', () => {
  const figures = octoberEmployees.map((emp) => {
    const cells = {}
    for (const col of orderedColumns) {
      const cell = octoberGrid[emp.id][col.key]
      const entry = { value: cell.value, shown: shownInTable(col, emp, cell) }
      if (col.type === 'formula') {
        // The calculation breakdown the user sees when clicking the cell.
        entry.breakdown = {
          substituted: cell.trace.substituted,
          error: cell.trace.error,
          exemption: cell.trace.exemption?.sentence,
          exemptionMatched: cell.trace.exemption?.matched,
          tiered: cell.trace.tiered?.sentence,
          compare: cell.trace.compare?.sentence,
          progressive: cell.trace.progressive?.sentence,
        }
      }
      cells[col.name] = entry
    }
    return { employee: emp.values.id, cells }
  })
  expectRecorded('calculated-figures', figures)
})

test('totals across two months match the recorded result', () => {
  const periods = [
    { year: 2026, month: 9, employees: septemberEmployees },
    { year: 2026, month: 10, employees: octoberEmployees },
  ]
  const totals = computeTotals(periods, effectiveColumns, columnsByKey, idFieldKey)

  const rows = totals.employees.map((emp) => {
    const sums = {}
    for (const col of orderedColumns) {
      if (col.valueType === 'text' || col.valueType === 'checkbox') continue
      const value = totals.computedGrid[emp.id]?.[col.key]?.value ?? 0
      sums[col.name] = { value, shown: formatDecimal(value, col.decimals ?? 2) }
    }
    return { group: emp.id, identity: identityFields.map((f) => emp.values?.[f.key] ?? ''), sums }
  })
  expectRecorded('totals', rows)

  // The Totals screen's "Export to Excel" (includes its TOTAL row).
  const plan = buildExportPlan({
    title: `${company.name} — Totals (September 2026 to October 2026)`,
    companyId: company.id,
    companyDetails: company.details,
    kind: 'totals',
    employees: totals.employees,
    identityFields,
    effectiveColumns,
    computedGrid: totals.computedGrid,
  })
  expectRecorded('excel-plan-totals', { ...plan, exportDateLabel: '<date>' })
})

test('the Excel export plan for the month (with its TOTAL row) matches the recorded result', () => {
  for (const exportMode of ['values', 'formulas']) {
    const plan = buildExportPlan({
      title: company.name,
      companyId: company.id,
      companyDetails: company.details,
      kind: 'period',
      exportMode,
      employees: octoberEmployees,
      identityFields,
      effectiveColumns,
      computedGrid: octoberGrid,
    })
    expectRecorded(`excel-plan-month-${exportMode}`, { ...plan, exportDateLabel: '<date>' })
  }
})
