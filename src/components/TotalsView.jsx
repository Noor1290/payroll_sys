import { useEffect, useMemo, useState } from 'react'
import { CircleAlert, FileSpreadsheet, LoaderCircle, TriangleAlert } from 'lucide-react'
import TotalsTable from './TotalsTable'
import { dataStore } from '../lib/dataStore'
import { enumeratePeriods, periodKey, parsePeriodKey, formatPeriodLabel } from '../lib/periods'
import { computeTotals, findSharedIds } from '../lib/totals'
import { getColumnsByKey } from '../lib/model'

const isPending = (result) => typeof result?.then === 'function'

// The months of a range: at once from this browser; inside the dashboard they
// may have to be read first. Never part of a range: a month that could not be
// read stops the totals, with the reason.
//   { periodsWithData } | { blocked } | null while reading
function useRangeMonths(companyId, periodsList, reloadToken) {
  const direct = useMemo(() => {
    // Read again when asked to (the dashboard was unlocked): the token says when.
    void reloadToken
    const results = periodsList.map(({ year, month }) => ({ year, month, result: dataStore.loadPeriod(companyId, year, month) }))
    if (results.some((r) => isPending(r.result))) return { pending: results }
    const failed = results.find((r) => r.result.blocked)
    if (failed) return { blocked: failed.result.blocked }
    return { periodsWithData: results.map(({ year, month, result }) => ({ year, month, employees: result.employees })) }
  }, [companyId, periodsList, reloadToken])

  const [read, setRead] = useState(null) // { for, ...result }
  useEffect(() => {
    if (!direct.pending) return
    let live = true
    Promise.all(direct.pending.map((r) => Promise.resolve(r.result))).then((list) => {
      if (!live) return
      const failed = list.find((r) => r.blocked)
      setRead(
        failed
          ? { for: direct, blocked: failed.blocked }
          : { for: direct, periodsWithData: list.map((r, i) => ({ year: direct.pending[i].year, month: direct.pending[i].month, employees: r.employees })) }
      )
    })
    return () => {
      live = false
    }
  }, [direct])

  if (!direct.pending) return direct
  return read?.for === direct ? read : null
}

// Aggregates a company's employees across a user-chosen month range,
// matched by the designated ID field, and reuses the standard export
// pipeline to send the aggregated table to Excel.
export default function TotalsView({ company, identityFields, idFieldKey, effectiveColumns, defaultYear, defaultMonth, onExport, reloadToken = 0 }) {
  const [fromKey, setFromKey] = useState(periodKey(defaultYear, defaultMonth))
  const [toKey, setToKey] = useState(periodKey(defaultYear, defaultMonth))

  const { year: fromYear, month: fromMonth } = parsePeriodKey(fromKey)
  const { year: toYear, month: toMonth } = parsePeriodKey(toKey)

  const columnsByKey = useMemo(() => getColumnsByKey(effectiveColumns), [effectiveColumns])

  const periodsList = useMemo(() => enumeratePeriods(fromYear, fromMonth, toYear, toMonth), [fromYear, fromMonth, toYear, toMonth])
  const range = useRangeMonths(company.id, periodsList, reloadToken)

  const rangeLabel = useMemo(() => {
    const first = periodsList[0]
    const last = periodsList[periodsList.length - 1]
    return periodsList.length === 1
      ? formatPeriodLabel(first.year, first.month)
      : `${formatPeriodLabel(first.year, first.month)} to ${formatPeriodLabel(last.year, last.month)}`
  }, [periodsList])

  const totals = useMemo(
    () => (range?.periodsWithData ? computeTotals(range.periodsWithData, effectiveColumns, columnsByKey, idFieldKey) : null),
    [range, effectiveColumns, columnsByKey, idFieldKey]
  )
  // Audit R7: two employees with one ID in a month are added together in one row; say so.
  const sharedIds = useMemo(() => (range?.periodsWithData ? findSharedIds(range.periodsWithData, idFieldKey) : []), [range, idFieldKey])
  const employees = totals?.employees ?? []
  const computedGrid = totals?.computedGrid ?? {}

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
        <button onClick={() => onExport(employees, computedGrid, rangeLabel)} disabled={!totals} className="btn btn-primary mb-0.5">
          <FileSpreadsheet aria-hidden="true" />
          Export to Excel
        </button>
      </div>

      {!range ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          Loading the months from the dashboard…
        </p>
      ) : range.blocked ? (
        <div role="alert" className="panel panel-danger text-sm">
          <CircleAlert aria-hidden="true" />
          <span>
            {range.blocked.code === 'unreadable'
              ? 'No totals: a month of this range could not be read in this browser.'
              : 'No totals: a month of this range could not be loaded from the dashboard.'}{' '}
            {range.blocked.error}
          </span>
        </div>
      ) : !idFieldKey ? (
        <div className="panel text-sm [--panel:var(--warn)]">
          <TriangleAlert aria-hidden="true" />
          <span>
            No ID field is designated, so employees can't be matched across months. Set one as the "ID field" in Global
            Columns → Identity Fields to use Totals.
          </span>
        </div>
      ) : (
        <>
          {sharedIds.length > 0 && (
            <div role="alert" className="panel text-sm [--panel:var(--warn)]">
              <TriangleAlert aria-hidden="true" />
              <span>
                {sharedIds
                  .map((s) => `In ${formatPeriodLabel(s.year, s.month)}, ${s.count} employees have the ID "${s.id}".`)
                  .join(' ')}{' '}
                Their figures are added together in one row here. Give each employee their own ID in the Employee Table.
              </span>
            </div>
          )}
          <TotalsTable
            identityFields={identityFields}
            idFieldKey={idFieldKey}
            effectiveColumns={effectiveColumns}
            employees={employees}
            computedGrid={computedGrid}
          />
        </>
      )}
    </div>
  )
}
