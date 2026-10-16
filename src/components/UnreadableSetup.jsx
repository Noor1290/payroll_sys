import { useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { useBackupControls } from './BackupControls'
import { startWithEmptySetup } from '../lib/backup'

// Shown instead of the app, on its own, when the setup and companies saved
// in this browser are there but cannot be read (see setupIsUnreadable in
// storage.js). Nothing is shown as empty and nothing is saved over them
// until the user chooses: back them up, restore an earlier backup, or start
// with an empty setup, which first keeps a copy of what could not be read.
export default function UnreadableSetup({ onRestored, onStarted }) {
  const backup = useBackupControls(onRestored)
  const [refused, setRefused] = useState(false)

  function handleStartEmpty() {
    const result = startWithEmptySetup()
    if (!result.ok) {
      setRefused(true)
      return
    }
    onStarted(result.keptUnder)
  }

  return (
    <main className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <div role="alert" className="flex max-w-lg flex-col items-center gap-3">
        <span className="icon-tile icon-tile-danger" aria-hidden="true">
          <CircleAlert />
        </span>
        <h1 className="text-base font-semibold text-fg">The saved setup could not be read</h1>
        <p className="text-sm text-muted">
          The columns and companies saved in this browser are there, but they could not be read, so they cannot be shown.
          Nothing has been changed, and nothing will be saved over them.
        </p>
        <p className="text-sm text-muted">
          First save a backup with "Back up": it keeps them exactly as they are. If you have an earlier backup, "Restore"
          puts it back.
        </p>
      </div>
      <div className="w-full max-w-xs text-left">{backup.controls}</div>
      <div className="flex max-w-lg flex-col items-center gap-2">
        <button onClick={handleStartEmpty} className="btn btn-secondary">
          Start with an empty setup
        </button>
        <p className="text-xs text-muted">
          Keeps a copy of what could not be read in this browser, then starts with no columns and no companies. The saved
          months are not touched.
        </p>
        {refused && (
          <p role="alert" className="note note-warn text-sm">
            The browser's storage is full, so no copy could be kept. Nothing was changed. Save a backup, free some space,
            and try again.
          </p>
        )}
      </div>
      {backup.dialogs}
    </main>
  )
}
