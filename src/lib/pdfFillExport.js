// "Export for PDF fill" (CSV / JSON): a flat, one-row-per-employee dump of
// whichever columns the user picks, headered/keyed by each column's plain
// display NAME (not its internal key) - built for feeding an external
// PDF-filling tool that matches fields by name, not for re-importing back
// into this app (that's what the xlsx system-export round-trip is for).

import { periodKey } from './periods'
import { getCategoryGroups, getOrderedEffectiveColumns } from './categories'

// The flat, ordered list of every column a PDF-fill export could include:
// identity fields first, then Global/Company columns in their normal
// category order - same shape (key/name/kind/valueType/decimals) the
// checklist UI and the row-builder both work from.
export function buildPdfFillColumns(identityFields, effectiveColumns) {
  const identity = identityFields.map((f) => ({ key: f.key, name: f.name, kind: 'identity' }))
  const ordered = getOrderedEffectiveColumns(effectiveColumns).map((c) => ({
    key: c.key,
    name: c.name,
    kind: c.type,
    valueType: c.valueType,
    decimals: c.decimals ?? 2,
  }))
  return [...identity, ...ordered]
}

// Same grouping the rest of the app uses (Identifiers, then each category),
// for the column-picker checklist.
export function buildPdfFillColumnGroups(identityFields, effectiveColumns) {
  const orderedEffectiveColumns = getOrderedEffectiveColumns(effectiveColumns)
  const groups = []
  if (identityFields.length > 0) {
    groups.push({ label: 'Identifiers', columns: identityFields.map((f) => ({ key: f.key, name: f.name, kind: 'identity' })) })
  }
  for (const group of getCategoryGroups(orderedEffectiveColumns)) {
    groups.push({
      label: group.label,
      columns: group.columns.map((c) => ({ key: c.key, name: c.name, kind: c.type, valueType: c.valueType, decimals: c.decimals ?? 2 })),
    })
  }
  return groups
}

// Company Details fields as pickable, PDF-fill-export-able items: the three
// fixed fields (Company Name/Address/BRN) plus every custom field, each
// with a stable `key` (for the checklist's selection state) and the plain
// `value` that'll repeat identically on every employee row/object. Not
// scoped to a company tab the way employee columns are - this always
// reflects whichever company the export was opened from.
export function buildCompanyDetailFields(companyName, companyDetails) {
  const fields = [
    { key: '__company_name', label: 'Company Name', value: companyName ?? '' },
    { key: '__company_address', label: 'Address', value: companyDetails?.address ?? '' },
    { key: '__company_brn', label: 'BRN', value: companyDetails?.brn ?? '' },
  ]
  for (const cf of companyDetails?.customFields ?? []) {
    fields.push({ key: `__company_custom_${cf.id}`, label: cf.label, value: cf.value ?? '' })
  }
  return fields
}

// Resolves each selected company-details field's final exported header,
// disambiguating with a "Company: " prefix only where its label happens to
// collide with one of the chosen employee columns' names.
export function resolveCompanyFieldHeaders(selectedCompanyFields, employeeColumnNames) {
  const employeeNameSet = new Set(employeeColumnNames)
  return selectedCompanyFields.map((f) => ({
    ...f,
    header: employeeNameSet.has(f.label) ? `Company: ${f.label}` : f.label,
  }))
}

function cellDisplayValue(col, emp, computedGrid) {
  if (col.kind === 'identity') return emp.values?.[col.key] ?? ''
  const cell = computedGrid[emp.id]?.[col.key]
  const value = cell?.value
  if (col.valueType === 'checkbox') return value === 1 ? 'Yes' : 'No'
  if (col.valueType === 'text') return typeof value === 'string' ? value : (value ?? '')
  const num = typeof value === 'number' && !Number.isNaN(value) ? value : 0
  // Rounded to the column's own configured precision, same as every other
  // export/display in the app - but never grouped/comma-formatted, since
  // that would corrupt a CSV's own delimiter.
  return Number(num.toFixed(col.decimals ?? 2))
}

// One plain { [header]: value } object per employee - this IS the JSON
// export's row shape directly, and the CSV writer below just projects each
// row through `headers` in order. `resolvedCompanyFields` (from
// resolveCompanyFieldHeaders) repeat the SAME value on every row, since
// they describe the one company, not the individual employee.
export function buildPdfFillRows(columns, employees, computedGrid, resolvedCompanyFields = []) {
  return employees.map((emp) => {
    const row = {}
    for (const col of columns) {
      row[col.name] = cellDisplayValue(col, emp, computedGrid)
    }
    for (const cf of resolvedCompanyFields) {
      row[cf.header] = cf.value
    }
    return row
  })
}

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function buildCsvContent(headers, rows) {
  const headerLine = headers.map(csvEscape).join(',')
  const lines = rows.map((row) => headers.map((h) => csvEscape(row[h])).join(','))
  return [headerLine, ...lines].join('\r\n')
}

export function buildJsonContent(rows) {
  return JSON.stringify(rows, null, 2)
}

function downloadTextFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function buildPdfFillFilename(format, companyName, year, month) {
  const safeName = (companyName || 'company').replace(/[^a-z0-9_\- ]/gi, '').trim() || 'company'
  return `${safeName}-pdf-fill-${periodKey(year, month)}.${format}`
}

// `format` is 'csv' | 'json'. `columns` are the already-filtered, chosen
// employee columns in the order they should appear. `resolvedCompanyFields`
// (from resolveCompanyFieldHeaders) are appended after them, identically on
// every row.
export function downloadPdfFillExport(format, columns, employees, computedGrid, resolvedCompanyFields, { companyName, year, month }) {
  const rows = buildPdfFillRows(columns, employees, computedGrid, resolvedCompanyFields)
  const headers = [...columns.map((c) => c.name), ...resolvedCompanyFields.map((cf) => cf.header)]
  const filename = buildPdfFillFilename(format, companyName, year, month)
  if (format === 'csv') {
    downloadTextFile(buildCsvContent(headers, rows), filename, 'text/csv;charset=utf-8')
  } else {
    downloadTextFile(buildJsonContent(rows), filename, 'application/json')
  }
}
