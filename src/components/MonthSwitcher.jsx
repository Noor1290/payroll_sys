import { formatPeriodLabel, monthName, shiftPeriod } from '../lib/periods'

export default function MonthSwitcher({ year, month, onChange }) {
  const prev = shiftPeriod(year, month, -1)
  const next = shiftPeriod(year, month, 1)

  return (
    <div className="flex items-center justify-center gap-4 rounded-lg border border-slate-200 bg-white py-2">
      <button
        onClick={() => onChange(prev.year, prev.month)}
        className="rounded-md px-3 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      >
        ← {monthName(prev.month)}
      </button>
      <span className="min-w-[10rem] text-center text-sm font-semibold text-slate-800">
        {formatPeriodLabel(year, month)}
      </span>
      <button
        onClick={() => onChange(next.year, next.month)}
        className="rounded-md px-3 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      >
        {monthName(next.month)} →
      </button>
    </div>
  )
}
