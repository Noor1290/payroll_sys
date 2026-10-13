// Shared display-formatting helpers. Rounding here is display-only - the
// underlying stored/computed value is never mutated, so chained formula
// calculations keep full precision regardless of any column's configured
// decimal places.

// Rounds half away from zero to `decimals` places, the way a person rounds
// a figure on paper: 271.725 -> 271.73, -271.725 -> -271.73.
//
// A plain toFixed()/toLocaleString() rounds the binary number actually
// stored, and 18,115 x 1.5% is stored as 271.72499999999997, which would
// give 271.72. So the value is first read back to 15 significant digits
// (which recovers the decimal figure that was meant, 271.725), and the
// rounding is then done on that decimal text rather than with floating-point
// arithmetic.
export function roundHalfUp(value, decimals = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value
  const magnitude = Math.abs(value)
  const text = String(Number(magnitude.toPrecision(15)))
  let rounded
  if (text.includes('e')) {
    // Far too large or too small for the decimal places to matter.
    const factor = 10 ** decimals
    rounded = Math.round(magnitude * factor) / factor
  } else {
    rounded = Number(`${Math.round(Number(`${text}e${decimals}`))}e-${decimals}`)
  }
  if (rounded === 0) return 0
  return value < 0 ? -rounded : rounded
}

// Formats a number to `decimals` places (fixed, with trailing zeros).
// Non-numeric values (e.g. a text-type column's value) pass through as-is.
// When `decimals` is omitted, falls back to a loose "up to 2 places, no
// forced trailing zeros" display - used where no specific column's setting
// applies (e.g. a raw threshold the user typed into the tier builder).
export function formatDecimal(value, decimals, { grouping = true } = {}) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return typeof value === 'string' ? value : String(value ?? '')
  }
  if (decimals === undefined || decimals === null) {
    return roundHalfUp(value, 2).toLocaleString(undefined, { maximumFractionDigits: 2, useGrouping: grouping })
  }
  return roundHalfUp(value, decimals).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouping,
  })
}

// Excel number-format string for a given decimal-places count, e.g.
// 2 -> "#,##0.00", 0 -> "#,##0".
export function excelNumberFormat(decimals = 2) {
  return decimals > 0 ? `#,##0.${'0'.repeat(decimals)}` : '#,##0'
}
