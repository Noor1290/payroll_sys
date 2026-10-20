import { useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { readDate, showDate } from '../lib/dates'

// One Date cell of the Employee Table (a Date Input column or a Date identity field). Typed and shown
// DD/MM/YYYY, saved "YYYY-MM-DD" (see src/lib/dates.js), with a calendar to pick the date from.
//
// A date is saved as soon as what is typed is one. What is not a date ("31/02/2026", "13/13/2020",
// words) is refused: nothing is saved, the cell keeps the text in red and the table says why
// (`refused`, kept by the table so it is listed above it), until it is corrected or Esc is pressed.
// A value saved before the field was a Date that is not a clear date is shown as it was saved, in red.
export default function DateCell({ value, label, refused, describedBy, onCommit, onRefuse, onClearRefusal }) {
  const [draft, setDraft] = useState(null) // the text while the cell is being typed in
  const atFocus = useRef(null) // the text the cell showed when it was entered
  const pickerRef = useRef(null)

  const saved = readDate(value)
  const savedUnreadable = refused === undefined && draft === null && Boolean(saved.unreadable)
  const invalid = refused !== undefined || savedUnreadable
  const shown = draft ?? refused ?? showDate(value)

  function commit(iso) {
    if (iso !== value) onCommit(iso)
    onClearRefusal()
  }

  function handleChange(text) {
    setDraft(text)
    const read = readDate(text)
    if (read.value) commit(read.value)
    else if (read.empty) commit('')
  }

  function finishTyping() {
    if (draft === null) return
    // Only what was typed is refused: leaving a cell unchanged changes nothing.
    if (draft !== atFocus.current && readDate(draft).unreadable) onRefuse(draft.trim())
    setDraft(null)
  }

  function openPicker() {
    const picker = pickerRef.current
    if (!picker) return
    try {
      picker.showPicker()
    } catch {
      picker.focus()
    }
  }

  return (
    <div className="relative flex items-center gap-0.5">
      <input
        type="text"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={refused !== undefined ? describedBy : undefined}
        title={savedUnreadable ? 'Not a date: kept as it was saved. Type it as DD/MM/YYYY, for example 01/08/2026.' : undefined}
        placeholder="DD/MM/YYYY"
        className={`field field-cell num min-w-0 flex-1 text-[13px] ${invalid ? 'border-danger/70 text-danger' : ''}`}
        value={shown}
        onFocus={() => {
          atFocus.current = shown
          setDraft(shown)
        }}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={finishTyping}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            // Back to what is saved, with nothing refused on the way out.
            atFocus.current = e.currentTarget.value
            setDraft(null)
            onClearRefusal()
            e.currentTarget.blur()
          }
        }}
      />
      <button
        type="button"
        onClick={openPicker}
        aria-label={`Pick a date: ${label}`}
        title="Pick a date"
        className="btn btn-ghost btn-icon btn-sm shrink-0 text-subtle hover:text-accent"
      >
        <CalendarDays aria-hidden="true" />
      </button>
      {/* The browser's own calendar, opened by the button. It works in YYYY-MM-DD, like what is saved. */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        data-date-picker
        className="pointer-events-none absolute bottom-0 right-0 h-px w-px opacity-0"
        min="1900-01-01"
        max="2100-12-31"
        value={saved.value ?? ''}
        onChange={(e) => {
          setDraft(null)
          commit(e.target.value)
        }}
      />
    </div>
  )
}
