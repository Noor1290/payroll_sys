# Known issues

Found during the visual redesign (October 2026) and deliberately **not fixed** on the
`redesign` branch, which changes appearance only. Each one needs its own decision.
All evidence below uses the fake data in `tests/safetyNet/fixture.js`.

## 1. A total can differ by 0.01 from the sum of the figures shown beside it

**What happens.** Each column is rounded only for display. Formulas that add other
columns use the unrounded values, so a total can disagree by a cent with the sum of
the rounded figures on the same row. The Excel export, "Export for PDF fill" and
"Send to dashboard" carry the same figures as the screen.

**Evidence.** Fake employee F001 (October 2026): emoluments 20,115.

| Column | Unrounded | Shown and exported |
|---|---|---|
| CSG (1.5%) | 301.725 | 301.72 |
| NSF (1%) | 201.15 | 201.15 |
| PAYE | 0 | 0 |
| Total deductions (`csg + nsf + paye`) | 502.875 | **502.88** |

301.72 + 201.15 + 0 = 502.87, but Total deductions shows 502.88. Recorded in
`tests/safetyNet/expected/calculated-figures.json` and `send-to-dashboard-message.json`.

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
