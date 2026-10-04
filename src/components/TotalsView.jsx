import { useMemo, useState } from 'react'
import { FileSpreadsheet, TriangleAlert } from 'lucide-react'
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
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="card flex flex-wrap items-end gap-x-4 gap-y-3 px-4 py-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          From
          <input type="month" value={fromKey} onChange={(e) => setFromKey(e.target.value)} className="field num w-44" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          To
          <input type="month" value={toKey} onChange={(e) => setToKey(e.target.value)} className="field num w-44" />
        </label>
        <span className="pb-3 text-xs text-muted">Summing {rangeLabel}</span>
        <div className="flex-1" />
        <button onClick={() => onExport(employees, computedGrid, rangeLabel)} className="btn btn-primary mb-0.5">
          <FileSpreadsheet aria-hidden="true" />
          Export to Excel
        </button>
      </div>

      {!idFieldKey ? (
        <div className="panel text-sm [--panel:var(--warn)]">
          <TriangleAlert aria-hidden="true" />
          <span>
            No ID field is designated, so employees can't be matched across months. Set one as the "ID field" in Global
            Columns → Identity Fields to use Totals.
          </span>
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
