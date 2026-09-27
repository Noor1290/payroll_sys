import { useMemo, useState } from 'react'
import TotalsTable from './TotalsTable'
import { loadPeriod } from '../lib/storage'
import { enumeratePeriods, periodKey, parsePeriodKey, formatPeriodLabel } from '../lib/periods'
import { computeTotals } from '../lib/totals'
import { getColumnsByKey } from '../lib/model'

// Aggregates a company's employees across a user-chosen month range,
// matched by the designated ID field, and reuses the standard export
// pipeline to send the aggregated table to Excel.
export default function TotalsView({ company, identityFields, idFieldKey, effectiveColumns, defaultYear, defaultMonth, onExport }) {
  const [fromKey, setFromKey] = useState(periodKey(defaultYear, defaultMonth))
  const [toKey, setToKey] = useState(periodKey(defaultYear, defaultMonth))

  const { year: fromYear, month: fromMonth } = parsePeriodKey(fromKey)
  const { year: toYear, month: toMonth } = parsePeriodKey(toKey)

  const columnsByKey = useMemo(() => getColumnsByKey(effectiveColumns), [effectiveColumns])

  const { employees, computedGrid, rangeLabel } = useMemo(() => {
    const periodsList = enumeratePeriods(fromYear, fromMonth, toYear, toMonth)
    const periodsWithData = periodsList.map(({ year, month }) => ({
      year,
      month,
      employees: loadPeriod(company.id, year, month).employees,
    }))
    const result = computeTotals(periodsWithData, effectiveColumns, columnsByKey, idFieldKey)

    const first = periodsList[0]
    const last = periodsList[periodsList.length - 1]
    const label =
      periodsList.length === 1
        ? formatPeriodLabel(first.year, first.month)
        : `${formatPeriodLabel(first.year, first.month)} to ${formatPeriodLabel(last.year, last.month)}`

    return { ...result, rangeLabel: label }
  }, [company.id, fromYear, fromMonth, toYear, toMonth, effectiveColumns, columnsByKey, idFieldKey])

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          From
          <input
            type="month"
            value={fromKey}
            onChange={(e) => setFromKey(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          To
          <input
            type="month"
            value={toKey}
            onChange={(e) => setToKey(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </label>
        <span className="text-xs text-slate-400">Summing {rangeLabel}</span>
        <div className="flex-1" />
        <button
          onClick={() => onExport(employees, computedGrid, rangeLabel)}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Export to Excel
        </button>
      </div>

      {!idFieldKey ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No ID field is designated, so employees can't be matched across months. Set one as the "ID field" in Global
          Columns → Identity Fields to use Totals.
        </div>
      ) : (
        <TotalsTable
          identityFields={identityFields}
          idFieldKey={idFieldKey}
          effectiveColumns={effectiveColumns}
          employees={employees}
          computedGrid={computedGrid}
        />
      )}
    </div>
  )
}
