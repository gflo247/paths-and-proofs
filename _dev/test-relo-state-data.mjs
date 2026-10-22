#!/usr/bin/env node
// Regression test for the 2026-10-21 state-data and Social Security fixes in
// roth-conversion/states.json and relocation/relo-engine.mjs. Every expected figure is
// worked by hand from the state's own published schedule or statute (cited per block),
// not read back from the data, so a data edit that drifts from the source fails here.
//
// Run: node _dev/test-relo-state-data.mjs

import { computeStateIncomeTax } from '../relocation/relo-engine.mjs';
import { readFileSync } from 'node:fs';

const states = JSON.parse(readFileSync(new URL('../roth-conversion/states.json', import.meta.url), 'utf8'));
const tax = (code, status, income) => computeStateIncomeTax(states[code].taxRules, status, income);

let pass = 0, fail = 0;
function check(label, actual, expected, tolerance = 1) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) { pass++; console.log(`ok    ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  (got ${actual}, expected ${expected} ±${tolerance})`); }
}

// --- New York: TY2026 rate schedules (Form IT-2105-I 2026, tax.ny.gov) ---
// The schedule's own "plus" amounts: single, over $13,900 but not over $80,650: $586 plus
// 5.40% of the excess -> at $80,650 that's 586 + 0.054 * 66,750 = 4,190.5 (the next row
// starts "4,191 plus 5.90%"). Married filing jointly, over $27,900: $1,174 plus 5.40%.
// Input wages include the NY standard deduction (single $8,000, mfj $16,050, hoh $11,200)
// so that taxable income after the deduction matches the bracket test points.
{
  check('NY single, $80,650 taxable: 2026 schedule ($4,191 row start; was $4,271 at the 2025 rates)',
    tax('NY', 'single', { wages: 80650 + 8000, age: 50 }).tax, 4191);
  check('NY joint, $100,000 taxable: $1,174 + 5.40% x 72,100 = $5,067',
    tax('NY', 'mfj', { wages: 100000 + 16050, age: 50 }).tax, 5067);
  check('NY head of household, $107,650 taxable: 2026 schedule row ($5,564 + 0)',
    tax('NY', 'hoh', { wages: 107650 + 11200, age: 50 }).tax, 5564);
  check('NY roth.cr is the 5.9% band (was 6%)', states.NY.roth.cr, 0.059, 0);
}

// --- Mississippi: 4% over $10,000 for TY2026 (MS DOR, General Information) ---
// MS standard deduction (combined exemption + std ded): single $8,300.
// Input wages include the deduction so that taxable income = $30,000.
{
  check('MS single, $30,000 taxable: 4% x 20,000 = $800 (was $880 at 4.4%)',
    tax('MS', 'single', { wages: 30000 + 8300, age: 50 }).tax, 800);
  check('MS roth.cr 4%', states.MS.roth.cr, 0.04, 0);
}

// --- Utah: 4.45% for 2026 (S.B. 60, Utah Code 59-10-104(2)(b)); Social Security credit
//     (Utah Code 59-10-1042): rate x the Social Security in taxable income, reduced by
//     $0.025 per dollar of modified AGI over $54,000 single / $90,000 joint or HoH. ---
{
  check('UT single, $50,000 taxable: 4.45% = $2,225 (was $2,250 at 4.5%)',
    tax('UT', 'single', { wages: 50000, age: 50 }).tax, 2225);
  // Joint, SS 40,000, IRA 70,000. Federal worksheet: provisional = 70,000 + 20,000 = 90,000,
  // so taxable SS = min(34,000, 6,000 + 0.85 * 46,000) = 34,000; federal AGI = 104,000.
  // Credit = 0.0445 * 34,000 - 0.025 * (104,000 - 90,000) = 1,513 - 350 = 1,163, so Utah tax
  // = 0.0445 * 104,000 - 1,163 = 3,465. (Before: SS taxed in full at 4.5% -> $4,680.)
  const r = tax('UT', 'mfj', { ss: 40000, iraWithdrawal: 70000, age: 70 });
  check('UT joint, SS credit partly phased out: tax $3,465', r.tax, 3465);
  // Head of household uses the $90,000 joint threshold: SS 30,000, other income 60,000.
  // Federal taxable SS (single bases): provisional 75,000 -> min(25,500, 4,500 + 0.85 * 41,000)
  // = 25,500; federal AGI 85,500 <= 90,000 -> full credit, no tax on the Social Security.
  check('UT head of household under $90,000: no Utah tax on Social Security (was taxed at the $54,000 single threshold)',
    tax('UT', 'hoh', { ss: 30000, iraWithdrawal: 60000, age: 70 }).breakdown.taxableSS, 0);
}

// --- Idaho: TY2025 0% band (ISTC rate schedule; Idaho Code 63-3024(2)) ---
// ID conforms to federal standard deduction: single $15,750, mfj $31,500, hoh $23,625.
// Input wages include the deduction so that taxable income = $20,000.
{
  check('ID single, $20,000 taxable: 5.3% x (20,000 - 4,811) = $805 (was $1,060)',
    tax('ID', 'single', { wages: 20000 + 15750, age: 50 }).tax, 805);
  check('ID joint, $20,000 taxable: 5.3% x (20,000 - 9,622) = $550',
    tax('ID', 'mfj', { wages: 20000 + 31500, age: 50 }).tax, 550);
  check('ID head of household uses the joint band ($550)',
    tax('ID', 'hoh', { wages: 20000 + 23625, age: 50 }).tax, 550);
}

// --- Arkansas: Social Security and Railroad Retirement are nontaxable (AR DFA Subject 209) ---
{
  check('AR joint over $100,000 AGI: Social Security not taxed (was 85% taxed above $100k)',
    tax('AR', 'mfj', { ss: 40000, iraWithdrawal: 100000, age: 70 }).breakdown.taxableSS, 0);
}

// --- Hawaii: schedules for tax years after 2024 (HI DOTAX Tax Rate Schedules page); net
//     capital gain taxed at no more than 7.25% (HRS 235-51(f)) ---
// HI standard deduction + personal exemption (combined): single $5,544, mfj $11,088,
// hoh $7,568. Input wages include the deduction so taxable income matches the bracket
// test points. For cap-gains tests, the stacked ladder sees ordinary income AFTER
// deduction, so the deduction shifts which tier gains land in.
{
  // Schedule I: over $48,000, "$2,539 plus 7.60% over $48,000" -> 2,539.2 + 912 at $60,000.
  check('HI single, $60,000 taxable: $2,539 + 7.6% x 12,000 = $3,451',
    tax('HI', 'single', { wages: 60000 + 5544, age: 50 }).tax, 3451);
  // Schedule II: over $96,000, "$5,078 plus 7.60% over $96,000" -> 5,078.4 + 304.
  check('HI joint, $100,000 taxable: $5,078 + 7.6% x 4,000 = $5,382',
    tax('HI', 'mfj', { wages: 100000 + 11088, age: 50 }).tax, 5382);
  // Schedule III: over $72,000, "$3,809 plus 7.60% over $72,000".
  check('HI head of household, $80,000 taxable: $3,809 + 7.6% x 8,000 = $4,417',
    tax('HI', 'hoh', { wages: 80000 + 7568, age: 50 }).tax, 4417);
  // Capital gains above the 7.2% band: HRS 235-51(f) -> regular tax on the other $60,000
  // (3,451.2) + 7.25% x 40,000 (2,900) = 6,351.
  check('HI single, $60,000 + $40,000 gain: gain taxed at 7.25% ($6,351)',
    tax('HI', 'single', { wages: 60000 + 5544, capGains: 40000, age: 50 }).tax, 6351);
  // Straddling the $48,000 line: TI 60,000, TI - gain = 30,000 < 48,000, so the cap formula
  // is regular tax on 48,000 (2,539.2) + 7.25% x 12,000 (870) = 3,409.
  check('HI single, $30,000 + $30,000 gain: regular rates up to $48,000, 7.25% above ($3,409)',
    tax('HI', 'single', { wages: 30000 + 5544, capGains: 30000, age: 50 }).tax, 3409);
  check('HI roth.cr is the 7.6% band (was 8.25%)', states.HI.roth.cr, 0.076, 0);
}

// --- Montana: TY2026 bands (MT DOR HB337 page; MCA 15-30-2103) ---
// MT conforms to federal standard deduction: hoh $23,625, mfj $31,500.
// Input wages include the deduction so taxable income matches the bracket test points.
{
  check('MT head of household, $71,250 taxable: all at 4.7% = $3,349 (was $3,574 on the single band)',
    tax('MT', 'hoh', { wages: 71250 + 23625, age: 50 }).tax, 3349);
  // Long-term gains: 3.0% on the first ($95,000 less nonqualified taxable income), 4.1%
  // above. Wages 80,000 -> 3,760; gain 30,000 -> 15,000 * 3% + 15,000 * 4.1% = 1,065.
  check('MT joint, $80,000 + $30,000 long-term gain: $3,760 + $1,065 = $4,825 (was $5,313 as ordinary)',
    tax('MT', 'mfj', { wages: 80000 + 31500, capGains: 30000, age: 50 }).tax, 4825);
}

// --- Arizona: 25% subtraction of long-term gains on assets bought after 2011
//     (2025 Form 140 instructions, lines 20-24) ---
// AZ conforms to federal standard deduction: single $15,750. After the 25% exclusion,
// taxable CG = $30,000. With no wages, ordinary = $30,000, minus $15,750 deduction = $14,250.
// AZ flat 2.5% x $14,250 = $356.25 -> $356.
{
  check('AZ single, $40,000 gain after deduction: 2.5% x 14,250 = $356',
    tax('AZ', 'single', { capGains: 40000, age: 50 }).tax, 356);
}

// --- Vermont: flat capital gains exclusion, $5,000 or the gain if less (IN-153, 2025);
//     Social Security exclusion phases out in a straight line over $10,000 of federal AGI
//     (32 V.S.A. 5830e(a)) ---
// VT standard deduction: single $7,650, mfj $15,300. Age 65 add-on: $1,250.
{
  // Single, $20,000 gain: after $5,000 CG exclusion = $15,000 ordinary. Minus $7,650
  // deduction = $7,350. VT 3.35% x $7,350 = $246.23 -> $246.
  check('VT single, $20,000 gain after deduction: 3.35% x 7,350 = $246',
    tax('VT', 'single', { capGains: 20000, age: 50 }).tax, 246);
  check('VT single, $3,000 gain: fully excluded',
    tax('VT', 'single', { capGains: 3000, age: 50 }).tax, 0);
  // Joint, SS 30,000, IRA 50,000: taxable SS unchanged (federal AGI-based, deduction doesn't
  // affect it). Ordinary = 50,000 + 9,182.25 = 59,182.25. Minus $15,300 deduction = $43,882.25.
  // Minus $2,500 age65 add-on (both 70, 2 × $1,250) = $41,382.25.
  // VT 3.35% x $41,382.25 = $1,386.31 -> $1,386.
  const vt = tax('VT', 'mfj', { ss: 30000, iraWithdrawal: 50000, age: 70, spouseAge: 70 });
  check('VT joint in the phase-out: taxable SS $9,182', vt.breakdown.taxableSS, 9182.25, 0.01);
  check('VT joint in the phase-out after deduction: tax $1,386', vt.tax, 1386);
}

// --- New Mexico: "100% of your net capital gains, not to exceed $2,500" applies to any
//     gain (2025 PIT-ADJ line 16) ---
{
  check('NM single, $10,000 gain: $2,500 deducted -> 1.5% x 5,500 + 3.2% x 2,000 = $147 (was $227)',
    tax('NM', 'single', { capGains: 10000, age: 50 }).tax, 147);
}

// --- West Virginia: married filing separately uses half-width bands (WV Tax Division,
//     2026 Income Tax Rate Cut page: "Over $20,000 but not over $30,000 ... $553.25 plus
//     4.22%", "Over $30,000 ... $975.25 plus 4.58%") ---
// WV personal exemption: mfs $2,000. Input wages include the deduction so taxable = $30,000.
{
  check('WV married filing separately, $30,000 taxable: $975 (was $791 on the single bands)',
    tax('WV', 'mfs', { wages: 30000 + 2000, age: 50 }).tax, 975);
}

// --- Minnesota: the Social Security subtraction is "reduced by ten percent for each $4,000
//     of adjusted gross income, or fraction thereof" over the threshold
//     (Minn. Stat. 290.0132 subd. 26(c)) ---
// MN standard deduction: mfj $29,900. Age 65 add-on: $1,550 per spouse.
{
  // Joint, SS 40,000, IRA 90,000: taxable SS 34,000 (85% tier), federal AGI 124,000, which is
  // 13,220 over $110,780 -> ceil(13,220 / 4,000) = 4 steps -> 40% taxable = 13,600.
  // Ordinary = 90,000 + 13,600 = 103,600. Minus $29,900 deduction - $3,100 (2 × $1,550 age
  // 65 add-on, both age 70) = $70,600 taxable. MN brackets: 5.35% × $48,700 + 6.8% ×
  // ($70,600 - $48,700) = 2,605.45 + 1,489.20 = $4,094.65 -> $4,095.
  const mn = tax('MN', 'mfj', { ss: 40000, iraWithdrawal: 90000, age: 70, spouseAge: 70 });
  check('MN joint, 4 steps into the phase-out: taxable SS $13,600', mn.breakdown.taxableSS, 13600, 0.01);
  check('MN joint after deduction: tax $4,095', mn.tax, 4095);
}

// --- Connecticut: head of household uses the $100,000 joint Social Security threshold
//     (CT DRS, Tax Tips for Senior Citizens); the pension phase-out is tested on federal
//     AGI ---
{
  // HoH, SS 30,000, IRA 60,000: federal AGI = 60,000 + 25,500 = 85,500 < 100,000 -> exempt.
  check('CT head of household under $100,000: Social Security exempt (was 25% taxed at the $75,000 single threshold)',
    tax('CT', 'hoh', { ss: 30000, iraWithdrawal: 60000, age: 70 }).breakdown.taxableSS, 0);
  // Single, SS 40,000, pension 50,000: taxable SS 34,000 -> federal AGI 84,000 -> the
  // "up to $84,999" tier (40%), so 20,000 of the pension is excluded (was the $94,999 tier,
  // 5%, from income plus the whole benefit = 90,000).
  check('CT single: pension phase-out tier picked from federal AGI ($84,000 -> 40%)',
    tax('CT', 'single', { ss: 40000, pension: 50000, age: 70 }).breakdown.penTaxable, 30000);
}

// --- Rhode Island: the pension/annuity modification is lost above federal AGI of $107,000
//     single / $133,500 joint (RI Retirement Income Guide, Pub 2026-01, Tax Year 2025) ---
{
  check('RI single over $107,000 AGI: no pension modification (was $50,000 excluded)',
    tax('RI', 'single', { pension: 60000, iraWithdrawal: 60000, age: 70 }).breakdown.penTaxable, 60000);
  check('RI single under $107,000 AGI: $50,000 modification applies',
    tax('RI', 'single', { pension: 60000, iraWithdrawal: 40000, age: 70 }).breakdown.penTaxable, 10000);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
