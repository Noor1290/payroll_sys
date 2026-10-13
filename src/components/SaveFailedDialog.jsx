import { TriangleAlert } from 'lucide-react'
import Modal from './Modal'

// Shown when the browser refuses to store a change (its storage for this
// site is full). The change has already been taken back off the screen, so
// what is shown is always what is saved; this says so plainly and stays up
// until it is acknowledged.
export default function SaveFailedDialog({ onClose }) {
  return (
    <Modal
      title="This change was NOT saved"
      description="The browser's storage for this site is full, so your last change could not be kept. It has been removed from the screen: what you see now is what is saved."
      onClose={onClose}
      width="max-w-md"
      icon={<TriangleAlert />}
      iconTone="danger"
    >
      <p className="mb-4 text-sm leading-relaxed text-muted">
        To free some space: save a backup first ("Back up", at the foot of the company list), then delete months or
        companies you no longer need, and make the change again.
      </p>
      <div className="flex justify-end">
        <button onClick={onClose} className="btn btn-primary">
          OK
        </button>
      </div>
    </Modal>
  )
}
