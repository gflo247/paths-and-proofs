#!/usr/bin/env node
// Stress test for social-security.js building blocks and computeSurface().
// Complements test-social-security.mjs (which focuses on survivor rules,
// RIB-LIM, ageGap, death-order logic, and buildVerdict). This file covers:
//   - workerBenefit / spousalBenefit directly at every key age
//   - discount rate flowing through computeSurface
//   - surface structure: key cells, directional relationships, asymmetries
//   - one-earner household (piaLow=0)
//   - negative ageGap (higher earner younger than lower earner)
//   - claimLow variation

import {
  workerBenefit,
  spousalBenefit,
  survivorBenefit,
  householdMonthly,
  computeSurface,
  FULL_RETIREMENT_AGE,
  SURVIVOR_FULL_RETIREMENT_AGE,
} from '../social-security/social-security.js';

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

// ── Group 1: workerBenefit ────────────────────────────────────────────────────
// Verify the reduction/credit formula at every meaningful breakpoint.
// Source: CFR 404.410(a) (reduction) and CFR 404.313 (credits).

// Claim at 62 (max reduction): 60 months early.
// First 36 months: 36 × 5/9 / 100 = 20%. Next 24 months: 24 × 5/12 / 100 = 10%. Total: 30%.
check('workerBenefit: claim at 62 = 70% of PIA (30% reduction)', workerBenefit(3000, 62), 2100);

// Claim at 63 (48 months early):
// First 36: 20%. Next 12: 12 × 5/12 / 100 = 5%. Total: 25%.
check('workerBenefit: claim at 63 = 75% of PIA (25% reduction)', workerBenefit(3000, 63), 2250);

// Claim at 65 (24 months early): only the first-bracket formula applies.
// 24 × 5/9 / 100 = 13.333%.
check('workerBenefit: claim at 65 = 86.67% of PIA', workerBenefit(3000, 65), 3000 * (1 - 24 * 5 / 9 / 100), 0.01);

// Claim at FRA=67: no reduction, no credit.
check('workerBenefit: claim at 67 (FRA) = 100% of PIA', workerBenefit(3000, 67), 3000);

// Claim at 68 (12 months late): 12 × 2/3 / 100 = 8% credit.
check('workerBenefit: claim at 68 = 108% of PIA', workerBenefit(3000, 68), 3000 * 1.08, 0.01);

// Claim at 70 (max credit, 36 months late): 36 × 2/3 / 100 = 24%.
check('workerBenefit: claim at 70 = 124% of PIA', workerBenefit(3000, 70), 3720);

// Claim at 71: credits stop at 70 — must equal claim-at-70.
check('workerBenefit: claim at 71 is clamped to 70 (credits stop at 70)', workerBenefit(3000, 71), workerBenefit(3000, 70));

// ── Group 2: spousalBenefit ──────────────────────────────────────────────────
// Source: CFR 404.410(b). Unreduced = 50% of partner's PIA.
// Reduction uses a DIFFERENT rate from worker formula: 25/36 per month (first
// 36), then 5/12 per month (beyond 36). No delayed credits — benefit never
// exceeds 50% of partner's PIA regardless of how long claiming is delayed.

// Claim at FRA or later: unreduced (50% of partner PIA).
check('spousalBenefit: claim at FRA = 50% of partner PIA', spousalBenefit(3000, 67), 1500);
check('spousalBenefit: claim at 70 = same as FRA (no credits)', spousalBenefit(3000, 70), 1500);

// Claim at 62 (max reduction): 60 months early.
// First 36: 36 × 25/36 / 100 = 25%. Next 24: 24 × 5/12 / 100 = 10%. Total: 35%.
check('spousalBenefit: claim at 62 = 65% of unreduced (35% reduction)', spousalBenefit(3000, 62), 1500 * 0.65);

// Claim at 65 (24 months early): first-bracket only.
// 24 × 25/36 / 100 = 16.667%.
check('spousalBenefit: claim at 65 = 83.33% of unreduced', spousalBenefit(3000, 65), 1500 * (1 - 24 * 25 / 36 / 100), 0.01);

// The spousal formula is genuinely different from the worker formula.
// At 62, spousalBenefit(3000,62)=975 while workerBenefit(1500,62)=1050.
// (Same PIA base, same claim age, different rates → different result.)
checkTrue('spousalBenefit formula differs from workerBenefit formula at 62',
  spousalBenefit(3000, 62) !== workerBenefit(1500, 62));
checkTrue('spousalBenefit at 62 < workerBenefit at same effective PIA (25/36 > 5/9 reduction)',
  spousalBenefit(3000, 62) < workerBenefit(1500, 62));

// ── Group 3: computeSurface — discount rate flows correctly ───────────────────
// A higher real discount rate makes the early-claiming option look better
// (you can invest the early income). The delay premium must shrink
// monotonically, and can turn negative (early wins) at a high enough rate.

const baseVals = {
  piaHigh: 3000, claimHigh: 70, claimHighEarly: 62,
  piaLow:  1200, claimLow:  62, ageGap: 0,
  lifeHigh: 84,  lifeLow:  87,
};

const surf_r0 = computeSurface({ ...baseVals, discountRate: 0 }, 2);
const surf_r2 = computeSurface({ ...baseVals, discountRate: 2 }, 2);
const surf_r5 = computeSurface({ ...baseVals, discountRate: 5 }, 2);

const findCell = (surf, hd, ld) => surf.cells.find(c => c.highDeath === hd && c.lowDeath === ld);

const m_r0 = findCell(surf_r0, 90, 90).margin;
const m_r2 = findCell(surf_r2, 90, 90).margin;
const m_r5 = findCell(surf_r5, 90, 90).margin;

checkTrue('computeSurface: delay wins at 0% discount (hd=90, ld=90)', m_r0 > 0);
checkTrue('computeSurface: delay margin shrinks from 0% to 2% discount', m_r2 < m_r0);
checkTrue('computeSurface: delay margin shrinks from 2% to 5% discount', m_r5 < m_r2);
checkTrue('computeSurface: at 5% discount, delay premium is materially smaller than at 0%',
  m_r0 - m_r5 > 50000); // a couple's 28yr SS stream — time value should be large
check('computeSurface: r=0 discount rate matches exact undiscounted sum (i===0 branch)',
  m_r0, 174240, 500); // matches known value from spot-check run

// ── Group 4: computeSurface — surface structure (heatmap integrity) ───────────
// Key invariants that must hold for the colored cells to mean what the labels say.

// hd=60: higher earner dies before any claiming age (62 for either strategy).
// Neither strategy has filed → same survivor base (100% PIA) for lower earner
// under both plans → margin must be exactly 0 regardless of lower earner lifespan.
const surf_base = surf_r2;
const c60_90 = findCell(surf_base, 60, 90);
const c60_80 = findCell(surf_base, 60, 80);
check('computeSurface: hd=60, ld=90 — margin=0 (higher earner died unfiled under both strategies)', c60_90.margin, 0, 1);
check('computeSurface: hd=60, ld=80 — margin=0 (same; independent of lower earner lifespan)', c60_80.margin, 0, 1);

// hd=62: planEarly filed at 62 (RIB-LIM floors survivor to 82.5% PIA),
// planDelay didn't file (base=100% PIA). Lower earner gets ~17.5% more PIA
// per month for ~28 survivor years → delay wins by a meaningful, positive margin.
const c62_90 = findCell(surf_base, 62, 90);
checkTrue('computeSurface: hd=62, ld=90 — delay wins (RIB-LIM vs full-PIA survivor base)', c62_90.margin > 50000);

// For a high-earner-dominant couple (piaHigh >> piaLow), the LOWER-RIGHT
// (higher earner lives long, lower earner dies young) produces a LARGER delay
// margin than the upper-left (higher earner dies young, lower earner lives
// long). The higher earner's own 38-year benefit stream at 3720/mo outweighs
// the survivor-benefit-difference channel in the upper-left. Both cells are
// positive (delay wins), but lower-right > upper-left for typical PIAs.
const c62_90_m  = findCell(surf_base, 62, 90).margin;
const c90_62_m  = findCell(surf_base, 90, 62).margin;
checkTrue('computeSurface: both upper-left (hd=62,ld=90) and lower-right (hd=90,ld=62) show delay winning',
  c62_90_m > 0 && c90_62_m > 0);
checkTrue('computeSurface: lower-right (hd=90,ld=62) has larger delay margin than upper-left (hd=62,ld=90) for piaHigh-dominant couple',
  c90_62_m > c62_90_m);

// Both live long (hd=90, ld=90): delay wins decisively at 2% discount.
const c90_90 = findCell(surf_base, 90, 90);
checkTrue('computeSurface: hd=90, ld=90 — delay wins at 2% discount', c90_90.margin > 0);

// hd=60, ld=60: both die at/before AGE_START — degenerate case, must be 0 and not NaN.
const c60_60 = findCell(surf_base, 60, 60);
check('computeSurface: hd=60, ld=60 — margin=0, no NaN/crash', c60_60.margin, 0, 1);
checkTrue('computeSurface: hd=60, ld=60 — margin is a finite number', isFinite(c60_60.margin));

// Lower earner dies first (ld < hd): exercises the !highAlive && lowAlive branch
// in a scenario where the lower earner dies before the higher earner.
// Delay must still produce a positive margin when the higher earner lives long.
const c90_70 = findCell(surf_base, 90, 70);
checkTrue('computeSurface: ld=70, hd=90 (lower dies first) — produces a finite, non-NaN margin',
  isFinite(c90_70.margin));

// ── Group 5: one-earner household (piaLow=0) ─────────────────────────────────
// The lower earner has no own record. They depend entirely on spousal (while
// both alive) and survivor (after higher earner dies) benefits.

const oneEarnerVals = { ...baseVals, piaLow: 0, claimLow: 62, discountRate: 0 };
const surf_one = computeSurface(oneEarnerVals, 2);

checkTrue('computeSurface: piaLow=0 — does not throw or produce NaN cells',
  surf_one.cells.every(c => isFinite(c.margin)));

// With piaLow=0, the lower earner's own worker benefit is 0 at any age.
// The household relies entirely on the higher earner's record, so the survivor
// benefit from the higher earner is paramount — delay should still win when
// both live long.
const one_c90_90 = findCell(surf_one, 90, 90);
checkTrue('computeSurface: piaLow=0, both live long — delay still wins (survivor benefit dominates)',
  one_c90_90.margin > 0);

// Spousal benefit while both alive: lower earner gets spousalBenefit(piaHigh, claimLow).
// householdMonthly should not produce 0 for the lower earner while both alive
// if the higher earner has filed (spousal gate is satisfied).
const vOne = { piaHigh: 3000, claimHigh: 67, piaLow: 0, claimLow: 67 };
const gotBothAlive = householdMonthly(vOne, true, true, 70, 70);
const expectedSpousal = spousalBenefit(3000, 67); // 1500
const expectedWorker  = workerBenefit(3000, 67);  // 3000
check('householdMonthly: piaLow=0 both alive — lower earner draws full spousal benefit',
  gotBothAlive, expectedWorker + expectedSpousal, 0.01);

// ── Group 6: negative ageGap (higher earner is younger) ──────────────────────
// ageGap<0 means the higher earner is younger. Clock conversion:
// highDeathAgeOnClock = highDeathAge - ageGap = highDeathAge + |ageGap|.
// Test that the surface computes finite margins without crashing, and that
// a plausible cell gives a directionally-correct result.

const negGapVals = { ...baseVals, discountRate: 0, ageGap: -5 };
const surf_neg  = computeSurface(negGapVals, 2);

checkTrue('computeSurface: negative ageGap — no NaN cells',
  surf_neg.cells.every(c => isFinite(c.margin)));

// With ageGap=-5, higher earner (younger by 5) lives longer relative to the
// lower-earner clock. For hd=90, ld=90 the higher earner is 95 on their own
// clock. Still expect delay to win at 0% discount over long lifespans.
const neg_c90_90 = findCell(surf_neg, 90, 90);
checkTrue('computeSurface: negative ageGap, hd=90 ld=90 — delay wins at 0% discount',
  neg_c90_90.margin > 0);

// Reversing ageGap should change the margin (not produce the same result).
checkTrue('computeSurface: ageGap=+5 and ageGap=-5 produce different margins for the same cell',
  findCell(computeSurface({ ...baseVals, discountRate: 0, ageGap:  5 }, 2), 90, 90).margin !==
  findCell(computeSurface({ ...baseVals, discountRate: 0, ageGap: -5 }, 2), 90, 90).margin);

// ── Group 7: claimLow variation ───────────────────────────────────────────────
// claimLow affects when the spousal top-up kicks in while both are alive,
// which in turn changes how many months the lower earner receives a spousal
// benefit vs their own worker benefit. Varying claimLow must change the margin.

const surf_low62 = computeSurface({ ...baseVals, discountRate: 0, claimLow: 62 }, 2);
const surf_low70 = computeSurface({ ...baseVals, discountRate: 0, claimLow: 70 }, 2);

const m62 = findCell(surf_low62, 90, 90).margin;
const m70 = findCell(surf_low70, 90, 90).margin;
checkTrue('computeSurface: claimLow=70 produces a different margin than claimLow=62',
  Math.abs(m62 - m70) > 1000);

// claimLow affects absolute plan values but not the DIRECTION of delay-vs-early
// for the higher earner when both live to 90.
checkTrue('computeSurface: delay still wins at claimLow=70, hd=90 ld=90', m70 > 0);

// ── Group 8: grid structure ───────────────────────────────────────────────────
// Sanity checks on the returned ages array and cells array shape.

const { ages, cells } = surf_r2;
checkTrue('computeSurface: ages grid starts at 60', ages[0] === 60);
checkTrue('computeSurface: ages grid ends at 100', ages[ages.length - 1] === 100);
checkTrue('computeSurface: ages grid uses step=2 (21 values from 60 to 100)',
  ages.length === 21);
checkTrue('computeSurface: cells count = ages² = 441', cells.length === 441);
checkTrue('computeSurface: every cell has highDeath, lowDeath, and a finite margin',
  cells.every(c =>
    typeof c.highDeath === 'number' &&
    typeof c.lowDeath  === 'number' &&
    isFinite(c.margin)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
