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
    <div className="mb-8">
      <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-fg">Identity Fields</h3>
          <p className="mt-0.5 text-xs text-muted">
            Always leftmost in the Employee Table, plain text, shared by every company.
          </p>
        </div>
        <button onClick={() => setEditing('new')} className="btn btn-secondary btn-sm">
          + Add Identity Field
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-120 text-sm">
          <thead className="text-left text-xs font-medium text-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Key</th>
              <th className="px-4 py-2.5">ID Field</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {identityFields.map((field) => (
              <tr key={field.id} className="transition-colors hover:bg-surface-hover">
                <td className="px-4 py-2.5 font-medium text-fg">{field.name}</td>
                <td className="num px-4 py-2.5 text-xs text-muted">{field.key}</td>
                <td className="px-4 py-2.5">
                  <button
                    onClick={() => onSetIdField(idFieldKey === field.key ? null : field.key)}
                    className={`badge normal-case transition-colors ${
                      idFieldKey === field.key ? 'badge-warn' : 'hover:border-line-strong hover:text-fg'
                    }`}
                    title="Used for duplicate detection when importing from Excel"
                  >
                    {idFieldKey === field.key ? 'ID field ✓' : 'Set as ID field'}
                  </button>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <button onClick={() => setEditing(field)} className="btn btn-ghost btn-sm text-xs text-accent">
                    Edit
                  </button>
                  <button onClick={() => setDeleting(field)} className="btn btn-ghost btn-sm text-xs text-danger">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {identityFields.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted">
                  No identity fields yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </section>

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
