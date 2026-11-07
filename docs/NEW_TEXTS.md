# On-screen texts waiting for the owner's approval

Branch `cleanup`, Stage 2 of the big cleanup (November 2026). Each line says where the text is, what it said before and what it says now. Once approved, the entries are added to `tests/textCheck/approved.json` (where the text check sees them) and removed here.

| Item | Where | Before | Now |
|---|---|---|---|
| Known issue 9 | Column list, under the name of a Tiered column still saved with the old rule | (no note for this case) | Figures use the old rule, which let a wider tier win over an 'Equal to' tier. Open and save this column to apply the corrected rule. Its figures will change. |
| C2 | The name of a downloaded Excel file, one month | `TEST Co A-payroll.xlsx` (values or formulas alike) | `TEST Co A - Payroll 2026-09 (values).xlsx` / `TEST Co A - Payroll 2026-09 (formulas).xlsx` |
| C2 | The same, a Totals export | `TEST Co A  Totals January 2026 to March 2026-payroll.xlsx` | `TEST Co A - Totals 2026-01 to 2026-03.xlsx` |
