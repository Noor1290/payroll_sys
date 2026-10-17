// "Date of Employment" as the dashboard and the payslip app read it: "YYYY-MM-DD" (rehearsal fix F6,
// 17 Oct 2026, problem M3). In this app it is typed as text, usually the Mauritian way, day first:
// "01/08/2026". "Send to dashboard" sends it converted; a date that cannot be read without guessing
// is not sent for that employee, and the user is told before sending.

const pad = (n) => String(n).padStart(2, '0')

// A real calendar date within what the dashboard accepts (1900 to 2100), as "YYYY-MM-DD", or null.
function isoDate(year, month, day) {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

// Reads one typed date. Returns { value: "YYYY-MM-DD" }, { empty: true } for nothing typed, or
// { unreadable: true } for anything else: two-digit years, words, a number, an impossible date.
// Accepted: "YYYY-MM-DD", and day first with "/", "-" or "." between: "1/8/2026", "01-08-2026".
export function readEmploymentDate(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { empty: true }
  const text = String(raw).trim()
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) {
    const value = isoDate(Number(m[1]), Number(m[2]), Number(m[3]))
    return value ? { value } : { unreadable: true }
  }
  m = text.match(/^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/)
  if (m) {
    const value = isoDate(Number(m[4]), Number(m[3]), Number(m[1]))
    return value ? { value } : { unreadable: true }
  }
  return { unreadable: true }
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
