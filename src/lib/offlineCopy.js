// When the dashboard cannot be reached: the last column setup this browser
// loaded from it, offered READ-ONLY, labelled with when it was loaded. It is
// never opened for editing in place of the dashboard's copy (that would make
// two versions), and it holds no month: the employees' figures stay in the
// dashboard, behind its password gate.
//
// The copy is written by dashboardSetup.js each time a company's setup is
// loaded from the dashboard, one per company.

import { getCurrentPeriod } from './periods'
import { companyBodyOf, readOfflineNote, sharedBodyOf } from './dashboardSetup'
import { sameJson } from './hubWire'

const isList = Array.isArray

function usable(copy) {
  return (
    copy &&
    typeof copy === 'object' &&
    typeof copy.brn === 'string' &&
    typeof copy.label === 'string' &&
    typeof copy.loadedAt === 'string' &&
    !Number.isNaN(Date.parse(copy.loadedAt)) &&
    isList(copy.shared?.body?.identityFields) &&
    isList(copy.shared?.body?.globalColumns) &&
    isList(copy.company?.body?.columns)
  )
}

// Every company this browser has a copy for, newest first: { brn, label, loadedAt }.
export function listOfflineCopies() {
  return Object.values(readOfflineNote())
    .filter(usable)
    .map(({ brn, label, loadedAt }) => ({ brn, label, loadedAt }))
    .sort((a, b) => b.loadedAt.localeCompare(a.loadedAt))
}

// "15 October 2026 at 18:22", in this computer's own time.
export function formatLoadedAt(loadedAt) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(loadedAt))
}

const OFFLINE = { code: 'offline', error: "The employees' figures are kept in the dashboard only. They are not in this offline copy." }

// A store (see dataStore.js) that shows one company's copy and saves nothing.
// Null when there is no usable copy for that BRN.
export function offlineStore(brn) {
  const copy = Object.values(readOfflineNote()).find((c) => usable(c) && c.brn === brn)
  if (!copy) return null
  const { year, month } = getCurrentPeriod()
  const id = `offline_${copy.brn}`
  let state = {
    identityFields: copy.shared.body.identityFields,
    idFieldKey: copy.shared.body.idFieldKey ?? null,
    globalColumns: copy.shared.body.globalColumns,
    companies: [
      {
        id,
        name: copy.company.name,
        columns: copy.company.body.columns,
        columnWidths: {},
        viewYear: year,
        viewMonth: month,
        details: { address: copy.company.address ?? '', brn: copy.brn, customFields: copy.company.body.customFields ?? [] },
      },
    ],
    activeCompanyId: id,
  }
  const setupOf = (s) => ({ shared: sharedBodyOf(s), companies: s.companies.map(companyBodyOf) })
  const kept = setupOf(state)

  return {
    copy: { brn: copy.brn, label: copy.label, loadedAt: copy.loadedAt },
    store: {
      loadState: () => structuredClone(state),
      // Nothing can be saved: a change to the columns is refused (the screens offer none).
      // What is only this screen's (the month being viewed, column widths) is kept in memory.
      saveState(next) {
        if (!sameJson(setupOf(next), kept)) return false
        state = structuredClone(next)
        return true
      },
      loadPeriod: () => ({ employees: [], blocked: { ...OFFLINE } }),
      savePeriod: () => false,
      periodHasEmployees: () => false,
      deletePeriodsForCompany: () => {},
      countPeriodsHoldingKey: () => ({ periods: 0, companies: 0, unknown: true }),
      renameValueKeyInPeriods: () => false,
      readSavedValues: () => Promise.resolve({ ok: false, code: 'offline', error: 'The months are not in the offline copy.' }),
    },
  }
}
