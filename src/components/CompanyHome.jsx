import { useId } from 'react'
import { ArrowLeft, ChevronRight, CircleAlert, LayoutGrid, LoaderCircle, Plus } from 'lucide-react'
import { hueOf, initialsOf } from '../lib/companyLook'
import { formatPeriodLabel, parsePeriodKey } from '../lib/periods'

// "Your companies": the app's main page inside the dashboard (company-list,
// the dashboard's migration 0024). A card for each company on the Payroll
// list; a card opens that company, in the month chosen here. The same look as
// the main pages of Payslip and MRA Returns.

// The circle with the company's initials, in the same colour as in the dashboard.
export function Avatar({ name, hueKey }) {
  const hue = hueOf(hueKey)
  const style = {
    color: `oklch(var(--avatar-fg-l) 0.13 ${hue})`,
    background: `oklch(0.7 0.13 ${hue} / var(--avatar-bg-a))`,
    boxShadow: `inset 0 0 0 1px oklch(0.7 0.13 ${hue} / 0.35)`,
  }
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {initialsOf(name)}
    </span>
  )
}

//   companies  the companies on the Payroll list, by name: [{ company_id, brn, name }]
//   loading    the list is still being read
//   canChoose  the user is an admin of at least one company (only admins choose the list)
//   months     ["YYYY-MM", ...]; period: the one chosen
//   opening    the company_id of the card being opened, or null
//   problem    a sentence: reading the list, or opening a company or the picker, went wrong
//   onRetry    reads the list again, when that is what failed
//   extra      the company selected in the dashboard when it is not on the Payroll list:
//              { company, onAdd } (onAdd null when not an admin), or null. One more card,
//              first, marked "Not on the list"; Add opens the picker.
export default function CompanyHome({ companies, loading, canChoose, months, period, onPeriod, opening, onOpen, onChoose, problem, onRetry, extra = null }) {
  const monthId = useId()
  const empty = !loading && !problem && companies.length === 0

  function card(company, offList) {
    const busy = opening === company.company_id
    return (
      <button
        type="button"
        className="company-card"
        aria-busy={busy || undefined}
        disabled={opening !== null && !busy}
        onClick={() => onOpen(company)}
      >
        <Avatar name={company.name} hueKey={company.brn || company.company_id} />
        <span className="company-text">
          <span className="company-name">{company.name}</span>
          <span className="company-brn">{company.brn}</span>
          {offList && (
            <span className="company-tags">
              <span className="company-tag warn">Not on the list</span>
            </span>
          )}
        </span>
        {busy ? <LoaderCircle className="go motion-safe:animate-spin" aria-hidden="true" /> : <ChevronRight className="go" aria-hidden="true" />}
      </button>
    )
  }
  return (
    <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-8">
      <section className="home rise-in" aria-labelledby="home-title" data-testid="company-home">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 id="home-title" className="home-title">
            Your companies
          </h1>
          <label htmlFor={monthId} className="sr-only">
            Month
          </label>
          <select id={monthId} className="month-pill" value={period} onChange={(event) => onPeriod(event.target.value)}>
            {months.map((month) => {
              const { year, month: m } = parsePeriodKey(month)
              return (
                <option key={month} value={month}>
                  {formatPeriodLabel(year, m)}
                </option>
              )
            })}
          </select>
          {!empty && (
            <button type="button" className="btn btn-secondary btn-sm ml-auto" onClick={onChoose} disabled={loading}>
              <LayoutGrid aria-hidden="true" />
              Choose companies
            </button>
          )}
        </div>

        {problem && (
          <div role="alert" className="panel panel-danger text-sm" data-testid="home-problem">
            <CircleAlert aria-hidden="true" />
            <span className="flex-1">{problem}</span>
            {onRetry && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
                Try again
              </button>
            )}
          </div>
        )}

        {loading && (
          <div role="status" className="company-grid">
            <span className="sr-only">Loading</span>
            {[0, 1, 2].map((n) => (
              <div key={n} className="company-skeleton" />
            ))}
          </div>
        )}

        {empty && (
          <div className="company-empty" data-testid="no-companies">
            <span className="icon-tile icon-tile-round" aria-hidden="true">
              <LayoutGrid />
            </span>
            <h2>No companies yet</h2>
            {canChoose ? (
              <button type="button" className="btn btn-primary" onClick={onChoose}>
                <LayoutGrid aria-hidden="true" />
                Choose companies
              </button>
            ) : (
              <p className="m-0 text-sm text-muted">An admin can choose them.</p>
            )}
          </div>
        )}

        {!loading && (companies.length > 0 || extra) && (
          <ul className="company-grid" aria-label="Your companies">
            {extra && (
              <li key={extra.company.company_id} className="company-extra" data-testid="extra-card">
                {card(extra.company, true)}
                {extra.onAdd && (
                  <button type="button" className="btn btn-ghost btn-sm company-add" onClick={extra.onAdd} disabled={opening !== null}>
                    <Plus aria-hidden="true" />
                    Add
                  </button>
                )}
              </li>
            )}
            {companies.map((company) => (
              <li key={company.company_id}>{card(company, false)}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

// On a company's screen: the way back to the cards, and, when the company
// selected in the dashboard is not on the Payroll list, "Not on the list"
// with Add for an admin (it opens the picker).
//   home  { onBack, notListed, onAdd } (onAdd null when not an admin)
export function HomeBar({ home }) {
  return (
    <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2" data-testid="home-bar">
      <button type="button" className="btn btn-ghost btn-sm" onClick={home.onBack}>
        <ArrowLeft aria-hidden="true" />
        Your companies
      </button>
      {home.notListed && (
        <>
          <span className="badge badge-warn" data-testid="not-listed">
            Not on the list
          </span>
          {home.onAdd && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={home.onAdd}>
              <Plus aria-hidden="true" />
              Add
            </button>
          )}
        </>
      )}
      {home.problem && (
        <span role="alert" className="text-sm text-danger">
          {home.problem}
        </span>
      )}
    </div>
  )
}
