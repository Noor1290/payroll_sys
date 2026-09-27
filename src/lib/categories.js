// Column categories: fixed, ordered groups every Global/Company column
// belongs to, used to group both the column-management screens and the
// Employee Table's header. "Identifiers" isn't a selectable category on
// the column form - it's populated implicitly by the existing Identity
// Fields, which are always leftmost regardless of these groups.

export const CATEGORIES = [
  { id: 'identifiers', label: 'Identifiers' },
  { id: 'general', label: 'General' },
  { id: 'employeeContribution', label: 'Employee Contribution' },
  { id: 'employerContribution', label: 'Employer Contribution' },
  { id: 'otherDeductions', label: 'Other Deductions' },
]

export const SELECTABLE_CATEGORIES = CATEGORIES.filter((c) => c.id !== 'identifiers')
export const CATEGORY_ORDER = SELECTABLE_CATEGORIES.map((c) => c.id)
export const DEFAULT_CATEGORY = 'general'

export function getCategoryLabel(id) {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id
}

function categoryOf(col) {
  return col.category ?? DEFAULT_CATEGORY
}

// Short, readable key suffixes used to auto-disambiguate a name collision
// before falling back to a plain numeric suffix.
const CATEGORY_KEY_SUFFIX = {
  general: '',
  employeeContribution: 'employee',
  employerContribution: 'employer',
  otherDeductions: 'other',
}

// Generates a key that doesn't collide with anything in `existingKeys`,
// starting from `baseSlug` (the plain slugified name), then trying a
// category-flavored suffix, then plain numeric suffixes. Used both for
// auto-filling the Key field as the user types a Name, and defensively at
// save time.
export function generateUniqueKey(baseSlug, category, existingKeys) {
  const known = new Set(existingKeys)
  if (!baseSlug) return baseSlug
  if (!known.has(baseSlug)) return baseSlug

  const suffix = CATEGORY_KEY_SUFFIX[category]
  if (suffix) {
    const candidate = `${baseSlug}_${suffix}`
    if (!known.has(candidate)) return candidate
  }

  let n = 2
  while (known.has(`${baseSlug}_${n}`)) n++
  return `${baseSlug}_${n}`
}

// Attaches a `helperLabel` to each column: just its name, unless another
// column in the list shares that exact name, in which case its category is
// appended for disambiguation, e.g. "CSG (Employee Contribution)".
export function labelColumnsForHelper(columns) {
  const nameCounts = new Map()
  for (const c of columns) nameCounts.set(c.name, (nameCounts.get(c.name) ?? 0) + 1)
  return columns.map((c) => ({
    ...c,
    helperLabel: (nameCounts.get(c.name) ?? 0) > 1 ? `${c.name} (${getCategoryLabel(categoryOf(c))})` : c.name,
  }))
}

// Orders a flat column list by fixed category order, preserving each
// column's relative position within its own category (array order doubles
// as the persisted per-category manual order - see reorderWithinCategory).
export function getOrderedEffectiveColumns(columns) {
  return CATEGORY_ORDER.flatMap((cat) => columns.filter((c) => categoryOf(c) === cat))
}

// Non-empty category groups (in fixed order) for a flat column list, used
// to render the Employee Table's spanning group-header row.
export function getCategoryGroups(columns) {
  return CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: getCategoryLabel(cat),
    columns: columns.filter((c) => categoryOf(c) === cat),
  })).filter((g) => g.columns.length > 0)
}

// Moves `draggedId` to just before `targetId` within `fullList`, but only
// if both belong to the same category (columns can be reordered within
// their category, not dragged into another one).
export function reorderWithinCategory(fullList, draggedId, targetId) {
  if (draggedId === targetId) return fullList
  const dragged = fullList.find((c) => c.id === draggedId)
  const target = fullList.find((c) => c.id === targetId)
  if (!dragged || !target) return fullList
  if (categoryOf(dragged) !== categoryOf(target)) return fullList

  const withoutDragged = fullList.filter((c) => c.id !== draggedId)
  const targetIndex = withoutDragged.findIndex((c) => c.id === targetId)
  const next = [...withoutDragged]
  next.splice(targetIndex, 0, dragged)
  return next
}
