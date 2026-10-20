// Date values: a "Date" Input column or identity field. Typed and shown day first, the Mauritian
// way ("01/08/2026"); stored as "YYYY-MM-DD", which is also what the Payroll Hub dashboard and the
// payslip app read. A value saved before a field became a Date (typed as text) is read the same way,
// so "01/08/2026" saved as text is the date it says; it is written "YYYY-MM-DD" the next time it is
// changed. A value that is not a clear date is kept exactly as it was and shown as such, never guessed.

const pad = (n) => String(n).padStart(2, '0')

// The dates accepted, as the dashboard accepts them.
const FIRST_YEAR = 1900
const LAST_YEAR = 2100

// A real calendar date within 1900 to 2100, as "YYYY-MM-DD", or null.
function isoDate(year, month, day) {
  if (year < FIRST_YEAR || year > LAST_YEAR || month < 1 || month > 12 || day < 1) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

// Reads one typed date. Returns { value: "YYYY-MM-DD" }, { empty: true } for nothing typed, or
// { unreadable: true, wellFormed } for anything else: two-digit years, words, a number, an impossible
// date. `wellFormed` is true for something written like a date that is not one ("31/02/2026").
// Accepted: "YYYY-MM-DD", and day first with "/", "-" or "." between: "1/8/2026", "01-08-2026".
export function readDate(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { empty: true }
  const text = String(raw).trim()
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) {
    const value = isoDate(Number(m[1]), Number(m[2]), Number(m[3]))
    return value ? { value } : { unreadable: true, wellFormed: true }
  }
  m = text.match(/^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/)
  if (m) {
    const value = isoDate(Number(m[4]), Number(m[3]), Number(m[1]))
    return value ? { value } : { unreadable: true, wellFormed: true }
  }
  return { unreadable: true, wellFormed: false }
}

// "YYYY-MM-DD" as shown and typed: "DD/MM/YYYY".
export function formatDateDMY(iso) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// What a saved value is shown as: a date as "DD/MM/YYYY", nothing as "", anything that is not a clear
// date exactly as it was saved.
export function showDate(raw) {
  const read = readDate(raw)
  if (read.value) return formatDateDMY(read.value)
  if (read.empty) return ''
  return String(raw)
}

// What a saved value is when it is worked with (exports, Totals, what is sent): "YYYY-MM-DD", "", or the
// saved text when it is not a clear date.
export function dateValue(raw) {
  const read = readDate(raw)
  if (read.value) return read.value
  if (read.empty) return ''
  return String(raw)
}

// Excel keeps a date as the number of days since 30 December 1899, except that it counts a 29 February
// 1900 that never was (day 60): days 1 to 59 are one day earlier.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)
const DAY = 24 * 60 * 60 * 1000
const MARCH_1900 = 61

// An Excel date cell (its serial number, e.g. 46235 for 01/08/2026) as "YYYY-MM-DD", or null. A time of
// day (the fraction) is dropped. Day 60, the 29 February 1900 Excel counts, is not a date.
export function excelSerialToIso(serial) {
  if (typeof serial !== 'number' || !Number.isFinite(serial)) return null
  const days = Math.floor(serial)
  if (days < 1 || days === 60) return null
  const d = new Date(EXCEL_EPOCH + (days < MARCH_1900 ? days + 1 : days) * DAY)
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

// "YYYY-MM-DD" as an Excel date serial number.
export function isoToExcelSerial(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const days = Math.round((Date.UTC(y, m - 1, d) - EXCEL_EPOCH) / DAY)
  return days < MARCH_1900 ? days - 1 : days
}

// One cell of an Excel file, for a Date field: an Excel date (a number), "DD/MM/YYYY" text or
// "YYYY-MM-DD" text. Returns { value } ("YYYY-MM-DD" or "" for an empty cell) or { unreadable: true }.
export function readExcelDateCell(raw) {
  if (typeof raw === 'number') {
    const value = excelSerialToIso(raw)
    return value ? { value } : { unreadable: true }
  }
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const value = isoDate(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate())
    return value ? { value } : { unreadable: true }
  }
  const read = readDate(raw)
  if (read.value) return { value: read.value }
  if (read.empty) return { value: '' }
  return { unreadable: true }
}

// Why a typed value is refused in a Date cell, or null when it is a date or nothing.
export function dateRefusal(raw) {
  const read = readDate(raw)
  if (!read.unreadable) return null
  const text = String(raw).trim()
  return read.wellFormed
    ? `"${text}" is not a real date. Type it as DD/MM/YYYY, for example 01/08/2026.`
    : `"${text}" is not a date. Type it as DD/MM/YYYY, for example 01/08/2026.`
}
