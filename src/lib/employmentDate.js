// "Date of Employment" as the dashboard and the payslip app read it: "YYYY-MM-DD" (rehearsal fix F6,
// 17 Oct 2026, problem M3). In this app it is typed as text, usually the Mauritian way, day first:
// "01/08/2026". "Send to dashboard" sends it converted; a date that cannot be read without guessing
// is not sent for that employee, and the user is told before sending.

import { readDate } from './dates'

// Reads one typed date. Returns { value: "YYYY-MM-DD" }, { empty: true } for nothing typed, or
// { unreadable: true } for anything else: two-digit years, words, a number, an impossible date.
// Accepted: "YYYY-MM-DD", and day first with "/", "-" or "." between: "1/8/2026", "01-08-2026".
// The same reading as a Date field (src/lib/dates.js).
export function readEmploymentDate(raw) {
  const read = readDate(raw)
  return read.unreadable ? { unreadable: true } : read
}

const loose = (name) => String(name).trim().replace(/\s+/g, ' ').toLowerCase()

// The header under which this app exports the date of employment, or null when there is none.
export function employmentDateHeader(headers) {
  return headers.find((h) => loose(h) === 'date of employment') ?? null
}

// The rows "Send to dashboard" sends, with the date of employment written "YYYY-MM-DD". A date that
// cannot be read is left out of that row (never sent as typed), and listed:
// { rows, unreadable: [{ index, raw }] } (`index` is the row's position).
export function withIsoEmploymentDates(rows, header) {
  if (!header) return { rows, unreadable: [] }
  const unreadable = []
  const out = rows.map((row, index) => {
    if (!(header in row)) return row
    const read = readEmploymentDate(row[header])
    if (read.value) return { ...row, [header]: read.value }
    const { [header]: raw, ...rest } = row
    if (read.unreadable) unreadable.push({ index, raw: String(raw) })
    return rest
  })
  return { rows: out, unreadable }
}
