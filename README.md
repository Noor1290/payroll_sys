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

A backup file holds real payroll figures: keep it where the payroll itself is kept, and never in this repository.

## Where the data is read and saved

Screens never touch the browser's storage themselves. They call the operations in `src/lib/dataStore.js`, and a store carries them out. Today the only store is the browser (`src/lib/storage.js`), so the app behaves as it always has. Saving through the Payroll Hub dashboard (see `docs/MIGRATION_PLAN.md` in the payroll_hub repository) will be a second store with the same operations. `tests/audit/dataStore.test.jsx` fails if a screen reaches past the interface.

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
