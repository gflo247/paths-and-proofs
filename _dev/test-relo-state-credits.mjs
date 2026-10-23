#!/usr/bin/env node
// Deductions, exemptions and credits for the five states the Relocation engine left out until
// 2026-10-22 (fix-pack 11): Alabama, Connecticut, Ohio, Utah and Wisconsin. Before, all five
// were taxed with no deduction or credit at all. The new engine shapes they need: `steps` and
// `rate` phase-outs, bands that set an amount, an exemption's head-of-household and 65+ extras,
// and the `credits` list (percentOfTax, ofDeduction, flat, schedule).
//
// Every expected value is worked by hand from the state's own form, instructions or statute
// (cited per block; links in SOURCES.md), not read back from the data:
//   AL  Form 40 booklet 2025 (standard deduction chart, exemptions; federal tax: see
//       test-relo-federal-tax.mjs)
//   CT  CGS 12-702 (exemptions) and 12-703 (credits) = CT-1040 TCS 2025 Tables A and E
//   OH  IT 1040 booklet 2025 (exemption by income; retirement income, senior and exemption credits)
//   UT  TC-40 instructions 2025, lines 11-20 (taxpayer tax credit)
//   WI  2026 Form 1-ES instructions (standard deduction formula, exemptions)
//
// Run: node _dev/test-relo-state-credits.mjs

import { computeStateIncomeTax } from '../relocation/relo-engine.mjs';
import { readFileSync } from 'node:fs';

const states = JSON.parse(readFileSync(new URL('../roth-conversion/states.json', import.meta.url), 'utf8'));
const tax = (code, status, income) => computeStateIncomeTax(states[code].taxRules, status, income);

let pass = 0, fail = 0;
function check(label, actual, expected, tolerance = 0.01) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) { pass++; console.log(`ok    ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  (got ${actual}, expected ${expected} ±${tolerance})`); }
}

// The Relocation page's California preset income: joint, both 68, $30,000 Social Security,
// $40,000 IRA, $20,000 pension, $10,000 gains. Federal AGI 95,500 (25,500 of the benefit
// taxable); federal tax $4,064 (test-relo-federal-tax.mjs).
const PRESET = { ss: 30000, iraWithdrawal: 40000, pension: 20000, capGains: 10000, age: 68 };

// --- Alabama: standard deduction by Alabama AGI (chart: joint $8,500 to $25,999, then $175 less per
// $500 band down to $5,000 from $35,500; single $3,000 less $25; head of family $5,200 less $135;
// both to $2,500; separate $4,250 to $12,999, less $88 per $250 band, $2,500 from $17,750);
// exemption $1,500, $3,000 joint and head of family.
{
  // Preset: Alabama AGI = 40,000 IRA - 2 x 6,000 (65+ exclusion) + 10,000 gains = 38,000 (pension
  // and Social Security exempt). 5,000 + 3,000 + 4,064 federal tax = 12,064; taxable 25,936:
  // 2% x 1,000 + 4% x 5,000 + 5% x 19,936 = 1,216.80. (Was 1,820: no deductions at all.)
  check('AL joint, preset: deductions $12,064', tax('AL', 'mfj', PRESET).breakdown.deductible, 12064);
  check('AL joint, preset: tax $1,217 (was $1,820)', tax('AL', 'mfj', PRESET).tax, 1217, 0);
  // Chart edges, joint (federal tax 0 below $32,200 of wages): $25,999 -> 8,500; $26,000 -> 8,325.
  check('AL joint, $25,999: $8,500 + $3,000', tax('AL', 'mfj', { wages: 25999, age: 60 }).breakdown.deductible, 11500);
  check('AL joint, $26,000: first band, $8,325 + $3,000', tax('AL', 'mfj', { wages: 26000, age: 60 }).breakdown.deductible, 11325);
  // Single, $30,250: 9 bands ($30,000-$30,499 row) -> 2,775; + 1,500; federal 14,150 taxable ->
  // 1,240 + 12% x 1,750 = 1,450. Taxable 30,250 - 5,725 = 24,525: 10 + 100 + 5% x 21,525.
  check('AL single, $30,250: $2,775 + $1,500 + $1,450 federal tax', tax('AL', 'single', { wages: 30250, age: 60 }).breakdown.deductible, 5725);
  check('AL single, $30,250: tax $1,186', tax('AL', 'single', { wages: 30250, age: 60 }).tax, 1186, 0);
  // Separate, $15,100: ceil(2,101 / 250) = 9 bands -> 4,250 - 792 = 3,458 ($15,000-$15,249 row);
  // no federal tax (under $16,100).
  check('AL separate, $15,100: $3,458 + $1,500', tax('AL', 'mfs', { wages: 15100, age: 60 }).breakdown.deductible, 4958);
  // Head of family, $40,000: floor $2,500 + $3,000 exemption + federal 10% x 15,850 = 1,585.
  check('AL head of household, $40,000: $2,500 + $3,000 + $1,585', tax('AL', 'hoh', { wages: 40000, age: 60 }).breakdown.deductible, 7085);
}

// --- Connecticut: exemption $15,000 single, $24,000 joint, $12,000 separate, $19,000 head of
// household, less $1,000 for each $1,000 of CT AGI, or fraction, over $30,000 / $48,000 / $24,000 /
// $38,000; then a credit of a share of the tax by CT AGI (Table E).
{
  // Preset: CT AGI 20,000 (Social Security exempt under $100,000; the pension subtraction; 25% of
  // the IRA left in) is under the $24,000 exemption. (Was 2% x 20,000 = 400.)
  check('CT joint, preset: tax $0 (was $400)', tax('CT', 'mfj', PRESET).tax, 0, 0);
  check('CT single, $30,000: full $15,000 exemption', tax('CT', 'single', { wages: 30000, age: 60 }).breakdown.deductible, 15000);
  check('CT single, $30,001: $1 over -> $14,000', tax('CT', 'single', { wages: 30001, age: 60 }).breakdown.deductible, 14000);
  // $32,500: 3 steps -> 12,000; taxable 20,500: 2% x 10,000 + 4.5% x 10,500 = 672.50; credit 12%
  // ($32,300-$32,800 row) = 80.70 -> 591.80.
  check('CT single, $32,500: tax $592 after a 12% credit', tax('CT', 'single', { wages: 32500, age: 60 }).tax, 592, 0);
  // $50,000: no exemption; 200 + 4.5% x 40,000 = 2,000; credit 10% -> 1,800.
  check('CT single, $50,000: credit 10%, $200', tax('CT', 'single', { wages: 50000, age: 60 }).breakdown.credits, 200);
  // $64,500: 2,000 + 5.5% x 14,500 = 2,797.50, 1% credit -> 2,769.53; $64,501: no credit.
  check('CT single, $64,500: last 1% row, tax $2,770', tax('CT', 'single', { wages: 64500, age: 60 }).tax, 2770, 0);
  check('CT single, $64,501: no credit, tax $2,798', tax('CT', 'single', { wages: 64501, age: 60 }).tax, 2798, 0);
  // Joint, $60,000: 12 steps -> 12,000; taxable 48,000: 400 + 4.5% x 28,000 = 1,660; 10% -> 1,494.
  check('CT joint, $60,000: tax $1,494', tax('CT', 'mfj', { wages: 60000, age: 60 }).tax, 1494, 0);
  // Head of household, $40,000: 19,000 - 2,000 = 17,000; taxable 23,000: 2% x 16,000 + 4.5% x
  // 7,000 = 635; credit 15% ($35,500-$44,000 row) = 95.25 -> 539.75.
  check('CT head of household, $40,000: tax $540', tax('CT', 'hoh', { wages: 40000, age: 60 }).tax, 540, 0);
  // Separate, $30,000: 12,000 - 6,000 = 6,000; taxable 24,000: 200 + 4.5% x 14,000 = 830; 10% -> 747.
  check('CT separate, $30,000: tax $747', tax('CT', 'mfs', { wages: 30000, age: 60 }).tax, 747, 0);
}

// --- Ohio: exemption per person by Ohio MAGI ($2,400 to $40,000; $2,150 to $80,000; $1,900 below
// $750,000; none from $750,000); credits while MAGI less exemptions is under $100,000: retirement
// income (Table 2, up to $200 a return), $50 senior (65+, a return); $20 an exemption under $30,000.
{
  // Preset: Ohio AGI 70,000 (Social Security exempt): 2 x 2,150 -> taxable 65,700; 2.75% x
  // 39,650 = 1,090.375; credits 200 (60,000 of retirement income) + 50 = 250 -> 840.375.
  check('OH joint, preset: credits $250', tax('OH', 'mfj', PRESET).breakdown.credits, 250);
  check('OH joint, preset: tax $840 (was $1,209)', tax('OH', 'mfj', PRESET).tax, 840, 0);
  check('OH single, $40,000: $2,400', tax('OH', 'single', { wages: 40000, age: 60 }).breakdown.deductible, 2400);
  check('OH single, $40,001: $2,150', tax('OH', 'single', { wages: 40001, age: 60 }).breakdown.deductible, 2150);
  check('OH single, $80,001: $1,900', tax('OH', 'single', { wages: 80001, age: 60 }).breakdown.deductible, 1900);
  check('OH single, $750,000: none', tax('OH', 'single', { wages: 750000, age: 60 }).breakdown.deductible, 0);
  // $31,000: taxable 28,600 -> 2.75% x 2,550 = 70.125, less the $20 exemption credit -> 50.125.
  check('OH single, $31,000: $20 exemption credit, tax $50', tax('OH', 'single', { wages: 31000, age: 60 }).tax, 50, 0);
  // 66, $50,000 wages + $4,000 IRA: taxable 54,000 - 2,150 = 51,850 -> 709.50; credits $80 (Table 2,
  // $3,001-$5,000) + $50 -> 579.50.
  check('OH single 66, $4,000 of IRA income: $80 + $50 credits', tax('OH', 'single', { wages: 50000, iraWithdrawal: 4000, age: 66 }).breakdown.credits, 130);
  // 66, $101,000 IRA: taxable 99,100 (under $100,000): 2.75% x 73,050 = 2,008.875 - 250 = 1,758.875.
  check('OH single 66, $101,000 IRA: credits still allowed, tax $1,759', tax('OH', 'single', { iraWithdrawal: 101000, age: 66 }).tax, 1759, 0);
  // $102,000: taxable 100,100 -> no credits: 2.75% x 74,050 = 2,036.375.
  check('OH single 66, $102,000 IRA: no credits, tax $2,036', tax('OH', 'single', { iraWithdrawal: 102000, age: 66 }).tax, 2036, 0);
}

// --- Utah: taxpayer tax credit = 6% x (federal standard deduction + $2,000 / $1,600 per person 65+,
// 2025 figures), less 1.3% of Utah income over $18,213 single and separate, $36,426 joint, $27,320
// head of household.
{
  // Preset: 6% x (31,500 + 3,200) = 2,082 - 1.3% x (95,500 - 36,426) = 1,314.04. Tax before it:
  // 4.45% x (70,000 + 3,089.89 of Social Security left after Utah's credit) = 3,252.50 -> 1,938.46.
  check('UT joint, preset: credit $1,314.04', tax('UT', 'mfj', PRESET).breakdown.credits, 1314.04);
  check('UT joint, preset: tax $1,938 (was $3,253)', tax('UT', 'mfj', PRESET).tax, 1938, 0);
  // Single 70, $30,000: 6% x 17,750 = 1,065 - 1.3% x 11,787 = 911.77; 1,335 - 911.77 = 423.23.
  check('UT single 70, $30,000: tax $423', tax('UT', 'single', { wages: 30000, age: 70 }).tax, 423, 0);
  // Separate 66, $30,000: 6% x (15,750 + 1,600) = 1,041 - 153.23 = 887.77 -> 447.23.
  check('UT separate 66, $30,000: married 65+ amount, tax $447', tax('UT', 'mfs', { wages: 30000, age: 66 }).tax, 447, 0);
  // Head of household, $40,000: 6% x 23,625 = 1,417.50 - 1.3% x 12,680 = 1,252.66 -> 527.34.
  check('UT head of household, $40,000: tax $527', tax('UT', 'hoh', { wages: 40000, age: 60 }).tax, 527, 0);
  check('UT single, $150,000: credit phased out', tax('UT', 'single', { wages: 150000, age: 60 }).breakdown.credits, 0);
}

// --- Wisconsin (2026): standard deduction $13,960 single, $25,840 joint, $12,280 separate, $18,030
// head of household, less 12% / 19.778% / 19.778% / 22.515% of Wisconsin income over $20,120 /
// $29,040 / $13,780 / $20,120 (head of household then follows the single formula from $58,827);
// exemptions $700 a person + $250 a person 65+.
{
  // Preset: Wisconsin income 19,000 (40,000 + 20,000 retirement income - 2 x 24,000 for 67+, +
  // 70% of 10,000 gains): 25,840 + 1,400 + 500 = 27,740 covers it. (Was 3.5% x 19,000 = 665.)
  check('WI joint, preset: deductions $27,740', tax('WI', 'mfj', PRESET).breakdown.deductible, 27740);
  check('WI joint, preset: tax $0 (was $665)', tax('WI', 'mfj', PRESET).tax, 0, 0);
  // Single, $50,000: 13,960 - 12% x 29,880 = 10,374.40 + 700; taxable 38,925.60: 3.5% x 15,110 +
  // 4.4% x 23,815.60 = 1,576.74.
  check('WI single, $50,000: deductions $11,074.40', tax('WI', 'single', { wages: 50000, age: 60 }).breakdown.deductible, 11074.4);
  check('WI single, $50,000: tax $1,577', tax('WI', 'single', { wages: 50000, age: 60 }).tax, 1577, 0);
  check('WI single 66, $50,000: + $250 at 65', tax('WI', 'single', { wages: 50000, age: 66 }).breakdown.deductible, 11324.4);
  check('WI single, $140,000: deduction gone, $700 left', tax('WI', 'single', { wages: 140000, age: 60 }).breakdown.deductible, 700);
  // Joint, $100,000: 25,840 - 19.778% x 70,960 = 11,805.53 + 1,400.
  check('WI joint, $100,000: $13,205.53', tax('WI', 'mfj', { wages: 100000, age: 60 }).breakdown.deductible, 13205.53);
  // Separate, $30,000: 12,280 - 19.778% x 16,220 = 9,072.01 + 700.
  check('WI separate, $30,000: $9,772.01', tax('WI', 'mfs', { wages: 30000, age: 60 }).breakdown.deductible, 9772.01);
  // Head of household, $40,000: own formula 18,030 - 22.515% x 19,880 = 13,554.02 (single's gives
  // 11,574.40) + 700. At $80,000 the single formula is the larger: 13,960 - 12% x 59,880 = 6,774.40.
  check('WI head of household, $40,000: own formula, $14,254.02', tax('WI', 'hoh', { wages: 40000, age: 60 }).breakdown.deductible, 14254.02);
  check('WI head of household, $80,000: single formula, $7,474.40', tax('WI', 'hoh', { wages: 80000, age: 60 }).breakdown.deductible, 7474.4);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
