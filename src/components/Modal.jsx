import { X } from 'lucide-react'

// `redesigned` dialogs pass an icon and (optionally) a one-line description
// for the header. Dialogs that haven't been restyled yet don't, and keep
// their old light look until they are (TEMPORARY - see .legacy-light).
export default function Modal({ title, onClose, children, width = 'max-w-lg', redesigned = false, icon, iconTone, description }) {
  if (!redesigned) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div className={`legacy-light w-full ${width} rounded-lg bg-white shadow-xl`}>
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <h2 className="text-base font-semibold text-slate-800">{title}</h2>
            <button
              onClick={onClose}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`rise-in w-full ${width} rounded-2xl border border-line-strong bg-elevated shadow-pop`}
      >
        <div className="flex items-start gap-3 px-6 pt-5">
          {icon && (
            <span className={`icon-tile icon-tile-round ${iconTone === 'danger' ? 'icon-tile-danger' : ''}`} aria-hidden="true">
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="text-base font-semibold text-fg">{title}</h2>
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
