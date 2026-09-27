import { useState } from 'react'
import ConfirmDialog from './ConfirmDialog'

export default function Sidebar({ companies, activeCompanyId, onSelect, onAddCompany, onRenameCompany, onDeleteCompany }) {
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [deletingCompany, setDeletingCompany] = useState(null)

  function startRename(company) {
    setRenamingId(company.id)
    setRenameValue(company.name)
  }

  function commitRename() {
    if (renameValue.trim()) onRenameCompany(renamingId, renameValue.trim())
    setRenamingId(null)
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      <div className="border-b border-slate-200 px-4 py-4">
        <h1 className="text-lg font-bold text-slate-800">Payroll</h1>
        <p className="text-xs text-slate-500">Companies</p>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {companies.length === 0 && (
          <p className="px-4 py-3 text-sm text-slate-400">No companies yet.</p>
        )}
        {companies.map((company) => (
          <div
            key={company.id}
            className={`group mx-2 mb-1 flex items-center rounded-md px-3 py-2 text-sm ${
              company.id === activeCompanyId
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-700 hover:bg-slate-200'
            }`}
          >
            {renamingId === company.id ? (
              <input
                autoFocus
                className="w-full rounded border border-slate-300 px-1 py-0.5 text-sm text-slate-800"
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
                <button
                  className="flex-1 truncate text-left"
                  onClick={() => onSelect(company.id)}
                  onDoubleClick={() => startRename(company)}
                  title={company.name}
                >
                  {company.name}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeletingCompany(company)
                  }}
                  className={`ml-1 shrink-0 rounded px-1 text-xs opacity-0 group-hover:opacity-100 ${
                    company.id === activeCompanyId ? 'hover:bg-indigo-500' : 'hover:bg-slate-300'
                  }`}
                  aria-label={`Delete ${company.name}`}
                >
                  ✕
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-slate-200 p-3">
        <button
          onClick={onAddCompany}
          className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + New Company
        </button>
      </div>

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
    </aside>
  )
}
