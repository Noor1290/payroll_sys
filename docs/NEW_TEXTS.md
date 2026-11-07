# On-screen texts waiting for the owner's approval

Branch `cleanup`, Stage 2 of the big cleanup (November 2026). Each line says where the text is, what it said before and what it says now. Once approved, the entries are added to `tests/textCheck/approved.json` (where the text check sees them) and removed here.

| Item | Where | Before | Now |
|---|---|---|---|
| Known issue 9 | Column list, under the name of a Tiered column still saved with the old rule | (no note for this case) | Figures use the old rule, which let a wider tier win over an 'Equal to' tier. Open and save this column to apply the corrected rule. Its figures will change. |
| C2 | The name of a downloaded Excel file, one month | `TEST Co A-payroll.xlsx` (values or formulas alike) | `TEST Co A - Payroll 2026-09 (values).xlsx` / `TEST Co A - Payroll 2026-09 (formulas).xlsx` |
| C2 | The same, a Totals export | `TEST Co A  Totals January 2026 to March 2026-payroll.xlsx` | `TEST Co A - Totals 2026-01 to 2026-03.xlsx` |
| C3 | "Send to dashboard", the question before sending (new note), when a figure is below 0 | (nothing) | **Negative figures** / `Basic Salary: TST001 Alpha (-500.00).` (one line per column, at most 5 names, then "and N more") / Check that they are meant, or send anyway. |
| C3 | The same, when a required input (a column with one of the required names) is empty | (nothing) | **Required figures left empty** / `Basic Salary: TST002 Beta.` / An empty cell counts as 0. Fill them in, or send anyway. |
| C6 | Tier builder, the operator of a tier (new choice, after "Below") | Below / Equal to / Above / From | Below / **At or below** / Equal to / Above / From |
| C6 | Rule summary and breakdown, an "At or below" tier | (new) | `If Basic Salary is 50,000 or below, apply 3%.` / `This is 50,000.00 or below → rate: 3%.` |
| C6 | Breakdown, a figure no tier holds for (a rule with two tiers or more) | `Basic Salary: 50,000.00. 50,000.00 × 0% = 0.00.` | `Basic Salary: 50,000.00. This matches no tier → rate: 0%. 50,000.00 × 0% = 0.00.` |
| C6 | Employee Table, a figure on a threshold no tier covers (the case the rule summary already warns about): the cell is amber with a warning sign; its tooltip, and the screen-reader text | "Click to see calculation breakdown" | "Matches no tier, so the rate is 0%. Click to see calculation breakdown" / (screen reader) "Matches no tier, so the rate is 0%." |
| C15 | Copy from Previous Month, opening | nothing ticked ("Copy 0 Employees") | every employee ticked; every column ticked too when this month is empty (nothing to overwrite), none when it has employees |
| C15 | Copy from Previous Month, "Columns to copy" (new buttons, the same words as the employees' ones) | (none) | **Select All** / **Clear All** (screen reader: "Select all columns" / "Clear all columns") |
| C15 | Copy from Previous Month, the preview | ID, Name and Surname blank | ID, Name and Surname shown |
