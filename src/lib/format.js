// Shared display-formatting helpers. Rounding here is display-only - the
// underlying stored/computed value is never mutated, so chained formula
// calculations keep full precision regardless of any column's configured
// decimal places.

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
    return value.toLocaleString(undefined, { maximumFractionDigits: 2, useGrouping: grouping })
  }
  return value.toLocaleString(undefined, {
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
