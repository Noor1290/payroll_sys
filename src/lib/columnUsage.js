// Which formulas use a column, and how to carry a change of a column's key
// through everything that refers to it. Used before two edits that would
// otherwise break formulas silently: making a Global column company-only,
// and changing a column's key.

import { getDependencies } from './formulaEngine'

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The formula columns in `columns` whose formula refers to `key`.
export function findFormulasUsingColumn(key, columns) {
  return columns.filter((c) => c.type === 'formula' && c.key !== key && getDependencies(c.formula, [key]).length > 0)
}

// Every formula that would stop working if the Global column `column`
// became specific to the company `keepCompanyId`:
//   - Global formulas (a Global formula may only use Global columns, and it
//     is calculated for every company);
//   - the own formulas of every OTHER company (they would lose the column).
// Returns [{ name, where }], `where` being "Global" or the company's name.
export function findScopeChangeBlockers(column, globalColumns, companies, keepCompanyId) {
  const blockers = findFormulasUsingColumn(column.key, globalColumns).map((c) => ({ name: c.name, where: 'Global' }))
  for (const company of companies) {
    if (company.id === keepCompanyId) continue
    for (const c of findFormulasUsingColumn(column.key, company.columns ?? [])) blockers.push({ name: c.name, where: company.name })
  }
  return blockers
}

// An expression with every whole-word reference to `oldKey` replaced.
export function renameKeyInExpression(expr, oldKey, newKey) {
  if (typeof expr !== 'string' || expr === '') return expr
  return expr.replace(new RegExp(`\\b${escapeRegExp(oldKey)}\\b`, 'g'), newKey)
}

const swap = (value, oldKey, newKey) => (value === oldKey ? newKey : value)

// One column with every reference to `oldKey` replaced by `newKey`: its
// compiled formula, and the builder settings the formula was compiled from
// (so reopening it in the Tiered / Progressive / Compare builders, or its
// exemption, still shows the right column). The column's own key is not
// touched here.
export function renameKeyInColumn(col, oldKey, newKey) {
  if (col.type !== 'formula') return col
  const next = { ...col, formula: renameKeyInExpression(col.formula, oldKey, newKey) }
  if (col.tiered) next.tiered = { ...col.tiered, baseKey: swap(col.tiered.baseKey, oldKey, newKey) }
  if (col.progressive) next.progressive = { ...col.progressive, baseKey: swap(col.progressive.baseKey, oldKey, newKey) }
  if (col.compare) {
    next.compare = {
      ...col.compare,
      columnAKey: swap(col.compare.columnAKey, oldKey, newKey),
      columnBKey: swap(col.compare.columnBKey, oldKey, newKey),
      trueExpr: renameKeyInExpression(col.compare.trueExpr, oldKey, newKey),
      falseExpr: renameKeyInExpression(col.compare.falseExpr, oldKey, newKey),
    }
  }
  if (col.exemption) {
    next.exemption = {
      ...col.exemption,
      resultColumnKey: swap(col.exemption.resultColumnKey, oldKey, newKey),
      conditions: (col.exemption.conditions ?? []).map((cond) => ({
        ...cond,
        columnKey: swap(cond.columnKey, oldKey, newKey),
        ...(('compareToColumnKey' in cond) ? { compareToColumnKey: swap(cond.compareToColumnKey, oldKey, newKey) } : {}),
      })),
    }
  }
  return next
}

// A { [key]: width } map with the width kept under the new key.
export function renameKeyInWidths(columnWidths, oldKey, newKey) {
  if (!columnWidths || !(oldKey in columnWidths)) return columnWidths
  const { [oldKey]: width, ...rest } = columnWidths
  return { ...rest, [newKey]: width }
}
