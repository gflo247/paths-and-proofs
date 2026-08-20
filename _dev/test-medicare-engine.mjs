#!/usr/bin/env node
// Regression/sanity test for medicare/medicare-engine.mjs, the pure-function breakeven
// computation for the planned Medigap-vs-Medicare-Advantage tool. Checks the core math
// by hand-derivation, then checks that state-specific context (rating trajectory,
// guaranteed-issue rights) is read and passed through correctly for a representative
// state from each category found in medicare/states.json.

import { computeMedigapBreakeven, DEFAULT_ADVANTAGE_OOP_MAX, DEFAULT_PART_B_DEDUCTIBLE, DEFAULT_COINSURANCE_RATE } from '../medicare/medicare-engine.mjs';
import { readFileSync } from 'node:fs';

const states = JSON.parse(readFileSync(new URL('../medicare/states.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
function check(label, actual, expected, tolerance = 0.5) {
  const ok = typeof expected === 'number'
    ? Math.abs(actual - expected) <= tolerance
    : actual === expected;
  if (ok) { pass++; console.log(`ok    ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`); }
}

// ── Core math, hand-derived ──
// $200/mo Medigap, $0 Advantage: medigapAnnualCost = 200*12 + 283 = 2683.
// premiumDifferential = 2683. Within OOP max (9250), so breakeven = 2683 / 0.20 = 13415.
{
  const r = computeMedigapBreakeven(null, { medigapMonthlyPremium: 200 });
  check('basic case: medigapAnnualCost', r.medigapAnnualCost, 2683);
  check('basic case: premiumDifferential', r.premiumDifferential, 2683);
  check('basic case: breakevenUtilization', r.breakevenUtilization, 13415);
  check('basic case: medigapEverWins', r.medigapEverWins, true);
  check('basic case: partDNotIncluded flagged true at $0 default', r.partDNotIncluded, true);
}

// ── Part D premium adds to Medigap's cost, since Medigap carries no drug coverage ──
// $200/mo Medigap + $50/mo Part D: medigapAnnualCost = 2400 + 600 + 283 = 3283.
{
  const r = computeMedigapBreakeven(null, { medigapMonthlyPremium: 200, partDMonthlyPremium: 50 });
  check('with Part D: medigapAnnualCost includes it', r.medigapAnnualCost, 3283);
  check('with Part D: partDAnnualPremium', r.partDAnnualPremium, 600);
  check('with Part D: partDNotIncluded flagged false once entered', r.partDNotIncluded, false);
  check('with Part D: breakevenUtilization shifts higher', r.breakevenUtilization, 3283 / 0.20);
}

// ── Edge case: Medigap cheaper than Advantage even at zero utilization ──
// $0 Medigap (unrealistic but tests the boundary), $30/mo Advantage:
// medigapAnnualCost = 0 + 283 = 283. advantageAnnualPremium = 360. differential = -77 <= 0.
{
  const r = computeMedigapBreakeven(null, { medigapMonthlyPremium: 0, advantageMonthlyPremium: 30 });
  check('zero-utilization edge: breakevenUtilization', r.breakevenUtilization, 0);
  check('zero-utilization edge: medigapEverWins', r.medigapEverWins, true);
}

// ── Edge case: Medigap never wins within a normal year ──
// $900/mo Medigap: medigapAnnualCost = 10800 + 283 = 11083, exceeds the $9250 OOP max.
{
  const r = computeMedigapBreakeven(null, { medigapMonthlyPremium: 900 });
  check('never-wins edge: breakevenUtilization is null', r.breakevenUtilization, null);
  check('never-wins edge: medigapEverWins', r.medigapEverWins, false);
}

// ── Divide-by-zero guard: a 0% coinsurance rate must not produce Infinity ──
{
  const r = computeMedigapBreakeven(null, { medigapMonthlyPremium: 200, coinsuranceRate: 0 });
  check('coinsuranceRate=0 does not produce Infinity', Number.isFinite(r.breakevenUtilization) || r.breakevenUtilization === null, true);
  check('coinsuranceRate=0: medigapEverWins is false', r.medigapEverWins, false);
}

// ── Custom OOP max / coinsurance / deductible override the defaults ──
{
  const r = computeMedigapBreakeven(null, {
    medigapMonthlyPremium: 200,
    advantageOOPMax: 5000,
    coinsuranceRate: 0.25,
    partBDeductible: 300,
  });
  // medigapAnnualCost = 2400 + 300 = 2700. differential = 2700, within 5000 OOP max.
  // breakeven = 2700 / 0.25 = 10800.
  check('override case: medigapAnnualCost', r.medigapAnnualCost, 2700);
  check('override case: breakevenUtilization', r.breakevenUtilization, 10800);
}

// ── Defaults match the documented 2026 CMS figures ──
check('default OOP max', DEFAULT_ADVANTAGE_OOP_MAX, 9250);
check('default Part B deductible', DEFAULT_PART_B_DEDUCTIBLE, 283);
check('default coinsurance rate', DEFAULT_COINSURANCE_RATE, 0.20);

// ── State context: null/no state selected doesn't throw ──
{
  const r = computeMedigapBreakeven(null, { medigapMonthlyPremium: 200 });
  check('no state: ratingContext.method', r.ratingContext.method, 'unknown');
  check('no state: guaranteedIssueContext.hasProtection', r.guaranteedIssueContext.hasProtection, false);
}

// ── State context: community-rated (New York) ──
{
  const r = computeMedigapBreakeven(states.NY, { medigapMonthlyPremium: 200 });
  check('NY: rating method', r.ratingContext.method, 'community');
  check('NY: GI hasProtection', r.guaranteedIssueContext.hasProtection, true);
  check('NY: GI trigger', r.guaranteedIssueContext.periods[0].trigger, 'continuous');
  check('NY: GI appliesTo (the bug caught in the adversarial pass)', r.guaranteedIssueContext.periods[0].appliesTo, 'anyone');
}

// ── State context: rating method downgraded to unverified (Florida) ──
{
  const r = computeMedigapBreakeven(states.FL, { medigapMonthlyPremium: 200 });
  check('FL: rating method surfaces as unverified, not guessed (downgraded 2026-08-20, no primary source supports issueAgeMandated)', r.ratingContext.method, 'unverified');
  check('FL: GI hasProtection (employerRetireeCoverageChange, added 2026-08-20)', r.guaranteedIssueContext.hasProtection, true);
  check('FL: GI trigger', r.guaranteedIssueContext.periods[0].trigger, 'employerRetireeCoverageChange');
}

// ── State context: attained-age banned (Arizona) ──
{
  const r = computeMedigapBreakeven(states.AZ, { medigapMonthlyPremium: 200 });
  check('AZ: rating method', r.ratingContext.method, 'attainedAgeBanned');
  check('AZ: GI hasProtection (genuinely none, not in the employerRetireeCoverageChange list)', r.guaranteedIssueContext.hasProtection, false);
}

// ── State context: no mandate, baseline (Ohio) ──
{
  const r = computeMedigapBreakeven(states.OH, { medigapMonthlyPremium: 200 });
  check('OH: rating method', r.ratingContext.method, 'noMandate');
  check('OH: GI hasProtection (employerRetireeCoverageChange, added 2026-08-20)', r.guaranteedIssueContext.hasProtection, true);
}

// ── State context: employerRetireeCoverageChange has no fabricated mechanics ──
{
  const r = computeMedigapBreakeven(states.AK, { medigapMonthlyPremium: 200 });
  const p = r.guaranteedIssueContext.periods[0];
  check('AK: GI trigger', p.trigger, 'employerRetireeCoverageChange');
  check('AK: GI windowDays left null, not guessed', p.windowDays, null);
  check('AK: GI insurerScope left null, not guessed', p.insurerScope, null);
  check('AK: GI benefitLevel left null, not guessed', p.benefitLevel, null);
}

// ── State context: unverified (Missouri) ──
{
  const r = computeMedigapBreakeven(states.MO, { medigapMonthlyPremium: 200 });
  check('MO: rating method surfaces as unverified, not guessed', r.ratingContext.method, 'unverified');
  check('MO: GI hasProtection (the anniversary rule)', r.guaranteedIssueContext.hasProtection, true);
  check('MO: GI trigger', r.guaranteedIssueContext.periods[0].trigger, 'policyAnniversary');
}

// ── State context: birthday-rule state with restrictions (Illinois) ──
{
  const r = computeMedicareGuaranteedIssueSanity('IL');
  check('IL: GI trigger', r.trigger, 'birthday');
  check('IL: GI windowDays', r.windowDays, 45);
  check('IL: GI restrictions mentions age cap', r.restrictions.includes('65-75'), true);
}
function computeMedicareGuaranteedIssueSanity(code) {
  const r = computeMedigapBreakeven(states[code], { medigapMonthlyPremium: 200 });
  return r.guaranteedIssueContext.periods[0];
}

// ── State context: disability-split community-rating state (Washington) ──
{
  const r = computeMedigapBreakeven(states.WA, { medigapMonthlyPremium: 200 });
  check('WA: rating method', r.ratingContext.method, 'community');
  check('WA: disabilitySplit flagged', r.ratingContext.disabilitySplit, true);
  check('WA: GI appliesTo (genuinely existing-holders-only, unlike NY/CT/MA)', r.guaranteedIssueContext.periods[0].appliesTo, 'existingHoldersOnly');
}

// ── Every one of the 51 jurisdictions computes without throwing ──
{
  let threw = 0;
  for (const code of Object.keys(states).filter((k) => k !== '_schema')) {
    try {
      computeMedigapBreakeven(states[code], { medigapMonthlyPremium: 200 });
    } catch (e) {
      threw++;
      console.log(`FAIL  ${code} threw: ${e.message}`);
    }
  }
  check('all 51 jurisdictions compute without throwing', threw, 0);
}

console.log(pass + fail === 0 ? '\nNo checks ran.' : `\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
