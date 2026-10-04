import { useState } from 'react'
import { CircleAlert, IdCard } from 'lucide-react'
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
    <Modal title={isEdit ? 'Edit identity field' : 'Add identity field'} onClose={onClose} width="max-w-md" redesigned icon={<IdCard />}>
      <div className="space-y-4">
        <div>
          <label className="label">Name</label>
          <input
            className="field"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. Employee Code"
            autoFocus
          />
        </div>

        <div>
          <label className="label">Key</label>
          <input
            className="field font-mono"
            value={key}
            onChange={(e) => {
              setKeyTouched(true)
              setKey(e.target.value)
            }}
            placeholder="employeeCode"
          />
        </div>

        {error && (
          <div role="alert" className="panel panel-danger text-sm">
            <CircleAlert aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="btn btn-primary"
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}
