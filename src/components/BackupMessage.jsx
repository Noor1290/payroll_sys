import { CircleCheck, TriangleAlert } from 'lucide-react'
import Modal from './Modal'

// What a restore ended with, or why a chosen file cannot be restored: a title,
// one sentence, and OK.
export default function BackupMessage({ title, description, tone, onClose }) {
  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      width="max-w-md"
      icon={tone === 'danger' ? <TriangleAlert /> : <CircleCheck />}
      iconTone={tone}
    >
      <div className="flex justify-end">
        <button onClick={onClose} className="btn btn-primary">
          OK
        </button>
      </div>
    </Modal>
  )
}
