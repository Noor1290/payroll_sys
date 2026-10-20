import { useState } from 'react'
import { CircleAlert, IdCard } from 'lucide-react'
import Modal from './Modal'
import { SavedDatesSummary } from './DateConversionDialog'
import { useSavedValues } from '../hooks/useSavedValues'

const plural = (n, one, many) => (n === 1 ? one : many)

// "Move to identity fields": a Global Input column (Text or Date) becomes an identity field with the
// SAME key. The months keep every value under its key, so no saved value moves or changes: only the
// setup does, in one save (inside the dashboard, one new revision of the shared setup, which History >
// Restore undoes). Shown first: the name and type it will have, how many saved months hold a value,
// and, as a Date, which saved values are not clear dates (by month and row). Refused while a formula
// uses the column: an identity field is never in a formula.
//
//   formulas      names of the formulas that use the column
//   identityNames the names of the identity fields there are now
//   readSaved, companyNames   as for DateConversionDialog
export default function MoveToIdentityDialog({ column, formulas, identityNames, readSaved, companyNames, onConfirm, onCancel }) {
  const [name, setName] = useState(column.name)
  const [valueType, setValueType] = useState(column.valueType === 'date' ? 'date' : 'text')
  const [error, setError] = useState(null)
  const state = useSavedValues(readSaved)
  const blocked = formulas.length > 0

  function handleMove() {
    const trimmed = name.trim()
    if (!trimmed) return setError('Name is required')
    if (identityNames.some((n) => n.trim().toLowerCase() === trimmed.toLowerCase())) {
      return setError(`An identity field is already called "${trimmed}".`)
    }
    onConfirm({ name: trimmed, valueType })
  }

  const months = state.step === 'checked' ? state.months : []
  const companies = new Set(months.map((m) => m.companyId)).size

  return (
    <Modal title={`Move "${column.name}" to the identity fields?`} onClose={onCancel} width="max-w-lg" icon={<IdCard />}>
      <div className="space-y-4 text-sm" data-testid="move-to-identity">
        {blocked ? (
          <div role="alert" className="panel panel-danger">
            <CircleAlert aria-hidden="true" />
            <span>
              Can't move it: {plural(formulas.length, 'this formula uses', 'these formulas use')} it, and an identity field can't be used in a
              formula: {formulas.join(', ')}. Change {plural(formulas.length, 'that formula', 'those formulas')} first.
            </span>
          </div>
        ) : (
          <>
            <div>
              <label className="label">Name</label>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
            </div>
            <div>
              <label className="label">Type</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setValueType('text')} className={`choice ${valueType === 'text' ? 'choice-active' : ''}`}>
                  Text
                </button>
                <button type="button" onClick={() => setValueType('date')} className={`choice ${valueType === 'date' ? 'choice-active' : ''}`}>
                  Date
                </button>
              </div>
            </div>

            <p>
              It becomes an identity field with the same key, <span className="num">{column.key}</span>: leftmost in the Employee Table, and
              always in the Excel exports (an identity field has no &ldquo;Include in Excel export&rdquo; setting).
            </p>

            {state.step === 'checked' && (
              <p>
                {months.length === 0
                  ? 'No month holds a value for it yet.'
                  : `Its saved values stay where they are: ${months.length} ${plural(months.length, 'month holds', 'months hold')} one, in ${companies} ${plural(companies, 'company', 'companies')}.`}
              </p>
            )}
            {valueType === 'date' || state.step !== 'checked' ? (
              <SavedDatesSummary state={state} companyNames={companyNames} />
            ) : null}

            <p className="text-muted">One save of the column setup: inside the dashboard, one new revision, which History &gt; Restore undoes.</p>

            {error && (
              <div role="alert" className="panel panel-danger">
                <CircleAlert aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
          {!blocked && state.step === 'checked' && (
            <button onClick={handleMove} className="btn btn-primary">
              Move
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
