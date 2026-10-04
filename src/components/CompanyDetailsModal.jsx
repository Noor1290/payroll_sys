import { useState } from 'react'
import { Building2, ChevronDown, ChevronUp, CircleAlert } from 'lucide-react'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import { newCustomField } from '../lib/model'

// Company info form: three fixed default fields (Name/Address/BRN, always
// first, never deletable or reorderable) plus any number of custom fields
// the user defines themselves, scoped to this one company. "Company Name"
// isn't separate storage - it IS `company.name`, so saving it here renames
// the company everywhere else in the app.
export default function CompanyDetailsModal({ company, otherCompanies, onSave, onClose }) {
  const [name, setName] = useState(company.name ?? '')
  const [address, setAddress] = useState(company.details?.address ?? '')
  const [brn, setBrn] = useState(company.details?.brn ?? '')
  const [customFields, setCustomFields] = useState(company.details?.customFields ?? [])
  const [copyFromId, setCopyFromId] = useState('')
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)

  function markDirty() {
    setDirty(true)
  }

  function updateCustomField(id, patch) {
    setCustomFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)))
    markDirty()
  }

  function addCustomField() {
    setCustomFields((prev) => [...prev, newCustomField()])
    markDirty()
  }

  function removeCustomField(id) {
    setCustomFields((prev) => prev.filter((f) => f.id !== id))
    markDirty()
  }

  function moveCustomField(index, direction) {
    const target = index + direction
    if (target < 0 || target >= customFields.length) return
    setCustomFields((prev) => {
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    markDirty()
  }

  function applyCopyFrom(companyId) {
    setCopyFromId(companyId)
    if (!companyId) return
    const source = otherCompanies.find((c) => c.id === companyId)
    if (!source) return
    const existingLabels = new Set(customFields.map((f) => f.label.trim().toLowerCase()).filter(Boolean))
    const toCopy = (source.details?.customFields ?? []).filter((f) => f.label.trim() && !existingLabels.has(f.label.trim().toLowerCase()))
    if (toCopy.length === 0) return
    setCustomFields((prev) => [...prev, ...toCopy.map((f) => newCustomField({ label: f.label }))])
    markDirty()
  }

  function requestClose() {
    if (dirty) {
      setConfirmingDiscard(true)
      return
    }
    onClose()
  }

  function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName) return setError('Company Name is required')

    onSave({
      name: trimmedName,
      details: {
        address: address.trim(),
        brn: brn.trim(),
        customFields: customFields.map((f) => ({ id: f.id, label: f.label.trim(), value: f.value.trim() })),
      },
    })
  }

  return (
    <>
      <Modal title={`${company.name} — Details`} onClose={requestClose} width="max-w-2xl" icon={<Building2 />}>
        <div className="space-y-4">
          <div>
            <label className="label">Company Name</label>
            <input
              className="field"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                markDirty()
              }}
              autoFocus
            />
          </div>

          <div>
            <label className="label">Address</label>
            <textarea
              rows={3}
              className="field"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value)
                markDirty()
              }}
              placeholder={'123 Main Street\nPort Louis, Mauritius'}
            />
          </div>

          <div>
            <label className="label">BRN</label>
            <input
              className="field"
              value={brn}
              onChange={(e) => {
                setBrn(e.target.value)
                markDirty()
              }}
            />
          </div>

          <div className="border-t border-line pt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="label mb-0">Custom fields</label>
              {otherCompanies.length > 0 && (
                <select
                  value={copyFromId}
                  onChange={(e) => applyCopyFrom(e.target.value)}
                  className="field field-cell w-auto max-w-full"
                >
                  <option value="">Copy fields from…</option>
                  {otherCompanies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-2">
              {customFields.map((field, i) => (
                <div key={field.id} className="flex items-start gap-2 rounded-lg border border-line bg-surface p-3">
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => moveCustomField(i, -1)}
                      disabled={i === 0}
                      className="btn btn-ghost btn-icon btn-sm h-6 w-6"
                      aria-label="Move up"
                    >
                      <ChevronUp aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveCustomField(i, 1)}
                      disabled={i === customFields.length - 1}
                      className="btn btn-ghost btn-icon btn-sm h-6 w-6"
                      aria-label="Move down"
                    >
                      <ChevronDown aria-hidden="true" />
                    </button>
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <input
                      value={field.label}
                      onChange={(e) => updateCustomField(field.id, { label: e.target.value })}
                      placeholder="Label, e.g. VAT No"
                      className="field font-medium"
                    />
                    <textarea
                      value={field.value}
                      onChange={(e) => updateCustomField(field.id, { value: e.target.value })}
                      placeholder="Value"
                      rows={1}
                      className="field"
                    />
                  </div>
                  <button type="button" onClick={() => removeCustomField(field.id)} className="btn btn-ghost btn-sm shrink-0 text-xs text-danger">
                    Remove
                  </button>
                </div>
              ))}
              {customFields.length === 0 && <p className="text-xs text-muted">No custom fields yet.</p>}
            </div>

            <button
              type="button"
              onClick={addCustomField}
              className="btn btn-ghost btn-sm mt-2 border-dashed border-line-strong text-xs hover:border-accent hover:text-accent"
            >
              + Add Field
            </button>
          </div>

          {error && (
            <div role="alert" className="panel panel-danger text-sm">
              <CircleAlert aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <button onClick={requestClose} className="btn btn-secondary">
              Cancel
            </button>
            <button onClick={handleSave} className="btn btn-primary">
              Save
            </button>
          </div>
        </div>
      </Modal>

      {confirmingDiscard && (
        <ConfirmDialog
          title="Discard changes?"
          message="You have unsaved changes to this company's details. Close without saving?"
          confirmLabel="Discard"
          onCancel={() => setConfirmingDiscard(false)}
          onConfirm={onClose}
        />
      )}
    </>
  )
}
