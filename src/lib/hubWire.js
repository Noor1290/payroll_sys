// The messages this app exchanges with the Payroll Hub dashboard about its
// column setup (the dashboard's docs/INTEGRATION.md, "Payroll app: column
// setup"). Everything goes through the copied bridge file; nothing here
// talks to a server.
//
// Every answer is one of:
//   { ok: true, rows, meta: { brn, label, role } }      a request was answered
//   { ok: true, result }                               a save was stored
//   { ok: false, code, error }                         it was not; `code` says why:
//     stale, forbidden, wrong-company, invalid, not-found, too-large, unavailable,
//     no-answer      the dashboard did not answer at all
//     not-supported  a dashboard that does not keep payroll setups yet

const KNOWN_CODES = ['stale', 'forbidden', 'wrong-company', 'invalid', 'not-found', 'too-large', 'unavailable']

// How long a request may take before the app stops waiting. The bridge itself
// waits up to two minutes for a request, because the dashboard may ask its
// user first; a setup is answered without asking, so this is plenty.
export const REQUEST_WAIT_MS = 15_000

function failureOf(reply) {
  const error = typeof reply?.error === 'string' ? reply.error : ''
  if (typeof reply?.code === 'string' && KNOWN_CODES.includes(reply.code)) return { ok: false, code: reply.code, error }
  // A dashboard that does not know a data type turns it away with a sentence and no code.
  if (/not registered/i.test(error)) return { ok: false, code: 'not-supported', error }
  if (/did not answer in time/i.test(error)) return { ok: false, code: 'no-answer', error }
  return { ok: false, code: 'unavailable', error }
}

function readMeta(meta) {
  const { brn, label, role } = meta ?? {}
  if (typeof brn !== 'string' || brn === '') return null
  return { brn, label: typeof label === 'string' ? label : '', role: role === 'admin' ? 'admin' : 'member' }
}

const NO_ANSWER = { ok: false, code: 'no-answer', error: 'The dashboard did not answer in time.' }

export async function askHub(params, { waitMs = REQUEST_WAIT_MS } = {}) {
  let timer
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(NO_ANSWER), waitMs)
  })
  const reply = await Promise.race([
    window.PayrollHubBridge.sendToDashboard('request-data', { dataType: 'payroll-setup', params }),
    late,
  ])
  clearTimeout(timer)
  if (reply === NO_ANSWER) return NO_ANSWER
  if (reply?.ok !== true) return failureOf(reply)
  const meta = readMeta(reply.meta)
  if (!meta || !Array.isArray(reply.rows)) {
    return { ok: false, code: 'unavailable', error: "The dashboard's answer could not be read." }
  }
  return { ok: true, rows: reply.rows, meta }
}

export async function sendHub(row) {
  const reply = await window.PayrollHubBridge.sendToDashboard('send-data', { dataType: 'payroll-setup', rows: [row] })
  if (reply?.ok !== true) return failureOf(reply)
  return { ok: true, result: reply.result ?? {} }
}

// A value as it is once stored as JSON: what the dashboard keeps of it.
// Properties that are `undefined` are not kept (columns have several).
export function asJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

// Whether two values hold the same thing once stored as JSON. The database
// does not keep the order of an object's properties, so what comes back is
// compared by content, never as text.
export function sameJson(a, b) {
  return sameValue(asJson(a), asJson(b))
}

function sameValue(a, b) {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]))
  }
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => key in b && sameValue(a[key], b[key]))
}

export const normaliseBrn = (brn) => String(brn ?? '').trim().toUpperCase()
