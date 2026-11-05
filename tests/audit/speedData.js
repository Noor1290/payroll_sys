// The two TEST companies of the speed check (Payroll\SPEED_CHECK): TEST Co 20 and TEST Co 200,
// 12 months each (Dec 2025 to Nov 2026), with the 22 columns of a real setup: the audit's TEST
// column set (simple, tiered with the NSF 29,710 ceiling, progressive PAYE, compare, an
// exemption) and PRGF 4.5%, employer NSF, a levy, overtime, transport and total deductions.
// Made-up figures from a fixed seed, so every run has the same ones. TEST data only.

import { EMPLOYER, identityFields, idFieldKey, input, simple, testColumns, tiered } from './build'

export { identityFields, idFieldKey }

export function speedColumns() {
  return [
    ...testColumns(),
    input('Overtime', 'overtime'),
    input('Transport', 'transport'),
    simple('PRGF', 'prgf', 'emoluments * 0.045', { category: EMPLOYER }),
    tiered('NSF', 'nsf_employer', { baseKey: 'newBasic', tiers: [{ operator: 'from', threshold: 0, rate: 2.5 }], cap: 29710 }, { category: EMPLOYER }),
    simple('Training Levy', 'levy', 'newBasic * 0.015', { category: EMPLOYER }),
    simple('Total Deductions', 'totalDeductions', 'csg + nsf + paye'),
  ]
}

export const SPEED_MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Date.UTC(2025, 11 + i, 1))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
})

/** { year, month, employees } for each of the 12 months of a TEST company of `count` employees. */
export function speedCompany(count, seed = count) {
  let s = seed * 7919 + 1
  const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const people = Array.from({ length: count }, (_, i) => ({
    n: i + 1,
    // Some above 50,000 (the higher CSG rate) and above 29,710 (the NSF ceiling); some cents.
    salary: (Math.round(15000 + rand() * 110000) * 100 + Math.round(rand() * 99)) / 100,
    age60: rand() < 0.05,
  }))
  return SPEED_MONTHS.map(({ year, month }, m) => ({
    year,
    month,
    employees: people.map((p) => ({
      id: `tst-${count}-${p.n}`,
      values: {
        id: `TST${String(p.n).padStart(4, '0')}`,
        name: `Test${p.n}`,
        surname: 'Employee',
        basicSalary: String(p.salary),
        govtIncrement: m >= 1 ? '635' : '0',
        status: 'Full Time',
        // Now and then empty, as a cell left blank.
        allowances: rand() < 0.1 ? '' : String(Math.round(rand() * 300000) / 100),
        age60: p.age60,
        bonusBase: '1000',
        edf: rand() < 0.5 ? '9000' : '0',
        overtime: String(Math.round(rand() * 200000) / 100),
        transport: '1500',
      },
    })),
  }))
}
