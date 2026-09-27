import { useEffect, useMemo, useRef, useState } from 'react'
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
import ConfirmDialog from './components/ConfirmDialog'
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
import { reorderWithinCategory } from './lib/categories'
import { formatPeriodLabel } from './lib/periods'
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
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const fileInputRef = useRef(null)

  // The currently selected month's employees for the active company. Kept
  // separate from `companies` state since employee data now persists per
  // (company, year, month) period, not on the company itself.
  const [periodEmployees, setPeriodEmployees] = useState([])
  const [periodLoaded, setPeriodLoaded] = useState(false)

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

  const effectiveColumns = useMemo(
    () => (activeCompany ? getEffectiveColumns(activeCompany, globalColumns) : []),
    [activeCompany, globalColumns]
  )

  const columnsByKey = useMemo(() => getColumnsByKey(effectiveColumns), [effectiveColumns])

  const computedGrid = useComputedGrid(periodEmployees, effectiveColumns)

  function updateCompany(id, updater) {
    setCompanies((prev) => prev.map((c) => (c.id === id ? updater(c) : c)))
  }

  function handleAddCompany() {
    const company = newCompany(`Company ${companies.length + 1}`)
    setCompanies((prev) => [...prev, company])
    setActiveCompanyId(company.id)
    setActiveTab('employees')
  }

  function handleRenameCompany(id, name) {
    updateCompany(id, (c) => ({ ...c, name }))
  }

  function handleDeleteCompany(id) {
    setCompanies((prev) => prev.filter((c) => c.id !== id))
    if (activeCompanyId === id) setActiveCompanyId(null)
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
      setImportData({ headers, rows, systemFields, initialMapping, recognized, autoNote })
    } catch (err) {
      console.error('Failed to read Excel file:', err)
      window.alert('Could not read that file. Please make sure it is a valid .xlsx file.')
    }
  }

  function handleConfirmImport(mapping) {
    if (!importData || !activeCompanyId) return
    const imported = buildImportedEmployees({
      rows: importData.rows,
      systemFields: importData.systemFields,
      mapping,
      makeId,
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
    <div className="flex h-screen bg-slate-100 text-slate-900">
      <Sidebar
        companies={companies}
        activeCompanyId={activeCompanyId}
        onSelect={(id) => {
          setActiveCompanyId(id)
          setActiveTab('employees')
        }}
        onAddCompany={handleAddCompany}
        onRenameCompany={handleRenameCompany}
        onDeleteCompany={handleDeleteCompany}
      />

      <main className="flex-1 overflow-hidden p-6">
        {!activeCompany ? (
          <div className="flex h-full flex-col items-center justify-center text-slate-400">
            <p className="text-lg font-medium">No company selected</p>
            <p className="text-sm">Create or select a company from the sidebar to get started.</p>
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex gap-1 rounded-lg bg-slate-200/70 p-1">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                      activeTab === tab.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeTab === 'employees' && (
                <div className="flex gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={handleFileSelected}
                  />
                  <button
                    onClick={handleImportClick}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Import from Excel
                  </button>
                  <ExportSplitButton onExport={handleOpenExportPreview} />
                  <button
                    onClick={() => setConfirmingDeleteAll(true)}
                    disabled={periodEmployees.length === 0}
                    className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                  >
                    Delete All Employees
                  </button>
                </div>
              )}
            </div>

            {activeTab === 'employees' && selectedYear && selectedMonth && (
              <div className="mb-4">
                <MonthSwitcher year={selectedYear} month={selectedMonth} onChange={handleChangeMonth} />
              </div>
            )}

            <div className="flex-1 overflow-auto">
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
                  scope="company"
                  crossScopeExistingKeys={globalKnownKeys}
                  crossScopeAvailableKeys={globalColumns.map((c) => c.key)}
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
        <FormulaBreakdownModal trace={breakdownTrace} onClose={() => setBreakdownTrace(null)} />
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
    </div>
  )
}
