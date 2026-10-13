const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// What a backup file, or this browser, holds. One line per company: its name, how many months, which ones, how many employee rows.
export default function BackupHoldings({ summary }) {
  if (summary.companies.length === 0 && summary.monthCount === 0 && summary.unreadableCount === 0) {
    return <p className="text-sm text-subtle">No companies and no months.</p>
  }
  return (
    <ul className="space-y-1 text-sm text-fg">
      {summary.companies.map((c) => (
        <li key={c.id} className="flex flex-wrap justify-between gap-x-3">
          <span className="min-w-0 wrap-break-word font-medium">{c.name}</span>
          <span className="text-muted">
            {c.months === 0 ? 'no months' : `${plural(c.months, 'month')} (${c.range}), ${plural(c.rows, 'employee row')}`}
          </span>
        </li>
      ))}
      {summary.otherMonths > 0 && (
        <li className="text-muted">{plural(summary.otherMonths, 'month')} of a company that is no longer in the list</li>
      )}
      {summary.unreadableCount > 0 && (
        <li className="text-muted">{plural(summary.unreadableCount, 'item')} that could not be read, kept as it is</li>
      )}
      <li className="text-muted">{plural(summary.globalColumnCount, 'Global column')}</li>
    </ul>
  )
}
