// Converts a human-readable column name into a camelCase JS-identifier-safe key,
// e.g. "Basic Salary" -> "basicSalary", "Tax %" -> "tax"
export function slugify(name) {
  const words = String(name)
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)

  if (words.length === 0) return ''

  let key = words
    .map((w, i) => {
      const lower = w.toLowerCase()
      if (i === 0) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join('')

  if (!/^[a-zA-Z_$]/.test(key)) {
    key = `_${key}`
  }

  return key
}

export function isValidKey(key) {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)
}
