# On-screen texts waiting for the owner's approval

Four changes, Stage 2 (branch `four-changes`). Once approved they go into `tests/textCheck/approved.json`; until then the text check lists them as not approved. `{…}` is filled in by the app.

## Part 2: Automatic copy on by default

| # | Where | Text |
|---|---|---|
| A1 | The button, for a company that never chose | Automatic copy: On (default) |
| A2 | Added to the end of the banner after a copy made by the default | Automatic copy is on by default for this company; change it with the Automatic copy button. |
| A3 | Setting window, under the columns, while the company never chose | These are the default columns: every input column except those whose name contains bonus, allowance, overtime, increment, arrears, commission or leave. Save to keep your own choice. |

Unchanged: "Automatic copy: On", "Automatic copy: Off", the banner's first sentence ("Copied {n} employees from {month} ({columns}).") and Undo.

## Part 3: Copy this month to…

| # | Where | Text |
|---|---|---|
| C1 | Button next to Copy from Previous Month | Copy this month to… |
| C2 | Its tooltip when the month is empty | This month has no employees. |
| C3 | Its tooltip for someone who is not an admin (existing wording) | Only an admin of this company can change this. |
| C4 | Window title | Copy {November 2026} to other months |
| C5 | Choices | One month / A range of months |
| C6 | Field names | Month (one month); From, To (a range) |
| C7 | Under the fields when the choice can't be used | Choose a month. / Choose a month other than this one. / Choose at most 24 months. |
| C8 | Columns heading, buttons (existing wording) | Columns to copy; Tick all; Untick all |
| C9 | Under the columns | The identity fields are always copied. Calculated columns are worked out as usual. |
| C10 | Buttons | Cancel; Next; while waiting: Checking the months… |
| C11 | Preview, per month | Will be added ({6 employees}) / Saved already ({2 employees}) with Skip / Replace / Approved: never changed |
| C12 | Preview, per saved month, on its own (no dashboard) | Saved already: skipped |
| C13 | Preview, summary | {6 employees} into {1 month}. {1 month} skipped, {1 approved month} left as it is. |
| C14 | Preview, on its own, when a month is skipped | On its own, this app never replaces a saved month: there is no History here to bring it back. |
| C15 | Preview, inside the dashboard, while the month on screen is still being saved | Waiting for this month to be saved… |
| C16 | Preview buttons | Back; Copy to {3 months}; with replacements: Replace {2 months} and copy; while saving: Copying… |
| C17 | Second confirmation (only with Replace) | Title: Replace {December 2026 and January 2027}? Message: What is saved there now is kept in History, and Restore brings it back. Buttons: Cancel / Replace and copy |
| C18 | At the end | Copied to {3 months}; {1} skipped. Then: Close |
| C19 | At the end, on its own, if the browser refused a month | {January 2027} could not be saved in this browser. |
| C20 | When the dashboard refuses (nothing is saved) | Nothing was copied. {the dashboard's own message, e.g. "The month 2026-12 has an approved run in the dashboard, so it is never replaced. Nothing of this company was saved."} |
| C21 | When the dashboard check can't be used | This company has no column setup in the dashboard yet. / Only an admin of this company can do this. |
| C22 | Screen-reader names | Months (the month choice); The months (the preview list) |
