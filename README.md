# Payroll

The payroll calculation app of the payroll system: companies, columns and formulas, one table of employees per month, and exports (Excel, and CSV / JSON for the PDF form filler, the payslip app and the Payroll Hub dashboard). Everything runs in the browser; data is kept in the browser's own storage for this address.

## Run it

```
npm install
npm run dev        # http://localhost:5174/
```

## Ports

Each app of the payroll system has its own fixed local port and refuses to start on any other (`strictPort` in its `vite.config`). A browser keeps saved data per address **including the port**, so an app that quietly moved to another port would open with none of its data. With fixed ports that cannot happen: if the port is taken, the app says so instead of starting somewhere else.

| App | Folder | Local address |
|---|---|---|
| PDF form filler | `PDF Editor` | http://localhost:5173/pdf-form-filler/ |
| Payroll (this app) | `Payroll_sys` | http://localhost:5174/ |
| Payslip | `payslip` | http://localhost:5175/payslip/ |
| Payroll Hub dashboard | `payroll_hub` | http://localhost:5176/payroll-hub/ |

If an app ever opens empty, check the address bar first: the data is still there under the port it was saved on.

## Backup

Everything the app holds is in this browser only. At the foot of the company list:

- **Back up** saves one file, `payroll-backup-YYYY-MM-DD.json`, with the setup (identity fields, Global columns), every company with its columns and details, and every saved month of every company, exactly as stored. The theme is not in it.
- **Restore** puts such a file back. It first shows what is in the file and what is in the browser now, and replaces nothing until "Replace with this backup" is chosen. Restoring replaces everything the app keeps in this browser; it is all or nothing, so a restore the browser refuses (storage full) leaves what was there.

- **Clear this browser's data…** starts afresh. It is there only when the app is opened on its own, never inside the dashboard. It first downloads a Back up file; nothing can be cleared until it has. Then "Clear columns only" (the identity fields, the Global columns and every company's columns; companies, their details and the months stay) or "Clear everything" (also every company and every month, and the dashboard's offline copy, which the dashboard makes again), confirmed by typing CLEAR. Only this app's keys are removed (listed in `src/lib/storage.js`); the copies of data that could not be read (`payroll_app_state_v1_unreadable_*`), the theme and other apps' data are always kept. "Restore" with the downloaded file brings back what was cleared.

A backup file holds real payroll figures: keep it where the payroll itself is kept, and never in this repository.

## Dates

An Input column, or an identity field, can be a **Date** (`src/lib/dates.js`). It is typed and shown day first, DD/MM/YYYY, with a calendar to pick from, and saved as YYYY-MM-DD. Only a real date is accepted: anything else (31/02/2026, 13/13/2020, words) is refused in the cell, nothing is saved, and the table says why. A value saved as text before the field became a Date is read the same way, so "01/08/2026" is that date; one that is not a clear date is shown as it was saved, in red, and kept.

- **Import from Excel** takes a real Excel date cell (its serial number, e.g. 46235 for 01/08/2026), DD/MM/YYYY text or YYYY-MM-DD text. Anything else is not imported (a date already saved is kept) and is listed in the preview and in the summary.
- **Exports:** Excel (values and live formulas) writes a real Excel date shown DD/MM/YYYY; "Export for PDF fill" writes DD/MM/YYYY; "Send to dashboard" sends YYYY-MM-DD.
- **A field that is not a Date becoming one** (in the column form or the identity field form): its saved months are read first, and the form says how many values are dates and lists, by month and row (never a name or a value), the ones that can't be read. "Make it a Date" changes the setup only: no saved value is rewritten (a date is written YYYY-MM-DD the next time its cell is changed), and the ones that can't be read stay exactly as they are, in red, until corrected. Inside the dashboard it is one new revision of the column setup, which History > Restore undoes; the months can only be read while the dashboard is unlocked.
- **Move to identity fields** (a Global Text or Date column, in its row): it becomes an identity field with the same key, so no saved value moves or changes; only the setup does, in one save (inside the dashboard, one revision that History > Restore undoes). It shows first the name and type it will have, how many months hold a value, and, as a Date, the saved values that are not clear dates. Refused while a formula uses the column. An identity field is always in the Excel exports.
- A date is never added up (Totals and the totals row show the first month's, like a text column), and never used in a formula: the column form says so, and a column a formula uses cannot become a Date. The ID field is always text.

## Where the data is read and saved

Screens never touch the browser's storage themselves. They call the operations in `src/lib/dataStore.js`, and a store carries them out. Opened on its own, the store is the browser (`src/lib/storage.js`), so the app behaves as it always has. Inside the Payroll Hub dashboard it is the dashboard (`src/lib/dashboardSetup.js` for the column setup, `src/lib/dashboardMonths.js` for the months, behind the dashboard's password gate); see `docs/MIGRATION_PLAN.md` in the payroll_hub repository. `tests/audit/dataStore.test.jsx` fails if a screen reaches past the interface.

Inside the dashboard:

- **History.** "History of the Global columns", "History of the columns of [company]" and, on the Employee Table, "History of this month" list every saved revision, newest first, with the date, the time and who saved it. Looking at one changes nothing. "Restore this version" asks first and saves it as a NEW revision; nothing earlier is rewritten or deleted. Before a column setup is restored, the dialog names the keys and formulas that change, and works out again the months saved with a later revision, naming any whose figures would not be the same (this needs the dashboard unlocked). Only someone who may change it is offered Restore; a month's History needs the dashboard unlocked and hides everything when it locks.
- **Clear the column setup…** (in the company list) removes the Global columns and the selected company's own columns in one save (the identity fields are kept: they are not in an Export Column Setup file): one new revision of each with no columns. It first downloads the two "Export Column Setup" files, then asks for CLEAR. Nothing is deleted: no month, no earlier revision; History > Restore brings the previous setup back. Only for an admin of every company using the Global columns (otherwise disabled, with the reason). There is no "Clear everything" here: a company is deleted in the dashboard.
- **Offline copy.** Each time the column setup is loaded from the dashboard, this browser keeps that copy, one per company (`payroll_dashboard_offline_v1`: the shared and the company's columns, formulas and custom details, never a month, salary or national ID). When the dashboard cannot be reached, it is offered as "Offline: read-only copy from [date and time]. Changes can't be saved." Nothing in it can be changed, and the Employee Table and Totals say the months are not in it.

## Checks

| Command | What it checks |
|---|---|
| `npm test` | The safety-net recordings (`tests/safetyNet`) and the audit unit tests (`tests/audit`): formula engine, columns, months, import and export, the backup file, the storage interface, and the bridge's `activity` message |
| `npm run test:browser` | The real app driven in a throwaway Chromium profile (`tests/browser`); about 5 minutes. Never touches the data in your own browser |
| `npm run lint` | oxlint |
| `npm run build` | The production build |

A recording in `tests/safetyNet/expected/` is rewritten only on purpose: `npm run test:record`, then read the difference before keeping it.

In `tests/audit`, a test marked `test.fails` records a known bug that is not fixed yet: it states what should happen and passes only while the app still gets it wrong.

Things found and not changed are in [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md).
