import { useState } from 'react'
import Modal from './Modal'
import { slugify, isValidKey } from '../lib/slugify'

export default function IdentityFieldFormModal({ initial, existingKeys, onSave, onClose }) {
  const isEdit = Boolean(initial)
  const [name, setName] = useState(initial?.name ?? '')
  const [key, setKey] = useState(initial?.key ?? '')
  const [keyTouched, setKeyTouched] = useState(isEdit)
  const [error, setError] = useState(null)

  function handleNameChange(value) {
    setName(value)
    if (!keyTouched) setKey(slugify(value))
  }

  function handleSave() {
    const trimmedName = name.trim()
    const trimmedKey = key.trim()

    if (!trimmedName) return setError('Name is required')
    if (!trimmedKey) return setError('Key is required')
    if (!isValidKey(trimmedKey)) {
      return setError('Key must be a valid identifier (letters, numbers, _ or $, not starting with a number)')
    }
    if (existingKeys.includes(trimmedKey)) {
      return setError(`Key "${trimmedKey}" is already used by another field or column`)
    }

    onSave({ ...(initial ?? {}), name: trimmedName, key: trimmedKey })
  }

  return (
    <Modal title={isEdit ? 'Edit identity field' : 'Add identity field'} onClose={onClose} width="max-w-md">
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. Employee Code"
            autoFocus
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Key</label>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-sm focus:border-indigo-500 focus:outline-none"
            value={key}
            onChange={(e) => {
              setKeyTouched(true)
              setKey(e.target.value)
            }}
            placeholder="employeeCode"
          />
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}
