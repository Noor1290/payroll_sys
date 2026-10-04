import { useEffect, useMemo, useRef, useState } from 'react'
import { Building2, CircleAlert, Copy, Menu, Trash2, Upload, X } from 'lucide-react'
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
import { loadState, saveState, loadPeriod, savePeriod } from './lib/storage'
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
import { formatPeriodLabel, shiftPeriod } from './lib/periods'
import { useComputedGrid } from './hooks/useComputedGrid'
import { buildExportPlan } from './lib/excelExport'
import {
  parseWorkbookFile,
  getImportableSystemFields,
  buildImportedEmployees,
  isRecognizedExport,
  describeUnrecognizedMeta,
  resolveImportMapping,
} from './lib/excelImport'

const TABS = [
  { id: 'global', label: 'Global Columns' },
  { id: 'company', label: 'Company Columns' },
  { id: 'employees', label: 'Employee Table' },
  { id: 'totals', label: 'Totals' },
]

export default function App() {
  const [identityFields, setIdentityFields] = useState([])
  const [idFieldKey, setIdFieldKey] = useState(null)
  const [globalColumns, setGlobalColumns] = useState([])
  const [companies, setCompanies] = useState([])
  const [activeCompanyId, setActiveCompanyId] = useState(null)
  const [activeTab, setActiveTab] = useState('employees')
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
  const [periodEmployees, setPeriodEmployees] = useState([])
  const [periodLoaded, setPeriodLoaded] = useState(false)

  // No-op unless this app is running inside the Payroll Hub dashboard's iframe.
  useEffect(() => {
    window.PayrollHubBridge.init({ appId: 'payroll' })
  }, [])

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
    saveState({ identityFields, idFieldKey, globalColumns, companies, activeCompanyId })
  }, [loaded, identityFields, idFieldKey, globalColumns, companies, activeCompanyId])

  const activeCompany = companies.find((c) => c.id === activeCompanyId) ?? null
  const selectedYear = activeCompany?.viewYear ?? null
  const selectedMonth = activeCompany?.viewMonth ?? null

  // Load the selected month's employees whenever the company or month
  // changes. `periodLoaded` gates the save effect below so it never fires
  // (and overwrites real data with []) before a load has actually happened.
  useEffect(() => {
    if (!activeCompanyId || !selectedYear || !selectedMonth) {
      setPeriodEmployees([])
      setPeriodLoaded(false)
      return
    }
    setPeriodLoaded(false)
    const { employees } = loadPeriod(activeCompanyId, selectedYear, selectedMonth)
    setPeriodEmployees(employees)
    setPeriodLoaded(true)
  }, [activeCompanyId, selectedYear, selectedMonth])

  useEffect(() => {
    if (!periodLoaded || !activeCompanyId || !selectedYear || !selectedMonth) return
    savePeriod(activeCompanyId, selectedYear, selectedMonth, { employees: periodEmployees })
  }, [periodLoaded, activeCompanyId, selectedYear, selectedMonth, periodEmployees])

  // Whether "Copy from Previous Month" has anything to offer right now -
  // read fresh (not kept in React state) each time it's relevant, since
  // it's only ever consulted right before the user might click the button.
  const previousPeriodHasData = useMemo(() => {
    if (!activeCompanyId || !selectedYear || !selectedMonth) return false
    const prev = shiftPeriod(selectedYear, selectedMonth, -1)
    return loadPeriod(activeCompanyId, prev.year, prev.month).employees.length > 0
  }, [activeCompanyId, selectedYear, selectedMonth])

  function handleOpenCopyPreviousMonth() {
    if (!activeCompanyId || !selectedYear || !selectedMonth) return
    const prev = shiftPeriod(selectedYear, selectedMonth, -1)
    const { employees } = loadPeriod(activeCompanyId, prev.year, prev.month)
    setCopyPreviousMonthData({ employees, year: prev.year, month: prev.month })
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
    fileInputRef.current?.click()
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file || !activeCompanyId) return
    try {
      const { headers, rows, meta } = await parseWorkbookFile(file)
      const systemFields = getImportableSystemFields(identityFields, effectiveColumns)
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
    setPeriodEmployees((prev) => [...prev, ...imported])
    setImportData(null)
    setActiveTab('employees')
  }

  function handleOpenExportPreview(exportMode = 'values') {
    if (!activeCompany) return
    setExportPlan(
      buildExportPlan({
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
    )
  }

  function handleOpenTotalsExportPreview(totalsEmployees, totalsGrid, rangeLabel) {
    if (!activeCompany) return
    setExportPlan(
      buildExportPlan({
        title: `${activeCompany.name} — Totals (${rangeLabel})`,
        companyId: activeCompany.id,
        companyDetails: activeCompany.details,
        kind: 'totals',
        employees: totalsEmployees,
        identityFields,
        effectiveColumns,
        computedGrid: totalsGrid,
      })
    )
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
        companies={companies}
        activeCompanyId={activeCompanyId}
        onSelect={(id) => {
          setActiveCompanyId(id)
          setActiveTab('employees')
          setSidebarOpen(false)
        }}
        onAddCompany={handleAddCompany}
        onRenameCompany={handleRenameCompany}
        onDeleteCompany={handleDeleteCompany}
        onOpenDetails={setDetailsCompanyId}
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
                  <button onClick={handleImportClick} className="btn btn-secondary">
                    <Upload aria-hidden="true" />
                    Import from Excel
                  </button>
                  <ExportSplitButton onExport={handleOpenExportPreview} onExportPdfFill={setPdfFillFormat} />
                  {selectedYear && selectedMonth && (
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
                  <button
                    onClick={handleOpenCopyPreviousMonth}
                    disabled={!previousPeriodHasData}
                    title={previousPeriodHasData ? undefined : 'No data in the previous month for this company'}
                    className="btn btn-secondary"
                  >
                    <Copy aria-hidden="true" />
                    Copy from Previous Month
                  </button>
                  <button
                    onClick={() => setConfirmingDeleteAll(true)}
                    disabled={periodEmployees.length === 0}
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

            {activeTab === 'employees' && selectedYear && selectedMonth && (
              <div className="mb-4">
                <MonthSwitcher year={selectedYear} month={selectedMonth} onChange={handleChangeMonth} />
              </div>
            )}

            {/* TEMPORARY: screens not restyled yet keep their old light look
                inside a panel, so nothing is unreadable in the meantime. */}
            <div
              key={activeTab}
              className={`rise-in min-h-0 flex-1 overflow-auto ${
                activeTab === 'employees' || activeTab === 'totals' ? '' : 'legacy-light rounded-2xl bg-slate-100 p-4'
              }`}
            >
              {activeTab === 'global' && (
                <>
                  <IdentityFieldsManager
                    identityFields={identityFields}
                    idFieldKey={idFieldKey}
                    existingKeys={globalKnownKeys}
                    onAdd={handleAddIdentityField}
                    onEdit={handleEditIdentityField}
                    onDelete={handleDeleteIdentityField}
                    onSetIdField={handleSetIdField}
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
                  />
                </>
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
                />
              )}

              {activeTab === 'employees' && (
                <EmployeeTable
                  employees={periodEmployees}
                  identityFields={identityFields}
                  idFieldKey={idFieldKey}
                  effectiveColumns={effectiveColumns}
                  computedGrid={computedGrid}
                  columnWidths={activeCompany.columnWidths}
                  onResizeColumn={handleResizeColumn}
                  onUpdateValue={handleUpdateValue}
                  onAddEmployee={handleAddEmployee}
                  onDeleteEmployee={handleDeleteEmployee}
                  onOpenBreakdown={setBreakdownTrace}
                />
              )}

              {activeTab === 'totals' && selectedYear && selectedMonth && (
                <TotalsView
                  company={activeCompany}
                  identityFields={identityFields}
                  idFieldKey={idFieldKey}
                  effectiveColumns={effectiveColumns}
                  defaultYear={selectedYear}
                  defaultMonth={selectedMonth}
                  onExport={handleOpenTotalsExportPreview}
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
          onConfirm={handleConfirmImport}
          onClose={() => setImportData(null)}
        />
      )}

      {exportPlan && <ExportPreviewModal plan={exportPlan} onClose={() => setExportPlan(null)} />}

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
            />
          )
        })()}
    </div>
  )
}
