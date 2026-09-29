import { useRef, useState } from 'react'
import ColumnFormModal from './ColumnFormModal'
import ConfirmDialog from './ConfirmDialog'
import ColumnSetupImportModal from './ColumnSetupImportModal'
import { SELECTABLE_CATEGORIES, DEFAULT_CATEGORY } from '../lib/categories'
import { buildColumnSetupExport, buildColumnSetupFilename, downloadColumnSetup, parseColumnSetupFile } from '../lib/columnSetup'

function CategorySection({ category, ownColumns, otherColumns, onEdit, onDelete, onDragStart, onDrop, draggingId }) {
  return (
    <div className="mb-5">
      <h3 className="mb-2 text-sm font-semibold text-slate-600">{category.label}</h3>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-6 px-2 py-2"></th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Key</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Formula</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {otherColumns.map((col) => (
              <tr key={col.id} className="bg-slate-50/60 text-slate-400">
                <td className="px-2 py-2"></td>
                <td className="px-4 py-2">{col.name}</td>
                <td className="px-4 py-2 font-mono text-xs">{col.key}</td>
                <td className="px-4 py-2 capitalize">{col.type}</td>
                <td className="px-4 py-2 font-mono text-xs">{col.formula ?? '—'}</td>
                <td className="px-4 py-2 text-right text-xs italic">inherited</td>
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
                className={draggingId === col.id ? 'bg-indigo-50 opacity-60' : ''}
              >
                <td className="cursor-grab px-2 py-2 text-center text-slate-300 active:cursor-grabbing" title="Drag to reorder">
                  ⠿
                </td>
                <td className="px-4 py-2 font-medium text-slate-700">{col.name}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{col.key}</td>
                <td className="px-4 py-2 capitalize text-slate-600">
                  {col.type}
                  {col.builderMode === 'tiered' && (
                    <span className="ml-1 rounded bg-indigo-100 px-1 py-0.5 text-[10px] font-semibold normal-case text-indigo-700">
                      tiered
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{col.formula ?? '—'}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => onEdit(col)}
                    className="mr-2 rounded px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onDelete(col)}
                    className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {ownColumns.length === 0 && otherColumns.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-center text-slate-400">
                  No columns in this category yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
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
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
          {description && <p className="text-sm text-slate-500">{description}</p>}
        </div>
        <div className="flex gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFileSelected}
          />
          <button
            onClick={handleImportClick}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Import Column Setup
          </button>
          <button
            onClick={handleExportColumns}
            disabled={columns.length === 0}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
          >
            Export Column Setup
          </button>
          <button
            onClick={() => setEditing('new')}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            + Add Column
          </button>
        </div>
      </div>

      {importError && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{importError}</span>
          <button onClick={() => setImportError(null)} className="text-red-400 hover:text-red-600">
            ✕
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
