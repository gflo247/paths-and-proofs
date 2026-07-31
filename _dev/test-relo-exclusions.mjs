#!/usr/bin/env node
// Regression test for relo-engine.mjs's retirement-income exclusion logic.
//
// Phase 1 (live-bug fixes, see memory: roth-state-deduction-unification):
//   1. Pooled IRA+pension double-counting (any state with pensionIncome.sameAs ===
//      "retirementIncome" and a user entering both income types at once — confirmed
//      reachable via the relocation tool's own default preset inputs).
//   2. NJ modeled as a flat cap-or-nothing cliff at $150k when real law has two
//      intermediate stepped-percentage-of-actual-income tiers between $100k-$150k.
//   3. CT modeled as a smooth linear phase-out when real law is a 10-tier stepped
//      percentage table.
//
// Phase 2 (general mechanism, extending 5 more states beyond the flat-cap shape):
//   4. GA/WI: age-tiered per-person caps, summed by each spouse's OWN age rather than
//      a flat doubling (WI's $48k joint tier specifically requires BOTH spouses 67+,
//      confirmed by WI DOR's own FAQ — a flat "capJoint" would be wrong for a
//      mixed-age couple).
//   5. NM: a dollar amount (not %) tiered by AGI, multiplied by qualifying-spouse count.
//   6. SC: two deductions sharing one $15,000/person ceiling (not additive to $25k).
//   7. VA: a per-person $12,000 cap that phases out linearly above a threshold fixed by
//      filing status (not by how many spouses qualify).
//   8. WV: capJoint was flat $8,000 (same as single) instead of the confirmed per-person
//      $16,000 — the Social-Security-netting question (a separate, larger modeling
//      decision) remains open; this only fixes the nominal, un-netted figure.
//
// Checks are against exact figures pulled from primary-source research (state DOR
// worksheets/instructions), not hand-derived approximations.

import { computeStateIncomeTax } from '../relocation/relo-engine.mjs';
import { readFileSync } from 'node:fs';

const states = JSON.parse(readFileSync(new URL('../roth-conversion/states.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
function check(label, actual, expected, tolerance = 1) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) { pass++; console.log(`ok    ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  (got ${actual}, expected ${expected} ±${tolerance})`); }
}

// --- 1. Pooling fix: MI, both pension AND IRA present. Also confirms the MI figures
//     match the Roth tool's own already-verified $67,610/$135,220 (2026, no age gate,
//     confirmed via Michigan Treasury guidance + a detailed secondary source) — taxRules'
//     copy previously had stale $65,987/$131,794, presumably an earlier year's
//     CPI-adjusted figure, corrected here in the Roth tool's favor. ---
{
  const mi = states.MI.taxRules;
  check('MI capSingle matches the Roth tool\'s own verified 2026 figure', mi.retirementIncome.exclusion.capSingle, 67610, 0);
  check('MI capJoint matches the Roth tool\'s own verified 2026 figure', mi.retirementIncome.exclusion.capJoint, 135220, 0);
  const cap = mi.retirementIncome.exclusion.capSingle;

  const pensionOnly = computeStateIncomeTax(mi, 'single', { pension: cap, age: 70 });
  check('MI pension-only at the cap is fully excluded', pensionOnly.breakdown.penTaxable, 0);

  const iraOnly = computeStateIncomeTax(mi, 'single', { iraWithdrawal: cap, age: 70 });
  check('MI IRA-only at the cap is fully excluded', iraOnly.breakdown.iraTaxable, 0);

  // Combined income = 2x the cap. A shared pool should leave exactly `cap` taxable
  // (the amount over the single shared ceiling) — NOT $0 (the old double-counted bug).
  const both = computeStateIncomeTax(mi, 'single', { pension: cap, iraWithdrawal: cap, age: 70 });
  const totalTaxable = both.breakdown.penTaxable + both.breakdown.iraTaxable;
  check('MI pooled: combined 2x cap leaves exactly cap taxable (not $0)', totalTaxable, cap);

  // Sanity: a combined amount UNDER the cap should still be fully sheltered.
  const underCap = computeStateIncomeTax(mi, 'single', { pension: cap * 0.3, iraWithdrawal: cap * 0.3, age: 70 });
  check('MI pooled: combined amount under the cap is fully excluded', underCap.breakdown.penTaxable + underCap.breakdown.iraTaxable, 0);
}

// --- 2. NJ: below $100k full cap, tiered above, cliff at $150k, SS excluded from the threshold ---
{
  const nj = states.NJ.taxRules;

  // Research's own worked example (GIT-1&2 p.22): MFJ, combined Total Income $127,000
  // (falls in the $125,001-$150,000 tier -> 25%), qualifying spouse's actual taxable
  // pension = $10,000 -> exclusion = 25% x $10,000 = $2,500 exactly.
  // Total Income excludes SS, so construct wages+pension = 127000 with ss=0 to land
  // there directly (isolates the tier math from the SS-exclusion mechanic, tested below).
  const worked = computeStateIncomeTax(nj, 'mfj', { wages: 117000, pension: 10000, age: 62 });
  const totalTaxableWorked = worked.breakdown.penTaxable; // no IRA in this example
  // $2,500 is the EXCLUDED amount (research figure) -> $10,000 - $2,500 = $7,500 taxable.
  check('NJ worked example: $127k income, $10k pension -> $7,500 taxable (25% tier, $2,500 excluded)', totalTaxableWorked, 7500);

  // Below $100k: full cap applies (capped at actual income if less than the cap).
  const belowCap = computeStateIncomeTax(nj, 'mfj', { wages: 50000, pension: 30000, age: 62 });
  check('NJ below $100k: pension fully excluded (under the $100k cap)', belowCap.breakdown.penTaxable, 0);

  // Cliff at $150k: zero exclusion at/above the threshold.
  const overCliff = computeStateIncomeTax(nj, 'mfj', { wages: 160000, pension: 30000, age: 62 });
  check('NJ at $160k (over $150k cliff): pension fully taxable', overCliff.breakdown.penTaxable, 30000);

  // SS-exclusion-from-threshold: a large SS benefit should NOT push a filer into a lower
  // NJ tier, since NJ's own "Total Income" excludes Social Security entirely.
  const withBigSS = computeStateIncomeTax(nj, 'mfj', { ss: 40000, wages: 50000, pension: 30000, age: 62 });
  check('NJ threshold excludes SS: $40k SS does not shrink the exclusion tier', withBigSS.breakdown.penTaxable, 0);

  // Age gate: under 62 gets no exclusion at all, regardless of income level.
  const underAge = computeStateIncomeTax(nj, 'mfj', { wages: 50000, pension: 30000, age: 55 });
  check('NJ under 62: no exclusion at all', underAge.breakdown.penTaxable, 30000);
}

// --- 3. CT: 10-tier stepped percentage, boundary convention, no age gate, no dollar cap ---
{
  const ct = states.CT.taxRules;

  // Deep in the 100% tier.
  const deep100 = computeStateIncomeTax(ct, 'single', { wages: 20000, pension: 50000, age: 40 });
  check('CT well under $75k: 100% excluded', deep100.breakdown.penTaxable, 0);

  // Boundary convention (research: "AGI of exactly $75,000 single gets 85%, not 100%").
  // wages+pension = 75000 exactly.
  const atBoundary = computeStateIncomeTax(ct, 'single', { wages: 25000, pension: 50000, age: 40 });
  check('CT at exactly $75,000 AGI: 85% tier (not 100%)', atBoundary.breakdown.penTaxable, 50000 * 0.15);

  // No dollar cap: pension income itself counts toward CT's AGI trigger, so a large
  // pension can't stay under the 100% threshold in isolation — the "no cap" property
  // instead shows up as a meaningfully different result than the old smooth ramp once
  // total income lands in a middle tier. $90,000 single AGI = the 5% tier (87,500-89,999
  // is 10%; 90,000-94,999 is 5%), so only 5% of the $90k pension is excluded ($4,500) ->
  // $85,500 taxable. The old cliffType:"phaseout" model, using capSingle=75000 as a
  // ceiling and linearly interpolating, would have produced $60,000 taxable instead — a
  // large, concrete divergence, not a rounding difference.
  const noCap = computeStateIncomeTax(ct, 'single', { pension: 90000, age: 40 });
  check('CT stepped table (not the old smooth/capped ramp): $90k pension -> $85,500 taxable', noCap.breakdown.penTaxable, 85500);

  // No age gate: a 30-year-old with qualifying pension/IRA income still gets the exclusion.
  const noAgeGate = computeStateIncomeTax(ct, 'single', { wages: 10000, pension: 20000, age: 30 });
  check('CT has no age gate: excluded even at age 30', noAgeGate.breakdown.penTaxable, 0);

  // Top tier: fully phased to zero at/above $100k single.
  const topTier = computeStateIncomeTax(ct, 'single', { wages: 100000, pension: 20000, age: 40 });
  check('CT at $100k+ single: fully taxable (0% tier)', topTier.breakdown.penTaxable, 20000);

  // Joint uses the doubled breakpoints, not the single ones: $120,000 AGI is well past
  // single's $99,999 top tier but still mid-table on the joint schedule (100,000-104,999
  // is 85%; 120,000 falls in 119,999<x<=124,999 -> 25%). 25% of the $20k pension is
  // excluded ($5,000) -> $15,000 taxable.
  const jointMid = computeStateIncomeTax(ct, 'mfj', { wages: 100000, pension: 20000, age: 40 });
  check('CT joint at $120k AGI (25% tier, doubled breakpoints)', jointMid.breakdown.penTaxable, 20000 * 0.75);
}

// --- 4. Regression: a plain "hard" cliffType state still behaves as before ---
{
  const de = states.DE.taxRules; // untouched by any of this session's fixes
  const deSmall = computeStateIncomeTax(de, 'single', { pension: 5000, age: 65 });
  check('DE unaffected: small pension under cap still fully excluded', deSmall.breakdown.penTaxable, 0);
}

// --- 5. GA: age-tiered cap, summed per spouse (not a flat doubling) ---
{
  const ga = states.GA.taxRules;

  // 62-64 tier ($35k): pension exceeds it, remainder taxable.
  const tier1 = computeStateIncomeTax(ga, 'single', { pension: 40000, age: 63 });
  check('GA 62-64 tier: $40k pension against $35k cap -> $5k taxable', tier1.breakdown.penTaxable, 5000);

  // 65+ tier ($65k): same pension now fully sheltered.
  const tier2 = computeStateIncomeTax(ga, 'single', { pension: 40000, age: 65 });
  check('GA 65+ tier: $40k pension fully excluded under $65k cap', tier2.breakdown.penTaxable, 0);

  // Joint, mixed tiers: 63 + 66 -> cap = 35000 + 65000 = 100000 (summed per-person,
  // not a flat capJoint number), so $90k combined stays fully sheltered.
  const mixed = computeStateIncomeTax(ga, 'mfj', { pension: 50000, iraWithdrawal: 40000, age: 63, spouseAge: 66 });
  check('GA joint mixed tiers (63+66): $90k combined fully excluded (cap=$100k)', mixed.breakdown.penTaxable + mixed.breakdown.iraTaxable, 0);

  // Under 62: no exclusion at all.
  const tooYoung = computeStateIncomeTax(ga, 'single', { pension: 20000, age: 55 });
  check('GA under 62: no exclusion', tooYoung.breakdown.penTaxable, 20000);
}

// --- 6. WI: single-tier ageTieredCap, but the JOINT tier requires BOTH spouses to
//     qualify (confirmed by WI DOR's own FAQ) — this is the case a flat capJoint
//     doubling would get wrong. ---
{
  const wi = states.WI.taxRules;

  const bothQualify = computeStateIncomeTax(wi, 'mfj', { pension: 45000, age: 67, spouseAge: 70 });
  check('WI joint, both 67+: $48k cap, $45k combined fully excluded', bothQualify.breakdown.penTaxable, 0);

  // Only ONE spouse 67+: WI DOR confirms this is $24k (the qualifying spouse's own
  // cap), NOT half of $48k by coincidence, and NOT the full $48k either.
  const oneQualifies = computeStateIncomeTax(wi, 'mfj', { pension: 30000, age: 67, spouseAge: 60 });
  check('WI joint, only one 67+: capped at $24k (not $48k)', oneQualifies.breakdown.penTaxable, 6000);
}

// --- 7. NM: stepped DOLLAR amount (not %) by AGI, x1 or x2 by qualifying-spouse count.
//     The x2 case is NM TRD's own worked example, byte-for-byte. ---
{
  const nm = states.NM.taxRules;

  const single15k = computeStateIncomeTax(nm, 'single', { pension: 15000, age: 65 });
  check('NM single, $15k AGI (under $18k): full $8,000 tier', single15k.breakdown.penTaxable, 15000 - 8000);

  const single20k = computeStateIncomeTax(nm, 'single', { pension: 20000, age: 65 });
  check('NM single, $20k AGI (19,501-21,000 band): $6,000 tier', single20k.breakdown.penTaxable, 20000 - 6000);

  // NM TRD's own worked example: both spouses 65+, AGI $35,000 (33,001-36,000 joint
  // band -> $6,000) -> "$6,000 bracket x 2 = $12,000".
  const bothQualify = computeStateIncomeTax(nm, 'mfj', { pension: 35000, age: 65, spouseAge: 65 });
  check('NM worked example: joint $35k AGI, both 65+ -> $12,000 excluded', bothQualify.breakdown.penTaxable, 35000 - 12000);

  // Only one spouse 65+: the SAME AGI bracket, but the dollar figure applies x1.
  const oneQualifies = computeStateIncomeTax(nm, 'mfj', { pension: 35000, age: 65, spouseAge: 50 });
  check('NM joint $35k AGI, only one 65+ -> $6,000 excluded (x1)', oneQualifies.breakdown.penTaxable, 35000 - 6000);

  const tooYoung = computeStateIncomeTax(nm, 'single', { pension: 10000, age: 60 });
  check('NM under 65: no exclusion', tooYoung.breakdown.penTaxable, 10000);
}

// --- 8. SC: two deductions sharing one $15,000/person ceiling (not additive to $25k) ---
{
  const sc = states.SC.taxRules;

  const under65Small = computeStateIncomeTax(sc, 'single', { pension: 2000, age: 50 });
  check('SC under 65, $2k retirement income: fully sheltered (under $3k tier)', under65Small.breakdown.penTaxable, 0);

  const under65Big = computeStateIncomeTax(sc, 'single', { pension: 5000, age: 50 });
  check('SC under 65, $5k retirement income: $3,000 tier -> $2,000 taxable', under65Big.breakdown.penTaxable, 2000);

  // 65+, retirement income large enough that tier1 ($10k) + tier2 (remaining $5k of the
  // $15k ceiling) apply cleanly with no leftover capacity: $15,000 sheltered total, NOT
  // $10k+$15k=$25k (the bug the old "two stacking deductions" reading would have caused).
  const combined65 = computeStateIncomeTax(sc, 'single', { pension: 20000, age: 65 });
  check('SC 65+, $20k retirement income: $15,000 ceiling (not $25k)', combined65.breakdown.penTaxable, 5000);

  // Joint, both 65+: each spouse has their OWN $15k pool (per-person, confirmed via
  // SC1040's own p-1/p-2 and q-1/q-2 line structure) -> up to $30k combined capacity,
  // capped by actual combined income.
  const jointBoth65 = computeStateIncomeTax(sc, 'mfj', { pension: 20000, age: 65, spouseAge: 65 });
  check('SC joint, both 65+, $20k combined: fully sheltered (under $30k combined capacity)', jointBoth65.breakdown.penTaxable, 0);
}

// --- 9. VA: per-person $12,000 cap, phases out linearly above a threshold fixed by
//     filing status (NOT by qualifying-spouse count), SS excluded from the AGI test ---
{
  const va = states.VA.taxRules;

  const underThreshold = computeStateIncomeTax(va, 'single', { wages: 30000, pension: 10000, age: 65 });
  check('VA single, $40k AGI (under $50k threshold): full $12,000 cap shelters all $10k pension', underThreshold.breakdown.penTaxable, 0);

  const midPhaseout = computeStateIncomeTax(va, 'single', { wages: 6000, pension: 50000, age: 65 });
  // AGI = 56000, 6000 into the $12,000-wide band above the $50k threshold -> 50% phased.
  check('VA single, $56k AGI (halfway through phase-out band): 50% of $12k = $6,000 excluded', midPhaseout.breakdown.penTaxable, 50000 - 6000);

  const overCliff = computeStateIncomeTax(va, 'single', { wages: 62000, pension: 20000, age: 65 });
  check('VA single, $82k AGI (past $50k+$12k=$62k): fully phased to $0 excluded', overCliff.breakdown.penTaxable, 20000);

  // Joint, both 65+: cap doubles to $24,000, but the AGI THRESHOLD stays $75,000 (does
  // NOT double for the second qualifying spouse) — confirmed via VA's own Form 760
  // worksheet. wages+pension must SUM to $75,000 to land exactly at the threshold
  // (pension itself counts toward agiProxy too).
  const jointBoth = computeStateIncomeTax(va, 'mfj', { wages: 51000, pension: 24000, age: 65, spouseAge: 65 });
  check('VA joint, both 65+, at exactly $75k threshold: full $24,000 cap excluded', jointBoth.breakdown.penTaxable, 0);

  // Joint, only ONE spouse 65+: cap is $12,000 (not $24,000), same $75,000 threshold.
  const jointOne = computeStateIncomeTax(va, 'mfj', { wages: 55000, pension: 20000, age: 65, spouseAge: 50 });
  check('VA joint, only one 65+, at $75k threshold: $12,000 cap (not $24,000)', jointOne.breakdown.penTaxable, 8000);

  // SS excluded from the AGI test: a large SS benefit should not push AGI over the
  // threshold and shrink the exclusion.
  const withBigSS = computeStateIncomeTax(va, 'single', { ss: 40000, wages: 6000, pension: 50000, age: 65 });
  check('VA threshold excludes SS: same 50% phase-out as without SS', withBigSS.breakdown.penTaxable, 50000 - 6000);
}

// --- 10. WV: capJoint fix (was flat $8,000, now the confirmed per-person $16,000) ---
{
  const wv = states.WV.taxRules;
  const single = computeStateIncomeTax(wv, 'single', { pension: 8000, age: 65 });
  check('WV single, $8k pension: fully excluded (unchanged behavior)', single.breakdown.penTaxable, 0);

  const joint = computeStateIncomeTax(wv, 'mfj', { pension: 10000, iraWithdrawal: 6000, age: 65 });
  check('WV joint, $16k combined: fully excluded under the fixed $16,000 cap', joint.breakdown.penTaxable + joint.breakdown.iraTaxable, 0);
}

// --- 11. WV Social-Security netting (netAgainstSS:true, resolved 2026-07-31) ---
// The $8k/$16k modification shares one pool with SS (W. Va. Code 11-21-12(c)(9)).
{
  const wv = states.WV.taxRules;
  check('WV netAgainstSS flag is set', wv.retirementIncome.exclusion.netAgainstSS, true);

  // Gap-year retiree (hasn't claimed SS yet): full nominal cap still applies.
  const gapYear = computeStateIncomeTax(wv, 'single', { ss: 0, pension: 8000, age: 65 });
  check('WV single, no SS yet: full $8,000 still excluded', gapYear.breakdown.penTaxable, 0);

  // SS alone already exceeds the cap: nothing left to shelter IRA/pension income.
  const ssExceedsCap = computeStateIncomeTax(wv, 'single', { ss: 24000, pension: 8000, age: 65 });
  check('WV single, SS > $8k: cap fully consumed by SS, $0 excluded', ssExceedsCap.breakdown.penTaxable, 8000);

  // Partial netting: $8,000 - $3,000 SS = $5,000 of cap remains.
  const partial = computeStateIncomeTax(wv, 'single', { ss: 3000, pension: 8000, age: 65 });
  check('WV single, SS $3k: $5,000 of the cap remains, $3,000 taxable', partial.breakdown.penTaxable, 3000);

  // Joint, household-level netting (no per-spouse SS split available): $16,000 cap
  // less the full household SS benefit.
  const jointPartial = computeStateIncomeTax(wv, 'mfj', { ss: 10000, pension: 10000, iraWithdrawal: 6000, age: 65, spouseAge: 65 });
  check('WV joint, SS $10k: $6,000 of the $16,000 cap remains', jointPartial.breakdown.penTaxable + jointPartial.breakdown.iraTaxable, 16000 - 6000);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
