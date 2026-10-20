// A figure "in error" (a formula that could not be worked out) must never
// leave the app looking like a number. These helpers are shared by every
// export (Excel, PDF fill, Totals, Send to dashboard): they say which cells
// are in error, so the user can be warned first, and give the one text that
// is written in place of such a cell.

export const ERROR_TEXT = 'Error'

// `cell` is one entry of the computed grid: { value, trace } for a month,
// or { value, error } for a Totals row.
export function isErrorCell(cell) {
  if (!cell) return false
  if (cell.trace?.error || cell.error) return true
  return typeof cell.value === 'number' && !Number.isFinite(cell.value)
}

function isFigureColumn(col) {
  const kind = col.kind ?? col.type
  return kind !== 'identity' && col.valueType !== 'text' && col.valueType !== 'checkbox' && col.valueType !== 'date'
}

// How an employee is named in a warning: their first identity values, e.g.
// "TST001 Alpha Tester", or their position when they have none.
export function employeeLabel(employee, identityFields, index) {
  const parts = identityFields
    .slice(0, 3)
    .map((f) => employee.values?.[f.key])
    .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
  return parts.length > 0 ? parts.join(' ') : `Row ${index + 1}`
}

// Every figure cell in error among `columns` (each { key, name, ... }), as
// [{ employee, column }] in table order.
export function findErrorCells(employees, columns, computedGrid, identityFields) {
  const figureColumns = columns.filter(isFigureColumn)
  const found = []
  employees.forEach((employee, index) => {
    for (const col of figureColumns) {
      if (isErrorCell(computedGrid[employee.id]?.[col.key])) {
        found.push({ employee: employeeLabel(employee, identityFields, index), column: col.name })
      }
    }
  })
  return found
}
