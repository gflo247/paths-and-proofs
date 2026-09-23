#!/usr/bin/env node
// Edge-case sweep for social-security.js focusing on compute(), householdMonthly(),
// and the interaction between them. Complements:
//   test-social-security.mjs  — survivor rules, RIB-LIM, buildVerdict
//   test-ss-surface.mjs       — workerBenefit, spousalBenefit, computeSurface
// This file covers:
//   1. compute() output structure
//   2. compute() with identical plans (claimHigh = claimHighEarly)
//   3. compute() reversed plans (claimHighEarly > claimHigh)
//   4. compute() all three outcome types (earlyWins / delayWins / breakeven)
//   5. householdMonthly() before any claiming age → 0
//   6. Spousal top-up binding vs. not binding
//   7. Survivor under SURVIVOR_MIN_CLAIM_AGE → no inherited benefit
//   8. piaHigh = 0 (only lower earner has SS)
//   9. Both die at minimum age (60) — compute() handles gracefully
//  10. ageGap extremes (±20)
//  11. discountRate monotonicity in compute()
//  12. lifeHigh / lifeLow at extreme values (60, 100)

import {
  compute,
  householdMonthly,
  survivorBenefit,
  workerBenefit,
  spousalBenefit,
  FULL_RETIREMENT_AGE,
  SURVIVOR_MIN_CLAIM_AGE,
  SURVIVOR_FULL_RETIREMENT_AGE,
} from '../social-security-couples/social-security.js';

let pass = 0, fail = 0;

function check(label, actual, expected, tol = 0.01) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) { pass++; }
  else { fail++; console.log(`FAIL  ${label}`); console.log(`      expected ${expected}, got ${actual}`); }
}
function checkTrue(label, condition) {
  if (condition) { pass++; }
  else { fail++; console.log(`FAIL  ${label}`); }
}

const BASE = {
  piaHigh: 3000, claimHigh: 70, claimHighEarly: 62,
  piaLow:  1200, claimLow:  62,
  ageGap: 0, lifeHigh: 84, lifeLow: 87,
  discountRate: 2,
};

// ── Group 1: compute() output structure ──────────────────────────────────────
// Basic guard: compute() must return a well-formed result regardless of inputs.

const r = compute(BASE);

checkTrue('1.1 compute: returns series array',         Array.isArray(r.series));
checkTrue('1.2 compute: series has 2 elements',        r.series.length === 2);
checkTrue('1.3 compute: series[0] has points array',   Array.isArray(r.series[0].points));
checkTrue('1.4 compute: series[1] has points array',   Array.isArray(r.series[1].points));
checkTrue('1.5 compute: all series[0] points finite',  r.series[0].points.every(p => isFinite(p.y)));
checkTrue('1.6 compute: all series[1] points finite',  r.series[1].points.every(p => isFinite(p.y)));
checkTrue('1.7 compute: markers is an array',          Array.isArray(r.markers));
checkTrue('1.8 compute: markers has at least 1 entry', r.markers.length >= 1);
checkTrue('1.9 compute: markers[0].x is finite',       isFinite(r.markers[0].x));
checkTrue('1.10 compute: outcome has a type field',    typeof r.outcome?.type === 'string');
checkTrue('1.11 compute: outcome type is one of the three valid values',
  ['earlyWins', 'delayWins', 'breakeven'].includes(r.outcome.type));
checkTrue('1.12 compute: crossovers is an array',      Array.isArray(r.crossovers));
checkTrue('1.13 compute: xAxis has label and format',  typeof r.xAxis?.label === 'string' && typeof r.xAxis?.format === 'function');
checkTrue('1.14 compute: yAxis has label and format',  typeof r.yAxis?.label === 'string' && typeof r.yAxis?.format === 'function');

// ── Group 2: identical plans (claimHigh = claimHighEarly) ────────────────────
// Both plans are the same — margin everywhere should be ~0 and the outcome
// should be 'delayWins' (lastDelay >= lastEarly when equal → classifyOutcome
// returns delayWins, not earlyWins — the equal case goes to delay by convention).

const rSame = compute({ ...BASE, claimHigh: 67, claimHighEarly: 67 });
const earlyPts  = rSame.series[0].points;
const delayPts  = rSame.series[1].points;
const maxAbsDiff = Math.max(...earlyPts.map((p, i) => Math.abs(p.y - delayPts[i].y)));

check('2.1 identical plans: max difference between series is ~0', maxAbsDiff, 0, 1);
checkTrue('2.2 identical plans: outcome is delayWins (equal → delay wins by convention)',
  rSame.outcome.type === 'delayWins');
checkTrue('2.3 identical plans: no NaN in either series',
  [...earlyPts, ...delayPts].every(p => isFinite(p.y)));

// ── Group 3: reversed plans (claimHighEarly > claimHigh) ─────────────────────
// Unusual but reachable: user drags "early" slider above "delay" slider.
// The math should produce a sensible (not crashing, not NaN) result.
// By the reversed labeling, planDelay = { claimHigh: 62 } and
// planEarly = { claimHigh: 70 } — so "delay" collects less. The tool should
// produce an earlyWins outcome (the "early" plan now pays more).

const rRev = compute({ ...BASE, claimHigh: 62, claimHighEarly: 70 });

checkTrue('3.1 reversed plans: does not throw or produce NaN',
  rRev.series.every(s => s.points.every(p => isFinite(p.y))));
checkTrue('3.2 reversed plans: outcome is earlyWins (the "early" plan is actually the better one)',
  rRev.outcome.type === 'earlyWins');

// ── Group 4: all three outcome types ─────────────────────────────────────────
// Verify compute() can produce each of the three outcome classifications.

// earlyWins: high discount rate + both die young → present value strongly favors early
const rEarly = compute({ ...BASE, discountRate: 6, lifeHigh: 70, lifeLow: 72 });
checkTrue('4.1 earlyWins: high discount + short lives → outcome.type = earlyWins',
  rEarly.outcome.type === 'earlyWins');

// delayWins: 0% discount + both live to 100 → delay always pays off, no crossover
const rDelay = compute({ ...BASE, discountRate: 0, lifeHigh: 100, lifeLow: 100 });
checkTrue('4.2 delayWins: 0% discount + both live to 100 → outcome.type = delayWins',
  rDelay.outcome.type === 'delayWins');

// breakeven: moderate discount + one spouse dies relatively young → the early
// plan's head start matters, but delay eventually overtakes it for the survivor.
// BASE produces delayWins (delay dominates at all planning ages). To get a
// genuine crossover we need the chart x-axis to START in early-wins territory —
// achieved by a shorter firstDeathAge and slightly higher discount rate.
const rBreak = compute({ ...BASE, discountRate: 2, lifeHigh: 70, lifeLow: 80 });
checkTrue('4.3 breakeven: r=2, lh=70, ll=80 → outcome.type = breakeven',
  rBreak.outcome.type === 'breakeven');
checkTrue('4.4 breakeven: breakeven age is finite and in a plausible range (62–100)',
  rBreak.outcome.type === 'breakeven' && rBreak.outcome.age >= 62 && rBreak.outcome.age <= 100);

// ── Group 5: householdMonthly() before any claiming age ──────────────────────
// At age 61 (below AGE_START=62 and below every claim age), neither person
// has filed and neither has reached their own claim age — household income must be 0.

const vBefore = { ...BASE, claimHigh: 70, claimHighEarly: 62, claimLow: 67 };
check('5.1 householdMonthly: age 61, both alive → 0 (nobody has filed)',
  householdMonthly(vBefore, true, true, 61, 61), 0, 0.01);
// age 58: high alive, low dead. High (survivor) at 58 < SURVIVOR_MIN_CLAIM_AGE (60) → no
// inherited benefit. High's own worker benefit at 58 < claimHighEarly=62 → also 0.
check('5.2 householdMonthly: age 58, high alive low dead → 0 (high under SURVIVOR_MIN_CLAIM_AGE=60)',
  householdMonthly(vBefore, true, false, 58, 58), 0, 0.01);
// age 61: high dead, low alive. Low (survivor) at 61 >= SURVIVOR_MIN_CLAIM_AGE (60) → eligible
// for inherited benefit off piaHigh=3000. Low's own worker at 61 < claimLow=67 → 0.
check('5.3 householdMonthly: age 61, high dead low alive → survivorBenefit(piaHigh, claimHigh, 61, 61)',
  householdMonthly(vBefore, false, true, 61, 61, 61, Infinity),
  Math.max(0, survivorBenefit(3000, 70, 61, 61)),
  0.01);

// ── Group 6: spousal top-up binding vs. not binding ──────────────────────────
// The spousal benefit is 50% of partner's PIA. If the lower earner's own
// worker benefit is already above that, no top-up — own benefit wins.

// Case A: piaLow (800) < piaHigh/2 (1500) → spousal top-up binds
// lowWorker = workerBenefit(800, 62) = 800 * 0.70 = 560
// lowSpousal = spousalBenefit(3000, 62) = 1500 * 0.65 = 975
// lowOwn = max(560, 975) = 975
const vTopUp = { piaHigh: 3000, claimHigh: 70, piaLow: 800, claimLow: 62 };
const expectedTopUp = Math.max(workerBenefit(800, 62), spousalBenefit(3000, 62));
check('6.1 spousal top-up binds: lowOwn = max(workerBenefit, spousalBenefit)',
  householdMonthly(vTopUp, true, true, 70, 62) - workerBenefit(3000, 70),
  expectedTopUp, 0.01);

// Case B: piaLow (2000) > piaHigh/2 (1000) → own benefit wins, no top-up
// lowWorker = workerBenefit(2000, 62) = 2000 * 0.70 = 1400
// lowSpousal = spousalBenefit(2000, 62) = 1000 * 0.65 = 650
// lowOwn = max(1400, 650) = 1400 (own benefit wins)
const vNoTopUp = { piaHigh: 2000, claimHigh: 70, piaLow: 2000, claimLow: 62 };
const lowWorkerNoTopUp = workerBenefit(2000, 62);
check('6.2 no spousal top-up: lowOwn = workerBenefit (own benefit exceeds spousal)',
  householdMonthly(vNoTopUp, true, true, 70, 62) - workerBenefit(2000, 70),
  lowWorkerNoTopUp, 0.01);

// Case C: symmetric check — when piaLow = piaHigh, spousal = 50% of partner's PIA < own benefit
const vEqual = { piaHigh: 2600, claimHigh: 70, piaLow: 2400, claimLow: 67 };
// lowWorker = workerBenefit(2400, 67) = 2400 (claimed at FRA)
// lowSpousal = spousalBenefit(2600, 67) = 1300
// lowOwn = max(2400, 1300) = 2400 — own benefit wins decisively
check('6.3 near-equal PIAs: own benefit wins for lower earner at FRA',
  householdMonthly(vEqual, true, true, 70, 67) - workerBenefit(2600, 70),
  workerBenefit(2400, 67), 0.01);

// Case D: high earner's spousal top-up binds.
// piaHigh=1200, claimHigh=62: highWorker=1200*0.70=840, highSpousal=spousalBenefit(3000,62)=975.
// highOwn = max(840, 975) = 975 (spousal wins). This path (highSpousal > highWorker) is
// distinct from cases A–C where only the low earner's spousal path was exercised.
const vHighTopUp = { piaHigh: 1200, claimHigh: 62, piaLow: 3000, claimLow: 67 };
check('6.4 high earner spousal top-up binds: highOwn = spousalBenefit(piaLow, claimHigh)',
  householdMonthly(vHighTopUp, true, true, 70, 67) - workerBenefit(3000, 67),
  spousalBenefit(3000, 62), 0.01);

// ── Group 7: survivor under SURVIVOR_MIN_CLAIM_AGE ───────────────────────────
// A widow(er) under 60 cannot claim ANY survivor benefit. householdMonthly()
// must return only the survivor's own worker benefit (often 0 if they also
// haven't reached their own claim age yet).

// High earner dies, low earner (survivor) is 58 — below 60.
// Low hasn't reached claimLow=62 either → lowWorker=0, inherited=0 → returns 0.
const vYoungSurvivor = { piaHigh: 3000, claimHigh: 70, piaLow: 1200, claimLow: 62, claimHighEarly: 62 };
check('7.1 survivor under 60: inherited = 0, lowWorker = 0 → household = 0',
  householdMonthly(vYoungSurvivor, false, true, 62, 58, 62, Infinity),
  0, 0.01);

// Survivor at exactly 60 (SURVIVOR_MIN_CLAIM_AGE) is eligible — benefit > 0.
const survivorAt60 = survivorBenefit(3000, 70, 60, 62);
checkTrue('7.2 survivor at exactly 60: eligible, benefit > 0', survivorAt60 > 0);
checkTrue('7.3 survivor at 59 (below minimum): survivorBenefit clamps age up to 60',
  // survivorBenefit clamps internally at 60, so age=59 and age=60 produce the same result.
  Math.abs(survivorBenefit(3000, 70, 59, 62) - survivorBenefit(3000, 70, 60, 62)) < 0.01);

// ── Group 8: piaHigh = 0 (only lower earner has SS) ──────────────────────────
// The higher earner contributes nothing to household SS. The lower earner
// receives their own worker benefit. The high earner (survivor) gets a
// survivor benefit off piaHigh=0, which should be 0.

const vHighZero = { piaHigh: 0, claimHigh: 70, claimHighEarly: 62, piaLow: 2000, claimLow: 67, ageGap: 0, lifeHigh: 84, lifeLow: 87, discountRate: 2 };

// Both alive, both at/past their claim ages.
// highWorker = workerBenefit(0, 70) = 0
// highSpousal = spousalBenefit(2000, 70) = 0.5 * 2000 = 1000 (high earner CAN draw spousal off low)
// lowWorker = workerBenefit(2000, 67) = 2000
// lowSpousal = spousalBenefit(0, 67) = 0 (no piaHigh to draw from)
// highOwn = max(0, 1000) = 1000; lowOwn = max(2000, 0) = 2000 → total = 3000
check('8.1 piaHigh=0: high earner draws spousal off low earner, household = spousal(2000,70) + worker(2000,67)',
  householdMonthly(vHighZero, true, true, 70, 67),
  spousalBenefit(2000, 70) + workerBenefit(2000, 67), 0.01);

// Low survives high: survivor inherits off piaHigh=0 → 0. Low keeps own benefit.
check('8.2 piaHigh=0: low earner survives high → survivor benefit = 0, keeps own worker benefit',
  householdMonthly(vHighZero, false, true, 70, 80, 70, Infinity),
  workerBenefit(2000, 67), 0.01);

// compute() with piaHigh=0 must not crash or produce NaN.
const rHighZero = compute(vHighZero);
checkTrue('8.3 piaHigh=0: compute() produces no NaN', rHighZero.series.every(s => s.points.every(p => isFinite(p.y))));
checkTrue('8.4 piaHigh=0: outcome type is valid', ['earlyWins', 'delayWins', 'breakeven'].includes(rHighZero.outcome.type));

// ── Group 9: both die at minimum age (60) ────────────────────────────────────
// Both die at age 60, before AGE_START (62). compute() must handle this gracefully.
// planValueBySecondDeath sweeps secondDeathAge from firstDeathAge (60) upward, so a
// survivor at 62+ can still collect their own worker benefit — series values are NOT
// all zero. We verify: no crash, no NaN, no negative PV.

const rBothDie60 = compute({ ...BASE, lifeHigh: 60, lifeLow: 60 });

// If compute() threw, Node would have exited before reaching this line.
checkTrue('9.1 both die at 60: compute() does not crash and returns a series',
  Array.isArray(rBothDie60.series) && rBothDie60.series.length === 2);
checkTrue('9.2 both die at 60: no NaN in series',
  rBothDie60.series.every(s => s.points.every(p => isFinite(p.y))));
// planValueBySecondDeath sweeps secondDeathAge from firstDeathAge upward, so a survivor
// at 62+ can still collect their own worker benefit. Series values are finite and
// non-negative — no crash, no NaN, no negative PV.
checkTrue('9.3 both die at 60: series values are finite and non-negative (no crash)',
  rBothDie60.series.every(s => s.points.every(p => isFinite(p.y) && p.y >= 0)));

// ── Group 10: ageGap extremes (±20) ─────────────────────────────────────────
// The ageGap slider goes from -20 to +20. Both extremes must produce a valid
// result with no NaN, and the two extremes must differ from each other.

const rGapPlus20  = compute({ ...BASE, ageGap:  20 });
const rGapMinus20 = compute({ ...BASE, ageGap: -20 });

checkTrue('10.1 ageGap=+20: no NaN', rGapPlus20.series.every(s => s.points.every(p => isFinite(p.y))));
checkTrue('10.2 ageGap=-20: no NaN', rGapMinus20.series.every(s => s.points.every(p => isFinite(p.y))));
checkTrue('10.3 ageGap=+20 and ageGap=-20 produce different outcomes',
  JSON.stringify(rGapPlus20.outcome) !== JSON.stringify(rGapMinus20.outcome) ||
  rGapPlus20.series[0].points.some((p, i) => Math.abs(p.y - rGapMinus20.series[0].points[i]?.y) > 1));

// ── Group 11: discountRate monotonicity in compute() ─────────────────────────
// A higher real discount rate must reduce the PV advantage of delaying —
// the delay plan's present value shrinks faster than the early plan's because
// it front-loads fewer dollars. Test this via the planning-age PV of each plan.

function planningAgePV(result, age) {
  // Returns series[1].y (delay) minus series[0].y (early) at the given age.
  const find = (pts) => pts.find(p => Math.abs(p.x - age) < 0.5)?.y ?? 0;
  return find(result.series[1].points) - find(result.series[0].points);
}

const rR0 = compute({ ...BASE, discountRate: 0, lifeHigh: 90, lifeLow: 90 });
const rR2 = compute({ ...BASE, discountRate: 2, lifeHigh: 90, lifeLow: 90 });
const rR5 = compute({ ...BASE, discountRate: 5, lifeHigh: 90, lifeLow: 90 });

const margin0 = planningAgePV(rR0, 90);
const margin2 = planningAgePV(rR2, 90);
const margin5 = planningAgePV(rR5, 90);

checkTrue('11.1 discountRate monotonicity: delay margin at r=0 > r=2 (at age 90)',  margin0 > margin2);
checkTrue('11.2 discountRate monotonicity: delay margin at r=2 > r=5 (at age 90)',  margin2 > margin5);
checkTrue('11.3 discountRate monotonicity: r=5 margin materially lower than r=0',   margin0 - margin5 > 50000);

// ── Group 12: lifeHigh / lifeLow at extreme slider values ────────────────────
// Slider bounds are 60–100 for both. Test all four corner combinations.

const corners = [
  [60,  60],
  [60, 100],
  [100,  60],
  [100, 100],
];
corners.forEach(([lh, ll]) => {
  const rc = compute({ ...BASE, lifeHigh: lh, lifeLow: ll });
  checkTrue(`12.x lifeHigh=${lh} lifeLow=${ll}: no NaN`,
    rc.series.every(s => s.points.every(p => isFinite(p.y))));
  checkTrue(`12.x lifeHigh=${lh} lifeLow=${ll}: outcome type valid`,
    ['earlyWins', 'delayWins', 'breakeven'].includes(rc.outcome.type));
});

// ── Done ─────────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
