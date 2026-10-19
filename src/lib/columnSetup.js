// Export/import of column DEFINITIONS (Global Columns or one company's
// Company Columns) as a standalone JSON file - separate from employee
// data, which lives entirely in xlsx import/export (see excelExport.js /
// excelImport.js) and per-period storage. A "column setup" file is a
// portable snapshot of structure: names, keys, categories, types, and
// full formula-builder configuration (not just the compiled expression),
// so re-imported columns stay visually editable in their original
// Simple/Tiered/Progressive Brackets builder mode exactly as if built by
// hand.

import { newColumn } from './model'
import { generateUniqueKey } from './categories'
import { renameKeyInColumn } from './columnUsage'
import { validateFormulaSyntax } from './formulaEngine'
import { isValidKey, slugify } from './slugify'

const COLUMN_SETUP_APP_ID = 'payroll-sys-column-setup'
const COLUMN_SETUP_VERSION = 1

// Only these fields make a column re-creatable/re-editable exactly as
// before - `id` is deliberately excluded (regenerated fresh on import, so
// re-importing the same file twice, or into a different install, never
// collides on id).
function toPortableColumn(col) {
  return {
    name: col.name,
    key: col.key,
    category: col.category,
    type: col.type,
    valueType: col.valueType,
    decimals: col.decimals,
    formula: col.formula,
    builderMode: col.builderMode,
    tieredKind: col.tieredKind,
    tiered: col.tiered,
    compare: col.compare,
    progressive: col.progressive,
    exemption: col.exemption,
    excludeFromExport: col.excludeFromExport,
  }
}

// Builds the JSON-serializable export object for a scope's current columns.
// `companyDetails` (only meaningful for scope==='company') is carried
// through purely so nothing's lost if this file is inspected or
// re-imported later - not currently auto-applied by any import flow.
export function buildColumnSetupExport(columns, scope, companyName, companyDetails) {
  return {
    _meta: {
      app: COLUMN_SETUP_APP_ID,
      version: COLUMN_SETUP_VERSION,
      scope,
      companyName: companyName ?? null,
      companyDetails: scope === 'company' ? (companyDetails ?? null) : null,
      exportedAt: new Date().toISOString(),
    },
    columns: columns.map(toPortableColumn),
  }
}

export function buildColumnSetupFilename(scope, companyName) {
  const datePart = new Date().toISOString().slice(0, 10)
  const scopePart = scope === 'global' ? 'global' : slugify(companyName ?? 'company') || 'company'
  return `column-setup-${scopePart}-${datePart}.json`
}

// Triggers a normal browser file download for the given export object.
export function downloadColumnSetup(exportObj, filename) {
  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// "Export Column Setup", downloaded now: the file's name, or null when the
// download could not be started. What "Clear the column setup" does first.
export function downloadColumnSetupNow(columns, scope, companyName, companyDetails) {
  const filename = buildColumnSetupFilename(scope, companyName)
  try {
    downloadColumnSetup(buildColumnSetupExport(columns, scope, companyName, companyDetails), filename)
    return filename
  } catch (e) {
    console.error('Failed to download the column setup:', e)
    return null
  }
}

// The two "Export Column Setup" files of the setup in use: the Global columns
// and the selected company's own. What "Clear the column setup" downloads
// first. Returns the names of the files downloaded, or null if either failed.
export function exportColumnSetupNow({ globalColumns, companyColumns, companyName, companyDetails }) {
  const files = [
    downloadColumnSetupNow(globalColumns, 'global', companyName),
    downloadColumnSetupNow(companyColumns, 'company', companyName, companyDetails),
  ]
  return files.every(Boolean) ? files : null
}


// Reads and validates a selected file as a column-setup export. Returns
// { valid: true, scope, companyName, columns } or { valid: false, error }.
export async function parseColumnSetupFile(file) {
  let text
  try {
    text = await file.text()
  } catch {
    return { valid: false, error: 'Could not read that file.' }
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { valid: false, error: 'This file is not valid JSON.' }
  }

  const meta = parsed?._meta
  const isRecognized =
    parsed &&
    typeof parsed === 'object' &&
    meta &&
    meta.app === COLUMN_SETUP_APP_ID &&
    (meta.scope === 'global' || meta.scope === 'company') &&
    Array.isArray(parsed.columns)

  if (!isRecognized) {
    return { valid: false, error: 'This file is not a recognized column-setup export.' }
  }

  // Every column is checked; one that could not be built by hand is not
  // imported, and neither is the rest of the file.
  const problems = parsed.columns
    .map((col, i) => {
      const found = columnProblems(col)
      if (found.length === 0) return null
      const name = typeof col?.name === 'string' && col.name.trim() !== '' ? ` ("${col.name.trim()}")` : ''
      return `Column ${i + 1}${name}: ${found.join(', ')}.`
    })
    .filter(Boolean)
  if (problems.length > 0) {
    return { valid: false, error: `This file cannot be imported. ${problems.join(' ')}` }
  }

  return { valid: true, scope: meta.scope, companyName: meta.companyName ?? null, columns: parsed.columns }
}

const VALUE_TYPES = ['number', 'text', 'checkbox']

// What a column in a file lacks to be a column the column form could have
// made, e.g. ['no name', 'no valid key'].
function columnProblems(col) {
  if (!col || typeof col !== 'object' || Array.isArray(col)) return ['not a column']
  const found = []
  if (typeof col.name !== 'string' || col.name.trim() === '') found.push('no name')
  if (typeof col.key !== 'string' || !isValidKey(col.key)) found.push('no valid key')
  if (col.type !== 'input' && col.type !== 'formula') found.push('no valid type')
  if (col.type === 'formula' && (typeof col.formula !== 'string' || col.formula.trim() === '')) found.push('no formula')
  if (col.type === 'input' && col.valueType !== undefined && !VALUE_TYPES.includes(col.valueType)) found.push('an unknown value type')
  return found
}

// For each column in the file, decides whether it's brand-new, collides
// with an existing key (and gets skipped or auto-suffixed depending on
// `mode`), reusing the exact same generateUniqueKey collision-resolution
// already used everywhere else a duplicate name/key can arise. Returns one
// plan row per file column, in file order (which is what preserves each
// category's relative order once appended and re-displayed).
//
// Then the imported formulas:
//   - a column given a new key in 'duplicate' mode takes the file's formulas
//     with it: they point at the imported copy, not at the column that was
//     already there;
//   - each must only use columns a formula here may use (`referenceableKeys`,
//     by default every existing key) or columns imported with it. One that
//     does not is 'problem', with the reason, and is not imported - nor is a
//     formula that uses it.
export function planColumnImport(fileColumns, existingKeys, mode, referenceableKeys = existingKeys) {
  const plan = planKeys(fileColumns, existingKeys, mode)

  for (const { originalKey, finalKey } of plan.filter((p) => p.action === 'duplicate')) {
    for (const p of plan) if (p.column) p.column = renameKeyInColumn(p.column, originalKey, finalKey)
  }

  const imported = () => plan.filter((p) => p.column)
  let changed = true
  while (changed) {
    changed = false
    const available = [...referenceableKeys, ...imported().map((p) => p.finalKey)]
    for (const p of imported()) {
      if (p.column.type !== 'formula') continue
      const result = validateFormulaSyntax(p.column.formula, available)
      if (result.valid) continue
      Object.assign(p, { action: 'problem', problem: result.error, column: null })
      changed = true
    }
  }
  return plan
}

function planKeys(fileColumns, existingKeys, mode) {
  const usedKeys = new Set(existingKeys)
  // A new key is never one that a later column of the file has already.
  const fileKeys = fileColumns.map((raw) => raw.key)

  return fileColumns.map((raw) => {
    const category = raw.category ?? 'general'
    const collides = usedKeys.has(raw.key)

    if (!collides) {
      usedKeys.add(raw.key)
      return {
        name: raw.name,
        category,
        type: raw.type,
        originalKey: raw.key,
        finalKey: raw.key,
        action: 'new',
        problem: null,
        column: newColumn(raw),
      }
    }

    if (mode === 'skip') {
      return { name: raw.name, category, type: raw.type, originalKey: raw.key, finalKey: raw.key, action: 'skip', problem: null, column: null }
    }

    const finalKey = generateUniqueKey(raw.key, category, [...usedKeys, ...fileKeys])
    usedKeys.add(finalKey)
    return {
      name: raw.name,
      category,
      type: raw.type,
      originalKey: raw.key,
      finalKey,
      action: 'duplicate',
      problem: null,
      column: newColumn({ ...raw, key: finalKey }),
    }
  })
}
