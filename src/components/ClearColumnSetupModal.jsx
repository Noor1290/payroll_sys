import { useId, useState } from 'react'
import { CircleAlert, CircleCheck, Download, Eraser, TriangleAlert } from 'lucide-react'
import Modal from './Modal'
import { exportColumnSetupNow } from '../lib/columnSetup'
import { clearDashboardColumns } from '../lib/dashboardSetup'

// "Clear the column setup…", inside the dashboard only: the Global columns and
// this company's columns (the identity fields are kept), saved as one new revision of
// each with no columns (clearDashboardColumns). Nothing is deleted: History >
// Restore brings them back. No month is touched. "Clear everything" is not
// offered here: a company is deleted in the dashboard (Settings > Danger zone).
//   firstExport  the files downloaded when the dialog was opened, or null
//   setup        what exportColumnSetupNow downloads again
//   onCleared(message)  the app shows the setup now held
export default function ClearColumnSetupModal({ firstExport, setup, companyName, onClose, onCleared }) {
  const [files, setFiles] = useState(firstExport)
  const [typed, setTyped] = useState('')
  const [working, setWorking] = useState(false)
  const [failure, setFailure] = useState(null)
  const confirmId = useId()

  const exportAgain = () => setFiles(exportColumnSetupNow(setup) ?? files)
  const canClear = Boolean(files) && typed.trim() === 'CLEAR' && !working

  async function handleClear() {
    if (!canClear) return
    setWorking(true)
    setFailure(null)
    const result = await clearDashboardColumns()
    setWorking(false)
    if (!result.ok) {
      setFailure(result.error)
      return
    }
    onCleared({
      title: 'Column setup cleared',
      description: 'Saved as a new revision with no columns. To undo it, restore the previous version from History.',
    })
  }

  return (
    <Modal
      title="Clear the column setup"
      description={`Removes the Global columns and the columns of ${companyName}, in one save to the dashboard. The identity fields are kept.`}
      onClose={onClose}
      width="max-w-xl"
      icon={<Eraser />}
      iconTone="danger"
    >
      <h3 className="mb-2 text-sm font-semibold text-fg">1. The column setup, exported first</h3>
      {files ? (
        <div role="status" className="panel panel-accent items-center text-sm">
          <CircleCheck aria-hidden="true" />
          <span className="min-w-0 flex-1 wrap-break-word">Downloaded: {files.join(' and ')}.</span>
          <button onClick={exportAgain} className="btn btn-secondary btn-sm">
            <Download aria-hidden="true" />
            Download again
          </button>
        </div>
      ) : (
        <div role="alert" className="panel panel-danger items-center text-sm">
          <TriangleAlert aria-hidden="true" />
          <span className="min-w-0 flex-1">The column setup could not be downloaded, so nothing can be cleared.</span>
          <button onClick={exportAgain} className="btn btn-secondary btn-sm">
            Try again
          </button>
        </div>
      )}

      <h3 className="mb-2 mt-5 text-sm font-semibold text-fg">2. What happens</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
        <li>The Global columns are removed for every company that uses them.</li>
        <li>Nothing is deleted: the months stay, but their calculated figures will be empty until columns exist again.</li>
        <li>To undo it, open History and restore the previous version, of the Global columns and of this company's columns.</li>
      </ul>

      <h3 className="mb-2 mt-5 text-sm font-semibold text-fg">
        <label htmlFor={confirmId}>3. Type CLEAR to confirm</label>
      </h3>
      <input id={confirmId} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className="field w-40" />

      {failure && (
        <div role="alert" className="panel panel-danger mt-4 text-sm">
          <CircleAlert aria-hidden="true" />
          <span>Nothing was cleared. {failure}</span>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="btn btn-secondary">
          Cancel
        </button>
        <button onClick={handleClear} disabled={!canClear} className="btn btn-danger">
          {working ? 'Clearing…' : 'Clear the column setup'}
        </button>
      </div>
    </Modal>
  )
}
