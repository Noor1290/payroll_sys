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

## Checks

| Command | What it checks |
|---|---|
| `npm test` | The safety-net recordings (`tests/safetyNet`) and the audit unit tests (`tests/audit`): formula engine, columns, months, import and export |
| `npm run test:browser` | The real app driven in a throwaway Chromium profile (`tests/browser`); about 5 minutes. Never touches the data in your own browser |
| `npm run lint` | oxlint |
| `npm run build` | The production build |

A recording in `tests/safetyNet/expected/` is rewritten only on purpose: `npm run test:record`, then read the difference before keeping it.

In `tests/audit`, a test marked `test.fails` records a known bug that is not fixed yet: it states what should happen and passes only while the app still gets it wrong.

Things found and not changed are in [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md).
