#!/usr/bin/env node
// Tests for inflation in the life insurance tool's policy sizing.
//
// Needs are in today's dollars, but a level term policy pays a fixed dollar
// amount. A face of F paid t years from now is worth F / (1 + inflation)^t
// today, so a policy only covers year t's need if F >= need(t) x (1 +
// inflation)^t. The same goes for an existing term policy counted in "have".
//
// Run: node _dev/test-life-inflation.mjs

import { fitPolicies, scenarioByYear } from '../life-insurance/life-engine.mjs';
import { compute, inputs, presets } from '../life-insurance/life-insurance.js';

let passed = 0, failed = 0;
function ok(label, cond, extra = '') {
  if (cond) { passed++; console.log('ok   ', label); }
  else      { failed++; console.error('FAIL ', label, extra); }
}

// Worst shortfall, in today's dollars, of a set of policies against a need curve.
function shortfall(need, policies, inflation, horizon) {
  let worst = 0, at = -1;
  for (let t = 0; t < Math.min(need.length, horizon); t++) {
    let real = 0;
    for (const p of policies) if (t < p.term) real += p.face / Math.pow(1 + inflation, t);
    if (need[t] - real > worst) { worst = need[t] - real; at = t; }
  }
  return { worst, at };
}

// ── fitPolicies sizes faces for each year's need after inflation (failed before) ──
{
  // $400k a year for 10 years, then $300k for 10 more: by year 19, $300k of
  // today's money costs $300k x 1.025^19 = $479,600 in that year's dollars.
  const need = [...Array(10).fill(400000), ...Array(10).fill(300000)];
  const pol = fitPolicies(need, 19, 0.025);
  ok('single policy: face covers year 19 after inflation ($500k, not $400k)', pol.singlePolicy.face === 500000, JSON.stringify(pol.singlePolicy));
  const s = shortfall(need, [pol.singlePolicy], 0.025, pol.singlePolicy.term);
  ok('single policy: no year short in today’s dollars', s.worst <= 0.01, JSON.stringify(s));
}
{
  // A declining curve where a ladder pays off: the long policy must cover the
  // later years in their own dollars.
  const need = [...Array(10).fill(900000), ...Array(10).fill(250000)];
  const pol = fitPolicies(need, 19, 0.03);
  ok('ladder returned for a steeply declining need', pol.ladder !== null, JSON.stringify(pol));
  if (pol.ladder) {
    const s = shortfall(need, [pol.ladder.short, pol.ladder.long], 0.03, pol.ladder.long.term);
    ok('ladder: no year short in today’s dollars', s.worst <= 0.01, JSON.stringify(s));
  }
}

// ── Each example's suggestion covers every year of its term (failed before) ──
{
  const base = Object.fromEntries(inputs.filter((i) => i.id).map((i) => [i.id, i.default]));
  const bad = [];
  for (const [name, p] of Object.entries(presets)) for (const scenario of ['you', 'spouse']) {
    const r = compute({ ...base, ...p, scenario });
    const { pol, primary } = r._extra; if (!pol.singlePolicy) continue;
    const need = primary.map((q) => q.need), infl = p.inflation / 100;
    const policies = pol.ladder ? [pol.ladder.short, pol.ladder.long] : [pol.singlePolicy];
    const term = pol.ladder ? pol.ladder.long.term : pol.singlePolicy.term;
    const s = shortfall(need, policies, infl, term);
    if (s.worst > 0.01) bad.push(`${name}/${scenario}: $${Math.round(s.worst).toLocaleString()} short at year ${s.at}`);
    // The chart line is in today's dollars too.
    const line = r.series.find((x) => x.name === 'With suggested policies');
    const t = Math.min(12, primary.length - 1);
    const face = policies.reduce((sum, q) => sum + (t < q.term ? q.face : 0), 0);
    if (!line || Math.abs(line.points[t].y - (primary[t].have + face / Math.pow(1 + infl, t))) > 0.01) bad.push(`${name}/${scenario}: chart line at year ${t} not in today's dollars`);
  }
  ok('every example’s suggested policies cover each year of their term, after inflation', bad.length === 0, bad.join('; '));
}

// ── An existing term policy counts at its value after inflation (failed before) ──
{
  const base = Object.fromEntries(inputs.filter((i) => i.id).map((i) => [i.id, i.default]));
  const v = { ...base, ...presets['Two earners, preschooler'], youTermCoverage: 500000, youTermYearsLeft: 20, inflation: 2.5 };
  const without = scenarioByYear({ ...v, youTermCoverage: 0, youTermYearsLeft: 0 }, 'you');
  const withPolicy = scenarioByYear(v, 'you');
  const added10 = withPolicy[10].have - without[10].have;
  ok('existing $500k policy adds $500k / 1.025^10 = $390,599 of "have" at year 10', Math.abs(added10 - 500000 / Math.pow(1.025, 10)) < 0.01, `got ${added10}`);
  ok('...and the full $500k if it happened today', Math.abs(withPolicy[0].have - without[0].have - 500000) < 0.01);
}

// ── Unchanged (pass before and after) ──
{
  const need = [...Array(10).fill(400000), ...Array(10).fill(300000)];
  const a = fitPolicies(need, 19), b = fitPolicies(need, 19, 0);
  ok('no inflation argument (or 0) sizes faces exactly as before', JSON.stringify(a) === JSON.stringify(b) && a.singlePolicy.face === 400000);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
