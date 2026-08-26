#!/usr/bin/env node
// Regression test for the survivor-benefit fix to social-security/social-security.js
// (2026-08-26): RIB-LIM (the widow(er) limit, SSA POMS GN 00615.320) and the
// survivor's own age-based reduction (CFR 404.410(c)(1)) were both completely
// unimplemented before this fix -- householdMonthly() simply kept
// Math.max(highBenefit, lowBenefit), which understated the survivor benefit any
// time the deceased had claimed before their own full retirement age. Found via a
// primary-source audit; confirmed live with a $3,000 PIA / claim-at-62 example
// ($2,100 shown vs. $2,475 correct -- a $375/mo, $4,500/yr understatement).
//
// This is a plain ES module (not inline HTML like Roth), so we import it directly
// rather than extracting script text.

import {
  workerBenefit,
  spousalBenefit,
  survivorBenefit,
  householdMonthly,
  compute,
  FULL_RETIREMENT_AGE,
  SURVIVOR_FULL_RETIREMENT_AGE,
} from '../social-security/social-security.js';

let pass = 0, fail = 0;
function check(label, actual, expected, tolerance = 0.01) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) pass++;
  else { fail++; console.log(`FAIL  ${label}  (got=${actual}, expected=${expected})`); }
}
function checkEqual(label, actual, expected) {
  const ok = actual === expected;
  if (ok) pass++;
  else { fail++; console.log(`FAIL  ${label}  (got=${JSON.stringify(actual)}, expected=${JSON.stringify(expected)})`); }
}

// Sanity: the survivor FRA table is a real, different table from worker/spousal FRA.
check('SURVIVOR_FULL_RETIREMENT_AGE is 66y8mo, not 67', SURVIVOR_FULL_RETIREMENT_AGE, 66 + 8 / 12);
if (SURVIVOR_FULL_RETIREMENT_AGE === FULL_RETIREMENT_AGE) {
  fail++;
  console.log('FAIL  survivor FRA must not silently equal worker/spousal FRA');
} else pass++;

// --- RIB-LIM ---------------------------------------------------------------

// Deceased claimed at 62 (well before FRA 67): actual benefit is 70% of PIA
// ($2,100 on a $3,000 PIA), but RIB-LIM floors the survivor at 82.5% of PIA
// ($2,475). Evaluated at survivor age 70 (>= survivor FRA) so the survivor's own
// age reduction is 0% and isolates the RIB-LIM effect alone.
check(
  'RIB-LIM floors an early (age 62) claim at 82.5% of PIA',
  survivorBenefit(3000, 62, 70),
  3000 * 0.825
);

// Deceased delayed to 70: actual benefit (124% of PIA) already exceeds the 82.5%
// floor, so RIB-LIM must be a no-op -- survivor gets the full delayed-credit amount.
check(
  'RIB-LIM is a no-op when the deceased delayed past FRA',
  survivorBenefit(3000, 70, 70),
  workerBenefit(3000, 70)
);
check('...(sanity: that delayed amount is 124% of PIA)', workerBenefit(3000, 70), 3000 * 1.24);

// Deceased claimed exactly at FRA: actual benefit is exactly 100% of PIA, still
// above the 82.5% floor -- RIB-LIM still a no-op.
check(
  'RIB-LIM is a no-op when the deceased claimed exactly at FRA',
  survivorBenefit(3000, 67, 70),
  3000
);

// Sweep every whole claim age 62-70 against an independently-derived expectation,
// evaluated at survivor age >= survivor FRA so only RIB-LIM is in play.
for (let claimAge = 62; claimAge <= 70; claimAge++) {
  const pia = 2400;
  const actual = workerBenefit(pia, claimAge);
  const expected = Math.max(actual, pia * 0.825);
  check(`RIB-LIM sweep: PIA=${pia} claimAge=${claimAge}`, survivorBenefit(pia, claimAge, 70), expected);
}

// --- Survivor's own age-based reduction (CFR 404.410(c)(1)) -----------------

// At the survivor's own FRA: 0% reduction, base amount paid in full.
check(
  'Survivor age reduction is 0% exactly at survivor FRA',
  survivorBenefit(3000, 62, SURVIVOR_FULL_RETIREMENT_AGE),
  3000 * 0.825
);

// At the earliest survivor-claiming age (60): the maximum 28.5% reduction, applied
// on top of the RIB-LIM base (not on top of the deceased's unreduced PIA).
{
  const base = 3000 * 0.825; // RIB-LIM floor, since claimAge=62 < FRA
  check(
    'Survivor age reduction is 28.5% at age 60 (max), stacked on the RIB-LIM base',
    survivorBenefit(3000, 62, 60),
    base * (1 - 0.285)
  );
}

// Midpoint: age 63y4mo is exactly halfway between 60 and survivor FRA (66y8mo) ->
// reduction should be exactly half of 28.5% = 14.25%.
{
  const midpointAge = (60 + SURVIVOR_FULL_RETIREMENT_AGE) / 2;
  const base = 3000 * 0.825;
  check(
    'Survivor age reduction is exactly half (14.25%) at the age midpoint',
    survivorBenefit(3000, 62, midpointAge),
    base * (1 - 0.1425),
    0.5 // month-rounding tolerance
  );
}

// Below age 60 is not a real input (defensive clamp only, since no UI path can
// produce it) -- must not extrapolate past the 28.5% cap.
check(
  'Survivor age reduction clamps at 28.5%, does not extrapolate below age 60',
  survivorBenefit(3000, 62, 50),
  survivorBenefit(3000, 62, 60)
);

// Above survivor FRA never exceeds 0% reduction (no bonus for waiting past FRA --
// survivor benefits earn no delayed credits, unlike worker benefits).
check(
  'Survivor benefit at age 90 == at survivor FRA (no delayed credits)',
  survivorBenefit(3000, 62, 90),
  survivorBenefit(3000, 62, SURVIVOR_FULL_RETIREMENT_AGE)
);

// --- householdMonthly wiring -------------------------------------------------

const values = { piaHigh: 3000, claimHigh: 62, piaLow: 1200, claimLow: 62 };

// High has died at a moment low (the survivor) is already past survivor FRA (70):
// low should get the LARGER of their own worker benefit and the inherited,
// RIB-LIM-floored survivor benefit off high's record.
{
  const got = householdMonthly(values, false, true, 70, 70);
  const ownLow = workerBenefit(1200, 62);
  const inherited = survivorBenefit(3000, 62, 70);
  check('householdMonthly: high died, low survives, takes the larger', got, Math.max(ownLow, inherited));
  if (inherited <= ownLow) { fail++; console.log('FAIL  test setup: expected the inherited survivor benefit to be the larger branch'); } else pass++;
}

// Symmetric case: low has died, high (the survivor) is past survivor FRA.
// Own worker benefit happens to win with these numbers -- covered separately
// below to force the inherited-benefit branch too.
{
  const got = householdMonthly(values, true, false, 70, 70);
  const ownHigh = workerBenefit(3000, 62);
  const inherited = survivorBenefit(1200, 62, 70);
  check('householdMonthly: low died, high survives, takes the larger', got, Math.max(ownHigh, inherited));
  if (inherited >= ownHigh) { fail++; console.log('FAIL  test setup: expected own worker benefit to be the larger branch here'); } else pass++;
}

// Force the OTHER side of that same Math.max: a synthetic case (values need not
// reflect "low" actually being the lower earner) where the deceased's inherited,
// delayed-credit survivor benefit exceeds the survivor's own early-claimed benefit.
{
  const values2 = { piaHigh: 1500, claimHigh: 62, piaLow: 3000, claimLow: 70 };
  const got = householdMonthly(values2, true, false, 70, 70);
  const ownHigh = workerBenefit(1500, 62);
  const inherited = survivorBenefit(3000, 70, 70);
  check('householdMonthly: low died, high survives, inherited benefit wins', got, Math.max(ownHigh, inherited));
  if (inherited <= ownHigh) { fail++; console.log('FAIL  test setup: expected the inherited survivor benefit to be the larger branch'); } else pass++;
}

// Both alive: unaffected by this fix, should still just sum each person's own
// worker-vs-spousal max (the pre-existing rule, untouched by this change).
{
  const got = householdMonthly(values, true, true, 65, 65);
  const lowOwn = Math.max(workerBenefit(1200, 62), spousalBenefit(3000, 62));
  const expected = workerBenefit(3000, 62) + lowOwn;
  check('householdMonthly: both alive unaffected by the survivor fix', got, expected);
}

// Both dead: unaffected, still zero.
check('householdMonthly: both dead is still 0', householdMonthly(values, false, false, 80, 80), 0);

// --- Symmetric spousal top-up fix (2026-08-26) ------------------------------
// Prior bug: only the "low" earner field ever got a spousal top-up check;
// the "high" earner field used raw workerBenefit() with no comparison at
// all. Real SSA rule (CFR 404.410(b)) is symmetric -- either spouse can draw
// off the other's record. Use piaHigh < piaLow (the high-earner FIELD does
// not have the higher PIA here) so the high side's top-up actually binds.
{
  const values3 = { piaHigh: 800, claimHigh: 62, piaLow: 3000, claimLow: 70 };
  const highWorker = workerBenefit(800, 62);
  const highSpousal = spousalBenefit(3000, 62);
  if (highSpousal <= highWorker) { fail++; console.log('FAIL  test setup: expected highSpousal to be the larger branch'); } else pass++;

  // Both alive, both filed (ages past both claim ages): high side's own
  // worker benefit must lose to the spousal top-up off low's record.
  const gotBothFiled = householdMonthly(values3, true, true, 75, 75);
  const lowWorkerAt70 = workerBenefit(3000, 70);
  const lowSpousalOff800 = spousalBenefit(800, 70);
  const expectedBothFiled = Math.max(highWorker, highSpousal) + Math.max(lowWorkerAt70, lowSpousalOff800);
  check('householdMonthly: high earner field gets the spousal top-up when it is larger', gotBothFiled, expectedBothFiled);

  // Gating: high has filed (75 >= 62) but low has NOT filed yet (65 < 70) --
  // the high side's spousal top-up requires the OTHER person to have filed,
  // so it must be withheld even though it would otherwise be larger.
  const gotLowNotFiled = householdMonthly(values3, true, true, 75, 65);
  check('householdMonthly: high-side spousal top-up withheld until low has filed', gotLowNotFiled, highWorker + 0);
}

// After the low earner dies, the high survivor's benefit must revert to
// their OWN worker benefit (or the inherited survivor benefit) -- NOT keep
// the spousal top-up off low's record, since that relationship ended at death.
{
  const values3 = { piaHigh: 800, claimHigh: 62, piaLow: 3000, claimLow: 70 };
  const got = householdMonthly(values3, true, false, 75, 75);
  const highWorker = workerBenefit(800, 62);
  const inherited = survivorBenefit(3000, 70, 75);
  check('householdMonthly: low died, high survivor drops the defunct spousal top-up', got, Math.max(highWorker, inherited));
}

// --- compute() summary cards reflect the same symmetric top-up --------------
{
  const values4 = { piaHigh: 800, claimHigh: 62, piaLow: 3000, claimLow: 62, lifeHigh: 84, lifeLow: 87, discountRate: 2 };
  const result = compute(values4);
  const expectedAt70 = Math.max(workerBenefit(800, 70), spousalBenefit(3000, 70));
  const expectedAt62 = Math.max(workerBenefit(800, 62), spousalBenefit(3000, 62));
  check('compute(): "wait to 70" card reflects the high-earner spousal top-up', parseFloat(result.summary[0].value.replace('$', '')), expectedAt70);
  check('compute(): "claim at 62" card reflects the high-earner spousal top-up', parseFloat(result.summary[1].value.replace('$', '')), expectedAt62);
  if (!result.summary[0].label.includes('spousal top-up applies')) {
    fail++;
    console.log('FAIL  compute(): "wait to 70" card label should flag the spousal top-up');
  } else pass++;
}

// --- compute() shows the worse of the two death orders (2026-08-26 fix) -----
// Prior behavior: the main chart hardcoded "higher earner dies first" always.
// An audit sweep found this is usually (not always) the more conservative
// order; a targeted sweep for this fix found real, non-exotic cases where
// the reverse order ("lower earner dies first") is actually MORE conservative
// -- meaning the old hardcoded chart would have shown a too-early breakeven
// age, or even shown "waiting wins" when the true worst case is "claiming
// early wins". compute() must now pick whichever order is worse for the
// user's own inputs, not always the same hardcoded one.
{
  // Found via sweep: piaLow > piaHigh (the "low" field isn't actually lower)
  // flips which order is worse. High-dies-first alone gives breakeven age 85;
  // low-dies-first is truly worse at age 96. The shown headline must be 96.
  const case1 = { piaHigh: 1100, claimHigh: 62, piaLow: 1400, claimLow: 62, lifeHigh: 72, lifeLow: 75, discountRate: 0 };
  const r1 = compute(case1);
  check('compute(): shows the worse breakeven age across both death orders (96, not 85)', parseFloat(r1.summary[3].value.replace('age ', '')), 96);

  // A more extreme case from the same sweep: high-dies-first alone would show
  // a breakeven near the far edge of the chart (age 100); low-dies-first is
  // actually worse still -- delay never catches up at all ("early wins").
  // The shown headline must be the "claiming early wins" verdict, not a
  // deceptively optimistic breakeven age.
  const case2 = { piaHigh: 500, claimHigh: 62, piaLow: 800, claimLow: 62, lifeHigh: 95, lifeLow: 75, discountRate: 0 };
  const r2 = compute(case2);
  checkEqual('compute(): shows "claiming early wins" when that is the true worst case', r2.summary[3].value, 'claiming early wins');
}

// Regression: a normally-labeled household (piaHigh > piaLow, the common
// case) should still show the same result as the pre-fix hardcoded
// high-dies-first order, since that IS the more conservative order here --
// this fix should not change the answer for the typical, correctly-labeled
// household, only for the edge cases the sweep above found.
{
  const normal = { piaHigh: 3200, claimHigh: 62, piaLow: 1400, claimLow: 62, lifeHigh: 84, lifeLow: 87, discountRate: 2 };
  const r = compute(normal);
  checkEqual('compute(): normally-labeled household is unaffected by the fix', r.summary[3].value, 'waiting wins');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
