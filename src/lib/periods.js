// Month-period helpers: a "period" is a { year, month } pair (month is
// 1-indexed, matching human convention) identifying one monthly payroll
// table for a company.

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function getCurrentPeriod() {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

export function monthName(month) {
  return MONTH_NAMES[((month - 1) % 12 + 12) % 12]
}

// Adds `delta` months to a period, rolling the year over as needed in
// either direction (delta may be negative).
export function shiftPeriod(year, month, delta) {
  const total = year * 12 + (month - 1) + delta
  const newYear = Math.floor(total / 12)
  const newMonth = (((total % 12) + 12) % 12) + 1
  return { year: newYear, month: newMonth }
}

export function formatPeriodLabel(year, month) {
  return `${monthName(month)} ${year}`
}

// "2026-09" - used both as a localStorage key fragment and as the value
// for an <input type="month">.
export function periodKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function parsePeriodKey(key) {
  const [year, month] = key.split('-').map(Number)
  return { year, month }
}

export function comparePeriods(a, b) {
  return (a.year * 12 + a.month) - (b.year * 12 + b.month)
}

// Inclusive, chronological list of every {year, month} from `from` to `to`.
// Order of the two endpoints doesn't matter - the range is normalized so
// either picker can be earlier.
export function enumeratePeriods(fromYear, fromMonth, toYear, toMonth) {
  let a = { year: fromYear, month: fromMonth }
  let b = { year: toYear, month: toMonth }
  if (comparePeriods(a, b) > 0) [a, b] = [b, a]

  const result = []
  let cur = a
  while (comparePeriods(cur, b) <= 0) {
    result.push(cur)
    cur = shiftPeriod(cur.year, cur.month, 1)
  }
  return result
}
