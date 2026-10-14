// A stand-in for the Payroll Hub dashboard that keeps payroll column setups,
// for the tests. It follows the dashboard's docs/INTEGRATION.md ("Payroll
// app: column setup") and the rules of its migration 0013: the same actions,
// the same refusals (revision last seen, a company attached once, the shared
// setup changed only by an admin of every attached company).
//
// `createFakeSetupHub` must not use anything from outside itself: the browser
// tests turn it into text and run it in a page.
//
// TEST data only.

export function createFakeSetupHub(seed = {}) {
  const state = {
    supported: seed.supported !== false,
    // The user's companies in the dashboard: { brn, name, address, role: 'admin' | 'member' }.
    companies: (seed.companies || []).map((c) => ({ ...c })),
    selectedBrn: seed.selectedBrn || (seed.companies && seed.companies[0] && seed.companies[0].brn) || null,
    // Companies attached to a shared setup by someone else, that this user is not a member of.
    othersAttached: (seed.othersAttached || []).map((c) => ({ ...c })),
    // id -> { id, name, body, revision, mine }
    shared: new Map(),
    // BRN -> { shared_setup_id, body, revision }
    setups: new Map(),
    // { target: 'shared:<id>' | 'company:<BRN>', revision, body, shared_setup_id? }
    history: [],
    // Every message, without bodies: { type, action }.
    log: [],
    // The next message matching { action } is refused with { code, error }.
    // `store: true` carries it out first; `silent: true` sends no answer at all.
    failNext: null,
    // Stores the next save with a changed body, as a faulty store would.
    corruptNextSave: false,
    down: false,
    delayMs: 0,
    savesRunning: 0,
    mostSavesAtOnce: 0,
    now: 0,
  }
  for (const s of seed.shared || []) {
    state.shared.set(s.id, { mine: true, ...s, body: structuredClone(s.body) })
    state.history.push({ target: `shared:${s.id}`, revision: s.revision, body: structuredClone(s.body), saved_at: '2026-10-01T09:00:00.000Z' })
  }
  for (const [brn, s] of Object.entries(seed.setups || {})) {
    state.setups.set(brn, { ...s, body: structuredClone(s.body) })
    state.history.push({
      target: `company:${brn}`,
      revision: s.revision,
      body: structuredClone(s.body),
      shared_setup_id: s.shared_setup_id,
      saved_at: '2026-10-01T09:00:00.000Z',
    })
  }

  const norm = (brn) => String(brn || '').trim().toUpperCase()
  const refuse = (code, error) => ({ ok: false, code, error })
  const member = (brn) => state.companies.find((c) => norm(c.brn) === norm(brn)) || null
  const selected = () => member(state.selectedBrn)
  const meta = () => ({ label: selected().name, brn: selected().brn, role: selected().role })
  const stamp = () => new Date(Date.UTC(2026, 9, 14, 9, 0, state.now++)).toISOString()

  // What a database does to stored JSON: an object's properties come back in its own
  // order (shorter names first, then by alphabet), not the order they were sent in.
  const asStored = (value) => {
    if (Array.isArray(value)) return value.map(asStored)
    if (value === null || typeof value !== 'object') return value
    const keys = Object.keys(value).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
    return Object.fromEntries(keys.map((key) => [key, asStored(value[key])]))
  }
  const stored = (body) => {
    const copy = asStored(JSON.parse(JSON.stringify(body)))
    if (state.corruptNextSave) {
      state.corruptNextSave = false
      copy.corrupted = true
    }
    return copy
  }

  const attachedTo = (id) => [
    ...[...state.setups].filter(([, s]) => s.shared_setup_id === id).map(([brn]) => member(brn) || { brn, role: null }),
    ...state.othersAttached.filter((c) => c.shared_setup_id === id),
  ]
  const canRead = (id) => {
    const setup = state.shared.get(id)
    if (!setup) return false
    const attached = attachedTo(id)
    return attached.length === 0 ? setup.mine : attached.some((c) => c.role)
  }
  const canChange = (id) => {
    const setup = state.shared.get(id)
    if (!setup) return false
    const attached = attachedTo(id)
    return attached.length === 0 ? setup.mine : attached.every((c) => c.role === 'admin')
  }
  const keep = (target, revision, body, sharedId) =>
    state.history.push({ target, revision, body: structuredClone(body), saved_at: stamp(), ...(sharedId ? { shared_setup_id: sharedId } : {}) })

  function request(params) {
    if (params.brn !== undefined && norm(params.brn) !== norm(state.selectedBrn)) {
      return refuse('wrong-company', 'The dashboard has a different company selected.')
    }
    const answer = (rows) => ({ ok: true, dataType: 'payroll-setup', rows, meta: meta() })
    const which = (brn) => (brn === undefined ? selected() : member(brn))
    switch (params.action) {
      case 'load': {
        const own = state.setups.get(norm(state.selectedBrn))
        if (!own) return answer([])
        const setup = state.shared.get(own.shared_setup_id)
        const attached = attachedTo(setup.id)
        const rows = [
          {
            kind: 'shared',
            shared_setup_id: setup.id,
            name: setup.name,
            body: setup.body,
            revision: setup.revision,
            updated_at: stamp(),
            updated_by_you: true,
            can_change: canChange(setup.id),
            companies: attached.length,
            admin_of: attached.filter((c) => c.role === 'admin').length,
          },
        ]
        for (const [brn, s] of state.setups) {
          const company = member(brn)
          if (s.shared_setup_id !== setup.id || !company) continue
          rows.push({
            kind: 'company',
            brn: company.brn,
            name: company.name,
            address: company.address ?? null,
            role: company.role,
            selected: norm(brn) === norm(state.selectedBrn),
            shared_setup_id: s.shared_setup_id,
            body: s.body,
            revision: s.revision,
            updated_at: stamp(),
            updated_by_you: true,
          })
        }
        return answer(rows)
      }
      case 'companies':
        return answer(
          state.companies
            .filter((c) => c.role === 'admin')
            .map((c) => ({
              brn: c.brn,
              name: c.name,
              address: c.address ?? null,
              has_setup: state.setups.has(norm(c.brn)),
              shared_setup_id: state.setups.get(norm(c.brn))?.shared_setup_id ?? null,
              selected: norm(c.brn) === norm(state.selectedBrn),
            })),
        )
      case 'history':
      case 'revision': {
        const company = which(params.company_brn)
        if (!company) return refuse('not-found', 'You have no company with that BRN in the dashboard.')
        const own = state.setups.get(norm(company.brn))
        if (!own) return refuse('not-found', 'This company has no column setup in the dashboard yet.')
        const target = params.target === 'shared' ? `shared:${own.shared_setup_id}` : `company:${norm(company.brn)}`
        const kept = state.history.filter((h) => h.target === target).sort((a, b) => b.revision - a.revision)
        if (params.action === 'history') return answer(kept.map(({ revision, saved_at }) => ({ revision, saved_at, saved_by_you: true })))
        const one = kept.find((h) => h.revision === params.revision)
        if (!one) return refuse('not-found', 'This setup has no such revision.')
        const { target: _target, ...revision } = one
        return answer([{ ...revision, saved_by_you: true }])
      }
      default:
        return refuse('invalid', '"action" is missing or not valid.')
    }
  }

  function save(row) {
    if (norm(row.brn) !== norm(state.selectedBrn)) return refuse('wrong-company', 'The dashboard has a different company selected.')
    if (row.action === 'save-shared') {
      const existing = state.shared.get(row.shared_setup_id)
      const changes = row.companies || []
      if (!existing) {
        if (row.expected_revision !== 0) return refuse('not-found', 'The dashboard has no such item.')
        if (changes.length > 0) return refuse('invalid', 'Not valid: a new setup has no companies yet.')
        const setup = { id: row.shared_setup_id, name: row.name, body: stored(row.body), revision: 1, mine: true }
        state.shared.set(setup.id, setup)
        keep(`shared:${setup.id}`, 1, setup.body)
        return { ok: true, result: { action: 'save-shared', shared_setup_id: setup.id, name: setup.name, revision: 1, companies: [] } }
      }
      if (!canRead(existing.id)) return refuse('not-found', 'The dashboard has no such item.')
      if (!canChange(existing.id)) return refuse('forbidden', 'Only an admin of this company can do this.')
      if (existing.revision !== row.expected_revision) return refuse('stale', 'It was saved by someone else since you loaded it.')
      for (const change of changes) {
        const own = state.setups.get(norm(change.company_brn))
        if (!member(change.company_brn) || !own || own.shared_setup_id !== existing.id) return refuse('not-found', 'The dashboard has no such item.')
        if (own.revision !== change.expected_revision) return refuse('stale', 'It was saved by someone else since you loaded it.')
      }
      existing.body = stored(row.body)
      existing.revision += 1
      keep(`shared:${existing.id}`, existing.revision, existing.body)
      const companies = changes.map((change) => {
        const own = state.setups.get(norm(change.company_brn))
        own.body = stored(change.body)
        own.revision += 1
        keep(`company:${norm(change.company_brn)}`, own.revision, own.body, own.shared_setup_id)
        return { brn: member(change.company_brn).brn, revision: own.revision }
      })
      return { ok: true, result: { action: 'save-shared', shared_setup_id: existing.id, name: existing.name, revision: existing.revision, companies } }
    }

    const company = row.company_brn === undefined ? selected() : member(row.company_brn)
    if (!company) return refuse('not-found', 'You have no company with that BRN in the dashboard.')
    if (company.role !== 'admin') return refuse('forbidden', 'Only an admin of this company can change its columns.')
    const brn = norm(company.brn)

    if (row.action === 'attach-company') {
      if (!canRead(row.shared_setup_id)) return refuse('not-found', 'The dashboard has no such item.')
      if (!canChange(row.shared_setup_id)) return refuse('forbidden', 'Only an admin of this company can do this.')
      if (state.setups.has(brn)) return refuse('stale', 'This company already has a column setup in the dashboard. Reload, then try again.')
      const own = { shared_setup_id: row.shared_setup_id, body: stored(row.body), revision: 1 }
      state.setups.set(brn, own)
      keep(`company:${brn}`, 1, own.body, own.shared_setup_id)
      return { ok: true, result: { action: 'attach-company', brn: company.brn, company: company.name, shared_setup_id: own.shared_setup_id, revision: 1 } }
    }
    if (row.action === 'save-company') {
      const own = state.setups.get(brn)
      if (!own) return refuse('not-found', 'This company has no column setup in the dashboard yet.')
      if (own.revision !== row.expected_revision) return refuse('stale', 'It was saved by someone else since you loaded it.')
      own.body = stored(row.body)
      own.revision += 1
      keep(`company:${brn}`, own.revision, own.body, own.shared_setup_id)
      return { ok: true, result: { action: 'save-company', brn: company.brn, company: company.name, shared_setup_id: own.shared_setup_id, revision: own.revision } }
    }
    return refuse('invalid', '"action" is missing or not valid.')
  }

  // As the dashboard would answer one message from the app. Undefined = no answer at all.
  async function handle(type, payload) {
    const isRequest = type === 'request-data'
    const command = isRequest ? payload.params || {} : payload.rows[0]
    state.log.push({ type, action: command.action, ...(command.company_brn ? { company_brn: command.company_brn } : {}) })
    if (payload.dataType !== 'payroll-setup') return undefined
    if (!state.supported) return { ok: false, error: `This app is not registered to ${isRequest ? 'receive' : 'send'} this kind of data.` }
    if (state.down) return { ok: false, code: 'unavailable', error: "Can't reach the database." }

    const failing = state.failNext
    const matches = failing && failing.action === command.action
    if (matches) state.failNext = null

    if (!isRequest) {
      state.savesRunning += 1
      state.mostSavesAtOnce = Math.max(state.mostSavesAtOnce, state.savesRunning)
    }
    if (state.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.delayMs))
    let answer
    if (!matches || failing.store) answer = isRequest ? request(command) : save(command)
    if (!isRequest) state.savesRunning -= 1
    if (matches) return failing.silent ? undefined : { ok: false, code: failing.code, error: failing.error || 'The dashboard could not confirm it.' }
    return answer === undefined ? undefined : JSON.parse(JSON.stringify(answer))
  }

  // What another admin does in their own browser: change the shared setup there.
  function changeSharedElsewhere(id, body) {
    const setup = state.shared.get(id)
    setup.body = stored(body)
    setup.revision += 1
    keep(`shared:${id}`, setup.revision, setup.body)
  }

  return { state, handle, changeSharedElsewhere }
}

// Puts the stand-in in place of the dashboard for the app's copy of the bridge,
// in a jsdom test: what the app sends goes to `hub`, and its answer comes back.
// An answer the hub does not give stays unanswered (the bridge times out).
export function installFakeBridge(hub) {
  const sent = []
  window.PayrollHubBridge = {
    isEmbedded: () => true,
    isConnected: () => true,
    init: () => true,
    onStatus: () => () => {},
    requestData: () => Promise.resolve({ ok: false, error: 'Not in this test.' }),
    sendToDashboard: (type, payload) => {
      sent.push({ type, payload: structuredClone(payload) })
      // No answer: as the real bridge does, it gives up after 10 seconds.
      const unanswered = () =>
        new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'The dashboard did not answer in time.' }), 10_000))
      return hub.handle(type, structuredClone(payload)).then((answer) => answer ?? unanswered())
    },
  }
  return sent
}
