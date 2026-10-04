import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FileSpreadsheet } from 'lucide-react'

const MENU_ITEM = 'block w-full px-3 py-2 text-left text-sm text-fg transition-colors hover:bg-surface-hover'
const MENU_HINT = 'mt-0.5 block text-xs font-normal text-muted'

// Main button click = "Export with Values" (the existing/default behavior,
// unchanged). The chevron opens a small menu offering both xlsx options
// plus the "PDF fill" CSV/JSON exports, which go through a separate
// column-picker flow (onExportPdfFill) instead of straight to a download.
export default function ExportSplitButton({ onExport, onExportPdfFill }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function choose(mode) {
    setOpen(false)
    onExport(mode)
  }

  function choosePdfFill(format) {
    setOpen(false)
    onExportPdfFill(format)
  }

  return (
    <div className="relative inline-flex" ref={containerRef}>
      <button onClick={() => choose('values')} className="btn btn-primary rounded-r-none">
        <FileSpreadsheet aria-hidden="true" />
        Export to Excel
      </button>
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn btn-primary btn-icon ml-px w-9 rounded-l-none"
        aria-label="More export options"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ChevronDown aria-hidden="true" />
      </button>

      {open && (
        <div className="rise-in absolute right-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-xl border border-line-strong bg-elevated py-1 text-left shadow-pop">
          <button onClick={() => choose('values')} className={MENU_ITEM}>
            Export with Values
            <span className={MENU_HINT}>Formula columns as computed numbers</span>
          </button>
          <button onClick={() => choose('formulas')} className={MENU_ITEM}>
            Export with Live Formulas
            <span className={MENU_HINT}>Formula columns as working Excel formulas</span>
          </button>
          <div className="my-1 border-t border-line" />
          <button onClick={() => choosePdfFill('csv')} className={MENU_ITEM}>
            Export for PDF fill (CSV)
            <span className={MENU_HINT}>Pick columns, one row per employee, plain-name headers</span>
          </button>
          <button onClick={() => choosePdfFill('json')} className={MENU_ITEM}>
            Export for PDF fill (JSON)
            <span className={MENU_HINT}>Pick columns, one object per employee, plain-name keys</span>
          </button>
        </div>
      )}
    </div>
  )
}
