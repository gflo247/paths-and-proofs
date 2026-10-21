#!/usr/bin/env node
// Tests for the survivor (widow(er)'s) benefit in
// social-security-couples/social-security.js.
//
// The widow(er)'s limit (RIB-LIM) is a CAP on the survivor's age-reduced
// benefit, not a base the age reduction is applied to:
//   - CFR 404.338(c): when the deceased claimed before full retirement age
//     (FRA), the survivor's benefit "will be reduced to the amount the insured
//     person would be receiving if alive, or 82 1/2 percent of his or her
//     primary insurance amount, whichever is larger."
//     https://www.ssa.gov/OP_Home/cfr20/404/404-0338.htm
//   - POMS RS 00615.320 A.3: it "will apply when the WIB after adjustment for
//     the family maximum and reduction for age is more than BOTH 82 1/2 percent
//     of the NH's death PIA and the RIB ... if they were alive."
//     https://secure.ssa.gov/POMS.NSF/LNX/0300615320
//   - The age reduction itself (CFR 404.410(c)(1)) is taken off the deceased's
//     PIA, or their benefit with delayed credits if that is larger (POMS RS
//     00615.301 A.3).
//
// Run: node _dev/test-ss-survivor.mjs

import { survivorBenefit, workerBenefit, householdMonthly, computeSurface, SURVIVOR_FULL_RETIREMENT_AGE } from '../social-security-couples/social-security.js';
import * as ss from '../social-security-couples/social-security.js';   // convertedAtDeath may be missing on older engines

let passed = 0, failed = 0;
function ok(label, cond, extra = '') {
  if (cond) { passed++; console.log('ok   ', label); }
  else      { failed++; console.error('FAIL ', label, extra); }
}
const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;
const SFRA = SURVIVOR_FULL_RETIREMENT_AGE;   // 66y8mo for the 1960 cohort
// The survivor's age reduction at a given age: 28.5% x months before FRA / months from 60 to FRA.
const reductionAt = (age) => 0.285 * Math.round((SFRA - Math.max(60, Math.min(age, SFRA))) * 12) / Math.round((SFRA - 60) * 12);

// ── The widow's limit is a cap after the age reduction (failed before the fix) ──
// $3,000 PIA claimed at 62: the deceased was getting $2,100, so the cap is $2,475 (82.5%).
{
  const got = survivorBenefit(3000, 62, 60);
  ok('survivor at 60: $3,000 less 28.5% = $2,145, under the $2,475 cap (it was $1,770)', near(got, 2145), `got ${got}`);
}
{
  const got = survivorBenefit(3000, 62, 63);
  ok('survivor at 63: $3,000 less 15.7% = $2,530, so the $2,475 cap is paid (it was $2,087)', near(got, 2475), `got ${got}`);
}
{
  const got = survivorBenefit(3000, 62, 65);
  ok('survivor at 65: the $2,475 cap (it was $2,299)', near(got, 2475), `got ${got}`);
}
{
  // Independent formula across early claim ages and survivor ages under FRA.
  let bad = [];
  for (const claimAge of [62, 63, 64, 65, 66]) {
    const actual = workerBenefit(2400, claimAge);
    const cap = Math.max(actual, 2400 * 0.825);
    for (let age = 60; age <= 67; age += 0.5) {
      const expected = Math.min(2400 * (1 - reductionAt(age)), cap);
      const got = survivorBenefit(2400, claimAge, age);
      if (!near(got, expected)) bad.push(`claim ${claimAge}, survivor ${age}: got ${got.toFixed(2)}, expected ${expected.toFixed(2)}`);
    }
  }
  ok('sweep: smaller of the age-reduced PIA and the cap, for every early claim and survivor age', bad.length === 0, bad.slice(0, 3).join('; '));
}

// ── Unchanged (pass before and after) ──
ok('survivor at or past FRA: the $2,475 cap', near(survivorBenefit(3000, 62, SFRA), 2475) && near(survivorBenefit(3000, 62, 75), 2475));
ok('deceased claimed at FRA (no cap): survivor at 60 gets $3,000 less 28.5% = $2,145', near(survivorBenefit(3000, 67, 60), 2145));
ok('deceased delayed to 70 (no cap): survivor at 60 gets $3,720 less 28.5% = $2,659.80', near(survivorBenefit(3000, 70, 60), 3720 * 0.715));
ok('deceased died at 65 without filing (no cap): survivor at 60 gets $2,145', near(survivorBenefit(3000, 70, 60, 65), 2145));
{
  // POMS RS 00615.320's example: reduced benefit $350 on a $374.90 PIA (12
  // months early, FRA 65); the widow files at 66, past FRA. 82.5% of the PIA is
  // $309.20, so the larger, $350, is paid. (The tool doesn't round to dimes.)
  const got = survivorBenefit(374.90, 64, 66, Infinity, 65, 65);
  ok('POMS RS 00615.320 example: $350 (the deceased’s benefit beats 82.5% of PIA)', near(got, 374.90 * (1 - 12 * 5 / 9 / 100), 0.01) && Math.abs(got - 350) < 0.1, `got ${got}`);
}

// ── The age reduction is fixed when the survivor benefit starts ─────────────
// CFR 404.410(c)(1) counts "the number of months of entitlement prior to" FRA,
// and POMS RS 00615.301 B.1.c sets it once ("entitled beginning 7/2002 ... RF
// is 37"). So a reduced survivor benefit stays reduced; it doesn't grow back
// to the full amount at FRA. A survivor under FRA at the death can instead
// wait for the full amount (living on their own benefit meanwhile), unless
// Social Security switches them over automatically (POMS RS 00207.005 C).
// https://secure.ssa.gov/POMS.NSF/LNX/0300615301
// https://secure.ssa.gov/POMS.NSF/LNX/0300207005
{
  // $3,000 PIA, planning to wait to 70, dies at 64 without filing (no cap).
  // The survivor, also 64 (survivor FRA 66y8m), starts now: 32 of 80 months early.
  const v = { piaHigh: 3000, claimHigh: 70, piaLow: 1200, claimLow: 62 };
  const at64 = householdMonthly(v, false, true, 64, 64, 64, Infinity);
  const at70 = householdMonthly(v, false, true, 70, 70, 64, Infinity);
  ok('survivor starting at 64 gets $3,000 less 11.4% = $2,658', near(at64, 2658), `got ${at64}`);
  ok('...and still $2,658 at 70, not the full $3,000 (the reduction doesn’t shrink)', near(at70, 2658), `got ${at70}`);
  const wait64 = householdMonthly(v, false, true, 64, 64, 64, Infinity, true);
  const wait67 = householdMonthly(v, false, true, 67, 67, 64, Infinity, true);
  ok('waiting instead: their own $840 until survivor FRA, then the full $3,000', near(wait64, 840) && near(wait67, 3000), `got ${wait64}, ${wait67}`);
}
{
  // A survivor younger than 60 at the death starts at 60, with the full 28.5%
  // reduction for life. Higher earner 10 years older (FRA 66), dies at 68
  // without filing: base is the $3,000 PIA plus 2 years of credits = $3,480.
  const v = { piaHigh: 3000, birthYearHigh: 1950, claimHigh: 70, piaLow: 0, birthYearLow: 1960, claimLow: 62 };
  const at59 = householdMonthly(v, false, true, 69, 59, 68, Infinity);
  const at60 = householdMonthly(v, false, true, 70, 60, 68, Infinity);
  const at75 = householdMonthly(v, false, true, 85, 75, 68, Infinity);
  ok('survivor under 60 at the death: nothing until 60, then $3,480 less 28.5% = $2,488.20 for life',
    at59 === 0 && near(at60, 2488.2) && near(at75, 2488.2), `got ${at59}, ${at60}, ${at75}`);
}
{
  const conv = ss.convertedAtDeath;
  const v = { piaHigh: 3000, claimHigh: 67, piaLow: 0, claimLow: 62 };
  ok('converted automatically: no benefit of their own, already getting a spousal benefit, 62+', !!conv && conv(v, true, 64, 69) === true);
  ok('not converted (can wait): has their own benefit, so must elect a reduced survivor benefit',
    !!conv && conv({ ...v, piaLow: 500 }, true, 64, 69) === false);
  ok('not converted: the deceased hadn’t filed, so no spousal benefit to convert',
    !!conv && conv(v, true, 64, 66) === false && conv(v, true, 61, 69) === false);
}
{
  // The same household with no own record ($0) vs a token one ($1): with $0
  // the survivor (64, getting a spousal benefit) is switched to the reduced
  // survivor benefit at the death; with $1 they can wait for the full amount.
  // Higher earner 5 years older, files at 67 in the earlier plan, dies at 69.
  const plan = (piaLow) => ({ piaHigh: 3000, birthYearHigh: 1955, claimHigh: 70, claimHighEarly: 67, piaLow, birthYearLow: 1960, claimLow: 62, discountRate: 0 });
  const cell = (s) => s.cells.find((c) => c.highDeath === 69 && c.lowDeath === 100).margin;
  const converted = cell(computeSurface(plan(0), 1)), canWait = cell(computeSurface(plan(1), 1));
  ok('an automatically converted survivor can’t wait: the claim-earlier plan is worth ~$55k less',
    converted - canWait > 50000 && converted - canWait < 60000, `diff ${(converted - canWait).toFixed(0)}`);
}
{
  // The heatmap cell the shrinking reduction inflated most: higher earner dies
  // at 62, lower lives to 90, 2% discount. Waiting's lead was ~$119k.
  const s = computeSurface({ piaHigh: 3000, claimHigh: 70, claimHighEarly: 62, piaLow: 1200, claimLow: 62, discountRate: 2 }, 2);
  const margin = s.cells.find((c) => c.highDeath === 62 && c.lowDeath === 90).margin;
  ok('heatmap, higher earner dies at 62: waiting leads by ~$38.9k, not ~$119.3k', Math.abs(margin - 38858.35) < 1, `got ${margin.toFixed(2)}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
