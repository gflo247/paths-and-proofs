#!/usr/bin/env node
// Regression test for the RETDED (flat, non-phased-out retirement-income deduction)
// branch of computeConversionCost — currently Michigan only (see RETDED table in
// roth-conversion/index.html). Unlike the 8 RIX states, this path has never had
// automated coverage; every verification of it to date has been manual (hand-derived
// math, live-browser checks, before/after diffing during refactors — see commits
// 8ef9356, 11b0403, c3198ae). This closes that gap.
//
// Extracts the REAL cap-math lines verbatim from the shipped HTML (same philosophy as
// test-roth-rix.mjs: test the actual shipped code, not a third hand-transcription of
// it), then checks the result against an independently-derived algebraic equivalent:
// x - min(cap, x) == max(0, x - cap). Divergence means the shipped formula drifted
// from the deduction's actual shape, not that either form is "more right."

import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../roth-conversion/index.html', import.meta.url), 'utf8');
const startMarker = '} else if(rd){';
// Was briefly '} else if(stateCode===\'CT\'){' after that marker went stale once already
// this session (see git history) — now stale AGAIN because the CT and AL/NY dedicated
// branches were deleted entirely 2026-08-24 (folded into the shared core/retirement-
// rules.js dispatch), so `rix` is now the very next branch after `rd`. The rd branch's
// real end is whatever the very next branch is; keep this in sync if that changes again
// (this file IS wired into npm run verify now, so a future drift fails the build loudly
// instead of silently, unlike the first time this broke).
const endMarker = '} else if(rix){';
const startIdx = html.indexOf(startMarker);
const endIdx = html.indexOf(endMarker, startIdx);
if (startIdx === -1 || endIdx === -1) throw new Error('RETDED branch markers not found in index.html');
const body = html.slice(startIdx + startMarker.length, endIdx).replace(/stD\.cr/g, 'cr');

// curAge added 2026-08-24 alongside the conversionAgeGate fix (the rd branch now
// reads it to gate a Roth conversion's eligibility separately from ordinary
// pensionIncome) — the extracted body references it, so it must be a parameter here
// too, or the extraction throws ReferenceError instead of testing anything.
const computeRetdedDelta = new Function('rd', 'status', 'pensionIncome', 'taxableCvt', 'cr', 'curAge', `
  let cvtTxSt;
  ${body}
  return cvtTxSt;
`);

const states = JSON.parse(readFileSync(new URL('../roth-conversion/states.json', import.meta.url), 'utf8'));
const MI = states.MI.roth;
if (!MI.retDeduction) throw new Error('states.json MI.roth.retDeduction missing — test is stale');

let pass = 0, fail = 0;
function check(label, actual, expected, tolerance = 0.01) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) pass++;
  else { fail++; console.log(`FAIL  ${label}  (got=${actual}, expected=${expected})`); }
}

const statuses = ['single', 'mfj', 'mfs', 'hoh'];
const pensionAmts = [0, 30000, 67610, 67611, 100000, 135220, 135221, 200000];
const cvtAmts = [0, 5000, 20000, 50000, 100000];
const ages = [30, 45, 59, 59.5, 60, 70];
const gate = MI.retDeduction.conversionAgeGate;

let checked = 0;
for (const status of statuses) {
  const cap = MI.retDeduction[status] ?? MI.retDeduction.single;
  for (const pensionIncome of pensionAmts) {
    for (const taxableCvt of cvtAmts) {
      for (const curAge of ages) {
        checked++;
        const got = computeRetdedDelta(MI.retDeduction, status, pensionIncome, taxableCvt, MI.cr, curAge);

        // Independent algebraic derivation: the conversion only competes for the cap
        // if curAge clears conversionAgeGate (2026-08-24 MI fix) — below the gate it's
        // fully taxable regardless of the cap, while pensionIncome always competes for
        // (and can still fully use) the cap regardless of age.
        const cvtQualifies = gate == null || curAge >= gate;
        const cvtEligible = cvtQualifies ? taxableCvt : 0;
        const taxableBase = Math.max(0, pensionIncome - cap);
        const taxableWithEligible = Math.max(0, pensionIncome + cvtEligible - cap);
        const expected = (taxableWithEligible - taxableBase) + (taxableCvt - cvtEligible);
        const expectedTax = expected * MI.cr;

        check(`MI ${status} age=${curAge} cap=${cap} pension=${pensionIncome} cvt=${taxableCvt}`, got, expectedTax);
      }
    }
  }
}

console.log(`Checked ${checked.toLocaleString()} MI RETDED combinations across ${statuses.length} filing statuses and ${ages.length} ages (incl. the conversionAgeGate).`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
