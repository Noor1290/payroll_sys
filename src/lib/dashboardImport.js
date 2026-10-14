// The one-time import of this browser's column setup and companies into the
// Payroll Hub dashboard. Started by the user, never by itself, and only after
// a backup file has been downloaded.
//
//   1. Plan (reads only, writes nothing): each browser company is matched to a
//      dashboard company by BRN, only among the dashboard companies the user
//      is an admin of. A company with no BRN, or one that matches nothing, can
//      be linked by hand. The dashboard's name and address are never changed:
//      differences are shown.
//   2. Import, one item at a time: the shared setup first (identity fields and
//      Global columns), then each company's own columns and details, attached
//      to it.
//   3. Check: each item is read back from the dashboard and compared with this
//      browser's copy. Only an item that is the same is noted as imported.
//
// This browser's copy is never changed: it stays as the fallback, and is what
// the app uses when opened on its own. The months stay in this browser too
// (Phase 3): a linked dashboard company keeps using the months of the browser
// company it came from, under the same storage keys.

import * as browserStore from './storage'
import { asJson, askHub, normaliseBrn, sameJson, sendHub } from './hubWire'
import { companyBodyOf, dashboardCompany, readImported, readPrefs, sharedBodyOf, writeImported, writePrefs } from './dashboardSetup'

export const SHARED_SETUP_NAME = 'Shared column setup'

const fail = (code, error) => ({ ok: false, code, error })
const uncertain = (failure) => failure.code === 'unavailable' || failure.code === 'no-answer' || failure.code === 'stale'

// This browser's own copy, read exactly as the app reads it when opened on its own.
export const browserCopy = () => browserStore.loadState()

export function companiesNotImported(state = browserCopy()) {
  const imported = readImported().companies
  return (state?.companies ?? []).filter((company) => !(company.id in imported))
}

// Whether there is anything in this browser that has not been imported yet.
export const hasSomethingToImport = () => companiesNotImported().length > 0

const differs = (a, b) => String(a ?? '').trim() !== String(b ?? '').trim()

// The newest revision of a setup and its body, read through a company that uses it.
async function latestRevision(target, companyBrn) {
  const history = await askHub({ action: 'history', target, company_brn: companyBrn })
  if (!history.ok) return history
  const newest = history.rows[0]?.revision
  if (!newest) return fail('not-found', 'The dashboard has no revision of it.')
  const kept = await askHub({ action: 'revision', target, revision: newest, company_brn: companyBrn })
  if (!kept.ok) return kept
  return { ok: true, revision: newest, body: kept.rows[0]?.body, sharedSetupId: kept.rows[0]?.shared_setup_id }
}

// What an import would do. Reads only: nothing is written anywhere.
//   { ok: true, browser, dashboard, items, shared }
//     dashboard  the dashboard companies the user is an admin of
//     items      one per browser company not imported yet:
//                { company, brn, match, reason, differences, hasSetup }
//     shared     { existing: null } when a new shared setup will be made, or
//                { existing: { id, revision, body, usedBy, differs } }
export async function planImport() {
  const browser = browserCopy()
  if (!browser || browser.companies.length === 0) return fail('not-found', 'This browser holds no companies to import.')
  if (!dashboardCompany()) return fail('unavailable', 'The dashboard is not connected.')

  const answer = await askHub({ action: 'companies' })
  if (!answer.ok) return answer
  const dashboard = answer.rows
  if (dashboard.length === 0) {
    return fail('forbidden', 'You are not an admin of any company in the dashboard, so nothing can be imported. Nothing was changed.')
  }

  // A dashboard company already linked from this browser is not offered again.
  const linked = new Set(Object.values(readImported().companies).map((note) => normaliseBrn(note?.brn)))
  const items = companiesNotImported(browser).map((company) => {
    const brn = String(company.details?.brn ?? '').trim()
    const same = brn ? dashboard.find((d) => normaliseBrn(d.brn) === normaliseBrn(brn)) : undefined
    const match = same && !linked.has(normaliseBrn(same.brn)) ? same : null
    const reason = !brn ? 'no-brn' : match ? null : same ? 'already-linked' : 'no-match'
    return {
      company,
      brn,
      match,
      reason,
      differences: match ? describeDifferences(company, match) : [],
      hasSetup: match?.has_setup === true,
    }
  })

  // The shared setups the user's companies already use. More than one cannot be merged here.
  const inUse = [...new Set(dashboard.filter((d) => d.shared_setup_id).map((d) => d.shared_setup_id))]
  if (inUse.length > 1) {
    return fail(
      'invalid',
      'Your companies in the dashboard use more than one shared column setup, so this browser cannot tell which one to import into. Nothing was changed.',
    )
  }
  let shared = { existing: null }
  if (inUse.length === 1) {
    const usedBy = dashboard.filter((d) => d.shared_setup_id === inUse[0])
    const latest = await latestRevision('shared', usedBy[0].brn)
    if (!latest.ok) return latest
    shared = {
      existing: {
        id: inUse[0],
        revision: latest.revision,
        body: latest.body,
        usedBy: usedBy.map((d) => d.name),
        differs: !sameJson(latest.body, sharedBodyOf(browser)),
      },
    }
  }
  return { ok: true, browser, dashboard, items, shared }
}

function describeDifferences(company, match) {
  const out = []
  if (differs(company.name, match.name)) out.push({ field: 'Name', browser: company.name, dashboard: match.name })
  if (differs(company.details?.address, match.address)) {
    out.push({ field: 'Address', browser: company.details?.address ?? '', dashboard: match.address ?? '' })
  }
  return out
}

// The dashboard companies a browser company can be linked to by hand: those
// the user is an admin of that have no setup yet and are not taken by another
// choice in this import.
export function linkableCompanies(plan, choices, exceptBrowserId) {
  const taken = new Set(
    Object.entries(choices.companies)
      .filter(([browserId, choice]) => browserId !== exceptBrowserId && choice.target && choice.action !== 'skip')
      .map(([, choice]) => normaliseBrn(choice.target)),
  )
  const linked = new Set(Object.values(readImported().companies).map((note) => normaliseBrn(note?.brn)))
  return plan.dashboard.filter((d) => !d.has_setup && !taken.has(normaliseBrn(d.brn)) && !linked.has(normaliseBrn(d.brn)))
}

// What the import does unless the user chooses otherwise. A conflict is never
// resolved by default: it starts as "skip" until a choice is made.
export function defaultChoices(plan) {
  const companies = {}
  for (const item of plan.items) {
    companies[item.company.id] = item.match
      ? { target: item.match.brn, action: item.hasSetup ? 'skip' : 'import', manual: false, confirmed: true }
      : { target: null, action: 'skip', manual: false, confirmed: false }
  }
  return { shared: plan.shared.existing ? null : 'create', companies }
}

// Whether the choices are complete enough to start.
export function readyToImport(plan, choices) {
  if (choices.shared === null) return false
  const chosen = Object.values(choices.companies).filter((c) => c.action !== 'skip' && c.target)
  return chosen.length > 0 && chosen.every((c) => c.confirmed)
}

// ---------- importing ----------

// Imports what was chosen, one item at a time, and checks each. Returns one
// outcome per company that was not skipped, and one for the shared setup:
//   { ok: true, name } | { ok: false, name, reason }
export async function runImport(plan, choices, onProgress = () => {}) {
  const meta = dashboardCompany()
  const outcomes = []
  const say = (outcome) => {
    outcomes.push(outcome)
    onProgress(outcomes.length)
  }
  if (!meta) return [{ ok: false, name: SHARED_SETUP_NAME, reason: 'The dashboard is not connected.' }]

  const sharedBody = sharedBodyOf(plan.browser)
  const chosen = plan.items
    .map((item) => ({ item, choice: choices.companies[item.company.id] }))
    .filter(({ choice }) => choice && choice.action !== 'skip' && choice.target && choice.confirmed)

  // ---------- 1. the shared setup ----------
  let setup
  if (!plan.shared.existing) {
    const id = crypto.randomUUID()
    const sent = await sendHub({ action: 'save-shared', brn: meta.brn, shared_setup_id: id, name: SHARED_SETUP_NAME, body: sharedBody, expected_revision: 0 })
    if (!sent.ok && !uncertain(sent)) {
      say({ ok: false, name: SHARED_SETUP_NAME, reason: sent.error })
      return outcomes
    }
    setup = { id, revision: sent.ok ? sent.result.revision : 1, body: sharedBody, written: true }
  } else if (choices.shared === 'replace') {
    const { id, revision } = plan.shared.existing
    const sent = await sendHub({ action: 'save-shared', brn: meta.brn, shared_setup_id: id, name: SHARED_SETUP_NAME, body: sharedBody, expected_revision: revision })
    if (!sent.ok && !uncertain(sent)) {
      say({ ok: false, name: SHARED_SETUP_NAME, reason: sent.error })
      return outcomes
    }
    setup = { id, revision: sent.ok ? sent.result.revision : revision + 1, body: sharedBody, written: true }
  } else {
    const { id, revision, body } = plan.shared.existing
    setup = { id, revision, body, written: false }
  }

  // ---------- 2. each company, then 3. its check ----------
  let sharedChecked = !setup.written
  for (const { item, choice } of chosen) {
    const name = item.company.name
    const body = companyBodyOf(item.company)
    let written = true
    if (choice.action === 'import') {
      const sent = await sendHub({ action: 'attach-company', brn: meta.brn, company_brn: choice.target, shared_setup_id: setup.id, body })
      if (!sent.ok && !uncertain(sent)) {
        say({ ok: false, name, reason: sent.error })
        continue
      }
    } else if (choice.action === 'replace') {
      const latest = await latestRevision('company', choice.target)
      if (!latest.ok) {
        say({ ok: false, name, reason: latest.error })
        continue
      }
      if (latest.sharedSetupId !== setup.id) {
        say({ ok: false, name, reason: 'That dashboard company uses another shared column setup. Nothing was changed for it.' })
        continue
      }
      const sent = await sendHub({ action: 'save-company', brn: meta.brn, company_brn: choice.target, body, expected_revision: latest.revision })
      if (!sent.ok && !uncertain(sent)) {
        say({ ok: false, name, reason: sent.error })
        continue
      }
    } else {
      written = false // 'keep': the dashboard's own columns stay as they are
    }

    // The check: what the dashboard now holds, read back and compared.
    const back = await latestRevision('company', choice.target)
    if (!back.ok) {
      say({ ok: false, name, reason: back.code === 'not-found' ? 'The dashboard did not store it.' : back.error })
      continue
    }
    if (back.sharedSetupId !== setup.id) {
      say({ ok: false, name, reason: "The dashboard company is not attached to the shared column setup. This browser's copy is still the one to use." })
      continue
    }
    if (written && !sameJson(back.body, body)) {
      say({ ok: false, name, reason: "What the dashboard stored is not the same as this browser's copy. This browser's copy is still the one to use." })
      continue
    }
    if (!sharedChecked) {
      // The shared setup can only be read back through a company that uses it: this is the first.
      const sharedBack = await latestRevision('shared', choice.target)
      if (!sharedBack.ok || !sameJson(sharedBack.body, sharedBody)) {
        say({
          ok: false,
          name: SHARED_SETUP_NAME,
          reason: "What the dashboard stored as the shared column setup is not the same as this browser's copy. Nothing more was imported; this browser's copy is still the one to use.",
        })
        return outcomes
      }
      setup.revision = sharedBack.revision
      sharedChecked = true
      say({ ok: true, name: SHARED_SETUP_NAME })
    }

    const noted = note(item.company, choice.target, nameOf(plan, choice.target), back.revision, setup)
    say(noted ? { ok: true, name } : { ok: false, name, reason: "It is in the dashboard, but this browser's storage is full, so it could not be noted as imported here." })
  }
  return outcomes
}

const nameOf = (plan, brn) => plan.dashboard.find((d) => normaliseBrn(d.brn) === normaliseBrn(brn))?.name ?? brn

// Notes that a browser company is now the dashboard company with that BRN, so
// its months are found again, and starts the dashboard company with the same
// column widths and month as the browser company.
function note(company, brn, dashboardName, revision, setup) {
  const notes = readImported()
  notes.shared = { sharedSetupId: setup.id, revision: setup.revision, importedAt: new Date().toISOString() }
  notes.companies = {
    ...notes.companies,
    [company.id]: { brn, company: dashboardName, browserName: company.name, revision, importedAt: new Date().toISOString() },
  }
  if (!writeImported(notes)) return false
  const prefs = readPrefs()
  const key = normaliseBrn(brn)
  if (!prefs[key]) {
    prefs[key] = { columnWidths: asJson(company.columnWidths ?? {}), viewYear: company.viewYear, viewMonth: company.viewMonth }
    writePrefs(prefs)
  }
  return true
}
