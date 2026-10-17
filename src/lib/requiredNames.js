// The column names the Payroll Hub dashboard and the payslip app look for in what this app sends
// ("Send to dashboard") and exports ("Export for PDF fill"). One list, kept in step with the
// dashboard's own (payroll_hub src/config/payrollFields.ts) and the payslip app's (payslip
// src/lib/payrollFile.ts and src/lib/template.ts) by tests/audit/requiredNames.test.js.
// Rehearsal fix F4 (17 Oct 2026, problem H1; REPORT.md section 6.1).
//
//   dashboard: "Save to database" refuses a month without it.
//   payslip:   the payslip app needs it (the employee's name and NIC, its CSG and NSF lines, the
//              three totals it checks against).
// Company Name and BRN are required too, but this app always sends them from the company's details.
export const REQUIRED_NAMES = [
  { name: 'ID', dashboard: true, payslip: true },
  { name: 'Surname', dashboard: true, payslip: true },
  { name: 'Basic Salary', dashboard: true },
  { name: 'Govt Increment', dashboard: true },
  { name: 'New Basic Salary', dashboard: true },
  { name: 'Allowances', dashboard: true },
  { name: 'Emoluments', dashboard: true },
  { name: 'Travelling', dashboard: true },
  { name: 'Gross Pay', dashboard: true, payslip: true },
  { name: 'Age 60+', dashboard: true },
  { name: 'CSG', dashboard: true },
  { name: 'NSF', dashboard: true },
  { name: 'PAYE', dashboard: true },
  { name: 'Employee CSG', payslip: true },
  { name: 'Employee NSF', payslip: true },
  { name: 'Total deductions', dashboard: true, payslip: true },
  { name: 'Net Pay', dashboard: true, payslip: true },
  { name: 'Levy', dashboard: true },
  { name: 'PRGF', dashboard: true },
  { name: 'Total MRA contributions', dashboard: true },
  { name: 'EDF', dashboard: true },
  { name: 'EDF (monthly)', dashboard: true },
  { name: 'Total', dashboard: true },
]

const loose = (name) => String(name).trim().replace(/\s+/g, ' ').toLowerCase()

// Which required names the exported names (column headers / JSON keys, as "Export for PDF fill"
// names them) lack. Returns [{ name, dashboard, payslip, kind, found }], in list order:
//   kind 'capitals': a name that differs only in capitals or spaces, e.g. "Total Deductions";
//   kind 'shared':   two columns have the name, so both are exported with their category,
//                    e.g. "PAYE (Employee Contribution)" and "PAYE (Other Deductions)";
//   kind 'missing':  nothing like it.
export function checkRequiredNames(exportedNames) {
  const names = [...new Set(exportedNames)]
  const problems = []
  for (const required of REQUIRED_NAMES) {
    if (names.includes(required.name)) continue
    const close = names.filter((n) => loose(n) === loose(required.name))
    const shared = names.filter((n) => loose(n).startsWith(`${loose(required.name)} (`) && n.endsWith(')'))
    if (close.length > 0) problems.push({ ...required, kind: 'capitals', found: close })
    else if (shared.length > 1) problems.push({ ...required, kind: 'shared', found: shared })
    else problems.push({ ...required, kind: 'missing', found: [] })
  }
  return problems
}

// "the dashboard", "the payslip app" or "both", for the warning.
export function whoNeeds(problem) {
  return problem.dashboard && problem.payslip ? 'both' : problem.dashboard ? 'the dashboard' : 'the payslip app'
}
