import { useState } from 'react'
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
      <Modal title={`${company.name} — Details`} onClose={requestClose} width="max-w-2xl">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Company Name</label>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                markDirty()
              }}
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Address</label>
            <textarea
              rows={3}
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value)
                markDirty()
              }}
              placeholder={'123 Main Street\nPort Louis, Mauritius'}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">BRN</label>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              value={brn}
              onChange={(e) => {
                setBrn(e.target.value)
                markDirty()
              }}
            />
          </div>

          <div className="border-t border-slate-100 pt-4">
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-xs font-medium text-slate-600">Custom fields</label>
              {otherCompanies.length > 0 && (
                <select
                  value={copyFromId}
                  onChange={(e) => applyCopyFrom(e.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
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
                <div key={field.id} className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      onClick={() => moveCustomField(i, -1)}
                      disabled={i === 0}
                      className="rounded px-1 text-xs text-slate-400 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label="Move up"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => moveCustomField(i, 1)}
                      disabled={i === customFields.length - 1}
                      className="rounded px-1 text-xs text-slate-400 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label="Move down"
                    >
                      ▼
                    </button>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <input
                      value={field.label}
                      onChange={(e) => updateCustomField(field.id, { label: e.target.value })}
                      placeholder="Label, e.g. VAT No"
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm font-medium focus:border-indigo-500 focus:outline-none"
                    />
                    <textarea
                      value={field.value}
                      onChange={(e) => updateCustomField(field.id, { value: e.target.value })}
                      placeholder="Value"
                      rows={1}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeCustomField(field.id)}
                    className="shrink-0 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
              {customFields.length === 0 && <p className="text-xs text-slate-400">No custom fields yet.</p>}
            </div>

            <button
              type="button"
              onClick={addCustomField}
              className="mt-2 rounded-md border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500 hover:border-indigo-400 hover:text-indigo-600"
            >
              + Add Field
            </button>
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button onClick={requestClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
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
