# Big cleanup: approved on-screen texts

## Stage 2 (approved 7 November 2026)

Branch `cleanup`. Each line says where the text is, what it said before and what it says now. The on-screen texts the text check records are also in `tests/textCheck/approved.json`; the rest (file names, the delete question, breakdown lines, the CSV mark) are not recorded by it and are approved here.

| Item | Where | Before | Now |
|---|---|---|---|
| Known issue 9 | Column list, under the name of a Tiered column still saved with the old rule | (no note for this case) | Figures use the old rule, which let a wider tier win over an 'Equal to' tier. Open and save this column to apply the corrected rule. Its figures will change. |
| C2 | The name of a downloaded Excel file, one month | `TEST Co A-payroll.xlsx` (values or formulas alike) | `TEST Co A - Payroll 2026-09 (values).xlsx` / `TEST Co A - Payroll 2026-09 (formulas).xlsx` |
| C2 | The same, a Totals export | `TEST Co A  Totals January 2026 to March 2026-payroll.xlsx` | `TEST Co A - Totals 2026-01 to 2026-03.xlsx` |
| C3 | "Send to dashboard", the question before sending (new note), when a figure is below 0 | (nothing) | **Negative figures** / `Basic Salary: TST001 Alpha (-500.00).` (one line per column, at most 5 names, then "and N more") / Check that they are meant, or send anyway. |
| C3 | The same, when Basic Salary is empty (owner's choice: Basic Salary only; other empty inputs get no note) | (nothing) | **Required figures left empty** / `Basic Salary: TST002 Beta.` / An empty cell counts as 0. Fill them in, or send anyway. |
| C6 | Tier builder, the operator of a tier (new choice, after "Below") | Below / Equal to / Above / From | Below / **At or below** / Equal to / Above / From |
| C6 | Rule summary and breakdown, an "At or below" tier | (new) | `If Basic Salary is 50,000 or below, apply 3%.` / `This is 50,000.00 or below → rate: 3%.` |
| C6 | Breakdown, a figure no tier holds for (a rule with two tiers or more) | `Basic Salary: 50,000.00. 50,000.00 × 0% = 0.00.` | `Basic Salary: 50,000.00. This matches no tier → rate: 0%. 50,000.00 × 0% = 0.00.` |
| C6 | Employee Table, a figure on a threshold no tier covers (the case the rule summary already warns about): the cell is amber with a warning sign; its tooltip, and the screen-reader text | "Click to see calculation breakdown" | "Matches no tier, so the rate is 0%. Click to see calculation breakdown" / (screen reader) "Matches no tier, so the rate is 0%." |
| C15 | Copy from Previous Month, opening | nothing ticked ("Copy 0 Employees") | every employee ticked; every column ticked too when this month is empty (nothing to overwrite), none when it has employees |
| C15 | Copy from Previous Month, "Columns to copy" (new buttons, the same words as the employees' ones) | (none) | **Select All** / **Clear All** (screen reader: "Select all columns" / "Clear all columns") |
| C15 | Copy from Previous Month, the preview | ID, Name and Surname blank | ID, Name and Surname shown |
| C18 | Edit identity field, under Key, while the name is changed and the key is not | (nothing) | Renaming keeps the key "surname", so the saved values stay where they are. Change the key too only if you want it to match the new name. |
| C19 | Column lists (Global and Company Columns), beside the drag handle of each column (new buttons) | (drag only) | Up and down arrow buttons; tooltip "Move up" / "Move down"; screen reader "Move Basic Salary up" / "Move Basic Salary down" |
| C21 | Delete column question, a column whose name another column also has | Delete column "CSG"? Any formulas referencing "csg" will break. | Delete column "CSG (Employee Contribution)"? Any formulas referencing "csg" will break. It is used by Total deductions. |
| C21 | The same, any column used by a formula (new last sentence) | (nothing) | It is used by CSG (Employee Contribution), CSG (Employer Contribution). |
| C21 | Tier rule summary, two tiers that both hold for some figure at different rates (new sentence, one per pair) | (nothing) | Where "0 or above" and "above 50,000" both hold, "above 50,000" applies. |
| C21 | Export for PDF fill (CSV): the file starts with a byte order mark | (no mark) | (not visible; accents now show right in Excel) |
| C12 | Employee Table and Totals, the tooltip of the "not exported" badge | Not included in Excel exports or payslips | Not included in Excel exports. Export for PDF fill and Send to dashboard still include it. |
| C12 | Column form, the hint under "Include in Excel export" when unticked | Stays hidden from the Export Preview, the visible spreadsheet, and payslips - it still shows in the app's Employee Table, marked as not exported. If a Live-Formula export ... | Stays hidden from the Export Preview and the visible spreadsheet - it still shows in the app's Employee Table, marked as not exported, and Export for PDF fill and Send to dashboard still include it. If a Live-Formula export ... (the rest unchanged) |
