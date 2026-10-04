import { useId, useRef } from 'react'
import { X } from 'lucide-react'
import { useFocusScope } from '../hooks/useFocusScope'

// Shared dialog shell: centred on a dimmed, blurred overlay, with a round
// tinted icon, the title and an optional one-line description in the header.
export default function Modal({ title, onClose, children, width = 'max-w-lg', icon, iconTone, description }) {
  // The dialog is named by its own visible title, not by a separate label.
  const titleId = useId()
  // Keyboard: focus moves in, Tab stays inside, Escape uses the same close
  // handler as the close button, focus returns to the opener.
  const dialogRef = useRef(null)
  useFocusScope(dialogRef, { onEscape: onClose })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`rise-in w-full outline-none ${width} rounded-2xl border border-line-strong bg-elevated shadow-pop`}
      >
        <div className="flex items-start gap-3 px-6 pt-5">
          {icon && (
            <span className={`icon-tile icon-tile-round ${iconTone === 'danger' ? 'icon-tile-danger' : ''}`} aria-hidden="true">
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id={titleId} className="text-base font-semibold text-fg">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-icon btn-sm -mr-1 -mt-1" aria-label="Close">
            <X aria-hidden="true" />
          </button>
        </div>
        {/* Side padding is wide enough that a primary button's glow isn't clipped by the scroll area. */}
        <div className="max-h-[75vh] overflow-y-auto px-6 pb-6 pt-4">{children}</div>
      </div>
    </div>
  )
}
