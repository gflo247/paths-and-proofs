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

import { survivorBenefit, workerBenefit, SURVIVOR_FULL_RETIREMENT_AGE } from '../social-security-couples/social-security.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
