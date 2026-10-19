import { useId, useState } from 'react'
import { CircleCheck, Download, Eraser, TriangleAlert } from 'lucide-react'
import Modal from './Modal'
import { clearBrowserData, downloadBackupNow } from '../lib/backup'

const CHOICES = [
  {
    value: 'columns',
    label: 'Clear columns only',
    detail:
      "Removes the identity fields, the Global columns and every company's Company columns. Companies, company details and months are kept, but their calculated figures will be empty until columns exist again.",
    button: 'Clear columns',
    done: {
      title: 'Columns cleared',
      description: 'Companies, company details and months are kept. "Restore" with the backup file brings the columns back.',
    },
  },
  {
    value: 'everything',
    label: 'Clear everything',
    detail:
      'Removes the columns, every company with its details, and every month. The offline copy of the dashboard\'s columns is removed too; it is made again the next time the dashboard opens. Rescue copies of data that could not be read are kept.',
    button: 'Clear everything',
    done: {
      title: "This browser's data cleared",
      description: '"Restore" with the backup file brings it all back.',
    },
  },
]

// "Clear this browser's data…", on its own only (never inside the dashboard).
// A backup is downloaded first, by the click that opens this dialog
// (`firstBackup`: the file's name, or null when it could not be), and nothing
// can be cleared until one has been; then a choice, then CLEAR typed to confirm.
// `onCleared(message)`: the app starts again from what is now stored.
export default function ClearBrowserDataModal({ firstBackup, onClose, onCleared, onRefused }) {
  const [backupFile, setBackupFile] = useState(firstBackup) // the name of the file downloaded, or null
  const [choice, setChoice] = useState(null)
  const [typed, setTyped] = useState('')
  const confirmId = useId()

  const downloadTheBackup = () => setBackupFile(downloadBackupNow() ?? backupFile)

  const chosen = CHOICES.find((c) => c.value === choice)
  const canClear = Boolean(backupFile) && Boolean(chosen) && typed.trim() === 'CLEAR'

  function handleClear() {
    if (!canClear) return
    if (clearBrowserData(chosen.value)) onCleared(chosen.done)
    else onRefused()
  }

  return (
    <Modal
      title="Clear this browser's data"
      description="Removes what Payroll keeps in this browser, and nothing else."
      onClose={onClose}
      width="max-w-xl"
      icon={<Eraser />}
      iconTone="danger"
    >
      <h3 className="mb-2 text-sm font-semibold text-fg">1. A backup first</h3>
      {backupFile ? (
        <div role="status" className="panel panel-accent items-center text-sm">
          <CircleCheck aria-hidden="true" />
          <span className="min-w-0 flex-1 wrap-break-word">
            A backup of everything here was downloaded: {backupFile}. "Restore" with that file brings it all back.
          </span>
          <button onClick={downloadTheBackup} className="btn btn-secondary btn-sm">
            <Download aria-hidden="true" />
            Download again
          </button>
        </div>
      ) : (
        <div role="alert" className="panel panel-danger items-center text-sm">
          <TriangleAlert aria-hidden="true" />
          <span className="min-w-0 flex-1">The backup could not be downloaded, so nothing can be cleared.</span>
          <button onClick={downloadTheBackup} className="btn btn-secondary btn-sm">
            Try again
          </button>
        </div>
      )}

      <h3 className="mb-2 mt-5 text-sm font-semibold text-fg">2. What to clear</h3>
      <div className="space-y-3" role="radiogroup" aria-label="What to clear">
        {CHOICES.map((c) => (
          <label key={c.value} className="flex items-start gap-2 text-sm text-fg">
            <input type="radio" name="clear-choice" className="mt-1" checked={choice === c.value} onChange={() => setChoice(c.value)} />
            <span>
              <span className="font-medium">{c.label}</span>
              <span className="mt-0.5 block text-xs text-muted">{c.detail}</span>
            </span>
          </label>
        ))}
      </div>

      <h3 className="mb-2 mt-5 text-sm font-semibold text-fg">
        <label htmlFor={confirmId}>3. Type CLEAR to confirm</label>
      </h3>
      <input
        id={confirmId}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        className="field w-40"
      />

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="btn btn-secondary">
          Cancel
        </button>
        <button onClick={handleClear} disabled={!canClear} className="btn btn-danger">
          {chosen?.button ?? 'Clear'}
        </button>
      </div>
    </Modal>
  )
}
