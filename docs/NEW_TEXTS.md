# On-screen texts waiting for the owner's approval

## Stage 4 (9 November 2026): C17, the column list in plain sentences

No new wording. The **Formula** column of the Global and Company Columns lists now shows, for a column made with the Tiered, Compare or Progressive builder, the same sentence the column form already shows as its rule summary. Examples (TEST columns):

| Column | Before | Now |
|---|---|---|
| Employee CSG (Tiered) | `(Basic Salary) * (Basic Salary <= 50000 ? 0.015 : Basic Salary > 50000 ? 0.03 : 0)` | If Basic Salary is 50,000 or below, apply 1.5%. If Basic Salary is above 50,000, apply 3%. |
| Employee NSF (Tiered, Age 60+ exemption) | `((Age 60+ === 1)) ? (0) : (...)` | If "Age 60+" is ticked, this amount is 0. Otherwise: (the tier sentence, with its cap) |
| A typed formula with an exemption | `((Age 60+ === 1)) ? (0) : (Basic Salary * 0.1)` | If "Age 60+" is ticked, this amount is 0. Otherwise: Basic Salary * 0.1 |

Unchanged: a formula typed by hand with no exemption is still shown as the formula (`Basic Salary * 2`); a Tiered column still on an old rule (flagged) still shows its formula, because the sentence would describe today's rule, not the figures it gives.

### What the text check found (9 November 2026): 14 differences, all from C17

`node scripts/text-check.mjs` lists 7 sentences now shown in the column list, each already the form's own rule summary, and the 7 code lines they replace (gone from the list). To be added to `tests/textCheck/approved.json` once approved.

Shown now:
1. First 30,000 taxed at 0%. Next 20,000 (30,000–50,000) taxed at 10%. Remainder above 50,000 taxed at 20%.
2. If "Age 60+" is ticked, this amount is 0. Otherwise: 1% of Emoluments, up to a maximum of 29,710.
3. If "Emoluments" is greater than 200,000 or "Basic Salary" is less than "Allowances", this amount is the value of "Travelling". Otherwise: Emoluments * 0.045
4. If EDF (monthly) is greater than Emoluments, use 0. Otherwise, use Emoluments − EDF (monthly).
5. If Emoluments is below 20,000, apply 0%. If Emoluments is above 20,000, apply 1.5%. If Emoluments is equal to 50,000, apply 2%. Where "above 20,000" and "equal to 50,000" both hold, "equal to 50,000" applies. Exactly 20,000 matches no tier, so the rate there is 0%. Capped at a maximum Emoluments value of 100,000.
6. If Emoluments is below 29,710, apply 1%. Capped at a maximum Emoluments value of 29,710.
7. If Emoluments is below 50,000, apply 1.5%. If Emoluments is 50,000 or above, apply 3%.

Gone from the list (the code each replaced): `((Age 60+ === 1)) ? (0) : ((Math.min(Emoluments, 29710)) * (0.01))`, `((Emoluments > 200000) || (Basic Salary < Allowances)) ? (Travelling) : (Emoluments * 0.045)`, `(EDF (monthly) > Emoluments) ? (0) : (Emoluments - EDF (monthly))`, `(Emoluments) * (Emoluments < 50000 ? 0.015 : Emoluments >= 50000 ? 0.03 : 0)`, the PAYE `Math.max(...)` line, `(Math.min(Emoluments, 100000)) * (Emoluments === 50000 ? 0.02 : ...)`, `(Math.min(Emoluments, 29710)) * (Emoluments < 29710 ? 0.01 : 0)`.
