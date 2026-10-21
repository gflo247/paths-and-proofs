#!/usr/bin/env node
// Tests for dual entitlement in social-security-couples/social-security.js:
// someone entitled to their own retirement benefit AND a spousal benefit.
//
// Social Security doesn't pay "the larger of the two". It pays the own benefit
// plus the spousal excess (half the partner's PIA minus your own PIA):
//   - CFR 404.411(d) + 404.407(a): with the own benefit started before full
//     retirement age (FRA), the total is the reduced own benefit plus the
//     excess reduced for age (POMS RS 00615.020, Method C).
//     https://www.ssa.gov/OP_Home/cfr20/404/404-0411.htm
//     https://www.ssa.gov/OP_Home/cfr20/404/404-0407.htm
//   - CFR 404.410(b): the excess is reduced only for months of spousal
//     entitlement before FRA, counted from when the spousal benefit starts,
//     i.e. once the partner has filed.
//   - POMS RS 00615.694: delayed credits are left out of the combined amount,
//     so at or after FRA the total IS the larger of the own benefit and the
//     full spousal amount. https://secure.ssa.gov/POMS.NSF/LNX/0300615694
//
// Imports only functions that existed before the fix, so this file runs (and
// shows which checks fail) against the old engine too.
//
// Run: node _dev/test-ss-dual-entitlement.mjs

import {
  householdMonthly, compute, workerBenefit, spousalBenefit, fraFromBirthYear, presets, inputs,
} from '../social-security-couples/social-security.js';

let passed = 0, failed = 0;
function ok(label, cond, extra = '') {
  if (cond) { passed++; console.log('ok   ', label); }
  else      { failed++; console.error('FAIL ', label, extra); }
}
const near = (a, b) => Math.abs(a - b) < 0.005;

// The lower earner's check while both are alive: household income minus the
// higher earner's own benefit (the higher earner has no top-up in these cases).
function lowerCheck(values, highAge, lowAge) {
  const highFra = fraFromBirthYear(values.birthYearHigh ?? 1960);
  const high = highAge >= values.claimHigh ? workerBenefit(values.piaHigh, values.claimHigh, highFra) : 0;
  return householdMonthly(values, true, true, highAge, lowAge) - high;
}

const defaults = Object.fromEntries(inputs.map((i) => [i.id, i.default]));
// The page's first view: $3,000 and $800 PIAs, both born 1960 (FRA 67), the
// lower earner claims at 62, the higher earner waits to 70 or claims at 62.
const onePreset = { ...defaults, ...presets['One earner, one not'] };

// ── The rule (these failed before the fix) ──────────────────────────────────
{
  const got = lowerCheck({ ...onePreset, claimHigh: 62 }, 62, 62);
  ok('both claim at 62: $560 own + 65% of the $700 excess = $1,015 (CFR 404.411(d), 404.407(a))', near(got, 1015), `got ${got}`);
}
{
  const got = lowerCheck(onePreset, 70, 70);
  ok('own at 62, top-up from 70 when the higher earner files: $560 + the full $700 = $1,260 (CFR 404.410(b))', near(got, 1260), `got ${got}`);
}
{
  // The higher earner, 2 years older, files at their 66; the lower earner is
  // then 64, 36 months before FRA, so the excess keeps 75%.
  const got = lowerCheck({ ...onePreset, birthYearHigh: 1958, claimHigh: 66 }, 66, 64);
  ok('top-up starting at 64, 36 months before FRA: $560 + 75% of $700 = $1,085', near(got, 1085), `got ${got}`);
}
{
  // POMS RS 00615.694's worked example. Born 1935 (FRA 65): own PIA $500 taken
  // at 62 (36 months early) is $400; the spouse's PIA is $1,600; the spousal
  // benefit starts at 67, after FRA, so the $300 excess isn't reduced.
  const v = { piaHigh: 1600, birthYearHigh: 1935, claimHigh: 67, piaLow: 500, birthYearLow: 1935, claimLow: 62 };
  const got = lowerCheck(v, 67, 67);
  ok('POMS RS 00615.694 worked example: $400 own + $300 excess = $700', near(got, 700), `got ${got}`);
}
{
  // The own benefit beats the reduced spousal amount ($980 vs $975), yet the
  // $100 excess is still paid on top.
  const got = lowerCheck({ ...onePreset, piaLow: 1400, claimHigh: 62 }, 62, 62);
  ok('$1,400 own PIA at 62: $980 + 65% of the $100 excess = $1,045, not $980', near(got, 1045), `got ${got}`);
}

// ── Summary cards (these failed before the fix) ─────────────────────────────
{
  const r = compute(onePreset);
  const card = (text) => r.summary.find((c) => c.label.includes(text));
  const wait = card('if the higher earner waits to 70');
  const early = card('if the higher earner claims at 62');
  ok('card: lower earner if the higher earner waits to 70 is $1260, with their own $560 until then',
    wait?.value === '$1260' && wait.label.includes('their own $560 until then'), JSON.stringify(wait));
  ok('card: lower earner if the higher earner claims at 62 is $1015, top-up flagged',
    early?.value === '$1015' && early.label.includes('spousal top-up applies'), JSON.stringify(early));
  const headline = r.summary.find((c) => c.primary);
  ok('first view: waiting wins at every lifespan shown (it said "age 87")', headline?.value === 'waiting wins', headline?.value);
}
{
  // No own record: nothing until the higher earner files, then the full
  // spousal amount if that's at or after FRA.
  const r = compute({ ...onePreset, piaLow: 0 });
  const wait = r.summary.find((c) => c.label.includes('if the higher earner waits to 70'));
  ok('card: no own record, nothing until the higher earner files at 70, then $1500',
    wait?.value === '$1500' && wait.label.includes('(nothing until then)'), JSON.stringify(wait));
}
{
  // Claiming at 70 the top-up starts at 70 either way: one card, as before.
  const r = compute({ ...onePreset, claimLow: 70 });
  const low = r.summary.filter((c) => c.label.startsWith('Lower earner'));
  ok('card: lower earner claims at 70, same check either way: one card, $1500',
    low.length === 1 && low[0].value === '$1500' && low[0].label.includes('spousal top-up applies'), JSON.stringify(low));
}

// ── Unchanged by the fix (these pass before and after) ──────────────────────
for (const claimLow of [67, 68, 70]) {
  const got = lowerCheck({ ...onePreset, claimLow }, 70, 70);
  ok(`lower earner claims at ${claimLow}, at or after FRA: the larger of own and the full $1,500 (credits not stacked)`, near(got, 1500), `got ${got}`);
}
{
  const v = { ...onePreset, piaHigh: 3200, piaLow: 1800 };
  ok('no excess (own PIA at least half the partner’s): own benefit only', near(lowerCheck(v, 70, 70), workerBenefit(1800, 62)));
}
ok('no top-up until the higher earner files: own $560 at 65', near(lowerCheck(onePreset, 65, 65), 560));
{
  // The higher earner filed at 70 and died at 84: the survivor keeps the larger
  // of their own $560 and the inherited $3,720.
  const got = householdMonthly(onePreset, false, true, 84, 84, 84, Infinity);
  ok('survivor phase unchanged: the larger of own and inherited', near(got, 3720), `got ${got}`);
}
{
  const r = compute({ ...defaults, ...presets['Both earned, uneven'] });
  ok('example without a spousal excess keeps four cards and its own-benefit card',
    r.summary.length === 4 && r.summary[2].label.includes('their own benefit is larger') && r.summary[2].value === '$1800',
    JSON.stringify(r.summary.map((c) => c.value)));
}

// ── Sweep: against "the larger of own vs spousal at the own claim age" ──────
// The fix may only raise a both-alive check (never lower it), and must leave it
// unchanged whenever that person claims at or after FRA or has no excess.
{
  const largerOf = (pia, claim, fra, partnerPia, filed, partnerFiled) => {
    if (!filed) return 0;
    const own = workerBenefit(pia, claim, fra);
    return partnerFiled ? Math.max(own, spousalBenefit(partnerPia, claim, fra)) : own;
  };
  let states = 0, lower = 0, changedWhereItShouldnt = 0, raised = 0;
  for (const piaHigh of [1000, 2000, 3000, 4000])
  for (const piaLow of [0, 400, 800, 1200, 1600, 2400])
  for (const birthYearHigh of [1955, 1958, 1960, 1963])
  for (const birthYearLow of [1956, 1960])
  for (const claimHigh of [62, 64, 66, 67, 68, 70])
  for (const claimLow of [62, 63, 65, 66, 67, 69, 70]) {
    const v = { piaHigh, piaLow, birthYearHigh, birthYearLow, claimHigh, claimLow };
    const gap = birthYearLow - birthYearHigh;
    const highFra = fraFromBirthYear(birthYearHigh), lowFra = fraFromBirthYear(birthYearLow);
    for (let lowAge = 62; lowAge <= 80; lowAge += 2) {
      const highAge = lowAge + gap;
      const highFiled = highAge >= claimHigh, lowFiled = lowAge >= claimLow;
      const reference = largerOf(piaHigh, claimHigh, highFra, piaLow, highFiled, lowFiled)
                      + largerOf(piaLow, claimLow, lowFra, piaHigh, lowFiled, highFiled);
      const got = householdMonthly(v, true, true, highAge, lowAge);
      states++;
      if (got < reference - 1e-9) lower++;
      if (got > reference + 1e-9) raised++;
      const lowSame = claimLow >= lowFra || piaLow >= piaHigh / 2;
      const highSame = claimHigh >= highFra || piaHigh >= piaLow / 2;
      if (lowSame && highSame && Math.abs(got - reference) > 1e-9) changedWhereItShouldnt++;
    }
  }
  ok(`sweep (${states} both-alive states): never below the larger-of rule`, lower === 0, `${lower} lower`);
  ok('sweep: identical wherever the claim is at or after FRA or there is no excess', changedWhereItShouldnt === 0, `${changedWhereItShouldnt} changed`);
  console.log(`      (${raised} states raised: claims before FRA with a spousal excess)`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
