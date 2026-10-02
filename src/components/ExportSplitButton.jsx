import { useEffect, useRef, useState } from 'react'

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
      <button
        onClick={() => choose('values')}
        className="rounded-l-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
      >
        Export to Excel
      </button>
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-r-md border-l border-emerald-700 bg-emerald-600 px-2 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        aria-label="More export options"
      >
        ▾
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-md border border-slate-200 bg-white py-1 text-left shadow-lg">
          <button
            onClick={() => choose('values')}
            className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Export with Values
            <span className="block text-xs font-normal text-slate-400">Formula columns as computed numbers</span>
          </button>
          <button
            onClick={() => choose('formulas')}
            className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Export with Live Formulas
            <span className="block text-xs font-normal text-slate-400">Formula columns as working Excel formulas</span>
          </button>
          <div className="my-1 border-t border-slate-100" />
          <button
            onClick={() => choosePdfFill('csv')}
            className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Export for PDF fill (CSV)
            <span className="block text-xs font-normal text-slate-400">Pick columns, one row per employee, plain-name headers</span>
          </button>
          <button
            onClick={() => choosePdfFill('json')}
            className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Export for PDF fill (JSON)
            <span className="block text-xs font-normal text-slate-400">Pick columns, one object per employee, plain-name keys</span>
          </button>
        </div>
      )}
    </div>
  )
}
