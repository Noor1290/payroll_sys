import { useState } from 'react'
import IdentityFieldFormModal from './IdentityFieldFormModal'
import ConfirmDialog from './ConfirmDialog'

// Manages the global set of identity fields (always leftmost, plain text,
// shared by every company) and which one is designated the "ID field" used
// for duplicate detection on import.
export default function IdentityFieldsManager({ identityFields, idFieldKey, existingKeys, onAdd, onEdit, onDelete, onSetIdField }) {
  const [editing, setEditing] = useState(null) // 'new' | field | null
  const [deleting, setDeleting] = useState(null)

  function existingKeysExcluding(field) {
    return existingKeys.filter((k) => k !== field?.key)
  }

  function handleSave(field) {
    if (editing === 'new') {
      onAdd(field)
    } else {
      onEdit(editing.id, field)
    }
    setEditing(null)
  }

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Identity Fields</h3>
          <p className="text-xs text-slate-400">
            Always leftmost in the Employee Table, plain text, shared by every company.
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          + Add Identity Field
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Key</th>
              <th className="px-4 py-2">ID Field</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {identityFields.map((field) => (
              <tr key={field.id}>
                <td className="px-4 py-2 font-medium text-slate-700">{field.name}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{field.key}</td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => onSetIdField(idFieldKey === field.key ? null : field.key)}
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      idFieldKey === field.key
                        ? 'border-amber-400 bg-amber-100 text-amber-700'
                        : 'border-slate-200 text-slate-400 hover:bg-slate-50'
                    }`}
                    title="Used for duplicate detection when importing from Excel"
                  >
                    {idFieldKey === field.key ? 'ID field ✓' : 'Set as ID field'}
                  </button>
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => setEditing(field)}
                    className="mr-2 rounded px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleting(field)}
                    className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {identityFields.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  No identity fields yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <IdentityFieldFormModal
          initial={editing === 'new' ? null : editing}
          existingKeys={existingKeysExcluding(editing === 'new' ? null : editing)}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete identity field"
          message={`Delete identity field "${deleting.name}"? Existing employee data for this field will no longer be shown.`}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            onDelete(deleting.id)
            setDeleting(null)
          }}
        />
      )}
    </div>
  )
}
