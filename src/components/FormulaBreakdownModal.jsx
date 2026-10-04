import { useState } from 'react'
import { ChevronDown, ChevronRight, Sigma } from 'lucide-react'
import Modal from './Modal'
import { formatDecimal } from '../lib/format'
import { formatFormulaForDisplay } from '../lib/formulaEngine'

const SECTION_LABEL = 'text-xs font-medium uppercase tracking-wide text-subtle'
const CODE_LINE = 'num mt-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-fg'

function formatValue(v, decimals, valueType) {
  if (valueType === 'checkbox') return v === 1 || v === true ? 'Yes' : 'No'
  if (typeof v === 'string') return v || '—'
  if (typeof v !== 'number' || Number.isNaN(v)) return '—'
  return formatDecimal(v, decimals ?? 2)
}

function DependencyRow({ trace, labelByKey }) {
  const [open, setOpen] = useState(false)
  const isFormula = trace.type === 'formula'

  return (
    <div className="rounded-lg border border-line">
      <button
        type="button"
        onClick={() => isFormula && setOpen((o) => !o)}
        aria-expanded={isFormula ? open : undefined}
        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
          isFormula ? 'cursor-pointer hover:bg-surface-hover' : 'cursor-default'
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {isFormula && (
            <span className="text-subtle" aria-hidden="true">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
          )}
          <span className="font-medium text-fg">{trace.name}</span>
          {isFormula ? <span className="badge badge-glow normal-case">fx</span> : <span className="badge normal-case">input</span>}
        </span>
        <span className={`num shrink-0 text-sm ${trace.error ? 'text-danger' : 'text-fg'}`}>
          {trace.error ? 'Error' : formatValue(trace.value, trace.decimals, trace.valueType)}
        </span>
      </button>

      {isFormula && open && (
        <div className="border-t border-line px-3 py-3">
          <FormulaBody trace={trace} labelByKey={labelByKey} />
        </div>
      )}
    </div>
  )
}

function FormulaBody({ trace, labelByKey }) {
  if (trace.error) {
    return <p className="text-sm text-danger">Error: {trace.error}</p>
  }

  return (
    <div className="space-y-4">
      {trace.exemption && (
        <div>
          <p className={SECTION_LABEL}>Exemption / condition</p>
          <p className="note note-warn mt-1">{trace.exemption.sentence}</p>
        </div>
      )}
      {(!trace.exemption || !trace.exemption.matched) &&
        (trace.tiered || trace.compare || trace.progressive ? (
          <div>
            <p className={SECTION_LABEL}>How this was calculated</p>
            <p className="note note-accent mt-1">{(trace.tiered ?? trace.compare ?? trace.progressive).sentence}</p>
          </div>
        ) : (
          <>
            <div>
              <p className={SECTION_LABEL}>Formula</p>
              <p className={CODE_LINE}>{formatFormulaForDisplay(trace.formula, labelByKey)}</p>
            </div>
            <div>
              <p className={SECTION_LABEL}>Substituted</p>
              <p className={CODE_LINE}>{trace.substituted}</p>
            </div>
          </>
        ))}
      <div>
        <p className={SECTION_LABEL}>Result</p>
        <p className="num mt-1 text-xl font-semibold text-accent">{formatValue(trace.value, trace.decimals)}</p>
      </div>

      {trace.dependencies && trace.dependencies.length > 0 && (
        <div>
          <p className={`${SECTION_LABEL} mb-1.5`}>Depends on</p>
          <div className="space-y-1.5">
            {trace.dependencies.map((dep) => (
              <DependencyRow key={dep.key} trace={dep} labelByKey={labelByKey} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function FormulaBreakdownModal({ trace, labelByKey = {}, onClose }) {
  return (
    <Modal title={`Breakdown: ${trace.name}`} onClose={onClose} width="max-w-xl" icon={<Sigma />}>
      <FormulaBody trace={trace} labelByKey={labelByKey} />
    </Modal>
  )
}
