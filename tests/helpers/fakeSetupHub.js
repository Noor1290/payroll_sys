// A stand-in for the Payroll Hub dashboard that keeps payroll column setups,
// for the tests. It follows the dashboard's docs/INTEGRATION.md ("Payroll
// app: column setup") and the rules of its migration 0013: the same actions,
// the same refusals (revision last seen, a company attached once, the shared
// setup changed only by an admin of every attached company).
//
// With `monthsSupported: true` it keeps the months too ("Payroll app: months",
// migration 0014): admins only, behind a password gate (`unlocked`), every save
// naming the revision last seen, and a change of key that saves the setup and
// moves the values in every month it reaches, all or nothing. Without it, it is
// a dashboard from before that: it turns the months' data type away.
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
    // ---------- months ----------
    monthsSupported: seed.monthsSupported === true,
    // The dashboard's password gate.
    unlocked: seed.unlocked !== false,
    // What the user does when the app asks to unlock: 'unlock' | 'deny'.
    unlockAnswer: 'unlock',
    // `${BRN}|${YYYY-MM}` -> { revision, employees, shared_revision, company_revision, by }
    months: new Map(),
    // { key, revision, shared_revision, company_revision, employee_count, employees: kept content or null, by, saved_at }
    monthHistory: [],
    // Told when the gate opens or locks, as the dashboard tells the app.
    onPush: null,
    savesRunning: 0,
    mostSavesAtOnce: 0,
    now: 0,
    // ---------- several companies at once ("payroll-batch") ----------
    // Kept by a dashboard that keeps the months, unless the seed says otherwise.
    batchSupported: seed.batchSupported ?? seed.monthsSupported === true,
    // What the user does with the dashboard's one question: 'allow' | 'deny'.
    batchAnswer: 'allow',
    // Every question asked: { from, to, companies } (BRNs as sent).
    batchAsked: [],
    // What was allowed: { from, to, brns: Set } | null.
    batchPermit: null,
  }
  for (const s of seed.shared || []) {
    state.shared.set(s.id, { mine: true, ...s, body: structuredClone(s.body) })
    state.history.push({ target: `shared:${s.id}`, revision: s.revision, body: structuredClone(s.body), saved_at: '2026-10-01T09:00:00.000Z' })
  }
  for (const [key, m] of Object.entries(seed.months || {})) {
    const month = { revision: 1, shared_revision: 1, company_revision: 1, by: 'other', ...m, employees: JSON.parse(JSON.stringify(m.employees)) }
    state.months.set(key, month)
    state.monthHistory.push({ ...recordOf(key, month), saved_at: '2026-10-01T09:00:00.000Z' })
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
  // What a month's history records of one save; its content only when kept later.
  function recordOf(key, month) {
    return {
      key,
      revision: month.revision,
      shared_revision: month.shared_revision,
      company_revision: month.company_revision,
      employee_count: month.employees.length,
      employees: null,
      by: month.by,
      saved_at: null,
    }
  }
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
      // A month (a list) gets a value changed; a setup (an object) a property added.
      if (Array.isArray(copy) && copy.length > 0) copy[0] = { ...copy[0], values: { ...copy[0].values, corrupted: true } }
      else copy.corrupted = true
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

  // ---------- months ----------

  const monthKey = (brn, period) => `${norm(brn)}|${period}`
  const LOCKED = () => refuse('locked', 'The dashboard is locked. Unlock it there to see the employees\' figures.')
  const valueKeys = (employees) => [...new Set(employees.flatMap((e) => Object.keys(e.values || {})))].sort()
  const hasRevision = (target, revision) => state.history.some((h) => h.target === target && h.revision === revision)
  // The month as it is about to be replaced, kept when someone else saved it or when asked.
  const keepPrevious = (key, month, asked) => {
    const record = state.monthHistory.find((h) => h.key === key && h.revision === month.revision)
    if (record && record.employees === null && (asked || month.by !== 'me')) record.employees = JSON.parse(JSON.stringify(month.employees))
  }
  // Which company a month message is about: the selected one, or another of the user's, admin only.
  const monthCompany = (companyBrn) => {
    const company = companyBrn === undefined ? selected() : member(companyBrn)
    if (!company) return refuse('not-found', 'You have no company with that BRN in the dashboard.')
    if (company.role !== 'admin') return refuse('forbidden', `Only an admin of ${company.name} can see or change its employees' figures.`)
    return company
  }

  function monthRequest(params) {
    if (params.brn !== undefined && norm(params.brn) !== norm(state.selectedBrn)) {
      return refuse('wrong-company', 'The dashboard has a different company selected.')
    }
    const answer = (rows) => ({ ok: true, dataType: 'payroll-month', rows, meta: meta() })
    if (params.action === 'gate') return answer([{ unlocked: state.unlocked }])
    if (selected().role !== 'admin') return refuse('forbidden', `Only an admin of ${selected().name} can see or change its employees' figures.`)
    if (params.action === 'unlock') {
      if (state.unlocked) return answer([{ unlocked: true }])
      if (state.unlockAnswer === 'deny') return refuse('denied', 'The dashboard user declined the request.')
      setGate(true)
      return answer([{ unlocked: true }])
    }
    if (!state.unlocked) return LOCKED()
    const company = monthCompany(params.company_brn)
    if (company.ok === false) return company
    const brn = norm(company.brn)
    const mine = [...state.months].filter(([key]) => key.startsWith(`${brn}|`))
    switch (params.action) {
      case 'list':
        return answer(
          mine
            .map(([key, m]) => ({
              period: key.split('|')[1],
              revision: m.revision,
              shared_revision: m.shared_revision,
              company_revision: m.company_revision,
              employee_count: m.employees.length,
              value_keys: valueKeys(m.employees),
              updated_at: stamp(),
              updated_by_you: m.by === 'me',
            }))
            .sort((a, b) => (a.period < b.period ? -1 : 1))
        )
      case 'load': {
        if (!Array.isArray(params.periods) || params.periods.length < 1 || params.periods.length > 12) {
          return refuse('invalid', '"periods" is missing or not valid.')
        }
        return answer(
          params.periods
            .filter((period) => state.months.has(monthKey(brn, period)))
            .map((period) => {
              const m = state.months.get(monthKey(brn, period))
              return {
                period,
                revision: m.revision,
                shared_revision: m.shared_revision,
                company_revision: m.company_revision,
                employee_count: m.employees.length,
                employees: m.employees,
                updated_at: stamp(),
                updated_by_you: m.by === 'me',
              }
            })
        )
      }
      case 'history':
        return answer(
          state.monthHistory
            .filter((h) => h.key === monthKey(brn, params.period))
            .sort((a, b) => b.revision - a.revision)
            .map((h) => ({
              revision: h.revision,
              shared_revision: h.shared_revision,
              company_revision: h.company_revision,
              employee_count: h.employee_count,
              kept: h.employees !== null,
              saved_at: h.saved_at,
              saved_by_you: h.by === 'me',
            }))
        )
      case 'revision': {
        if (!Number.isInteger(params.revision) || params.revision < 1) return refuse('invalid', '"revision" is missing or not valid.')
        const key = monthKey(brn, params.period)
        const record = state.monthHistory.find((h) => h.key === key && h.revision === params.revision)
        const month = state.months.get(key)
        const employees = record && (record.employees ?? (month && month.revision === params.revision ? month.employees : null))
        if (!employees) return refuse('not-found', "This revision's content was not kept: the dashboard has only the record of that save.")
        return answer([
          {
            period: params.period,
            revision: record.revision,
            shared_revision: record.shared_revision,
            company_revision: record.company_revision,
            employee_count: record.employee_count,
            employees,
            saved_at: record.saved_at,
            saved_by_you: record.by === 'me',
          },
        ])
      }
      default:
        return refuse('invalid', '"action" is missing or not valid.')
    }
  }

  function monthSave(row) {
    if (norm(row.brn) !== norm(state.selectedBrn)) return refuse('wrong-company', 'The dashboard has a different company selected.')
    if (selected().role !== 'admin') return refuse('forbidden', `Only an admin of ${selected().name} can see or change its employees' figures.`)
    if (!state.unlocked) return refuse('locked', 'The dashboard is locked, so this was NOT saved. Unlock it there, and it is saved then.')

    if (row.action === 'save') {
      const company = monthCompany(row.company_brn)
      if (company.ok === false) return company
      const brn = norm(company.brn)
      const own = state.setups.get(brn)
      if (!own) return refuse('not-found', 'The dashboard has no such item.')
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.period) || !Array.isArray(row.employees)) return refuse('invalid', '"period" is missing or not valid.')
      if (row.employees.some((e) => !e || typeof e.id !== 'string' || !e.values || typeof e.values !== 'object' || Object.keys(e).length !== 2)) {
        return refuse('invalid', '"employees" is missing or not valid.')
      }
      if (!hasRevision(`shared:${own.shared_setup_id}`, row.shared_revision) || !hasRevision(`company:${brn}`, row.company_revision)) {
        return refuse('invalid', "Not valid: those column setup revisions are not this company's.")
      }
      const key = monthKey(brn, row.period)
      const month = state.months.get(key)
      if (!month && row.expected_revision !== 0) return refuse('not-found', 'The dashboard has no such item.')
      if (month && month.revision !== row.expected_revision) {
        return refuse('stale', 'Someone else saved this month in the dashboard since it was opened here. Nothing was saved.')
      }
      if (row.restored_from !== undefined && (!Number.isInteger(row.restored_from) || row.restored_from < 1)) {
        return refuse('invalid', '"restored_from" is missing or not valid.')
      }
      if (month) keepPrevious(key, month, row.keep_previous === true)
      const saved = {
        revision: month ? month.revision + 1 : 1,
        shared_revision: row.shared_revision,
        company_revision: row.company_revision,
        employees: stored(row.employees),
        by: 'me',
      }
      state.months.set(key, saved)
      state.monthHistory.push({ ...recordOf(key, saved), saved_at: stamp() })
      return {
        ok: true,
        result: {
          action: 'save',
          brn: company.brn,
          company: company.name,
          period: row.period,
          revision: saved.revision,
          employee_count: saved.employees.length,
          ...(row.restored_from !== undefined ? { restored_from: row.restored_from } : {}),
        },
      }
    }

    if (row.action === 'key-change') {
      if ((row.shared === undefined) === (row.company === undefined)) return refuse('invalid', 'Not valid: give either the shared setup or the company setup.')
      const setupId = row.shared ? row.shared.shared_setup_id : state.setups.get(norm(row.company.company_brn || state.selectedBrn))?.shared_setup_id
      if (!setupId) return refuse('not-found', 'The dashboard has no such item.')
      const attached = [...state.setups].filter(([, s]) => s.shared_setup_id === setupId).map(([brn]) => brn)
      // Everything that can be refused is checked before anything changes: all or nothing.
      const plan = []
      for (const move of row.moves || []) {
        const targets = move.company_brn === null ? attached : [norm(move.company_brn)]
        if (move.company_brn !== null && !attached.includes(norm(move.company_brn))) return refuse('not-found', 'The dashboard has no such item.')
        if (row.company && norm(move.company_brn) !== norm(row.company.company_brn || state.selectedBrn)) {
          return refuse('invalid', 'Not valid: a company setup can only move keys in its own months.')
        }
        if (targets.some((brn) => member(brn)?.role !== 'admin')) return refuse('forbidden', 'Only an admin of this company can do this.')
        plan.push({ move, targets })
      }
      const setupRow = row.shared
        ? { action: 'save-shared', brn: row.brn, shared_setup_id: row.shared.shared_setup_id, name: row.shared.name, body: row.shared.body, expected_revision: row.shared.expected_revision, companies: row.shared.companies }
        : { action: 'save-company', brn: row.brn, company_brn: row.company.company_brn, body: row.company.body, expected_revision: row.company.expected_revision }
      const setup = save(setupRow)
      if (!setup.ok) return setup
      const months = []
      for (const { move, targets } of plan) {
        for (const brn of targets) {
          for (const [key, month] of state.months) {
            if (!key.startsWith(`${brn}|`) || !valueKeys(month.employees).includes(move.old_key)) continue
            keepPrevious(key, month, false)
            const employees = month.employees.map((e) => {
              if (!(move.old_key in e.values)) return e
              const { [move.old_key]: value, ...rest } = e.values
              return { ...e, values: { ...rest, [move.new_key]: value } }
            })
            const moved = {
              ...month,
              revision: month.revision + 1,
              shared_revision: state.shared.get(setupId).revision,
              company_revision: state.setups.get(brn).revision,
              employees: asStored(employees),
              by: 'me',
            }
            state.months.set(key, moved)
            state.monthHistory.push({ ...recordOf(key, moved), saved_at: stamp() })
            months.push({ brn: member(brn)?.brn ?? brn, period: key.split('|')[1], revision: moved.revision })
          }
        }
      }
      const result = setup.result
      return {
        ok: true,
        result: {
          action: 'key-change',
          setup: { shared_setup_id: setupId, revision: result.revision, ...(row.company ? { brn: result.brn } : {}), companies: result.companies || [] },
          months,
        },
      }
    }
    return refuse('invalid', '"action" is missing or not valid.')
  }

  // ---------- several companies at once ----------
  // The dashboard's "payroll-batch": the user's admin companies; ONE question naming the
  // months (from `from` to `to`, 24 at most) and every company; then one company per load,
  // only as allowed and while unlocked.
  function batchRequest(params) {
    if (params.brn !== undefined && norm(params.brn) !== norm(state.selectedBrn)) {
      return refuse('wrong-company', 'The dashboard has a different company selected.')
    }
    const answer = (rows, period) => ({ ok: true, dataType: 'payroll-batch', rows, meta: { ...meta(), ...(period ? { period } : {}) } })
    const admins = state.companies
      .filter((c) => c.role === 'admin')
      .sort((a, b) => Number(norm(b.brn) === norm(state.selectedBrn)) - Number(norm(a.brn) === norm(state.selectedBrn)) || a.name.localeCompare(b.name))
    const adminOf = (brn) => admins.find((c) => norm(c.brn) === norm(brn)) || null
    const isMonth = (period) => typeof period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(period)
    const monthsOf = (from, to) => {
      const index = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1
      const out = []
      for (let i = index(from); i <= index(to); i++) out.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`)
      return out
    }
    const isRange = (from, to) => isMonth(from) && isMonth(to) && from <= to && monthsOf(from, to).length <= 24
    switch (params.action) {
      case 'companies':
        return answer(
          admins.map((c) => ({ brn: c.brn, name: c.name, selected: norm(c.brn) === norm(state.selectedBrn), has_setup: state.setups.has(norm(c.brn)) }))
        )
      case 'ask': {
        if (!isRange(params.from, params.to) || !Array.isArray(params.companies) || params.companies.length < 1 || params.companies.length > 200) {
          return refuse('invalid', '"companies" is missing or not valid.')
        }
        if (params.companies.some((brn) => !adminOf(brn))) return refuse('forbidden', 'Only companies where you are an admin can be chosen.')
        state.batchAsked.push({ from: params.from, to: params.to, companies: [...params.companies] })
        if (state.batchAnswer === 'deny') return refuse('denied', 'The dashboard user declined the request.')
        if (!state.unlocked) {
          if (state.unlockAnswer === 'deny') return refuse('locked', 'The dashboard is locked. Confirm your password there to unlock it, then ask again.')
          setGate(true)
        }
        const granted = [...new Set(params.companies.map(norm))].map(adminOf)
        state.batchPermit = { from: params.from, to: params.to, brns: new Set(granted.map((c) => norm(c.brn))) }
        return answer(
          granted.map((c) => ({ brn: c.brn, name: c.name })),
          params.from === params.to ? params.from : undefined
        )
      }
      case 'load': {
        const permit = state.batchPermit
        if (!isRange(params.from, params.to)) return refuse('invalid', '"to" is missing or not valid.')
        if (!permit || permit.from !== params.from || permit.to !== params.to || !permit.brns.has(norm(params.company_brn))) {
          return refuse('denied', 'That company and those months were not allowed in the dashboard for this app. Ask again.')
        }
        if (!state.unlocked) return refuse('locked', 'The dashboard is locked. Confirm your password there to unlock it, then ask again.')
        const company = adminOf(params.company_brn)
        if (!company) return refuse('forbidden', "Only an admin of that company can export its employees' figures.")
        const own = state.setups.get(norm(company.brn))
        const shared = own ? state.shared.get(own.shared_setup_id) : null
        const saved = monthsOf(params.from, params.to).filter((period) => state.months.has(monthKey(company.brn, period)))
        return answer(
          [
            {
              brn: company.brn,
              name: company.name,
              address: company.address ?? null,
              from: params.from,
              to: params.to,
              setup:
                own && shared
                  ? {
                      shared_setup_id: shared.id,
                      shared_name: shared.name,
                      shared_body: shared.body,
                      shared_revision: shared.revision,
                      company_body: own.body,
                      company_revision: own.revision,
                    }
                  : null,
              months: saved.map((period) => {
                const month = state.months.get(monthKey(company.brn, period))
                return {
                  period,
                  revision: month.revision,
                  shared_revision: month.shared_revision,
                  company_revision: month.company_revision,
                  employee_count: month.employees.length,
                  employees: month.employees,
                  updated_at: stamp(),
                }
              }),
            },
          ],
          params.from === params.to ? params.from : undefined
        )
      }
      default:
        return refuse('invalid', '"action" is missing or not valid.')
    }
  }

  // The dashboard's gate opens or locks; the app is told, as the dashboard tells it.
  function setGate(unlocked) {
    if (state.unlocked === unlocked) return
    state.unlocked = unlocked
    // Locking forgets what was allowed for several companies.
    if (!unlocked) state.batchPermit = null
    if (state.onPush) state.onPush({ dataType: 'payroll-month', rows: [{ action: 'gate', unlocked }] })
  }

  // What another admin does in their own browser: save a month there.
  function changeMonthElsewhere(brn, period, employees) {
    const key = monthKey(brn, period)
    const month = state.months.get(key)
    const own = state.setups.get(norm(brn))
    const saved = {
      revision: month ? month.revision + 1 : 1,
      shared_revision: month?.shared_revision ?? state.shared.get(own.shared_setup_id).revision,
      company_revision: month?.company_revision ?? own.revision,
      employees: stored(employees),
      by: 'other',
    }
    state.months.set(key, saved)
    state.monthHistory.push({ ...recordOf(key, saved), saved_at: stamp() })
  }

  // As the dashboard would answer one message from the app. Undefined = no answer at all.
  async function handle(type, payload) {
    const isRequest = type === 'request-data'
    const command = isRequest ? payload.params || {} : payload.rows[0]
    state.log.push({
      type,
      ...(payload.dataType === 'payroll-month' || payload.dataType === 'payroll-batch' ? { dataType: payload.dataType } : {}),
      action: command.action,
      ...(command.company_brn ? { company_brn: command.company_brn } : {}),
      ...(command.period ? { period: command.period } : {}),
    })
    const isMonth = payload.dataType === 'payroll-month'
    const isBatch = payload.dataType === 'payroll-batch'
    if (payload.dataType !== 'payroll-setup' && !isMonth && !isBatch) return undefined
    if (!state.supported || (isMonth && !state.monthsSupported) || (isBatch && (!state.batchSupported || !isRequest))) {
      return { ok: false, error: `This app is not registered to ${isRequest ? 'receive' : 'send'} this kind of data.` }
    }
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
    if (!matches || failing.store) {
      answer = isBatch
        ? batchRequest(command)
        : isMonth
          ? isRequest
            ? monthRequest(command)
            : monthSave(command)
          : isRequest
            ? request(command)
            : save(command)
    }
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

  return { state, handle, changeSharedElsewhere, changeMonthElsewhere, setGate }
}

// Puts the stand-in in place of the dashboard for the app's copy of the bridge,
// in a jsdom test: what the app sends goes to `hub`, and its answer comes back.
// An answer the hub does not give stays unanswered (the bridge times out).
export function installFakeBridge(hub) {
  const sent = []
  window.PayrollHubBridge = {
    isEmbedded: () => true,
    isConnected: () => true,
    // What the dashboard sends by itself (the gate opening or locking) reaches the app's onData.
    init: (options) => {
      hub.state.onPush = options && typeof options.onData === 'function' ? options.onData : null
      return true
    },
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
