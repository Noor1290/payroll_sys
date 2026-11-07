// Typing slips to show before "Send to dashboard" (rehearsal M2, TODO C3):
// a negative figure ("-500" as a Basic Salary gives an Employee CSG of
// -7.50), and a required input left empty (an empty cell counts as 0).
// They are warnings, never blocks: a negative figure can be meant (a
// correction), and the dashboard still decides what it accepts.

import { roundHalfUp } from './format'
import { employeeLabel, isErrorCell, isFigureColumn } from './exportErrors'
import { REQUIRED_NAMES } from './requiredNames'

const REQUIRED = new Set(REQUIRED_NAMES.map((r) => r.name))
const isEmpty = (value) => value === undefined || value === null || String(value).trim() === ''

// `columns` as buildPdfFillColumns gives them (named as they are sent).
// Returns { negatives: [{ column, entries: [{ employee, value }] }],
//           empty: [{ column, employees: [label] }] }, both in table order.
export function findSendWarnings(employees, columns, computedGrid, identityFields) {
  const figures = columns.filter(isFigureColumn)
  const negatives = []
  const empty = []
  for (const col of figures) {
    const entries = []
    const blank = []
    employees.forEach((employee, index) => {
      const cell = computedGrid[employee.id]?.[col.key]
      const value = cell?.value
      if (!isErrorCell(cell) && typeof value === 'number' && roundHalfUp(value, col.decimals ?? 2) < 0) {
        entries.push({ employee: employeeLabel(employee, identityFields, index), value: roundHalfUp(value, col.decimals ?? 2) })
      }
      if (col.kind === 'input' && REQUIRED.has(col.name) && isEmpty(employee.values?.[col.key])) blank.push(employeeLabel(employee, identityFields, index))
    })
    if (entries.length > 0) negatives.push({ column: col.name, entries })
    if (blank.length > 0) empty.push({ column: col.name, employees: blank })
  }
  return { negatives, empty }
}

// "DOE JANE, TEST B and 3 more": at most `shown` names, then how many more.
export function listNames(names, shown = 5) {
  if (names.length <= shown) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`
}
