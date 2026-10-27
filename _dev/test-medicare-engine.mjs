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
  check('NY: GI benefitLevel any, not equalOrLesser (corrected 2026-08-20)', r.guaranteedIssueContext.periods[0].benefitLevel, 'any');
}

// ── State context: continuous GI, benefitLevel corrected from equalOrLesser to any (Connecticut, Massachusetts) ──
{
  const ct = computeMedigapBreakeven(states.CT, { medigapMonthlyPremium: 200 });
  check('CT: GI benefitLevel any, not equalOrLesser (corrected 2026-08-20)', ct.guaranteedIssueContext.periods[0].benefitLevel, 'any');
  const ma = computeMedigapBreakeven(states.MA, { medigapMonthlyPremium: 200 });
  check('MA: GI benefitLevel any, not equalOrLesser (corrected 2026-08-20)', ma.guaranteedIssueContext.periods[0].benefitLevel, 'any');
  check('MA: GI citation points to §3, not §7 (corrected 2026-08-20)', states.MA.guaranteedIssuePeriods[0].citation.includes('§ 3'), true);
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

// ── State context: Arkansas community rating confirmed, Minnesota's new 2026 GI right ──
{
  const ar = computeMedigapBreakeven(states.AR, { medigapMonthlyPremium: 200 });
  check('AR: rating method', ar.ratingContext.method, 'community');
  const mn = computeMedigapBreakeven(states.MN, { medigapMonthlyPremium: 200 });
  check('MN: rating method', mn.ratingContext.method, 'community');
  check('MN: GI trigger for the new annual right (discovered 2026-08-20)', mn.guaranteedIssueContext.periods[0].trigger, 'annualEnrollmentPeriod');
  check('MN: GI now has 2 periods (new annual right + employerRetireeCoverageChange)', mn.guaranteedIssueContext.periods.length, 2);
}

// ── State context: birthday-rule batch (CA/ID/LA/NV/OR/WY primary-verified, IN age restriction found) ──
{
  const ca = computeMedigapBreakeven(states.CA, { medigapMonthlyPremium: 200 });
  check('CA: GI windowDays (60, confirmed 2026-08-20)', ca.guaranteedIssueContext.periods[0].windowDays, 60);
  const nv = computeMedigapBreakeven(states.NV, { medigapMonthlyPremium: 200 });
  check('NV: GI insurerScope (sameInsurer, confirmed 2026-08-20)', nv.guaranteedIssueContext.periods[0].insurerScope, 'sameInsurer');
  check('IN: GI restrictions mentions the age-65+ requirement', states.IN.guaranteedIssuePeriods[0].restrictions.includes('65'), true);
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
  check('IL: GI restrictions mentions age cap', r.restrictions.includes('65 to 75'), true);
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

// ── Chart: the axis reaches the point where Advantage hits its cap ──
// The x-axis is care used (Medicare-allowed charges); the cap is out-of-pocket dollars.
// Advantage's cost-sharing reaches a $9,250 cap at $9,250 / 0.20 = $46,250 of care, so the
// axis has to pass that point for the line to show its flat top, in both outcomes.
{
  globalThis.window = { MEDICARE_STATES: Object.fromEntries(Object.entries(states).filter(([k]) => k !== '_schema')) };
  const { compute } = await import('../medicare/medicare.js');
  const { findCrossover } = await import('../core/finance.js');
  const base = { stateCode: 'OH', medigapMonthlyPremium: 180, partDMonthlyPremium: 45, advantageMonthlyPremium: 0, advantageOOPMax: DEFAULT_ADVANTAGE_OOP_MAX };
  for (const [label, v] of [['crossover', base], ['Advantage always cheaper', { ...base, medigapMonthlyPremium: 900 }], ['lower cap + premium', { ...base, advantageMonthlyPremium: 20, advantageOOPMax: 4500 }]]) {
    const r = compute(v);
    const adv = r.series[1].points;
    check(`chart (${label}): axis passes where Advantage hits its cap`, adv[adv.length - 1].x >= v.advantageOOPMax / DEFAULT_COINSURANCE_RATE, true);
    check(`chart (${label}): Advantage line tops out at premium + cap`, Math.max(...adv.map((p) => p.y)), v.advantageMonthlyPremium * 12 + v.advantageOOPMax);
    // The marker the chart draws (core findCrossover, first grid point at or past the
    // crossing) must round to the same $k as the exact breakeven.
    const exact = computeMedigapBreakeven(null, v).breakevenUtilization;
    if (exact > 0) {
      const drawn = findCrossover(r.series[0], r.series[1]);
      check(`chart (${label}): crossover marker reads the exact breakeven ($${Math.round(exact / 1000)}k)`, Math.round(drawn / 1000), Math.round(exact / 1000), 0);
    }
  }
  // Sweep the input ranges: the marker sits exactly on the breakeven, never a step past it.
  let off = 0, tried = 0;
  for (let mg = 50; mg <= 1000; mg += 35) for (const pd of [0, 15, 45, 110]) for (const ap of [0, 20, 75]) for (const cap of [1000, 4500, 9250, 13900]) {
    const v = { ...base, medigapMonthlyPremium: mg, partDMonthlyPremium: pd, advantageMonthlyPremium: ap, advantageOOPMax: cap };
    const exact = computeMedigapBreakeven(null, v).breakevenUtilization;
    if (!(exact > 0)) continue;
    tried++;
    const r = compute(v);
    if (Math.abs(findCrossover(r.series[0], r.series[1]) - exact) > 1e-6) off++;
  }
  check(`chart: crossover marker exact across ${tried} input combinations`, off, 0, 0);
}

// ── Switching rights as the page shows them (fix-pack 14) ──
{
  const gi = (code, trig) => states[code].guaranteedIssuePeriods.find((p) => p.trigger === trig);
  // Massachusetts: the guaranteed right is the annual February 1 to March 31 window (211 CMR
  // 71.10(5)(a)); insurers MAY enroll at other times (71.10(8), (9)), so it isn't year-round.
  const ma = gi('MA', 'stateAnnualWindow');
  check('MA: an annual window set by state law, not "available year-round"', !!ma && !states.MA.guaranteedIssuePeriods.some((p) => p.trigger === 'continuous'), true);
  check('MA: window is February 1 to March 31', !!ma && /February 1 to March 31/.test(ma.windowAnchor), true);
  check('MA: open to people who never held Medigap', ma?.appliesTo, 'anyone');
  // Indiana and Kentucky: the new policy must come from a different insurer.
  check('IN: a different insurer than the current one', gi('IN', 'birthday').insurerScope, 'differentInsurer');
  check('KY: a different insurer than the current one', gi('KY', 'birthday').insurerScope, 'differentInsurer');
  // Minnesota: first-time Medigap applicants aged 65 to 70 only, with a 15%-35% surcharge
  // (Minnesota Commerce Department Administrative Bulletin 2026-3).
  const mn = gi('MN', 'annualEnrollmentPeriod');
  check('MN: only for first-time Medigap applicants', mn.appliesTo, 'firstTimeOnly');
  check('MN: ages 65 to 70, surcharge 15% rising to 35%', /65 to 70/.test(mn.restrictions) && /15%/.test(mn.restrictions) && /35%/.test(mn.restrictions), true);
  // Washington: RCW 48.66.045(2) — the replaceable group runs B, C, D, F, G, K, L, M, N.
  const wa = gi('WA', 'continuous');
  check('WA: plan group includes M and N, and isn\'t "B through L"', /M and N/.test(wa.restrictions) && !/B through L/.test(wa.restrictions), true);
  // Tennessee: plans C and F are closed to people first ELIGIBLE from 2020, not to every later enrollment.
  check('TN: 2020 plan list keyed to first Medicare eligibility', /first eligible for Medicare on or after January 1, 2020/.test(gi('TN', 'lossOfMedicaidEligibility').restrictions), true);

  // Every value the data uses has wording on the page.
  const html = readFileSync(new URL('../medicare/index.html', import.meta.url), 'utf8');
  const keysOf = (name) => {
    const at = html.indexOf(`const ${name} = {`);
    const body = html.slice(at, html.indexOf('};', at));
    return new Set([...body.matchAll(/(?:^|[\s{,])([A-Za-z]+):/g)].map((m) => m[1]));
  };
  const triggers = keysOf('GI_LABELS'), scopes = keysOf('SCOPE_LABELS');
  const shownAppliesTo = new Set([...html.matchAll(/p\.appliesTo === '([A-Za-z]+)'/g)].map((m) => m[1]));
  const unlabeled = [];
  for (const [code, st] of Object.entries(states)) {
    if (code === '_schema') continue;
    for (const p of st.guaranteedIssuePeriods || []) {
      if (!triggers.has(p.trigger)) unlabeled.push(`${code} trigger ${p.trigger}`);
      if (p.insurerScope != null && !scopes.has(p.insurerScope)) unlabeled.push(`${code} insurerScope ${p.insurerScope}`);
      if (!['existingHoldersOnly', ...shownAppliesTo].includes(p.appliesTo)) unlabeled.push(`${code} appliesTo ${p.appliesTo}`);
    }
  }
  check(`every switching-right value has page wording${unlabeled.length ? ': ' + unlabeled.join(', ') : ''}`, unlabeled.length, 0, 0);

  // The text the page shows reads as a description, not research notes: no code names, no
  // references to this data file or the research, no unexplained "AEP".
  const internal = /\b[a-z]+[A-Z][A-Za-z]+\b|\bthis (?:file|entry|pass|research)\b|mid-research|\bAEP\b/;
  const leaks = [];
  for (const [code, st] of Object.entries(states)) {
    if (code === '_schema') continue;
    for (const p of st.guaranteedIssuePeriods || []) {
      const shown = [p.windowAnchor, p.trigger === 'employerRetireeCoverageChange' ? null : p.restrictions].filter(Boolean);
      for (const t of shown) { const m = t.match(internal); if (m) leaks.push(`${code} ${p.trigger}: "${m[0]}"`); }
    }
  }
  check(`switching-right text has no code names or research notes${leaks.length ? ': ' + leaks.join(', ') : ''}`, leaks.length, 0, 0);
}

console.log(pass + fail === 0 ? '\nNo checks ran.' : `\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
