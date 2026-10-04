import { formatPeriodLabel, monthName, shiftPeriod } from '../lib/periods'

export default function MonthSwitcher({ year, month, onChange }) {
  const prev = shiftPeriod(year, month, -1)
  const next = shiftPeriod(year, month, 1)

  return (
    <div className="card flex items-center justify-center gap-2 px-2 py-1.5 sm:gap-4">
      <button onClick={() => onChange(prev.year, prev.month)} className="btn btn-ghost btn-sm">
        ← {monthName(prev.month)}
      </button>
      <span className="num min-w-36 text-center text-sm font-semibold text-fg sm:min-w-40">
        {formatPeriodLabel(year, month)}
      </span>
      <button onClick={() => onChange(next.year, next.month)} className="btn btn-ghost btn-sm">
        {monthName(next.month)} →
      </button>
    </div>
  )
}
