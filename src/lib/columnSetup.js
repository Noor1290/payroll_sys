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
import { slugify } from './slugify'

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
  }
}

// Builds the JSON-serializable export object for a scope's current columns.
export function buildColumnSetupExport(columns, scope, companyName) {
  return {
    _meta: {
      app: COLUMN_SETUP_APP_ID,
      version: COLUMN_SETUP_VERSION,
      scope,
      companyName: companyName ?? null,
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

  return { valid: true, scope: meta.scope, companyName: meta.companyName ?? null, columns: parsed.columns }
}

// For each column in the file, decides whether it's brand-new, collides
// with an existing key (and gets skipped or auto-suffixed depending on
// `mode`), reusing the exact same generateUniqueKey collision-resolution
// already used everywhere else a duplicate name/key can arise. Returns one
// plan row per file column, in file order (which is what preserves each
// category's relative order once appended and re-displayed).
export function planColumnImport(fileColumns, existingKeys, mode) {
  const usedKeys = new Set(existingKeys)

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
        column: newColumn(raw),
      }
    }

    if (mode === 'skip') {
      return { name: raw.name, category, type: raw.type, originalKey: raw.key, finalKey: raw.key, action: 'skip', column: null }
    }

    const finalKey = generateUniqueKey(raw.key, category, [...usedKeys])
    usedKeys.add(finalKey)
    return {
      name: raw.name,
      category,
      type: raw.type,
      originalKey: raw.key,
      finalKey,
      action: 'duplicate',
      column: newColumn({ ...raw, key: finalKey }),
    }
  })
}
