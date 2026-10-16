# Known issues

Found during the visual redesign (October 2026) and deliberately **not fixed** on the
`redesign` branch, which changes appearance only. Each one needs its own decision.
All evidence below uses the fake data in `tests/safetyNet/fixture.js`.

## 1. A total can differ by 0.01 from the sum of the figures shown beside it

**What happens.** Each column is rounded only for display. Formulas that add other
columns use the unrounded values, so a total can disagree by a cent with the sum of
the rounded figures on the same row. The Excel export, "Export for PDF fill" and
"Send to dashboard" carry the same figures as the screen.

**Evidence.** Fake employee F001 (October 2026): emoluments 20,115, gross pay 21,615.

| Column | Unrounded | Shown and exported |
|---|---|---|
| CSG (1.5%) | 301.725 | 301.73 |
| NSF (1%) | 201.15 | 201.15 |
| PAYE | 0 | 0 |
| Total deductions (`csg + nsf + paye`) | 502.875 | 502.88 |
| Net Pay (`grossPay - totalDeductions`) | 21,112.125 | **21,112.13** |

21,615.00 - 502.88 = 21,112.12, but Net Pay shows 21,112.13. Recorded in
`tests/safetyNet/expected/calculated-figures.json` and `send-to-dashboard-message.json`.

(Example updated 16 October 2026. Since the audit's half-up rounding fix, CSG shows 301.73,
not 301.72, so Total deductions now matches its lines on this row; the cent shows on Net Pay
instead. The rounding policy itself is unchanged.)

**To decide.** Whether each column should be rounded before it is used by other
formulas. That changes calculated figures, so it needs a deliberate decision and a
re-recorded safety-net test.

## 2. Typing in the Employee Table is slow with many employees

**What happens.** Every keystroke in a cell recalculates every formula for every
employee and re-renders every cell in the table.

**Evidence.** Fake employees, 24 columns, typing digits into one Basic Salary cell,
measured from the keystroke until the result was painted (headless Chromium on the
development machine, 4 October 2026). The time grows in step with the number of
employees.

Production build (`npm run build`, `npm run preview`), which is what users get:

| Employees | Time per keystroke |
|---|---|
| 20 | about 0.05 seconds |
| 50 | about 0.12 seconds |
| 100 | about 0.21 seconds |
| 400 | 0.72 to 0.79 seconds |

So typing feels immediate up to about 50 employees, slightly laggy at 100, and
clearly slow at several hundred.

An earlier measurement at 400 employees, taken before the column-width fix below,
was 1.5 to 1.8 seconds on the production build and 3.6 to 4.1 seconds on the
development build (`npm run dev`). The width fix made the browser's table layout
cheaper, which is why the current figure is lower. On the development build the old
and new styling measured the same, so the slowness is not caused by the redesign.
Scrolling the same table was smooth.

**To decide.** Fixing it means changing how the table recalculates and re-renders
(for example only the edited employee's row), which is a code change, not a visual one.

## 3. "Import from Excel" accepts files that are not Excel workbooks

**What happens.** The import reads whatever it is given. A plain text file renamed to
`.xlsx` is read as a one-column sheet and goes on to the column-matching dialog with
no warning. The message "Could not read that file. Please make sure it is a valid
.xlsx file." only appears when the file cannot be parsed at all.

**Evidence.** A text file containing `this is not an Excel file`, named
`not-a-workbook.xlsx`: no error, the import dialog opened. A file starting with the
ZIP signature followed by junk bytes: the error message appeared as expected.

**To decide.** Whether to check that the file really is an `.xlsx` workbook before
reading it.

**Fixed (16 October 2026, backlog batch B).** A file that does not start with the ZIP
signature every `.xlsx` has is refused before it is read, with the same message, and never
reaches the column-matching dialog. Proven by `tests/browser/io.e2e.js` ("a text file renamed
.xlsx gives the same plain message, and never reaches mapping") and `tests/audit/importExport.test.js`.

## 4. Re-saving a Simple formula that has an exemption nests the exemption again

**What happens.** For a column using the Simple builder with an exemption, the stored
formula already includes the exemption. Opening the column and pressing Save wraps it
in the same exemption a second time, and again on every later save. The calculated
value does not change (the outer condition decides first), but the formula text shown
in the column list and written to a Live-Formulas Excel export keeps growing. Tiered,
Compare and Progressive columns are not affected: their formula is rebuilt from the
builder settings on each save.

**Evidence.** Fake column PRGF (Simple formula `emoluments * 0.045`, exemption
"Emoluments > 200,000 or Basic Salary < Allowances, use Travelling"). Opened and saved
with no changes:

- Before: `((emoluments > 200000) || (basicSalary < allowances)) ? (travelling) : (emoluments * 0.045)`
- After: `((emoluments > 200000) || (basicSalary < allowances)) ? (travelling) : (((emoluments > 200000) || (basicSalary < allowances)) ? (travelling) : (emoluments * 0.045))`

Measured on the form before and after its restyle; both behave the same.

**Fixed (14 October 2026).** The form now opens on the formula inside the exemption
(`stripExemptionWrapper` in `src/lib/exemptionCondition.js`), so Save wraps it once. A
formula already wrapped several times is brought back to one wrapper the next time it
is saved; the figures are the same, since the outer condition always decided first.
Inside the dashboard every Save with no change used to be a new revision too: the form
also wrote `excludeFromExport: false` on a column stored without it. It now keeps what
was stored when that was not changed. Proven by `tests/audit/dashboardApp.test.jsx`
("saving a Simple formula with an exemption (known issue 4)"), which fails on the old
form, and `tests/audit/columns.test.js`.

## 5. Export Preview: the title lines can sit off-screen on a wide sheet

**What happens.** In the Export Preview dialog the company name, export date and
company details line are centred over the full width of the sheet. When the sheet is
wider than the dialog, they are out of view until you scroll right, and the top of
the preview looks blank. The downloaded Excel file is not affected.

**Evidence.** The fake company with 24 columns: the preview opens showing an empty
white band above the column headers. Same before and after the redesign.

**To decide.** Whether the preview should keep the title lines in view.

**Fixed (16 October 2026, backlog batch E).** The title lines are as wide as the visible part
of the preview and stay at its left edge while the sheet scrolls. The file is not affected.
Proven by `tests/browser/screens.e2e.js` (known issue 5), which fails on the old preview.

## 6. Narrow width: double-click rename is hard to use

**What happens.** At narrow widths the company list is a drawer that closes when a
company is selected. Double-clicking a company name to rename it selects the company
on the first click, so the drawer closes and the rename box ends up inside the closed
drawer. Renaming works from Company Details and at wide widths.

**Evidence.** At 640px wide: open the drawer and double-click a company name. The
drawer closes; reopening it shows the rename box.

**To decide.** Whether the drawer should stay open when the selected company is
clicked again, or whether renaming at narrow widths should only be offered from
Company Details.

**Fixed (16 October 2026, backlog batch E).** The drawer stays open when the company already
selected is clicked, so a double-click on its name opens the rename box in the open drawer.
Choosing another company still closes the drawer. To rename a company that is not selected,
select it first. Proven by `tests/browser/screens.e2e.js` (known issue 6).

## 7. (Obsolete) Between Phase 2 and Phase 3: a key changed inside the dashboard is not changed in this browser's own copy

**Obsolete (16 October 2026).** The dashboard that is live keeps the months (Phase 3), where this
cannot happen; a dashboard of Phase 2 without Phase 3 is no longer deployed. Kept for the record.

Found while building Phase 2 of the migration (14 October 2026). **Resolved by Phase 3
(15 October 2026)** inside a dashboard that keeps the months: a change of key moves the
values in the dashboard's months, in one step with the column setup that carries the
new key, and this browser's own copy (its setup and its months) is not touched, so it
stays whole. Proven through the real screens by `tests/audit/dashboardMonthsApp.test.jsx`
("known issue 7"): opened on its own afterwards, the app shows the same figures as
before and its stored text is unchanged. It can still happen inside a dashboard that
does not keep months yet (the dashboard of Phase 2 without Phase 3): there the months are
still this browser's, as described below.

**What happens.** Inside the dashboard, changing a column's key (or an identity
field's) moves that column's values in every saved month, as it always has; the months
are still the browser's, so they are moved there. The setup itself is saved to the
dashboard. This browser's own copy of the setup, kept untouched as the fallback (D4),
still has the old key. Opened on its own, the app then looks for the column's values
under the old key and does not find them.

**Example (fake data), worked out from the code, not run as a test.** "TEST Co A",
imported; inside the dashboard the Global column "Basic Salary" is given the key
`basicPay`. The months now hold `basicPay`. Opened on its own, TEST Co A's setup still
names `basicSalary`, so its September 2026 shows Basic Salary empty for TST001 to
TST003, and the figures worked out from it change.

**What would avoid it.** Either do key changes only once the months are in the
dashboard (Phase 3), or, until then, warn in the "Change this field's key?" question
that the browser's own copy will not follow.

## 8. One screen test runs close to the 5-second limit

Found during the backlog fixes (16 October 2026); not part of that work, so not changed.

**What happens.** `tests/audit/dashboardApp.test.jsx`, "opening and saving every column with no
change, of every kind, sends nothing", takes about 4.3 seconds of Vitest's 5-second limit per test.

**Evidence.** Run on its own: 4.3 s on the code before the backlog fixes, 4.3 to 4.7 s after. In
one full `npm test` run on a busy machine it stopped at 5.03 s ("Test timed out in 5000ms"); run
again, alone and in full, it passed.

**Risk.** A red run that says nothing about the code, as with the dashboard's own slow tests
(payroll_hub known issues 1 and 2).

**To decide.** If it times out again, make the test faster (for example fewer columns opened per
run, or a shorter save delay under test). Do not raise the limit, and do not cut what it checks.

## 9. An "Equal to" tier can be shadowed by a "Below" tier with a higher threshold

Found while fixing audit M1 (16 October 2026); not part of that fix, so not changed.

**What happens.** Tiers are tried highest threshold first. A "Below" tier holds for every figure
under its threshold, so an "Equal to" tier at a lower threshold is never reached.

**Evidence.** Fake rule "Equal to 30,000 at 4%" + "Below 50,000 at 3%": exactly 30,000 gets 3%
(900.00), not 4% (1,200.00). Recorded as a marked failing test in
`tests/audit/formulaEngine.test.js` ("BUG: "Equal to 30,000 at 4%" next to "Below 50,000 at 3%"
gives 4% for exactly 30,000"); it passes only while the bug is there.

**To decide.** Whether an "Equal to" tier should always win over a "Below" or "Above" tier that
also holds for its figure. Fixing it changes figures for any column with that shape, so it needs
the same treatment as M1 (fixed on save, flagged until then).

## Possible later feature: on-screen grand total

The Totals screen shows one row per employee and no grand-total row; only the Excel
export has a TOTAL row. If a grand total is added on screen, it should reuse the
export's TOTAL row calculation so the two always match, bearing in mind the rounding
difference in issue 1.

## Fixed during the redesign

**Column widths in the Employee Table were not honoured.** The ID column was declared
140px wide but rendered at about 86px, cutting off longer values. Fixed as a
styling-only change (the table now has an explicit width, so the browser applies each
column's width). The Excel export's own column widths are computed separately and
were not changed.
