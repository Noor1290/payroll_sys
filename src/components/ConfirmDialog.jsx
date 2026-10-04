import { TriangleAlert } from 'lucide-react'
import Modal from './Modal'

export default function ConfirmDialog({ title = 'Are you sure?', message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  return (
    <Modal
      title={title}
      description={message}
      onClose={onCancel}
      width="max-w-sm"
      icon={<TriangleAlert />}
      iconTone="danger"
    >
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
