#!/usr/bin/env node
// Regression test for state standard deductions, personal exemptions, age add-ons, the
// federal senior deduction, phase-outs and exemption credits in relocation/relo-engine.mjs
// (taxRules.standardDeduction), and for the Relocation page's own call into the engine.
//
// Every expected value is worked by hand from the state's own published schedule, form or
// instructions (cited per block; links in SOURCES.md), not read back from the data. Amounts
// are each state's latest published year: 2026 for ME, MN, NE, OR, RI, KY, SC and DC; 2025
// for the rest. Rewritten 2026-10-22 (fix-pack 10): the first version asserted several
// figures the sources contradict (LA, ME, KS, OK, RI, MN, NE, DE, AZ, MD, VT, OR, SC, MS).
//
// Run: node _dev/test-relo-std-deductions.mjs

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

// ============================================================================
// PART 1 — ENGINE
// ============================================================================

// 1a. A joint return with no spouseAge counts the spouse at the filer's age, as the rest of the
//     engine (core/retirement-rules.js) and the page's same-age assumption do. The page passes
//     no spouseAge, so before this fix a couple both 68 got ONE age-65 credit or add-on.
//     CA (FTB 540 2025): $153 personal credit each + $153 senior credit each.
{
  // CA preset income, joint, 68: SS exempt; ordinary 40,000 + 20,000 + 10,000 = 70,000;
  // taxable 70,000 - 11,412 = 58,588; 1% x 22,158 + 2% x 30,370 + 4% x 6,060 = 1,071.38;
  // credits 4 x 153 = 612 -> 459.38.
  const r = tax('CA', 'mfj', { ss: 30000, iraWithdrawal: 40000, pension: 20000, capGains: 10000, age: 68 });
  check('CA joint, 68, no spouseAge: four $153 credits ($612)', r.breakdown.exemptionCredit, 612, 0);
  check('CA joint, 68, no spouseAge: tax $459 (was $612 with one senior credit)', r.tax, 459);
  // An explicit younger spouse still gets one fewer senior credit: 2 x 153 + 153 = 459.
  check('CA joint, 65 and 64: $459 of credits',
    tax('CA', 'mfj', { iraWithdrawal: 100000, ss: 30000, age: 65, spouseAge: 64 }).breakdown.exemptionCredit, 459, 0);
  // NJ (NJ-1040): $1,000 each + $1,000 per person 65+ -> 2,000 + 2,000 with the spouse defaulted.
  check('NJ joint, 66, no spouseAge: $4,000 of exemptions',
    tax('NJ', 'mfj', { wages: 80000, age: 66 }).breakdown.deductible, 4000, 0);
}

// 1b. Married filing separately takes the MARRIED age add-on, as on the federal return.
//     MO (DOR 4711, 2025 standard deduction table): married filing separately, 1 box = $17,350.
{
  const r = tax('MO', 'mfs', { wages: 50000, age: 66 });
  // (Since 2026-10-22 `deductible` also holds Missouri's federal tax deduction, tested in
  // test-relo-federal-tax.mjs; the standard deduction is the rest.)
  check('MO married filing separately, 66: $17,350 (was $17,750, the unmarried add-on)',
    r.breakdown.deductible - r.breakdown.federalTaxDeduction, 17350, 0);
  // Federal tax 50,000 - 17,750 = 32,250 -> 3,622; Missouri AGI $50,000 -> 25% = 905.50.
  // 50,000 - 17,350 - 905.50 = 31,744.50; MO: 256.035 through $9,191, + 4.7% x 22,553.50 = 1,316.05.
  // (1,359 before the federal tax deduction.)
  check('MO married filing separately, 66, $50k wages: tax $1,316', r.tax, 1316);
}

// 1c. Stacked capital gains (MT, HI): deductions left over after the other income reduce the
//     gains, as on the federal capital gains worksheet. Before, the excess was dropped.
{
  // HI single, 50, $40,000 gain only: taxable gain 40,000 - 5,544 = 34,456 on the regular
  // rates capped at 7.25% (HRS 235-51(f)): 134.40 + 153.60 + 264 + 307.20 + 6.8% x 10,456
  // = 1,570.21. (Was 1,963.20 on the full $40,000.)
  check('HI single, $40,000 gain and nothing else: $1,570 (deduction offsets the gain)',
    tax('HI', 'single', { capGains: 40000, age: 50 }).tax, 1570);
  // MT joint, 50, $40,000 gain only: 40,000 - 31,500 = 8,500 at 3% = 255 (was 1,200).
  check('MT joint, $40,000 gain and nothing else: $255', tax('MT', 'mfj', { capGains: 40000, age: 50 }).tax, 255);
}

// 1d. Phase-outs.
{
  // Linear, on Maine AGI (MRS 2026 1040ES line 6a worksheet): single over $102,250, over $75,000.
  // $120,000: 15,700 x (1 - 17,750 / 75,000) = 11,984.33, + $5,300 exemption = 17,284.33.
  // Taxable 102,715.67: 1,589.20 + 2,527.875 + 7.15% x 37,865.67 = 6,824.47.
  const me = tax('ME', 'single', { wages: 120000, age: 60 });
  check('ME single, $120,000: standard deduction phased down to $11,984 (+ $5,300 exemption)', me.breakdown.deductible, 17284.33, 0.01);
  check('ME single, $120,000: tax $6,824', me.tax, 6824);
  // Linear, on federal AGI (SC H.4216 sec. 3): joint SCIAD $30,000 less (AGI - 80,000) / 110,000.
  // $100,000: 30,000 x (1 - 20,000/110,000) = 24,545.45; taxable 75,454.55;
  // 1.99% x 30,000 + 5.21% x 45,454.55 = 2,965.18 (= 5.21% x 75,454.55 - 966, the DOR's form).
  const sc = tax('SC', 'mfj', { wages: 100000, age: 60 });
  check('SC joint, $100,000: SCIAD $24,545 after the phase-out', sc.breakdown.deductible, 24545.45, 0.01);
  check('SC joint, $100,000: tax $2,965 (was $2,681 on a flat $30,000)', sc.tax, 2965);
  // Bands, on federal AGI (MD 2025 resident booklet, exemption chart): single over $100,000 to
  // $125,000 -> $1,600. $110,000: 3,350 + 1,600 = 4,950.
  check('MD single, $110,000: exemption steps down to $1,600', tax('MD', 'single', { wages: 110000, age: 60 }).breakdown.deductible, 4950, 0);
  // Bands, RI (ADV 2025-22; 2025 worksheet steps of a quarter of the range): 2026 range $261,000
  // to $290,800, steps of $7,450. $270,000 is in the second step -> 60% of 16,450 = 9,870.
  check('RI single, $270,000: deduction and exemption at 60%', tax('RI', 'single', { wages: 270000, age: 60 }).breakdown.deductible, 9870, 0.01);
  // Cutoffs on federal AGI: OR's credit is $0 over $100,000 single (OR-ESTIMATE 2026); IL's
  // exemptions are $0 over $250,000 single (IL-1040 2025, Step 4).
  check('OR single, $120,000: no exemption credit', tax('OR', 'single', { wages: 120000, age: 60 }).breakdown.exemptionCredit, 0, 0);
  check('OR single, $90,000: $260 exemption credit', tax('OR', 'single', { wages: 90000, age: 60 }).breakdown.exemptionCredit, 260, 0);
  const il = tax('IL', 'single', { wages: 260000, age: 60 });
  check('IL single, $260,000: no exemption', il.breakdown.deductible, 0, 0);
  check('IL single, $260,000: 4.95% x 260,000 = $12,870', il.tax, 12870);
}

// 1e. Federal senior deduction (IRC 151(d)(5)(C); IRS Schedule 1-A Part V): $6,000 per person
//     65+, less 6% of MAGI over $75,000 ($150,000 joint), figured once and given to each
//     qualifying spouse; none for married filing separately.
{
  // CO single, 70, $80,000 IRA: CO excludes $24,000 (65+) -> 56,000. Senior: 6,000 - 0.06 x
  // 5,000 = 5,700. Deductions 15,750 + 2,000 + 5,700 = 23,450. 4.4% x 32,550 = 1,432.20.
  const co = tax('CO', 'single', { iraWithdrawal: 80000, age: 70 });
  check('CO single, 70, $80,000 IRA: senior deduction $5,700', co.breakdown.seniorDeduction, 5700, 0.01);
  check('CO single, 70, $80,000 IRA: tax $1,432 (was $1,683)', co.tax, 1432);
  check('CO married filing separately, 70: no senior deduction',
    tax('CO', 'mfs', { iraWithdrawal: 80000, age: 70 }).breakdown.seniorDeduction, 0, 0);
  // ND joint, both 70 (spouse defaulted), $200,000 IRA: excess 50,000 -> 6,000 - 3,000 = 3,000
  // each. 31,500 + 2 x 1,600 + 2 x 3,000 = 40,700. Taxable 159,300: 1.95% x (159,300 - 80,975)
  // = 1,527.34.
  const nd = tax('ND', 'mfj', { iraWithdrawal: 200000, age: 70 });
  check('ND joint, both 70, $200,000: deductions $40,700', nd.breakdown.deductible, 40700, 0.01);
  check('ND joint, both 70, $200,000: tax $1,527 (was $1,676)', nd.tax, 1527);
  // Fully phased out at MAGI $175,000 single.
  check('ID single, 70, $180,000: senior deduction gone', tax('ID', 'single', { wages: 180000, age: 70 }).breakdown.seniorDeduction, 0, 0);
}

// 1f. Credit extras: head of household (AR, IA), the age bonus at the state's own age (DE: 60),
//     and the zero floor.
{
  // AR head of household, 66 (AR1000F 2025 lines 7A-7C): $29 personal + $29 head of household +
  // $29 age 65. Taxable 47,530: 112 + 144 + 353.60 + 3.7% x 21,131 = 1,391.45; less 87.
  check('AR head of household, 66, $50k wages: credits $87, tax $1,304 (was $1,391)',
    tax('AR', 'hoh', { wages: 50000, age: 66 }).tax, 1304);
  // IA head of household, 66 (IDR exemption credits): 2 x $40 + $20; deductions 23,625 + 2,000 +
  // 6,000 senior = 31,625. 3.8% x 18,375 = 698.25; less 100.
  check('IA head of household, 66, $50k wages: tax $598 (was $926)', tax('IA', 'hoh', { wages: 50000, age: 66 }).tax, 598);
  // DE single, 61 (PIT-RES 2025 line 27a/27b): $110 personal + $110 for 60 or over.
  // Taxable 46,750: 66 + 195 + 480 + 260 + 5.55% x 21,750 = 2,208.13; less 220.
  check('DE single, 61, $50k wages: $220 of credits, tax $1,988 (was $2,098)', tax('DE', 'single', { wages: 50000, age: 61 }).tax, 1988);
  // CA single, $6,000 wages: 1% x 294 = 2.94 of tax, $153 credit -> $0, not negative.
  check('CA single, $6k wages: credit larger than the tax -> $0', tax('CA', 'single', { wages: 6000, age: 60 }).tax, 0);
}

// ============================================================================
// PART 2 — STATE FIGURES (single, $50,000 of wages unless noted)
// ============================================================================

// Corrected this round.
{
  // AZ (Form 140 2025, lines 38 and 43): $15,750 + $2,100 per person 65+ (was the federal $2,000).
  check('AZ single, 66: 2.5% x (50,000 - 17,850) = $804', tax('AZ', 'single', { wages: 50000, age: 66 }).tax, 804);
  // DE (PIT-RES 2025 line 21): + $2,500 per box 65+. 3,250 + 2,500 = 5,750; taxable 44,250:
  // 66 + 195 + 480 + 260 + 5.55% x 19,250 = 2,069.38; less $220 (personal + 60 or over).
  check('DE single, 66: deduction $5,750, credits $220, tax $1,849', tax('DE', 'single', { wages: 50000, age: 66 }).tax, 1849);
  // KS (KDOR 2025 booklet): std $3,605 + exemption $9,160 + $850 at 65. Taxable 36,385:
  // 5.2% x 23,000 + 5.58% x 13,385 = 1,942.88.
  const ks = tax('KS', 'single', { wages: 50000, age: 66 });
  check('KS single, 66: deductions $13,615 (std + exemption + 65 add-on)', ks.breakdown.deductible, 13615, 0);
  check('KS single, 66: tax $1,943 (was $2,501)', ks.tax, 1943);
  check('KS head of household: 6,180 + 9,160 + 2,320 = $17,660', tax('KS', 'hoh', { wages: 50000, age: 60 }).breakdown.deductible, 17660, 0);
  // KY (DOR, 2026 standard deduction; Schedule ITC 2025): $3,360, $40 credit at 65.
  // 3.5% x 46,640 = 1,632.40; less 40.
  check('KY single, 66: tax $1,592', tax('KY', 'single', { wages: 50000, age: 66 }).tax, 1592);
  // LA (LDR FAQs): $12,500; "the additional $1,000 deductions for ... persons 65+ ... have
  // been repealed" — there is no $12,500 age add-on. 3% x 37,500.
  check('LA single, 66: no age add-on, 3% x 37,500 = $1,125 (was $750)', tax('LA', 'single', { wages: 50000, age: 66 }).tax, 1125);
  check('LA joint: $25,000', tax('LA', 'mfj', { wages: 50000, age: 66 }).breakdown.deductible, 25000, 0);
  // MD (2025 resident booklet): std $3,350 + exemption $3,200 (federal AGI <= $100,000) + $1,000 at 65.
  check('MD single, 60: deductions $6,550', tax('MD', 'single', { wages: 50000, age: 60 }).breakdown.deductible, 6550, 0);
  // Taxable 43,450: 20 + 30 + 4.75% x 41,450 = 2,018.88.
  check('MD single, 60: tax $2,019 (was $2,171)', tax('MD', 'single', { wages: 50000, age: 60 }).tax, 2019);
  check('MD single, 66: + $1,000 age exemption = $7,550', tax('MD', 'single', { wages: 50000, age: 66 }).breakdown.deductible, 7550, 0);
  // ME (MRS 2026 schedules): std $15,700 + exemption $5,300. Taxable 29,000:
  // 5.8% x 27,400 + 6.75% x 1,600 = 1,697.20.
  check('ME single, 60: tax $1,697 (was $2,102)', tax('ME', 'single', { wages: 50000, age: 60 }).tax, 1697);
  // Joint, both 66: 31,400 + 2 x 1,650 + 2 x 5,300 = 45,300.
  check('ME joint, both 66: deductions $45,300', tax('ME', 'mfj', { wages: 80000, age: 66 }).breakdown.deductible, 45300, 0);
  // 2026 surcharge, 2% over $1,000,000 single: deduction and exemption fully phased out at
  // $1.2M. 1,589.20 + 2,527.875 + 7.15% x 935,150 + 9.15% x 200,000 = 89,280.30.
  check('ME single, $1.2M: surcharge band, tax $89,280', tax('ME', 'single', { wages: 1200000, age: 60 }).tax, 89280);
  // MN (DOR 2026 inflation-adjusted amounts): $15,300 + $2,000 single 65+; joint $30,600 + $1,600 each.
  check('MN single, 67: $17,300', tax('MN', 'single', { wages: 50000, age: 67 }).breakdown.deductible, 17300, 0);
  check('MN joint, 68 and 60: 30,600 + 1,600 = $32,200', tax('MN', 'mfj', { wages: 60000, age: 68, spouseAge: 60 }).breakdown.deductible, 32200, 0);
  // MS (DOR General Information): head of family $8,000 exemption + $3,400 standard deduction
  // (dependents, including a head of household's qualifying person, aren't modeled anywhere).
  // 4% x (38,600 - 10,000) = 1,144.
  check('MS head of household: $11,400, tax $1,144', tax('MS', 'hoh', { wages: 50000, age: 60 }).tax, 1144);
  // MT (Form 2 2025; Pub 1 2026): federal $15,750 + $2,000 + Montana's $5,660 at 65 + the $6,000
  // senior deduction. $60,000 IRA, 70: deductions 29,410; 4.7% x 30,590 = 1,437.73.
  check('MT single, 70, $60,000 IRA: tax $1,438 (was $1,986)', tax('MT', 'single', { iraWithdrawal: 60000, age: 70 }).tax, 1438);
  // NE (2026 1040N-ES): $8,850; credit $176. Taxable 41,150: 101.60 + 724.11 + 745.75 = 1,571.46; less 176.
  check('NE single, 60: tax $1,395', tax('NE', 'single', { wages: 50000, age: 60 }).tax, 1395);
  // NM (PIT-1 2025 line 12, the federal standard deduction; ba3a00b left NM out). Taxable 34,250:
  // 82.50 + 352 + 731 + 4.7% x 750 = 1,200.75.
  check('NM single, 60: federal $15,750, tax $1,201 (was $1,941 with none)', tax('NM', 'single', { wages: 50000, age: 60 }).tax, 1201);
  // OK (511 2025 lines 10-11): $6,350 + $1,000 exemption. Taxable 42,650: 153.50 + 4.75% x 35,450 = 1,837.38.
  check('OK single, 60: tax $1,837 (was $1,885)', tax('OK', 'single', { wages: 50000, age: 60 }).tax, 1837);
  check('OK joint: 12,700 + 2 x 1,000 = $14,700', tax('OK', 'mfj', { wages: 80000, age: 60 }).breakdown.deductible, 14700, 0);
  // OR (OR-ESTIMATE 2026; OR-40 2025): Oregon's own $2,900 + $1,200 at 65 (not the federal
  // $15,750), $260 credit, and (since 2026-10-22) the federal tax subtraction: federal 50,000 -
  // 18,150 - 6,000 = 25,850 -> 2,854. Taxable 50,000 - 4,100 - 2,854 = 43,046: 216.13 + 462.38 +
  // 8.75% x 31,646 = 3,447.53; less 260. (3,437 before the subtraction; 2,503 on the federal deduction.)
  check('OR single, 66: tax $3,188', tax('OR', 'single', { wages: 50000, age: 66 }).tax, 3188);
  // RI (ADV 2025-22, 2026): $11,200 + $5,250 exemption. 3.75% x 33,550 = 1,258.13.
  check('RI single, 60: tax $1,258 (was $1,466)', tax('RI', 'single', { wages: 50000, age: 60 }).tax, 1258);
  check('RI head of household: 16,800 + 5,250 = $22,050', tax('RI', 'hoh', { wages: 50000, age: 60 }).breakdown.deductible, 22050, 0);
  // SC 2026: the SCIAD replaces the federal deduction and its age add-on (no add-on).
  check('SC single, 66, $30,000: full $15,000 SCIAD, no age add-on', tax('SC', 'single', { wages: 30000, age: 66 }).breakdown.deductible, 15000, 0);
  // VT (IN-111 2025): $7,650 + $5,300 exemption + $1,250 at 65. 3.35% x 35,800 = 1,199.30.
  check('VT single, 66: tax $1,199 (was $1,377)', tax('VT', 'single', { wages: 50000, age: 66 }).tax, 1199);
  // DC (2026 D-40ES): $16,100 + $2,050 unmarried 65+. Taxable 31,850: 400 + 6% x 21,850 = 1,711.
  check('DC single, 66: tax $1,711 (was $1,780)', tax('DC', 'single', { wages: 50000, age: 66 }).tax, 1711);
  // IA, ID: senior deduction (rolling conformity / HB 559). IA: 3.8% x (50,100 - 23,750) = 1,001.30, less $60.
  check('IA single, 66, $50,100: tax $941 (was $1,229)', tax('IA', 'single', { wages: 50100, age: 66 }).tax, 941);
  // ID: 5.3% x (26,250 - 4,811) = 1,136.27.
  check('ID single, 66: tax $1,136 (was $1,454)', tax('ID', 'single', { wages: 50000, age: 66 }).tax, 1136);
}

// Unchanged figures, confirmed against the same kind of source.
{
  // CA (FTB 540 2025): 50,000 - 5,706 = 44,294 -> 1,192.53, less 153.
  check('CA single, 60: tax $1,040', tax('CA', 'single', { wages: 50000, age: 60 }).tax, 1040);
  // NY (IT-201 2025 std deduction table): 80,000 - 8,000 = 72,000 on the 2026 rates.
  check('NY single, $80k: tax $3,723', tax('NY', 'single', { wages: 80000, age: 60 }).tax, 3723);
  // CO under 65: federal $15,750, no senior deduction. 4.4% x 34,250.
  check('CO single, 60: tax $1,507', tax('CO', 'single', { wages: 50000, age: 60 }).tax, 1507);
  check('CO single, $10k: floors at $0', tax('CO', 'single', { wages: 10000, age: 60 }).tax, 0);
  // ND: 34,250 inside the 0% band.
  check('ND single, 60: $0 (0% band)', tax('ND', 'single', { wages: 50000, age: 60 }).tax, 0);
  // NC (NCDOR): $12,750 / $25,500, no age add-on.
  check('NC single: 3.99% x 37,250 = $1,486', tax('NC', 'single', { wages: 50000, age: 66 }).tax, 1486);
  check('NC joint, $80k: 3.99% x 54,500 = $2,175', tax('NC', 'mfj', { wages: 80000, age: 60 }).tax, 2175);
  // GA (IT-511 2025 line 11): $12,000, no age add-on.
  check('GA single, 66: 4.99% x 38,000 = $1,896', tax('GA', 'single', { wages: 50000, age: 66 }).tax, 1896);
  // MI (Treasury): $5,800 each.
  check('MI single: 4.25% x 44,200 = $1,879', tax('MI', 'single', { wages: 50000, age: 60 }).tax, 1879);
  check('MI joint: 4.25% x 38,400 = $1,632', tax('MI', 'mfj', { wages: 50000, age: 60 }).tax, 1632);
  // IL (IL-1040 2025): $2,850 each + $1,000 at 65.
  check('IL single, 60: 4.95% x 47,150 = $2,334', tax('IL', 'single', { wages: 50000, age: 60 }).tax, 2334);
  check('IL joint, both 65+: 4.95% x 42,300 = $2,094', tax('IL', 'mfj', { wages: 50000, age: 67, spouseAge: 66 }).tax, 2094);
  // IN (DOR "Seniors"): $1,000 each + $1,000 at 65.
  check('IN joint, both 65+: 2.95% x 46,000 = $1,357', tax('IN', 'mfj', { wages: 50000, age: 67, spouseAge: 66 }).tax, 1357);
  // MA (DOR exemptions page): $4,400 single, $700 at 65.
  check('MA single, 60: 5% x 45,600 = $2,280', tax('MA', 'single', { wages: 50000, age: 60 }).tax, 2280);
  // WV (IT-140 2025): $2,000 each.
  check('WV joint: $4,000', tax('WV', 'mfj', { wages: 50000, age: 60 }).breakdown.deductible, 4000, 0);
  // HI (N-11 2025): $4,400 + $1,144 exemption; another $1,144 at 65.
  check('HI single, 65: $6,688', tax('HI', 'single', { wages: 50000, age: 65 }).breakdown.deductible, 6688, 0);
  // MS (DOR): $2,300 + $6,000; $1,500 at 65.
  check('MS single, 65: $9,800', tax('MS', 'single', { wages: 50000, age: 65 }).breakdown.deductible, 9800, 0);
  // VA (Form 760 2025): $8,750 + $930 exemption; $800 at 65.
  check('VA single, 66: $10,480', tax('VA', 'single', { wages: 50000, age: 66 }).breakdown.deductible, 10480, 0);
  // TX: no income tax. PA: no deduction or exemption.
  check('TX: $0', tax('TX', 'single', { wages: 50000, age: 60 }).tax, 0);
  check('PA: 3.07% x 50,000 = $1,535', tax('PA', 'single', { wages: 50000, age: 60 }).tax, 1535);
}

// States still without a deduction block: PA has none to model. (AL, CT, OH, UT and WI got theirs
// 2026-10-22; test-relo-state-credits.mjs.)
{
  for (const code of ['PA']) {
    const ok = states[code].taxRules.standardDeduction === undefined;
    if (ok) { pass++; console.log(`ok    ${code} has no standardDeduction`); }
    else { fail++; console.log(`FAIL  ${code} has no standardDeduction (field exists unexpectedly)`); }
  }
}

// ============================================================================
// PART 3 — THE PAGE'S OWN CALL (relocation.js compute(), which passes no spouseAge)
// ============================================================================
{
  const RELO = {};
  for (const code of Object.keys(states).filter((k) => k !== '_schema')) {
    RELO[code] = { name: states[code].facts.name, taxRules: states[code].taxRules, taxContext: states[code].taxContext, localTax: states[code].localTax };
  }
  globalThis.window = { RELO };
  const relo = await import('../relocation/relocation.js');
  const defaults = Object.fromEntries(relo.inputs.map((c) => [c.id, c.default]));
  const fromTax = (preset) => {
    const values = { ...defaults, ...relo.presets[preset] };
    const row = relo.compute(values).summary.find((s) => /state income tax per year/.test(s.label) && s.label.startsWith(states[values.fromState].facts.name));
    return row?.value;
  };
  // California to Texas: worked in 1a. New York to Florida: NY exempts the pension (government)
  // and $20,000 of IRA each; 20,000 + 15,000 gains - 16,050 = 18,950 -> 3.9% x 17,150 + 4.4% x
  // 1,800 = 748.05. NJ to PA: pension and IRA excluded (NJ-1040 retirement exclusion), 10,000
  // gains - 4,000 of exemptions (both 66) = 6,000 x 1.4% = 84.
  check('Page: California to Texas preset, California tax $459', Number(String(fromTax('California to Texas')).replace(/[$,]/g, '')), 459, 0);
  check('Page: New York to Florida preset, New York tax $748', Number(String(fromTax('New York to Florida')).replace(/[$,]/g, '')), 748, 0);
  check('Page: NJ to PA preset, New Jersey tax $84', Number(String(fromTax('When moving costs more (NJ to PA)')).replace(/[$,]/g, '')), 84, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
