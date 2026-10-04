import { useMemo, useState } from 'react'
import { FileJson } from 'lucide-react'
import Modal from './Modal'
import { planColumnImport } from '../lib/columnSetup'
import { getCategoryLabel } from '../lib/categories'

const STATUS_LABEL = {
  new: 'New',
  duplicate: 'Renamed (duplicate key)',
  skip: 'Already exists — skipped',
}

// Preview/confirm screen shown before actually creating any columns from an
// imported column-setup file. Recomputes the plan live as the user toggles
// how collisions should be handled, so what they see always matches what
// Import will do.
export default function ColumnSetupImportModal({ fileScope, fileCompanyName, fileColumns, existingKeys, onConfirm, onCancel }) {
  const [mode, setMode] = useState('skip') // 'skip' | 'duplicate'

  const plan = useMemo(() => planColumnImport(fileColumns, existingKeys, mode), [fileColumns, existingKeys, mode])

  const hasCollisions = useMemo(
    () => planColumnImport(fileColumns, existingKeys, 'skip').some((p) => p.action !== 'new'),
    [fileColumns, existingKeys]
  )

  const importCount = plan.filter((p) => p.action !== 'skip').length
  const skipCount = plan.filter((p) => p.action === 'skip').length

  return (
    <Modal title="Import Column Setup" onClose={onCancel} width="max-w-2xl" redesigned icon={<FileJson />}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          This file contains {fileColumns.length} {fileScope === 'global' ? 'Global' : 'Company'} column
          {fileColumns.length === 1 ? '' : 's'}
          {fileScope === 'company' && fileCompanyName ? ` (exported from "${fileCompanyName}")` : ''}.
        </p>

        {hasCollisions && (
          <div>
            <label className="label">If a column already exists</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode('skip')}
                className={`choice ${
                  mode === 'skip'
                    ? 'choice-active'
                    : ''
                }`}
              >
                Skip existing
              </button>
              <button
                type="button"
                onClick={() => setMode('duplicate')}
                className={`choice ${
                  mode === 'duplicate'
                    ? 'choice-active'
                    : ''
                }`}
              >
                Import as new/duplicate
              </button>
            </div>
          </div>
        )}

        <div className="max-h-80 overflow-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-elevated text-left text-xs font-medium text-muted shadow-[inset_0_-1px_0_var(--line)]">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {plan.map((p, i) => (
                <tr key={i} className={p.action === 'skip' ? 'text-subtle' : 'text-fg'}>
                  <td className="px-3 py-2">{p.name}</td>
                  <td className="px-3 py-2">{getCategoryLabel(p.category)}</td>
                  <td className="px-3 py-2 capitalize">{p.type}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {p.finalKey}
                    {p.action === 'duplicate' && <span className="text-subtle"> (was {p.originalKey})</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">{STATUS_LABEL[p.action]}</td>
                </tr>
              ))}
              {plan.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted">
                    No columns found in this file.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted">
          {importCount} column{importCount === 1 ? '' : 's'} will be added
          {skipCount > 0 ? `, ${skipCount} skipped.` : '.'}
        </p>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(plan.filter((p) => p.action !== 'skip').map((p) => p.column))}
            disabled={importCount === 0}
            className="btn btn-primary"
          >
            Import {importCount} Column{importCount === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
