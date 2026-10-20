// What restoring an earlier revision of a column setup would change, compared
// with the setup in use now: which keys and which formulas, and which columns
// would come back or go. Names and keys only: never a value typed for anyone.
//
// A column (or an identity field) is followed by its id, so a renamed key is
// one change of key, not one column gone and another added.
//
//   target   'shared'  the identity fields, the ID field and the Global columns
//            'company' a company's own columns and its custom company details
//
// Compared by content, never as text: the database does not keep the order of
// an object's properties.

import { sameJson } from './hubWire'

const idOf = (item) => item?.id ?? `key:${item?.key}`

function itemsOf(body, target) {
  if (target === 'shared') {
    return [
      ...(body?.identityFields ?? []).map((item) => ({ ...item, kind: 'identity' })),
      ...(body?.globalColumns ?? []).map((item) => ({ ...item, kind: 'column' })),
    ]
  }
  return (body?.columns ?? []).map((item) => ({ ...item, kind: 'column' }))
}

// The formula as it is worked out: its expression, or nothing for an input.
const formulaOf = (item) => (item.type === 'formula' ? (item.formula ?? '') : null)

// Everything else that is part of the column: shown as "other settings".
function settingsOf(item) {
  const { id: _id, key: _key, name: _name, formula: _formula, type: _type, kind: _kind, ...rest } = item
  return rest
}

// {
//   keys:     [{ name, from, to }]                    a key that changes
//   formulas: [{ name, key, from, to }]               a formula that changes (null: not a formula)
//   added:    [{ name, key, kind }]                   back with the restore
//   removed:  [{ name, key, kind }]                   gone with the restore
//   renamed:  [{ key, from, to }]                     a name that changes
//   settings: [{ name, key }]                         other settings that change
//   idField:  { from, to } | null                     the ID field changes (shared)
//   details:  boolean                                 the custom company details change (company)
//   none:     boolean                                 nothing at all changes
// }
export function describeSetupChange(nowBody, revisionBody, target) {
  const now = new Map(itemsOf(nowBody, target).map((item) => [idOf(item), item]))
  const then = new Map(itemsOf(revisionBody, target).map((item) => [idOf(item), item]))
  const out = { keys: [], formulas: [], added: [], removed: [], renamed: [], settings: [], idField: null, details: false }

  for (const [id, after] of then) {
    const before = now.get(id)
    if (!before) {
      out.added.push({ name: after.name, key: after.key, kind: after.kind })
      continue
    }
    if (before.key !== after.key) out.keys.push({ name: after.name, from: before.key, to: after.key })
    if (before.name !== after.name) out.renamed.push({ key: after.key, from: before.name, to: after.name })
    if (before.kind === 'column') {
      const from = formulaOf(before)
      const to = formulaOf(after)
      if (from !== to) out.formulas.push({ name: after.name, key: after.key, from, to })
      else if (!sameJson(settingsOf(before), settingsOf(after))) out.settings.push({ name: after.name, key: after.key })
    } else if (!sameJson(settingsOf(before), settingsOf(after))) {
      // An identity field's other setting: whether it is a Date.
      out.settings.push({ name: after.name, key: after.key })
    }
  }
  for (const [id, before] of now) {
    if (!then.has(id)) out.removed.push({ name: before.name, key: before.key, kind: before.kind })
  }

  if (target === 'shared' && (nowBody?.idFieldKey ?? null) !== (revisionBody?.idFieldKey ?? null)) {
    out.idField = { from: nowBody?.idFieldKey ?? null, to: revisionBody?.idFieldKey ?? null }
  }
  if (target === 'company') {
    out.details = !sameJson(nowBody?.customFields ?? [], revisionBody?.customFields ?? [])
  }
  // Only the order of the columns may differ: still a change, shown as such.
  const order = (body) => itemsOf(body, target).map(idOf).join('|')
  out.reordered = order(nowBody) !== order(revisionBody)

  out.none =
    out.keys.length + out.formulas.length + out.added.length + out.removed.length + out.renamed.length + out.settings.length === 0 &&
    !out.idField &&
    !out.details &&
    !out.reordered
  return out
}
