import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Building2, CircleAlert, CloudOff, Copy, History, LoaderCircle, LockKeyhole, Menu, RotateCw, Trash2, Upload, X } from 'lucide-react'
import Sidebar from './components/Sidebar'
import ColumnManager from './components/ColumnManager'
import IdentityFieldsManager from './components/IdentityFieldsManager'
import EmployeeTable from './components/EmployeeTable'
import MonthSwitcher from './components/MonthSwitcher'
import TotalsView from './components/TotalsView'
import FormulaBreakdownModal from './components/FormulaBreakdownModal'
import ImportMappingModal from './components/ImportMappingModal'
import ExportPreviewModal from './components/ExportPreviewModal'
import ExportSplitButton from './components/ExportSplitButton'
import PdfFillExportModal from './components/PdfFillExportModal'
import SendToDashboardButton from './components/SendToDashboardButton'
import ConfirmDialog from './components/ConfirmDialog'
import CompanyDetailsModal from './components/CompanyDetailsModal'
import CopyPreviousMonthModal from './components/CopyPreviousMonthModal'
import ExportErrorsDialog from './components/ExportErrorsDialog'
import SaveFailedDialog from './components/SaveFailedDialog'
import BackupMessage from './components/BackupMessage'
import DashboardBar from './components/DashboardBar'
import DashboardStart from './components/DashboardStart'
import ImportToDashboardModal from './components/ImportToDashboardModal'
import ImportMonthsModal from './components/ImportMonthsModal'
import { MonthHistoryModal, SetupHistoryModal } from './components/HistoryModal'
import UnreadableSetup from './components/UnreadableSetup'
import { dataStore, renameValueKey, resetDataStore, setDataStore } from './lib/dataStore'
import { brnOf, connectDashboard, dashboardCompany, dashboardStore, onSetupReplaced, readImported, sharedAccess } from './lib/dashboardSetup'
import { formatLoadedAt, listOfflineCopies, offlineStore } from './lib/offlineCopy'
import { hasSomethingToImport } from './lib/dashboardImport'
import { askToUnlock, gateChanged, monthStatus, onMonthsChanged } from './lib/dashboardMonths'
import { hasMonthsToImport } from './lib/monthImport'
import { setupIsUnreadable } from './lib/backup'
import { findErrorCells } from './lib/exportErrors'
import { findFormulasUsingColumn, findScopeChangeBlockers, renameKeyInColumn, renameKeyInWidths } from './lib/columnUsage'
import {
  newCompany,
  newEmployee,
  newColumn,
  newIdentityField,
  defaultIdentityFields,
  getEffectiveColumns,
  getColumnsByKey,
  getGlobalKnownKeys,
  getCompanyScopeKnownKeys,
  makeId,
} from './lib/model'
import { reorderWithinCategory, labelColumnsForHelper } from './lib/categories'
import { formatPeriodLabel, periodKey, shiftPeriod } from './lib/periods'
import { useComputedGrid } from './hooks/useComputedGrid'
import { buildExportPlan } from './lib/excelExport'
import {
  parseWorkbookFile,
  getImportableSystemFields,
  buildImportedEmployees,
  isRecognizedExport,
  describeUnrecognizedMeta,
  resolveImportMapping,
  findUnreadableValues,
} from './lib/excelImport'

// Shown while the selected month is still being loaded.
const NO_EMPLOYEES = []

const TABS = [
  { id: 'global', label: 'Global Columns' },
  { id: 'company', label: 'Company Columns' },
  { id: 'employees', label: 'Employee Table' },
  { id: 'totals', label: 'Totals' },
]

// Every read and save goes through the data store (see lib/dataStore.js).
const {
  loadState,
  saveState,
  loadPeriod,
  savePeriod,
  periodHasEmployees,
  deletePeriodsForCompany,
  countPeriodsHoldingKey,
  renameValueKeyInPeriods,
} = dataStore

// What the dashboard sends this app by itself: whether its password gate is
// open (the months are behind it). Anything else is turned down.
function receiveFromDashboard(payload) {
  const row = payload?.rows?.[0]
  if (payload?.dataType === 'payroll-month' && row?.action === 'gate' && typeof row.unlocked === 'boolean') {
    gateChanged(row.unlocked)
    return true
  }
  return false
}

const isPending = (result) => typeof result?.then === 'function'

// The app, started from whatever is stored. After a backup has been restored
// it is started again from scratch, so nothing of the replaced data stays on
// screen or in memory.
//
// Inside the Payroll Hub dashboard the column setup comes from the dashboard
// (lib/dashboardSetup.js) and is saved there, and so are the months
// (lib/dashboardMonths.js), behind the dashboard's password gate. A dashboard
// that does not keep months yet leaves them in this browser. Opened on its own,
// or inside a dashboard that does not keep payroll setups yet, everything is
// in this browser exactly as before.
// When the dashboard cannot be reached, the last column setup loaded from it
// can be opened read-only (lib/offlineCopy.js): mode 'offline'. No month is in it.
//   mode: 'browser' | 'starting' | 'dashboard' | 'empty' | 'failed' | 'offline'
export default function App() {
  const [startedFrom, setStartedFrom] = useState(0)
  const [restoreMessage, setRestoreMessage] = useState(null) // { title, description, tone } | null
  const [mode, setMode] = useState(() => (window.PayrollHubBridge.isEmbedded() ? 'starting' : 'browser'))
  const [startProblem, setStartProblem] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importMonthsOpen, setImportMonthsOpen] = useState(false)
  // The offline copy on screen: { brn, label, loadedAt } | null.
  const [offline, setOffline] = useState(null)

  // No-op unless this app is running inside the Payroll Hub dashboard's iframe.
  useEffect(() => {
    window.PayrollHubBridge.init({ appId: 'payroll', onData: receiveFromDashboard })
  }, [])

  // What a load from the dashboard answered decides what is shown.
  const applyResult = useCallback((result) => {
    setOffline(null)
    if (result.ok && !result.empty) {
      setDataStore(dashboardStore)
      setMode('dashboard')
      setStartedFrom((n) => n + 1)
    } else if (result.ok) {
      resetDataStore()
      setMode('empty')
    } else if (result.code === 'not-supported') {
      // A dashboard that does not keep payroll setups yet: this browser, as before.
      resetDataStore()
      setMode('browser')
    } else {
      resetDataStore()
      setStartProblem(result.error || 'The dashboard could not be reached.')
      setMode('failed')
    }
  }, [])

  const loadFromDashboard = useCallback(async () => {
    setMode('starting')
    applyResult(await connectDashboard())
  }, [applyResult])

  // Inside the dashboard, the setup comes from there. (After the bridge has
  // started, above.) The app starts in 'starting', so only the answer is applied.
  useEffect(() => {
    if (window.PayrollHubBridge.isEmbedded()) void connectDashboard().then(applyResult)
  }, [applyResult])

  useEffect(() => onSetupReplaced(applyResult), [applyResult])

  // "Open the read-only copy": the last column setup loaded from the dashboard, saving nothing.
  function openOffline(brn) {
    const opened = offlineStore(brn)
    if (!opened) return
    setDataStore(opened.store)
    setOffline(opened.copy)
    setMode('offline')
    setStartedFrom((n) => n + 1)
  }

  function handleRestored(message) {
    setRestoreMessage(message)
    setStartedFrom((n) => n + 1)
  }

  const importDialog = importOpen && (
    <ImportToDashboardModal
      onClose={() => setImportOpen(false)}
      onDone={() => {
        setImportOpen(false)
        void loadFromDashboard()
      }}
    />
  )

  if (mode !== 'browser' && mode !== 'dashboard' && mode !== 'offline') {
    return (
      <div className="relative isolate flex h-dvh overflow-hidden bg-canvas text-fg">
        <DashboardStart
          mode={mode}
          problem={startProblem}
          canImport={mode === 'empty' && hasSomethingToImport()}
          onRetry={() => void loadFromDashboard()}
          onImport={() => setImportOpen(true)}
          offlineCopies={mode === 'failed' ? listOfflineCopies() : []}
          onOpenOffline={openOffline}
        />
        {importDialog}
      </div>
    )
  }

  // On its own, with saved data that cannot be read: never shown as empty,
  // never saved over, until the user chooses what to do.
  if (mode === 'browser' && setupIsUnreadable()) {
    return (
      <div className="relative isolate flex h-dvh overflow-hidden bg-canvas text-fg">
        <UnreadableSetup
          onRestored={handleRestored}
          onStarted={(keptUnder) =>
            handleRestored({
              title: 'Started with an empty setup',
              description: `What could not be read is kept in this browser, under "${keptUnder}".`,
            })
          }
        />
        {restoreMessage && <BackupMessage {...restoreMessage} onClose={() => setRestoreMessage(null)} />}
      </div>
    )
  }

  return (
    <>
      <PayrollApp
        key={startedFrom}
        onRestored={handleRestored}
        inDashboard={mode === 'dashboard'}
        offline={mode === 'offline' ? offline : null}
        onReloadDashboard={() => void loadFromDashboard()}
        onOpenImport={() => setImportOpen(true)}
        onOpenImportMonths={() => setImportMonthsOpen(true)}
      />
      {restoreMessage && <BackupMessage {...restoreMessage} onClose={() => setRestoreMessage(null)} />}
      {importDialog}
      {importMonthsOpen && (
        <ImportMonthsModal
          onClose={() => setImportMonthsOpen(false)}
          onDone={() => {
            setImportMonthsOpen(false)
            void loadFromDashboard()
          }}
        />
      )}
    </>
  )
}

// `offline`: the read-only copy of the dashboard's column setup, { brn, label, loadedAt }, or null.
function PayrollApp({ onRestored, inDashboard = false, offline = null, onReloadDashboard, onOpenImport, onOpenImportMonths }) {
  const [identityFields, setIdentityFields] = useState([])
  const [idFieldKey, setIdFieldKey] = useState(null)
  const [globalColumns, setGlobalColumns] = useState([])
  const [companies, setCompanies] = useState([])
  const [activeCompanyId, setActiveCompanyId] = useState(null)
  // The offline copy has no months: it opens on the columns.
  const [activeTab, setActiveTab] = useState(offline ? 'global' : 'employees')
  // The History open now: 'shared' | 'company' | 'month' | null (inside the dashboard).
  const [historyOf, setHistoryOf] = useState(null)
  const [breakdownTrace, setBreakdownTrace] = useState(null)
  const [importData, setImportData] = useState(null) // { headers, rows } | null
  const [exportPlan, setExportPlan] = useState(null)
  const [pdfFillFormat, setPdfFillFormat] = useState(null) // 'csv' | 'json' | null
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false)
  const [detailsCompanyId, setDetailsCompanyId] = useState(null)
  const [copyPreviousMonthData, setCopyPreviousMonthData] = useState(null) // { employees, year, month } | null
  const [loaded, setLoaded] = useState(false)
  // Display only: the message shown when an Excel file can't be read, and
  // whether the company list is open as a drawer (narrow widths).
  const [importError, setImportError] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const fileInputRef = useRef(null)

  // The currently selected month's employees for the active company. Kept
  // separate from `companies` state since employee data now persists per
  // (company, year, month) period, not on the company itself.
  // Named `loadedEmployees` because it can briefly still hold the month just
  // left - everything below reads `periodEmployees`, which is only ever the
  // month named by `loadedPeriodKey`.
  const [loadedEmployees, setPeriodEmployees] = useState([])
  // Which company + month `loadedEmployees` belongs to.
  const [loadedPeriodKey, setLoadedPeriodKey] = useState(null)

  // A save the browser refused (storage full): the change is taken back off
  // the screen and this blocking warning says it was NOT saved.
  const [saveFailed, setSaveFailed] = useState(false)
  // Set while the screen is being put back to what is saved, so that
  // putting it back is not itself treated as a change to save.
  const revertingState = useRef(false)
  const revertingPeriod = useRef(false)
  // An export waiting for the user's answer to "some figures are in error".
  const [pendingExport, setPendingExport] = useState(null) // { errors, proceed } | null
  // What the last import could not read as numbers.
  const [importSummary, setImportSummary] = useState(null) // { count, unreadable } | null

  // A column setup restored from its History: the screen shows what the store now holds.
  function showRestoredSetup() {
    const saved = loadState()
    if (!saved) return
    setIdentityFields(saved.identityFields)
    setIdFieldKey(saved.idFieldKey)
    setGlobalColumns(saved.globalColumns)
    setCompanies(saved.companies)
  }

  useEffect(() => {
    const saved = loadState()
    if (saved) {
      setIdentityFields(saved.identityFields)
      setIdFieldKey(saved.idFieldKey)
      setGlobalColumns(saved.globalColumns)
      setCompanies(saved.companies)
      setActiveCompanyId(saved.activeCompanyId)
    } else {
      const defaults = defaultIdentityFields()
      setIdentityFields(defaults)
      setIdFieldKey(defaults[0].key)
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (!loaded) return
    if (revertingState.current) {
      revertingState.current = false
      return
    }
    if (saveState({ identityFields, idFieldKey, globalColumns, companies, activeCompanyId })) return
    // Not saved: never leave on screen what is not in storage.
    const saved = loadState()
    if (saved) {
      revertingState.current = true
      setIdentityFields(saved.identityFields)
      setIdFieldKey(saved.idFieldKey)
      setGlobalColumns(saved.globalColumns)
      setCompanies(saved.companies)
      setActiveCompanyId(saved.activeCompanyId)
    }
    setSaveFailed(true)
  }, [loaded, identityFields, idFieldKey, globalColumns, companies, activeCompanyId])

  // Inside the dashboard: who may change what. The dashboard decides; this only
  // shows read-only from the start instead of letting a save be refused.
  const access = inDashboard ? sharedAccess() : null
  const companyRole = inDashboard ? dashboardCompany()?.role : 'admin'
  // The offline copy is read-only throughout: nothing in it can be saved.
  const globalReadOnly = Boolean(offline) || (inDashboard && !access?.canChange)
  const companyReadOnly = Boolean(offline) || (inDashboard && companyRole !== 'admin')
  // Opened on its own after an import: this browser's copy is not the dashboard's.
  const [browserOnly] = useState(() => !inDashboard && !offline && Object.keys(readImported().companies).length > 0)
  const [canImport] = useState(() => inDashboard && companyRole === 'admin' && hasSomethingToImport())

  // Inside a dashboard that keeps the months: they are behind its password gate.
  const months = useSyncExternalStore(monthStatus.subscribe, monthStatus.get)
  const monthsKept = inDashboard && months.supported
  // The offline copy holds no month: in place of the table, it says so.
  const monthsInDashboard = monthsKept || Boolean(offline)
  const [canImportMonths] = useState(() => monthsKept && companyRole === 'admin' && hasMonthsToImport())
  // While the gate is locked the month's figures are covered; what was typed stays in memory.
  const covered = monthsKept && months.gate === 'locked'
  // Bumped when the month on screen must be read again (the gate opened, the dashboard's version was taken).
  const [monthReload, setMonthReload] = useState(0)
  // The month on screen could not be read: { key, code, error } | null.
  const [monthBlocked, setMonthBlocked] = useState(null)

  const activeCompany = companies.find((c) => c.id === activeCompanyId) ?? null
  const selectedYear = activeCompany?.viewYear ?? null
  const selectedMonth = activeCompany?.viewMonth ?? null
  const currentPeriodKey = activeCompanyId && selectedYear && selectedMonth ? `${activeCompanyId}:${selectedYear}-${selectedMonth}` : null

  // Load the selected month's employees whenever the company or month changes.
  // From this browser it is there at once; from the dashboard it may take a
  // moment, or not be readable at all (then nothing is shown or saved).
  useEffect(() => {
    if (!activeCompanyId || !selectedYear || !selectedMonth) {
      setPeriodEmployees([])
      setLoadedPeriodKey(null)
      setMonthBlocked(null)
      return
    }
    const key = `${activeCompanyId}:${selectedYear}-${selectedMonth}`
    const apply = (result) => {
      if (result.blocked) {
        setMonthBlocked({ key, ...result.blocked })
        return
      }
      setMonthBlocked(null)
      setPeriodEmployees(result.employees)
      setLoadedPeriodKey(key)
    }
    const result = loadPeriod(activeCompanyId, selectedYear, selectedMonth)
    if (!isPending(result)) return apply(result)
    let live = true
    result.then((loaded) => {
      if (live) apply(loaded)
    })
    return () => {
      live = false
    }
  }, [activeCompanyId, selectedYear, selectedMonth, monthReload])

  // Inside the dashboard: read the month again when the dashboard opens its gate
  // or its version of the month replaced the one on screen.
  useEffect(
    () =>
      onMonthsChanged(() => {
        setLoadedPeriodKey(null)
        setMonthReload((n) => n + 1)
      }),
    []
  )

  // Save the month on screen. Only ever the month that was actually loaded:
  // right after the company or month changes, `loadedEmployees` still holds
  // the month being left, and that must never be written under the new key.
  useEffect(() => {
    if (!currentPeriodKey || loadedPeriodKey !== currentPeriodKey) return
    if (revertingPeriod.current) {
      revertingPeriod.current = false
      return
    }
    if (savePeriod(activeCompanyId, selectedYear, selectedMonth, { employees: loadedEmployees })) return
    // Not saved: put the screen back to what is saved, and say so.
    revertingPeriod.current = true
    const saved = loadPeriod(activeCompanyId, selectedYear, selectedMonth)
    setPeriodEmployees(isPending(saved) ? loadedEmployees : saved.employees)
    setSaveFailed(true)
  }, [loadedPeriodKey, currentPeriodKey, activeCompanyId, selectedYear, selectedMonth, loadedEmployees])

  const periodEmployees = currentPeriodKey && loadedPeriodKey === currentPeriodKey ? loadedEmployees : NO_EMPLOYEES
  // The month on screen is there to work on: read, and not covered. (In this
  // browser it always is: it is read at once.)
  const blocked = monthBlocked && monthBlocked.key === currentPeriodKey ? monthBlocked : null
  // A month saved in this browser that cannot be read: covered, never shown as empty (see storage.js).
  const unreadableMonth = blocked?.code === 'unreadable'
  const monthReady = !unreadableMonth && (!monthsInDashboard || (Boolean(currentPeriodKey) && loadedPeriodKey === currentPeriodKey && !covered))

  // Whether "Copy from Previous Month" has anything to offer right now -
  // read fresh (not kept in React state) each time it's relevant, since
  // it's only ever consulted right before the user might click the button.
  const previousPeriodHasData = useMemo(() => {
    // Asked again when the dashboard's list of months changes (`months`).
    void months
    if (!activeCompanyId || !selectedYear || !selectedMonth) return false
    const prev = shiftPeriod(selectedYear, selectedMonth, -1)
    return periodHasEmployees(activeCompanyId, prev.year, prev.month)
  }, [activeCompanyId, selectedYear, selectedMonth, months])

  function handleOpenCopyPreviousMonth() {
    if (!activeCompanyId || !selectedYear || !selectedMonth) return
    const prev = shiftPeriod(selectedYear, selectedMonth, -1)
    const apply = (result) => {
      if (!result.blocked) setCopyPreviousMonthData({ employees: result.employees, year: prev.year, month: prev.month })
    }
    const result = loadPeriod(activeCompanyId, prev.year, prev.month)
    if (isPending(result)) void result.then(apply)
    else apply(result)
  }

  function handleConfirmCopyPreviousMonth(nextEmployees) {
    setPeriodEmployees(nextEmployees)
    setCopyPreviousMonthData(null)
  }

  const effectiveColumns = useMemo(
    () => (activeCompany ? getEffectiveColumns(activeCompany, globalColumns) : []),
    [activeCompany, globalColumns]
  )

  const columnsByKey = useMemo(() => getColumnsByKey(effectiveColumns), [effectiveColumns])

  // key -> readable label (name, or "Name (Category)" when another column
  // shares that name) for the breakdown modal's display-only formula
  // rendering - never touches the stored expression/keys themselves.
  const formulaDisplayLabels = useMemo(() => {
    const labeled = labelColumnsForHelper(Object.values(columnsByKey))
    return Object.fromEntries(labeled.map((c) => [c.key, c.helperLabel]))
  }, [columnsByKey])

  const computedGrid = useComputedGrid(periodEmployees, effectiveColumns)

  function updateCompany(id, updater) {
    setCompanies((prev) => prev.map((c) => (c.id === id ? updater(c) : c)))
  }

  function handleAddCompany() {
    const company = newCompany(`Company ${companies.length + 1}`)
    setCompanies((prev) => [...prev, company])
    setActiveCompanyId(company.id)
    setActiveTab('employees')
    // Straight into the details form so the user can fill in the real name/
    // address/BRN right away - Cancel just skips it, same as any other time.
    setDetailsCompanyId(company.id)
  }

  function handleRenameCompany(id, name) {
    updateCompany(id, (c) => ({ ...c, name }))
  }

  function handleDeleteCompany(id) {
    setCompanies((prev) => prev.filter((c) => c.id !== id))
    if (activeCompanyId === id) setActiveCompanyId(null)
    // Its employees live in per-month storage, not on the company: remove
    // every month too, so nothing of a deleted company stays in the browser.
    deletePeriodsForCompany(id)
  }

  function handleSaveCompanyDetails(id, { name, details }) {
    updateCompany(id, (c) => ({ ...c, name, details }))
    setDetailsCompanyId(null)
  }

  function handleChangeMonth(year, month) {
    updateCompany(activeCompanyId, (c) => ({ ...c, viewYear: year, viewMonth: month }))
  }

  // ---- Identity fields ----
  function handleAddIdentityField(field) {
    setIdentityFields((prev) => [...prev, newIdentityField(field)])
  }
  function handleEditIdentityField(id, field) {
    setIdentityFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...field } : f)))
  }
  function handleDeleteIdentityField(id) {
    setIdentityFields((prev) => {
      const deleted = prev.find((f) => f.id === id)
      if (deleted && deleted.key === idFieldKey) setIdFieldKey(null)
      return prev.filter((f) => f.id !== id)
    })
  }
  function handleSetIdField(key) {
    setIdFieldKey(key)
  }

  // Identity fields are shared by every company, so a change of key reaches
  // every company's saved months.
  function getIdentityKeyChangePreview(field) {
    return countPeriodsHoldingKey(companies.map((c) => c.id), field.key)
  }

  // Carries a change of an identity field's key through everything that
  // refers to it: every saved month of every company, the month on screen,
  // which field is the ID field, and the remembered column widths. The
  // field's own key is then set by the normal edit that follows.
  function handleRenameIdentityFieldKey(field, newKey) {
    const oldKey = field.key
    if (!renameValueKeyInPeriods(companies.map((c) => c.id), oldKey, newKey)) setSaveFailed(true)

    if (idFieldKey === oldKey) setIdFieldKey(newKey)
    setCompanies((prev) => prev.map((c) => ({ ...c, columnWidths: renameKeyInWidths(c.columnWidths, oldKey, newKey) })))
    setPeriodEmployees((prev) => prev.map((e) => renameValueKey(e, oldKey, newKey)))
  }

  // ---- Global columns ----
  function handleAddGlobalColumn(col) {
    setGlobalColumns((prev) => [...prev, newColumn(col)])
  }
  function handleEditGlobalColumn(id, col) {
    setGlobalColumns((prev) => prev.map((c) => (c.id === id ? { ...c, ...col } : c)))
  }
  function handleDeleteGlobalColumn(id) {
    setGlobalColumns((prev) => prev.filter((c) => c.id !== id))
  }
  function handleReorderGlobalColumns(draggedId, targetId) {
    setGlobalColumns((prev) => reorderWithinCategory(prev, draggedId, targetId))
  }
  // `newColumns` are already fully-formed column objects (built by
  // planColumnImport via newColumn()) - appended directly, not re-wrapped.
  function handleImportGlobalColumns(newColumns) {
    setGlobalColumns((prev) => [...prev, ...newColumns])
  }

  // ---- Company columns ----
  function handleAddCompanyColumn(col) {
    updateCompany(activeCompanyId, (c) => ({ ...c, columns: [...c.columns, newColumn(col)] }))
  }
  function handleEditCompanyColumn(id, col) {
    updateCompany(activeCompanyId, (c) => ({
      ...c,
      columns: c.columns.map((existing) => (existing.id === id ? { ...existing, ...col } : existing)),
    }))
  }
  function handleDeleteCompanyColumn(id) {
    updateCompany(activeCompanyId, (c) => ({ ...c, columns: c.columns.filter((existing) => existing.id !== id) }))
  }
  function handleReorderCompanyColumns(draggedId, targetId) {
    updateCompany(activeCompanyId, (c) => ({ ...c, columns: reorderWithinCategory(c.columns, draggedId, targetId) }))
  }
  function handleImportCompanyColumns(newColumns) {
    updateCompany(activeCompanyId, (c) => ({ ...c, columns: [...c.columns, ...newColumns] }))
  }

  // ---- Column scope conversion (Global <-> Company-specific) ----
  // `patchedColumn` is the fully-formed column object (same id, every other
  // field carried over/edited as usual) - only which array it lives in
  // changes here. Employee data is keyed by column key in per-period
  // storage untouched by this, so it's naturally preserved (just no longer
  // displayed) for companies that lose access to a column, and naturally
  // picked back up if the same key is ever restored to their scope.
  function handleChangeColumnScope(patchedColumn, newScope) {
    if (newScope === 'company') {
      setGlobalColumns((prev) => prev.filter((c) => c.id !== patchedColumn.id))
      updateCompany(activeCompanyId, (c) => ({ ...c, columns: [...c.columns, patchedColumn] }))
    } else {
      updateCompany(activeCompanyId, (c) => ({ ...c, columns: c.columns.filter((c2) => c2.id !== patchedColumn.id) }))
      setGlobalColumns((prev) => [...prev, patchedColumn])
    }
  }

  // ---- Checks before an edit that could break formulas ----
  // Formulas that would stop working if this Global column became specific
  // to the active company (see findScopeChangeBlockers).
  function getScopeBlockers(column) {
    return findScopeChangeBlockers(column, globalColumns, companies, activeCompanyId)
  }

  // Which companies and columns a column of the given scope can be used by.
  function reachOf(scope) {
    const reachCompanies = scope === 'global' ? companies : companies.filter((c) => c.id === activeCompanyId)
    const reachColumns = scope === 'global' ? [...globalColumns, ...companies.flatMap((c) => c.columns)] : (activeCompany?.columns ?? [])
    return { reachCompanies, reachColumns }
  }

  // What changing this column's key would have to update: the formulas that
  // use it, and the saved months that hold a value under it.
  function getKeyChangePreview(column, scope) {
    const { reachCompanies, reachColumns } = reachOf(scope)
    return {
      formulas: findFormulasUsingColumn(column.key, reachColumns).map((c) => c.name),
      ...countPeriodsHoldingKey(reachCompanies.map((c) => c.id), column.key),
    }
  }

  // Carries a change of key through everything that refers to it: every
  // formula (and its builder settings), every saved month, the month on
  // screen and the remembered column widths. The column's own key is then
  // set by the normal edit that follows.
  function handleRenameColumnKey(column, newKey, scope) {
    const oldKey = column.key
    const { reachCompanies } = reachOf(scope)
    const reachIds = new Set(reachCompanies.map((c) => c.id))
    if (!renameValueKeyInPeriods([...reachIds], oldKey, newKey)) setSaveFailed(true)

    const rename = (columns) => columns.map((c) => renameKeyInColumn(c, oldKey, newKey))
    if (scope === 'global') setGlobalColumns(rename)
    setCompanies((prev) =>
      prev.map((c) => (reachIds.has(c.id) ? { ...c, columns: rename(c.columns), columnWidths: renameKeyInWidths(c.columnWidths, oldKey, newKey) } : c))
    )
    setPeriodEmployees((prev) => prev.map((e) => renameValueKey(e, oldKey, newKey)))
  }

  // ---- Exports: never let a figure in error leave as a number ----
  // Runs `proceed` straight away when nothing is in error; otherwise asks
  // first, listing the employees and columns affected.
  function exportUnlessErrors(errors, proceed) {
    if (errors.length === 0) proceed()
    else setPendingExport({ errors, proceed })
  }

  // ---- Employees (scoped to the selected company + month) ----
  function handleAddEmployee() {
    setPeriodEmployees((prev) => [...prev, newEmployee()])
  }
  function handleDeleteEmployee(empId) {
    setPeriodEmployees((prev) => prev.filter((e) => e.id !== empId))
  }
  function handleUpdateValue(empId, key, value) {
    setPeriodEmployees((prev) =>
      prev.map((e) => (e.id === empId ? { ...e, values: { ...e.values, [key]: value } } : e))
    )
  }
  // The "tick all" box of a checkbox column: one value for every employee of the month.
  function handleSetForEveryone(key, value) {
    setPeriodEmployees((prev) => prev.map((e) => ({ ...e, values: { ...e.values, [key]: value } })))
  }
  function handleResizeColumn(key, width) {
    updateCompany(activeCompanyId, (c) => ({ ...c, columnWidths: { ...c.columnWidths, [key]: width } }))
  }
  function handleDeleteAllEmployees() {
    setPeriodEmployees([])
    setConfirmingDeleteAll(false)
  }

  // ---- Import from Excel ----
  function handleImportClick() {
    setImportError(null)
    setImportSummary(null)
    fileInputRef.current?.click()
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file || !activeCompanyId) return
    try {
      const systemFields = getImportableSystemFields(identityFields, effectiveColumns)
      const { headers, rows, meta } = await parseWorkbookFile(file, systemFields.flatMap((f) => [f.name, f.label]))
      const allCurrentKeys = new Set([...identityFields.map((f) => f.key), ...effectiveColumns.map((c) => c.key)])
      const recognized = isRecognizedExport(meta, activeCompanyId, allCurrentKeys)
      const initialMapping = resolveImportMapping(systemFields, headers, meta)
      const autoNote = recognized ? null : describeUnrecognizedMeta(meta, activeCompanyId, allCurrentKeys)
      setImportData({ headers, rows, systemFields, initialMapping, recognized, autoNote, meta })
    } catch (err) {
      console.error('Failed to read Excel file:', err)
      setImportError('Could not read that file. Please make sure it is a valid .xlsx file.')
    }
  }

  function handleConfirmImport(mapping) {
    if (!importData || !activeCompanyId) return
    const imported = buildImportedEmployees({
      rows: importData.rows,
      systemFields: importData.systemFields,
      mapping,
      makeId,
      meta: importData.meta,
    })
    // Number cells that could not be read were left blank, not written as
    // 0 - the same list the preview showed, repeated here after the import.
    const unreadable = findUnreadableValues({
      rows: importData.rows,
      systemFields: importData.systemFields,
      mapping,
      meta: importData.meta,
    })
    setImportSummary(unreadable.length > 0 ? { count: imported.length, unreadable } : null)
    setPeriodEmployees((prev) => [...prev, ...imported])
    setImportData(null)
    setActiveTab('employees')
  }

  // The columns of an export plan, named as the Employee Table names them
  // (two columns called "CSG" are told apart by their category).
  function namedForWarning(columns) {
    return columns.map((c) => ({ ...c, name: formulaDisplayLabels[c.key] ?? c.name }))
  }

  function handleOpenExportPreview(exportMode = 'values') {
    if (!activeCompany) return
    const plan = buildExportPlan({
      title: activeCompany.name,
      companyId: activeCompany.id,
      companyDetails: activeCompany.details,
      kind: 'period',
      exportMode,
      employees: periodEmployees,
      identityFields,
      effectiveColumns,
      computedGrid,
    })
    const errors = findErrorCells(periodEmployees, namedForWarning(plan.columns), computedGrid, identityFields)
    exportUnlessErrors(errors, () => setExportPlan(plan))
  }

  function handleOpenTotalsExportPreview(totalsEmployees, totalsGrid, rangeLabel) {
    if (!activeCompany) return
    const plan = buildExportPlan({
      title: `${activeCompany.name} — Totals (${rangeLabel})`,
      companyId: activeCompany.id,
      companyDetails: activeCompany.details,
      kind: 'totals',
      employees: totalsEmployees,
      identityFields,
      effectiveColumns,
      computedGrid: totalsGrid,
    })
    const errors = findErrorCells(totalsEmployees, namedForWarning(plan.columns), totalsGrid, identityFields)
    exportUnlessErrors(errors, () => setExportPlan(plan))
  }

  const globalKnownKeys = useMemo(
    () => getGlobalKnownKeys(identityFields, globalColumns, companies),
    [identityFields, globalColumns, companies]
  )

  // Keys reserved within just the active company's own world - the
  // relevant collision set when converting a Global column down to "this
  // company only".
  const companyScopeKnownKeys = useMemo(
    () => (activeCompany ? getCompanyScopeKnownKeys(identityFields, globalColumns, activeCompany) : []),
    [identityFields, globalColumns, activeCompany]
  )

  return (
    <div className="relative isolate flex h-dvh overflow-hidden bg-canvas text-fg">
      {/* Decorative background. Kept faint and still on the table screens. */}
      <div className="aurora" data-quiet={activeTab === 'employees' || activeTab === 'totals'} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <Sidebar
        // Inside the dashboard, the company selected there. The others attached to the
        // same Global columns are held only for the checks that look across companies.
        companies={inDashboard ? companies.filter((c) => c.id === activeCompanyId) : companies}
        inDashboard={inDashboard || Boolean(offline)}
        browserOnly={browserOnly}
        activeCompanyId={activeCompanyId}
        onSelect={(id) => {
          // At narrow widths the list is a drawer. Clicking the company already
          // selected keeps it open, so a double-click on its name can rename it
          // there (known issue 6); choosing another company closes it as before.
          if (id !== activeCompanyId) setSidebarOpen(false)
          setActiveCompanyId(id)
          setActiveTab('employees')
        }}
        onAddCompany={handleAddCompany}
        onRenameCompany={handleRenameCompany}
        onDeleteCompany={handleDeleteCompany}
        onOpenDetails={setDetailsCompanyId}
        onRestored={onRestored}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden p-4 sm:p-6">
        {/* Narrow widths only: the company list is a drawer, opened from here. */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="btn btn-secondary btn-icon mb-3 shrink-0 md:hidden"
          aria-label="Open company list"
        >
          <Menu aria-hidden="true" />
        </button>

        {offline && <OfflineBar copy={offline} onRetry={onReloadDashboard} />}

        {inDashboard && dashboardCompany() && (
          <DashboardBar
            company={dashboardCompany()}
            access={access}
            onReload={onReloadDashboard}
            onImport={canImport ? onOpenImport : null}
            months={inDashboard ? months : null}
            onImportMonths={canImportMonths ? onOpenImportMonths : null}
          />
        )}

        {!activeCompany ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 text-center">
            <span className="icon-tile icon-tile-neutral mb-3" aria-hidden="true">
              <Building2 />
            </span>
            <p className="text-base font-semibold text-fg">No company selected</p>
            <p className="text-sm text-muted">Create or select a company from the sidebar to get started.</p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex max-w-full gap-1 overflow-x-auto rounded-[10px] border border-line bg-surface p-1 shadow-inner-glow">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    aria-current={activeTab === tab.id ? 'page' : undefined}
                    className={`h-8 shrink-0 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors ${
                      activeTab === tab.id
                        ? 'bg-accent/15 text-accent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_35%,transparent)]'
                        : 'text-muted hover:bg-surface-hover hover:text-fg'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeTab === 'employees' && (
                <div className="ml-auto flex flex-wrap justify-end gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={handleFileSelected}
                  />
                  <button onClick={handleImportClick} disabled={!monthReady} className="btn btn-secondary">
                    <Upload aria-hidden="true" />
                    Import from Excel
                  </button>
                  <ExportSplitButton onExport={handleOpenExportPreview} onExportPdfFill={setPdfFillFormat} disabled={!monthReady} />
                  {selectedYear && selectedMonth && monthReady && (
                    <SendToDashboardButton
                      // Remounts per company + month, so a "Sent" message never lingers over different data.
                      key={`${activeCompany.id}:${selectedYear}-${selectedMonth}`}
                      identityFields={identityFields}
                      effectiveColumns={effectiveColumns}
                      employees={periodEmployees}
                      computedGrid={computedGrid}
                      companyName={activeCompany.name}
                      companyDetails={activeCompany.details}
                      year={selectedYear}
                      month={selectedMonth}
                    />
                  )}
                  {monthsKept && companyRole === 'admin' && (
                    <button onClick={() => setHistoryOf('month')} disabled={!monthReady} className="btn btn-secondary">
                      <History aria-hidden="true" />
                      History of this month
                    </button>
                  )}
                  <button
                    onClick={handleOpenCopyPreviousMonth}
                    disabled={!previousPeriodHasData || !monthReady}
                    title={previousPeriodHasData ? undefined : 'No data in the previous month for this company'}
                    className="btn btn-secondary"
                  >
                    <Copy aria-hidden="true" />
                    Copy from Previous Month
                  </button>
                  <button
                    onClick={() => setConfirmingDeleteAll(true)}
                    disabled={periodEmployees.length === 0 || !monthReady}
                    className="btn btn-danger"
                  >
                    <Trash2 aria-hidden="true" />
                    Delete All Employees
                  </button>
                </div>
              )}
            </div>

            {activeTab === 'employees' && importError && (
              <div role="alert" className="panel panel-danger rise-in mb-4 items-center text-sm">
                <CircleAlert aria-hidden="true" />
                <span className="min-w-0 flex-1">{importError}</span>
                <button onClick={handleImportClick} className="btn btn-secondary btn-sm">
                  Try again
                </button>
                <button onClick={() => setImportError(null)} className="btn btn-ghost btn-icon btn-sm" aria-label="Dismiss">
                  <X aria-hidden="true" />
                </button>
              </div>
            )}

            {activeTab === 'employees' && importSummary && (
              <div role="alert" className="panel rise-in mb-4 items-start text-sm [--panel:var(--warn)]">
                <CircleAlert aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-fg">
                    Imported {importSummary.count} row{importSummary.count === 1 ? '' : 's'}. {importSummary.unreadable.length} value
                    {importSummary.unreadable.length === 1 ? '' : 's'} could not be read as a number and{' '}
                    {importSummary.unreadable.length === 1 ? 'was' : 'were'} left blank:
                  </p>
                  <ul className="mt-1 max-h-32 overflow-y-auto">
                    {importSummary.unreadable.map((u, i) => (
                      <li key={i}>
                        {u.employee} — {u.field}: “{u.raw}”
                      </li>
                    ))}
                  </ul>
                </div>
                <button onClick={() => setImportSummary(null)} className="btn btn-ghost btn-icon btn-sm" aria-label="Dismiss">
                  <X aria-hidden="true" />
                </button>
              </div>
            )}

            {activeTab === 'employees' && selectedYear && selectedMonth && (
              <div className="mb-4">
                <MonthSwitcher year={selectedYear} month={selectedMonth} onChange={handleChangeMonth} />
              </div>
            )}

            <div key={activeTab} className="rise-in min-h-0 flex-1 overflow-auto">
              {activeTab === 'global' && (
                <>
                  {inDashboard && (
                    <HistoryButton label="History of the Global columns" onClick={() => setHistoryOf('shared')} />
                  )}
                  <IdentityFieldsManager
                    identityFields={identityFields}
                    idFieldKey={idFieldKey}
                    existingKeys={globalKnownKeys}
                    onAdd={handleAddIdentityField}
                    onEdit={handleEditIdentityField}
                    onDelete={handleDeleteIdentityField}
                    onSetIdField={handleSetIdField}
                    getKeyChangePreview={getIdentityKeyChangePreview}
                    onRenameKey={handleRenameIdentityFieldKey}
                    readOnly={globalReadOnly}
                  />
                  <ColumnManager
                    title="Global Columns"
                    description="Apply to every company. Formulas here may only reference other global columns."
                    columns={globalColumns}
                    reservedKeys={[
                      ...identityFields.map((f) => f.key),
                      ...companies.flatMap((c) => c.columns.map((col) => col.key)),
                    ]}
                    referenceableColumns={globalColumns}
                    allColumnsForCycleCheck={getColumnsByKey(globalColumns)}
                    onAdd={handleAddGlobalColumn}
                    onEdit={handleEditGlobalColumn}
                    onDelete={handleDeleteGlobalColumn}
                    onReorder={handleReorderGlobalColumns}
                    onImportColumns={handleImportGlobalColumns}
                    scope="global"
                    crossScopeExistingKeys={companyScopeKnownKeys}
                    totalCompanyCount={companies.length}
                    targetCompanyName={activeCompany.name}
                    onChangeScope={handleChangeColumnScope}
                    getScopeBlockers={getScopeBlockers}
                    getKeyChangePreview={getKeyChangePreview}
                    onRenameKey={handleRenameColumnKey}
                    readOnly={globalReadOnly}
                    allowScopeChange={!companyReadOnly}
                  />
                </>
              )}

              {activeTab === 'company' && inDashboard && (
                <HistoryButton label={`History of the columns of ${activeCompany.name}`} onClick={() => setHistoryOf('company')} />
              )}

              {activeTab === 'company' && (
                <ColumnManager
                  title={`Company Columns — ${activeCompany.name}`}
                  description="Scoped to this company only. Formulas may reference global columns and this company's columns."
                  columns={activeCompany.columns}
                  otherScopeColumns={globalColumns}
                  reservedKeys={identityFields.map((f) => f.key)}
                  referenceableColumns={effectiveColumns}
                  allColumnsForCycleCheck={columnsByKey}
                  onAdd={handleAddCompanyColumn}
                  onEdit={handleEditCompanyColumn}
                  onDelete={handleDeleteCompanyColumn}
                  onReorder={handleReorderCompanyColumns}
                  onImportColumns={handleImportCompanyColumns}
                  scope="company"
                  crossScopeExistingKeys={globalKnownKeys}
                  crossScopeAvailableKeys={globalColumns.map((c) => c.key)}
                  targetCompanyName={activeCompany.name}
                  companyDetails={activeCompany.details}
                  onChangeScope={handleChangeColumnScope}
                  getKeyChangePreview={getKeyChangePreview}
                  onRenameKey={handleRenameColumnKey}
                  readOnly={companyReadOnly}
                  allowScopeChange={!globalReadOnly}
                />
              )}

              {(activeTab === 'employees' || activeTab === 'totals') && (covered || blocked || !monthReady) && (monthsInDashboard || unreadableMonth) ? (
                <MonthCover
                  covered={covered}
                  blocked={blocked}
                  unsaved={months.state === 'not-saved'}
                  onRetry={() => setMonthReload((n) => n + 1)}
                />
              ) : null}

              {activeTab === 'employees' && monthReady && (
                <EmployeeTable
                  employees={periodEmployees}
                  identityFields={identityFields}
                  idFieldKey={idFieldKey}
                  effectiveColumns={effectiveColumns}
                  computedGrid={computedGrid}
                  columnWidths={activeCompany.columnWidths}
                  onResizeColumn={handleResizeColumn}
                  onUpdateValue={handleUpdateValue}
                  onSetForEveryone={handleSetForEveryone}
                  onAddEmployee={handleAddEmployee}
                  onDeleteEmployee={handleDeleteEmployee}
                  onOpenBreakdown={setBreakdownTrace}
                />
              )}

              {activeTab === 'totals' && selectedYear && selectedMonth && monthReady && (
                <TotalsView
                  company={activeCompany}
                  identityFields={identityFields}
                  idFieldKey={idFieldKey}
                  effectiveColumns={effectiveColumns}
                  defaultYear={selectedYear}
                  defaultMonth={selectedMonth}
                  onExport={handleOpenTotalsExportPreview}
                  reloadToken={monthReload}
                />
              )}
            </div>
          </div>
        )}
      </main>

      {breakdownTrace && (
        <FormulaBreakdownModal trace={breakdownTrace} labelByKey={formulaDisplayLabels} onClose={() => setBreakdownTrace(null)} />
      )}

      {importData && (
        <ImportMappingModal
          headers={importData.headers}
          rows={importData.rows}
          systemFields={importData.systemFields}
          initialMapping={importData.initialMapping}
          recognized={importData.recognized}
          autoNote={importData.autoNote}
          meta={importData.meta}
          onConfirm={handleConfirmImport}
          onClose={() => setImportData(null)}
        />
      )}

      {exportPlan && <ExportPreviewModal plan={exportPlan} onClose={() => setExportPlan(null)} />}

      {pendingExport && (
        <ExportErrorsDialog
          errors={pendingExport.errors}
          onCancel={() => setPendingExport(null)}
          onConfirm={() => {
            const { proceed } = pendingExport
            setPendingExport(null)
            proceed()
          }}
        />
      )}

      {saveFailed && <SaveFailedDialog onClose={() => setSaveFailed(false)} />}

      {(historyOf === 'shared' || historyOf === 'company') && activeCompany && (
        <SetupHistoryModal
          target={historyOf}
          companyName={activeCompany.name}
          onRestored={showRestoredSetup}
          onClose={() => setHistoryOf(null)}
        />
      )}

      {historyOf === 'month' && activeCompany && selectedYear && selectedMonth && brnOf(activeCompany.id) && (
        <MonthHistoryModal
          brn={brnOf(activeCompany.id)}
          period={periodKey(selectedYear, selectedMonth)}
          companyName={activeCompany.name}
          identityFields={identityFields}
          columns={effectiveColumns}
          onClose={() => setHistoryOf(null)}
        />
      )}

      {pdfFillFormat && activeCompany && selectedYear && selectedMonth && (
        <PdfFillExportModal
          format={pdfFillFormat}
          identityFields={identityFields}
          effectiveColumns={effectiveColumns}
          employees={periodEmployees}
          computedGrid={computedGrid}
          companyName={activeCompany.name}
          companyDetails={activeCompany.details}
          year={selectedYear}
          month={selectedMonth}
          onClose={() => setPdfFillFormat(null)}
        />
      )}

      {copyPreviousMonthData && activeCompany && selectedYear && selectedMonth && (
        <CopyPreviousMonthModal
          previousEmployees={copyPreviousMonthData.employees}
          currentEmployees={periodEmployees}
          identityFields={identityFields}
          idFieldKey={idFieldKey}
          effectiveColumns={effectiveColumns}
          previousPeriodLabel={formatPeriodLabel(copyPreviousMonthData.year, copyPreviousMonthData.month)}
          currentPeriodLabel={formatPeriodLabel(selectedYear, selectedMonth)}
          onConfirm={handleConfirmCopyPreviousMonth}
          onCancel={() => setCopyPreviousMonthData(null)}
        />
      )}

      {confirmingDeleteAll && activeCompany && selectedYear && selectedMonth && (
        <ConfirmDialog
          title="Delete all employees"
          message={`Delete all ${periodEmployees.length} employee${periodEmployees.length === 1 ? '' : 's'} for ${
            activeCompany.name
          } — ${formatPeriodLabel(selectedYear, selectedMonth)}? This cannot be undone.`}
          confirmLabel="Delete All"
          onCancel={() => setConfirmingDeleteAll(false)}
          onConfirm={handleDeleteAllEmployees}
        />
      )}

      {detailsCompanyId &&
        (() => {
          const detailsCompany = companies.find((c) => c.id === detailsCompanyId)
          if (!detailsCompany) return null
          return (
            <CompanyDetailsModal
              company={detailsCompany}
              otherCompanies={companies.filter((c) => c.id !== detailsCompanyId)}
              onSave={(patch) => handleSaveCompanyDetails(detailsCompanyId, patch)}
              onClose={() => setDetailsCompanyId(null)}
              fromDashboard={inDashboard}
              readOnly={companyReadOnly}
            />
          )
        })()}
    </div>
  )
}

// Inside the dashboard, in place of the month's table: while the dashboard's
// password gate is locked (the figures are not left on an unattended screen),
// while the month is read, or when it could not be.
function MonthCover({ covered, blocked, unsaved, onRetry }) {
  const [asking, setAsking] = useState(false)

  async function unlock() {
    setAsking(true)
    await askToUnlock()
    setAsking(false)
  }

  if (covered) {
    return (
      <div role="region" aria-label="Locked" className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
        <span className="icon-tile icon-tile-neutral" aria-hidden="true">
          <LockKeyhole />
        </span>
        <p className="text-base font-semibold text-fg">Unlock the dashboard to continue</p>
        <p className="max-w-md text-sm text-muted">
          The dashboard locked after a while without activity, so the employees' figures are hidden.
          {unsaved ? ' What you typed is kept on this screen, NOT saved yet, and is saved once the dashboard is unlocked.' : ''}
        </p>
        <button onClick={() => void unlock()} disabled={asking} className="btn btn-primary">
          <LockKeyhole aria-hidden="true" />
          Unlock the dashboard
        </button>
      </div>
    )
  }
  if (blocked?.code === 'offline') {
    return (
      <div role="region" aria-label="Not in the offline copy" className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
        <span className="icon-tile icon-tile-neutral" aria-hidden="true">
          <CloudOff />
        </span>
        <p className="text-base font-semibold text-fg">The months are not in this offline copy</p>
        <p className="max-w-md text-sm text-muted">{blocked.error} Only the column setup is kept in this browser for when the dashboard cannot be reached.</p>
      </div>
    )
  }
  if (blocked?.code === 'unreadable') {
    return (
      <div role="alert" className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
        <span className="icon-tile icon-tile-danger" aria-hidden="true">
          <CircleAlert />
        </span>
        <p className="text-base font-semibold text-fg">This month could not be read</p>
        <p className="max-w-md text-sm text-muted">
          {blocked.error} A backup ("Back up", at the foot of the company list) keeps it exactly as it is.
        </p>
      </div>
    )
  }
  if (blocked) {
    return (
      <div role="alert" className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
        <span className="icon-tile icon-tile-danger" aria-hidden="true">
          <CircleAlert />
        </span>
        <p className="text-base font-semibold text-fg">
          {blocked.code === 'forbidden' ? 'Only an admin can see the employees' : 'This month could not be loaded from the dashboard'}
        </p>
        <p className="max-w-md text-sm text-muted">{blocked.error || 'The dashboard could not be reached.'}</p>
        {blocked.code !== 'forbidden' && (
          <button onClick={onRetry} className="btn btn-primary">
            <RotateCw aria-hidden="true" />
            Try again
          </button>
        )}
      </div>
    )
  }
  return (
    <p role="status" className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted">
      <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
      Loading the month from the dashboard…
    </p>
  )
}

// Inside the dashboard: opens the History of the column setup shown on this tab.
function HistoryButton({ label, onClick }) {
  return (
    <div className="mb-3 flex justify-end">
      <button onClick={onClick} className="btn btn-secondary btn-sm">
        <History aria-hidden="true" />
        {label}
      </button>
    </div>
  )
}

// The offline copy: what it is, from when, and that nothing in it can be saved.
function OfflineBar({ copy, onRetry }) {
  return (
    <div role="status" className="panel mb-4 shrink-0 flex-wrap items-center text-sm [--panel:var(--warn)]">
      <CloudOff aria-hidden="true" />
      <span className="min-w-48 flex-1 text-fg">
        Offline: read-only copy from {formatLoadedAt(copy.loadedAt)}. Changes can't be saved.
        <span className="block text-muted">
          The column setup of {copy.label}, as last loaded from the dashboard. No month is kept in it.
        </span>
      </span>
      <button className="btn btn-secondary btn-sm" onClick={onRetry}>
        <RotateCw aria-hidden="true" />
        Try the dashboard again
      </button>
    </div>
  )
}
