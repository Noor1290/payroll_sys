import { TriangleAlert } from 'lucide-react'
import Modal from './Modal'
import { ERROR_TEXT } from '../lib/exportErrors'

const SHOWN = 12

// Shown before any export when a figure that would be exported is in error.
// Lists who and which column, and makes the user choose: go back and fix it,
// or export anyway - in which case each such cell is written as the text
// "Error", never as a number.
export default function ExportErrorsDialog({ errors, confirmLabel = 'Export anyway', onCancel, onConfirm }) {
  const rest = errors.length - SHOWN
  return (
    <Modal
      title={`${errors.length} figure${errors.length === 1 ? ' is' : 's are'} in error`}
      description={`These could not be calculated. If you export anyway, each one is written as the text "${ERROR_TEXT}", never as a number.`}
      onClose={onCancel}
      width="max-w-md"
      icon={<TriangleAlert />}
      iconTone="danger"
    >
      <ul className="mb-4 max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line bg-surface p-3 text-sm text-fg">
        {errors.slice(0, SHOWN).map((e, i) => (
          <li key={i}>
            {e.employee} — {e.column}
          </li>
        ))}
        {rest > 0 && <li className="text-muted">and {rest} more</li>}
      </ul>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn btn-secondary">
          Cancel
        </button>
        <button onClick={onConfirm} className="btn btn-danger">
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
