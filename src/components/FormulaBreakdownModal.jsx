import { useState } from 'react'
import Modal from './Modal'
import { formatDecimal } from '../lib/format'
import { formatFormulaForDisplay } from '../lib/formulaEngine'

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
    <div className="rounded-md border border-slate-200">
      <button
        type="button"
        onClick={() => isFormula && setOpen((o) => !o)}
        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
          isFormula ? 'cursor-pointer hover:bg-slate-50' : 'cursor-default'
        }`}
      >
        <span className="flex items-center gap-2">
          {isFormula && (
            <span className="text-xs text-slate-400">{open ? '▾' : '▸'}</span>
          )}
          <span className="font-medium text-slate-700">{trace.name}</span>
          {isFormula ? (
            <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">fx</span>
          ) : (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">input</span>
          )}
        </span>
        <span className={`font-mono text-sm ${trace.error ? 'text-red-600' : 'text-slate-800'}`}>
          {trace.error ? 'Error' : formatValue(trace.value, trace.decimals, trace.valueType)}
        </span>
      </button>

      {isFormula && open && (
        <div className="border-t border-slate-100 px-3 py-2">
          <FormulaBody trace={trace} labelByKey={labelByKey} />
        </div>
      )}
    </div>
  )
}

function FormulaBody({ trace, labelByKey }) {
  if (trace.error) {
    return <p className="text-sm text-red-600">Error: {trace.error}</p>
  }

  return (
    <div className="space-y-3">
      {trace.exemption && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Exemption / condition</p>
          <p className="mt-0.5 rounded bg-amber-50 px-2 py-1.5 text-sm text-amber-900">{trace.exemption.sentence}</p>
        </div>
      )}
      {(!trace.exemption || !trace.exemption.matched) &&
        (trace.tiered || trace.compare || trace.progressive ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">How this was calculated</p>
            <p className="mt-0.5 rounded bg-indigo-50 px-2 py-1.5 text-sm text-indigo-900">
              {(trace.tiered ?? trace.compare ?? trace.progressive).sentence}
            </p>
          </div>
        ) : (
          <>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Formula</p>
              <p className="mt-0.5 rounded bg-slate-50 px-2 py-1 font-mono text-sm text-slate-700">
                {formatFormulaForDisplay(trace.formula, labelByKey)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Substituted</p>
              <p className="mt-0.5 rounded bg-slate-50 px-2 py-1 font-mono text-sm text-slate-700">{trace.substituted}</p>
            </div>
          </>
        ))}
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Result</p>
        <p className="mt-0.5 font-mono text-base font-semibold text-indigo-700">{formatValue(trace.value, trace.decimals)}</p>
      </div>

      {trace.dependencies && trace.dependencies.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Depends on</p>
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
    <Modal title={`Breakdown: ${trace.name}`} onClose={onClose} width="max-w-xl">
      <FormulaBody trace={trace} labelByKey={labelByKey} />
    </Modal>
  )
}
