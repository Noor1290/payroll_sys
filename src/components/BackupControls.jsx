import { useRef, useState } from 'react'
import { Download, HardDriveDownload, TriangleAlert, Upload } from 'lucide-react'
import BackupHoldings from './BackupHoldings'
import BackupMessage from './BackupMessage'
import Modal from './Modal'
import {
  buildBackup,
  buildBackupFilename,
  downloadBackup,
  formatSavedAt,
  parseBackupFile,
  restoreBackup,
  summarizeBackup,
  summarizeBrowser,
} from '../lib/backup'

// "Back up" and "Restore": everything Payroll keeps in this browser, as one
// file. Returns two pieces for the company list to place: `controls` (the two
// buttons, inside the list) and `dialogs` (outside it, like its other
// dialogs, so they sit above the whole page and not just above the list).
//
// After a restore has replaced the data, `onRestored` is called with
// the message to show: the app then starts again from what is now stored,
// which takes this component with it, so the message is the app's to show.
//
// Inside the dashboard there is no Restore (`allowRestore` false): the setup
// on screen is the dashboard's, and a restore would only replace this
// browser's own copy behind it. "Back up" stays: the import needs it first.
export function useBackupControls(onRestored, { allowRestore = true } = {}) {
  const fileInputRef = useRef(null)
  const [pending, setPending] = useState(null) // { fileName, backup, inFile, inBrowser } | null
  const [message, setMessage] = useState(null) // { title, description, tone } | null

  function handleBackUp() {
    const now = new Date()
    downloadBackup(buildBackup(now), buildBackupFilename(now))
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // the same file can be chosen again
    if (!file) return
    const result = await parseBackupFile(file)
    if (!result.valid) {
      setMessage({ title: 'This file cannot be restored', description: result.error, tone: 'danger' })
      return
    }
    setPending({
      fileName: file.name,
      backup: result.backup,
      inFile: summarizeBackup(result.backup),
      inBrowser: summarizeBrowser(),
    })
  }

  function handleRestore() {
    const result = restoreBackup(pending.backup)
    setPending(null)
    if (result.ok) {
      onRestored({
        title: 'Backup restored',
        description: 'Everything from the backup file is now in this browser.',
      })
    } else if (result.unchanged) {
      setMessage({
        title: 'The backup was NOT restored',
        description:
          "The browser's storage for this site is full, so the backup could not be put back. Nothing was changed: this browser holds what it held before.",
        tone: 'danger',
      })
    } else {
      onRestored({
        title: 'The backup was NOT restored',
        description:
          'The browser refused to store the backup, and what was here before could not be put back either. Keep this page open and restore your latest backup file again.',
        tone: 'danger',
      })
    }
  }

  const savedAt = pending ? formatSavedAt(pending.inFile.exportedAt) : null

  const controls = (
    <div className="border-t border-line px-3 pb-1 pt-3">
      <p className="mb-2 text-xs text-muted">{allowRestore ? 'Saved in this browser only' : "This browser's own copy"}</p>
      <div className="flex gap-2">
        <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFileSelected} />
        <button onClick={handleBackUp} className="btn btn-secondary btn-sm flex-1" title="Save everything in this browser to one file">
          <Download aria-hidden="true" />
          Back up
        </button>
        {allowRestore && (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn btn-secondary btn-sm flex-1"
            title="Put a backup file back into this browser"
          >
            <Upload aria-hidden="true" />
            Restore
          </button>
        )}
      </div>
    </div>
  )

  const dialogs = (
    <>
      {pending && (
        <Modal
          title="Restore this backup?"
          description="Restoring replaces everything Payroll keeps in this browser with what is in the file."
          onClose={() => setPending(null)}
          width="max-w-xl"
          icon={<HardDriveDownload />}
        >
          <h3 className="mb-1 text-sm font-semibold text-fg">In the backup file</h3>
          <p className="mb-2 wrap-break-word text-xs text-muted">
            {pending.fileName}
            {savedAt && `, saved on ${savedAt}`}
          </p>
          <BackupHoldings summary={pending.inFile} />

          <h3 className="mb-2 mt-5 text-sm font-semibold text-fg">In this browser now</h3>
          <BackupHoldings summary={pending.inBrowser} />

          <div role="alert" className="panel panel-danger mt-5 items-center text-sm">
            <TriangleAlert aria-hidden="true" />
            <span className="min-w-0 flex-1">
              What is in this browser now will be removed. To keep it, back it up first.
            </span>
            <button onClick={handleBackUp} className="btn btn-secondary btn-sm">
              Back up what is here
            </button>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setPending(null)} className="btn btn-secondary">
              Cancel
            </button>
            <button onClick={handleRestore} className="btn btn-danger">
              Replace with this backup
            </button>
          </div>
        </Modal>
      )}

      {message && <BackupMessage {...message} onClose={() => setMessage(null)} />}
    </>
  )

  return { controls, dialogs }
}
