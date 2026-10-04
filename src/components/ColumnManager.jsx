import { useMemo, useRef, useState } from 'react'
import { CircleAlert, Download, GripVertical, Upload, X } from 'lucide-react'
import ColumnFormModal from './ColumnFormModal'
import ConfirmDialog from './ConfirmDialog'
import ColumnSetupImportModal from './ColumnSetupImportModal'
import { SELECTABLE_CATEGORIES, DEFAULT_CATEGORY, labelColumnsForHelper } from '../lib/categories'
import { buildColumnSetupExport, buildColumnSetupFilename, downloadColumnSetup, parseColumnSetupFile } from '../lib/columnSetup'
import { formatFormulaForDisplay } from '../lib/formulaEngine'

function CategorySection({ category, ownColumns, otherColumns, onEdit, onDelete, onDragStart, onDrop, draggingId, formulaLabels }) {
  return (
    <section className="card mb-5 overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h3 className="text-base font-semibold text-fg">{category.label}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-160 text-sm">
          <thead className="text-left text-xs font-medium text-muted">
            <tr className="border-b border-line">
              <th className="w-8 px-2 py-2.5"></th>
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Key</th>
              <th className="px-4 py-2.5">Type</th>
              <th className="px-4 py-2.5">Formula</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {otherColumns.map((col) => (
              <tr key={col.id} className="text-subtle">
                <td className="px-2 py-2.5"></td>
                <td className="px-4 py-2.5">{col.name}</td>
                <td className="num px-4 py-2.5 text-xs">{col.key}</td>
                <td className="px-4 py-2.5 capitalize">{col.type}</td>
                <td className="num px-4 py-2.5 text-xs">{col.formula ? formatFormulaForDisplay(col.formula, formulaLabels) : '—'}</td>
                <td className="px-4 py-2.5 text-right">
                  <span className="badge normal-case">inherited</span>
                </td>
              </tr>
            ))}
            {ownColumns.map((col) => (
              <tr
                key={col.id}
                draggable
                onDragStart={() => onDragStart(col.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  onDrop(col.id)
                }}
                className={`transition-colors hover:bg-surface-hover ${draggingId === col.id ? 'bg-accent/10 opacity-60' : ''}`}
              >
                <td className="cursor-grab px-2 py-2.5 text-center text-subtle active:cursor-grabbing" title="Drag to reorder">
                  <GripVertical className="mx-auto h-4 w-4" aria-hidden="true" />
                </td>
                <td className="px-4 py-2.5 font-medium text-fg">{col.name}</td>
                <td className="num px-4 py-2.5 text-xs text-muted">{col.key}</td>
                <td className="whitespace-nowrap px-4 py-2.5 capitalize text-muted">
                  {col.type}
                  {col.builderMode === 'tiered' && <span className="badge badge-glow ml-1.5 normal-case">tiered</span>}
                </td>
                <td className="num px-4 py-2.5 text-xs text-muted">
                  {col.formula ? formatFormulaForDisplay(col.formula, formulaLabels) : '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <button onClick={() => onEdit(col)} className="btn btn-ghost btn-sm text-xs text-accent">
                    Edit
                  </button>
                  <button onClick={() => onDelete(col)} className="btn btn-ghost btn-sm text-xs text-danger">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {ownColumns.length === 0 && otherColumns.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-5 text-center text-muted">
                  No columns in this category yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// Generic manager for a list of columns (global or company-scoped), grouped
// into the 5 category sections.
//
// columns: the columns owned by this scope (rendered in the table)
// otherScopeColumns: columns from the other scope that exist for context
//   (e.g. company manager also shows global columns as read-only reference
//   rows so users can see the full effective set and avoid key collisions)
// reservedKeys: extra keys (e.g. identity fields, or every other company's
//   columns for the global scope) that must also be excluded from - not
//   displayed as rows, just forbidden for uniqueness purposes
// referenceableColumns: columns (excluding self) that a new formula in this
//   scope is allowed to reference
// allColumnsForCycleCheck: full key->column map used for circular ref checks
// onReorder(draggedId, targetId): called with two ids from the SAME
//   category to move draggedId to just before targetId
export default function ColumnManager({
  title,
  description,
  columns,
  otherScopeColumns = [],
  reservedKeys = [],
  referenceableColumns,
  allColumnsForCycleCheck,
  onAdd,
  onEdit,
  onDelete,
  onReorder,
  onImportColumns,
  scope,
  crossScopeExistingKeys = [],
  crossScopeAvailableKeys = null,
  totalCompanyCount,
  targetCompanyName,
  companyDetails,
  onChangeScope,
}) {
  const [editing, setEditing] = useState(null) // 'new' | column | null
  const [deleting, setDeleting] = useState(null)
  const [draggingId, setDraggingId] = useState(null)
  const [importPreview, setImportPreview] = useState(null) // { scope, companyName, columns } | null
  const [importError, setImportError] = useState(null)
  const importInputRef = useRef(null)

  const allKeysInScope = [...reservedKeys, ...otherScopeColumns.map((c) => c.key), ...columns.map((c) => c.key)]

  // key -> readable label (name, or "Name (Category)" when another column
  // shares that name) for every column a formula here could reference -
  // display-only, purely for rendering the Formula column readably below;
  // the stored expression/keys are never touched.
  const formulaLabels = useMemo(() => {
    const labeled = labelColumnsForHelper(Object.values(allColumnsForCycleCheck))
    return Object.fromEntries(labeled.map((c) => [c.key, c.helperLabel]))
  }, [allColumnsForCycleCheck])

  function existingKeysExcluding(col) {
    return allKeysInScope.filter((k) => k !== col?.key)
  }

  // Unlike existingKeysExcluding, two DIFFERENT columns in different
  // companies can legitimately share the same key string (keys are only
  // unique within one effective scope) - so this must remove exactly the
  // one slot belonging to `col` itself, not every array entry that happens
  // to match its key string, or a genuine collision with another
  // same-keyed column elsewhere would be silently excluded too.
  function crossScopeKeysExcluding(col) {
    if (!col) return crossScopeExistingKeys
    const idx = crossScopeExistingKeys.indexOf(col.key)
    if (idx === -1) return crossScopeExistingKeys
    return [...crossScopeExistingKeys.slice(0, idx), ...crossScopeExistingKeys.slice(idx + 1)]
  }

  function handleSave(col, scopeChange) {
    if (editing === 'new') {
      onAdd(col)
    } else if (scopeChange) {
      onChangeScope(col, scopeChange.to)
    } else {
      onEdit(editing.id, col)
    }
    setEditing(null)
  }

  function categoryOf(col) {
    return col.category ?? DEFAULT_CATEGORY
  }

  function handleExportColumns() {
    const exportObj = buildColumnSetupExport(columns, scope, targetCompanyName, companyDetails)
    downloadColumnSetup(exportObj, buildColumnSetupFilename(scope, targetCompanyName))
  }

  function handleImportClick() {
    importInputRef.current?.click()
  }

  async function handleImportFileSelected(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return

    const result = await parseColumnSetupFile(file)
    if (!result.valid) {
      setImportError(result.error)
      return
    }
    if (result.scope !== scope) {
      const fileTabLabel = result.scope === 'global' ? 'Global Columns' : 'Company Columns'
      setImportError(`This file contains ${result.scope === 'global' ? 'Global' : 'Company'} columns - open it from the ${fileTabLabel} tab instead.`)
      return
    }

    setImportError(null)
    setImportPreview(result)
  }

  function handleConfirmImport(newColumnsToAdd) {
    onImportColumns(newColumnsToAdd)
    setImportPreview(null)
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight text-fg">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFileSelected}
          />
          <button onClick={handleImportClick} className="btn btn-secondary">
            <Upload aria-hidden="true" />
            Import Column Setup
          </button>
          <button onClick={handleExportColumns} disabled={columns.length === 0} className="btn btn-secondary">
            <Download aria-hidden="true" />
            Export Column Setup
          </button>
          <button onClick={() => setEditing('new')} className="btn btn-primary">
            + Add Column
          </button>
        </div>
      </div>

      {importError && (
        <div role="alert" className="panel panel-danger mb-4 items-center text-sm">
          <CircleAlert aria-hidden="true" />
          <span className="min-w-0 flex-1">{importError}</span>
          <button onClick={() => setImportError(null)} className="btn btn-ghost btn-icon btn-sm" aria-label="Dismiss">
            <X aria-hidden="true" />
          </button>
        </div>
      )}

      {SELECTABLE_CATEGORIES.map((cat) => (
        <CategorySection
          key={cat.id}
          category={cat}
          ownColumns={columns.filter((c) => categoryOf(c) === cat.id)}
          otherColumns={otherScopeColumns.filter((c) => categoryOf(c) === cat.id)}
          onEdit={setEditing}
          onDelete={setDeleting}
          draggingId={draggingId}
          onDragStart={setDraggingId}
          onDrop={(targetId) => {
            if (draggingId) onReorder?.(draggingId, targetId)
            setDraggingId(null)
          }}
          formulaLabels={formulaLabels}
        />
      ))}

      {editing && (
        <ColumnFormModal
          initial={editing === 'new' ? null : editing}
          existingKeys={existingKeysExcluding(editing === 'new' ? null : editing)}
          availableColumns={referenceableColumns.filter((c) => c.key !== (editing === 'new' ? undefined : editing.key))}
          columnsByKeyForCycleCheck={allColumnsForCycleCheck}
          currentScope={editing === 'new' ? undefined : scope}
          crossScopeExistingKeys={crossScopeKeysExcluding(editing === 'new' ? null : editing)}
          crossScopeAvailableKeys={crossScopeAvailableKeys}
          totalCompanyCount={totalCompanyCount}
          targetCompanyName={targetCompanyName}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete column"
          message={`Delete column "${deleting.name}"? Any formulas referencing "${deleting.key}" will break.`}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            onDelete(deleting.id)
            setDeleting(null)
          }}
        />
      )}

      {importPreview && (
        <ColumnSetupImportModal
          fileScope={importPreview.scope}
          fileCompanyName={importPreview.companyName}
          fileColumns={importPreview.columns}
          existingKeys={allKeysInScope}
          onConfirm={handleConfirmImport}
          onCancel={() => setImportPreview(null)}
        />
      )}
    </div>
  )
}
