import { useRef, useState } from 'react'
import { Info, Trash2, WalletCards, X } from 'lucide-react'
import ConfirmDialog from './ConfirmDialog'
import ThemeToggle from './ThemeToggle'
import { useFocusScope } from '../hooks/useFocusScope'

const ROW_ACTION =
  'ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100'

// `open` / `onClose` only matter at narrow widths, where the sidebar is a
// drawer over the page instead of a fixed column - layout only.
export default function Sidebar({
  companies,
  activeCompanyId,
  onSelect,
  onAddCompany,
  onRenameCompany,
  onDeleteCompany,
  onOpenDetails,
  open = false,
  onClose,
}) {
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [deletingCompany, setDeletingCompany] = useState(null)

  // Keyboard, only while it is open as a drawer at narrow widths: focus
  // moves in, Tab stays inside, Escape closes it, focus returns to the menu button.
  const asideRef = useRef(null)
  const isDrawer = open && window.matchMedia?.('(max-width: 767.98px)').matches
  useFocusScope(asideRef, { active: Boolean(isDrawer), onEscape: onClose })

  function startRename(company) {
    setRenamingId(company.id)
    setRenameValue(company.name)
  }

  function commitRename() {
    if (renameValue.trim()) onRenameCompany(renamingId, renameValue.trim())
    setRenamingId(null)
  }

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={onClose} aria-hidden="true" />}

      <aside
        ref={asideRef}
        tabIndex={-1}
        className={`outline-none flex h-full w-64 shrink-0 flex-col border-r border-line bg-elevated transition-transform duration-150 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-pop md:relative md:z-10 md:bg-surface ${
          open ? 'max-md:translate-x-0' : 'max-md:invisible max-md:-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-4">
          <span className="icon-tile" aria-hidden="true">
            <WalletCards />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-tight tracking-tight text-fg">Payroll</h1>
            <p className="text-xs text-muted">Companies</p>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-icon btn-sm md:hidden" aria-label="Close company list">
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {companies.length === 0 && <p className="px-4 py-3 text-sm text-subtle">No companies yet.</p>}
          {companies.map((company) => {
            const isActive = company.id === activeCompanyId
            return (
              <div
                key={company.id}
                className={`group mx-2 mb-1 flex h-10 items-center rounded-lg border px-3 text-sm transition-colors ${
                  isActive
                    ? 'border-accent/35 bg-accent/10 font-medium text-fg'
                    : 'border-transparent text-muted hover:bg-surface-hover hover:text-fg'
                }`}
              >
                {renamingId === company.id ? (
                  <input
                    autoFocus
                    data-own-escape
                    aria-label="Company name"
                    className="field field-cell"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                  />
                ) : (
                  <>
                    {isActive && <span className="mr-2 h-4 w-0.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />}
                    <button
                      className="flex-1 truncate rounded text-left"
                      onClick={() => onSelect(company.id)}
                      onDoubleClick={() => startRename(company)}
                      title={company.name}
                      aria-current={isActive ? 'true' : undefined}
                    >
                      {company.name}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenDetails(company.id)
                      }}
                      className={`${ROW_ACTION} ${isActive ? 'opacity-100' : 'opacity-0'}`}
                      aria-label={`${company.name} details`}
                      title="Company details"
                    >
                      <Info className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeletingCompany(company)
                      }}
                      className={`${ROW_ACTION} opacity-0 hover:text-danger`}
                      aria-label={`Delete ${company.name}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-2 border-t border-line p-3">
          <button onClick={onAddCompany} className="btn btn-primary flex-1">
            + New Company
          </button>
          <ThemeToggle />
        </div>
      </aside>

      {deletingCompany && (
        <ConfirmDialog
          title="Delete company"
          message={`Delete "${deletingCompany.name}" and all of its employees and columns? This cannot be undone.`}
          onCancel={() => setDeletingCompany(null)}
          onConfirm={() => {
            onDeleteCompany(deletingCompany.id)
            setDeletingCompany(null)
          }}
        />
      )}
    </>
  )
}
