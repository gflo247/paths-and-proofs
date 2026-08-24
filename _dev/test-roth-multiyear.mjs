#!/usr/bin/env node
// Regression test for computeMultiYear()'s per-row age handling — added 2026-08-24
// alongside a fix for a real, previously-undiscovered bug: computeMultiYear used to
// compute conversion tax ONCE per phase (at today's age), then linearly scale that
// single figure across every row via cv/planConvert, so any age-gated mechanism
// (MI's RETDED conversionAgeGate, EXAGE's ex:true-state age gate, every RIX_STATES
// age-tiered cap) and the federal senior deduction (nSr) silently never updated for
// rows representing FUTURE ages — even when a plan's own timeline crossed the
// relevant threshold. Confirmed live before the fix: a 55yo MI filer converting
// through age 64 showed a flat $4,320/yr total tax for all ten years, when ages
// 60-64 should show MI's shelter kick in (the correct age-62 figure: $2,620/yr).
//
// Extracts the REAL computeMultiYear/computeConversionCost/ST/RETDED/EXAGE/RIX
// definitions verbatim from the shipped HTML via jsdom (same approach as
// test-roth-rix.mjs — test the actual shipped code, not a third hand-transcription
// of it), then asserts a concrete before/after delta at each mechanism's threshold,
// not just "some number came back."

import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolveRetirementIncome, federalTaxableSS } from '../core/retirement-rules.js';

// computeMultiYear's golden-window phase reads document.getElementById('retSS' etc.)
// directly, so the stub body needs those inputs present even though most scenarios
// here only exercise the pre-retirement phase (which never touches the DOM).
const vc = new VirtualConsole();
const dom = new JSDOM(`<!doctype html><body>
  <input id="retSS"><input id="retPen"><input id="retOther">
  <input id="niiIncome"><input id="ltcgIncome">
</body>`, { virtualConsole: vc });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.matchMedia = () => ({ matches: true });
// Same harness-only quirk documented in test-roth-rix.mjs: bind on both window and
// Node's own globalThis, since the two aren't the same object in this sandbox.
globalThis.window.resolveRetirementIncome = resolveRetirementIncome;
globalThis.window.calcTaxableSS = federalTaxableSS;
globalThis.resolveRetirementIncome = resolveRetirementIncome;
globalThis.calcTaxableSS = federalTaxableSS;

const html = readFileSync(new URL('../roth-conversion/index.html', import.meta.url), 'utf8');
const marker = 'function computeConversionCost';
const markerIdx = html.indexOf(marker);
if (markerIdx === -1) throw new Error('computeConversionCost not found in index.html');
const scriptStart = html.lastIndexOf('<script>', markerIdx) + '<script>'.length;
const scriptEnd = html.indexOf('</script>', markerIdx);
const scriptSrc = html.slice(scriptStart, scriptEnd);
// computeMultiYear (defined earlier in the same classic <script> block as
// computeConversionCost) comes along for free with this same extraction window.
const { computeMultiYear, computeConversionCost, ST } = new Function(scriptSrc + '\nreturn {computeMultiYear, computeConversionCost, ST};')();

function setRet(ss, pen, other, nii, ltcg) {
  document.getElementById('retSS').value = String(ss);
  document.getElementById('retPen').value = String(pen);
  document.getElementById('retOther').value = String(other);
  document.getElementById('niiIncome').value = String(nii);
  document.getElementById('ltcgIncome').value = String(ltcg);
}
setRet(0, 0, 0, 0, 0);

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) pass++;
  else { fail++; console.log(`FAIL  ${label}`); }
}

// --- 1. MI conversionAgeGate (RETDED): pre-retirement rows must show the shelter
// kick in exactly at the row whose age crosses 59.5, not stay frozen at today's
// (pre-gate) figure for the whole plan. Matches the exact scenario that found the
// bug: single, curAge=55, retAge=65, $40k/yr. ---
{
  const plan = computeMultiYear(0, 0, 0, 0, 'single', 500000, 0, 0, 0.05, 0, ST.MI, 'MI', 0, 55, 65, 1, 40000, undefined, false, 0);
  const preGate = plan.preRows.filter(r => r.age < 59.5);
  const postGate = plan.preRows.filter(r => r.age >= 59.5);
  check('MI: exactly 5 rows before the 59.5 gate (ages 55-59)', preGate.length === 5);
  check('MI: exactly 5 rows at/after the gate (ages 60-64)', postGate.length === 5);
  check('MI: rows before the gate all show the same (unsheltered) tax', preGate.every(r => r.tax === preGate[0].tax));
  check('MI: rows at/after the gate all show a lower (sheltered) tax than pre-gate rows', postGate.every(r => r.tax < preGate[0].tax));
  check('MI: age-62 row matches the hand-verified sheltered figure ($2,620)', plan.preRows.find(r => r.age === 62).tax === 2620);
  check('MI: pre-gate rows match the hand-verified unsheltered figure ($4,320)', preGate[0].tax === 4320);
}

// --- 2. MI golden window: base age is goldStartAge, NOT curAge -- a golden window
// starting well past today (retiring young) must still correctly cross 59.5 partway
// through, rather than being priced at today's (much younger) curAge for its whole
// span. curAge=45, retAge=52 -> goldStartAge=52, ages 52-61. ---
{
  setRet(0, 20000, 0, 0, 0);
  const plan = computeMultiYear(0, 0, 0, 0, 'single', 500000, 0, 0, 0.05, 0, ST.MI, 'MI', 0, 45, 52, 1, 40000, undefined, false, 0);
  const preGate = plan.goldRows.filter(r => r.age < 59.5);
  const postGate = plan.goldRows.filter(r => r.age >= 59.5);
  check('MI golden: exactly 8 rows before 59.5 (ages 52-59), despite curAge=45', preGate.length === 8);
  check('MI golden: exactly 2 rows at/after 59.5 (ages 60-61)', postGate.length === 2);
  check('MI golden: rows before the gate all match each other', preGate.every(r => r.tax === preGate[0].tax));
  check('MI golden: rows at/after the gate show a lower (sheltered) tax', postGate.every(r => r.tax < preGate[0].tax));
  setRet(0, 0, 0, 0, 0);
}

// --- 3. EXAGE (Mississippi, ex:true, age gate 59.5): a different mechanism
// (computeConversionCost's exQualifies, not RETDED's conversionAgeGate) gated by
// the exact same kind of per-row age check. ---
{
  const plan = computeMultiYear(0, 0, 0, 0, 'single', 500000, 0, 0, 0.05, 0, ST.MS, 'MS', 0, 55, 65, 1, 40000, undefined, false, 0);
  const preGate = plan.preRows.filter(r => r.age < 59.5);
  const postGate = plan.preRows.filter(r => r.age >= 59.5);
  check('MS (EXAGE): rows before 59.5 all show the same (taxable) figure', preGate.length === 5 && preGate.every(r => r.tax === preGate[0].tax));
  check('MS (EXAGE): rows at/after 59.5 show a lower tax (ex:true exemption applies)', postGate.length === 5 && postGate.every(r => r.tax < preGate[0].tax));
}

// --- 4. NY (RIX_STATES, per-spouse ageTieredCap): a JOINT filer where only the
// SPOUSE crosses 59.5 mid-plan must see the household shelter appear at exactly
// that row -- proves spouseAge advances in lockstep with curAge across rows,
// rather than staying frozen at today's spouseAge. curAge=50, spouseAge=58,
// retAge=60 -> spouse crosses 59.5 when primary turns 52. ---
{
  const plan = computeMultiYear(0, 0, 0, 0, 'mfj', 500000, 0, 0, 0.05, 0, ST.NY, 'NY', 0, 50, 60, 1, 30000, 58, true, 0);
  const preGate = plan.preRows.filter(r => (58 + (r.age - 50)) < 59.5);
  const postGate = plan.preRows.filter(r => (58 + (r.age - 50)) >= 59.5);
  check('NY: exactly 2 rows before the spouse turns 59.5 (ages 50-51)', preGate.length === 2);
  check('NY: exactly 8 rows after (ages 52-59)', postGate.length === 8);
  check('NY: rows before the spouse qualifies show full tax', preGate.every(r => r.tax === preGate[0].tax));
  check('NY: rows after the spouse qualifies show the per-spouse $20k shelter (lower tax)', postGate.every(r => r.tax < preGate[0].tax));
}

// --- 5. Federal senior deduction (nSr): row 0 must respect the wizard's RAW
// entered value even when it disagrees with a naive age>=65 check (a birthday
// earlier in the current year the integer age can't see); every later row must
// derive fresh from that row's own age. Isolated with stateCode='' (no state tax
// at all) so only the federal effect is visible. curAge=64, retAge=66. ---
{
  const withRaw0 = computeMultiYear(30000, 0, 0, 0, 'single', 500000, 0, 0, 0.05, 0, ST[''], '', 0, 64, 66, 1, 40000, undefined, false, 0);
  const withRaw1 = computeMultiYear(30000, 0, 0, 0, 'single', 500000, 0, 0, 0.05, 1, ST[''], '', 0, 64, 66, 1, 40000, undefined, false, 0);
  const age64_raw0 = withRaw0.preRows.find(r => r.age === 64).tax;
  const age64_raw1 = withRaw1.preRows.find(r => r.age === 64).tax;
  const age65_raw0 = withRaw0.preRows.find(r => r.age === 65).tax;
  const age65_raw1 = withRaw1.preRows.find(r => r.age === 65).tax;
  check('nSr: row 0 (age===curAge===64) respects the RAW wizard value -- the two runs diverge', age64_raw0 !== age64_raw1);
  check('nSr: row 0 with raw nSr=1 shows the deduction applied even though 64<65', age64_raw1 < age64_raw0);
  check('nSr: later row (age=65) derives fresh from age regardless of the raw starting value -- both runs converge', age65_raw0 === age65_raw1);
}

// --- 6. Already-retired filer (curAge >= retAge, so goldStartAge===curAge): the
// golden window's own row 0 has age===curAge in this one case -- the trickiest
// boundary in this fix (flagged explicitly by an adversarial review as the case
// the rest of this suite didn't directly cover: does that row correctly reuse the
// RAW wizard nSr, the same rule as the pre-retirement phase's row 0, or does it
// wrongly fall through to the derived value since it's technically a golden-window
// row?). curAge=68, retAge=65 (already retired) -> nWork=0, goldStartAge=curAge=68.
// Isolated via a direct computeConversionCost cross-check rather than a second
// computeMultiYear run with a different raw nSr, since nSr also feeds gConv's own
// SIZING (computeOptTargets) -- comparing two full runs would conflate "row 0 used
// the wrong nSr" with "gConv itself came out a different size," muddying the signal.
{
  setRet(0, 20000, 0, 0, 0);
  const plan = computeMultiYear(0, 0, 0, 0, 'single', 500000, 0, 0, 0.05, 0, ST[''], '', 0, 68, 65, 1, 40000, undefined, false, 0);
  check('already-retired: no pre-retirement rows at all (nWork=0)', plan.preRows.length === 0);
  const row0 = plan.goldRows.find(r => r.age === 68);
  check('already-retired: golden window has a row at age 68 (===curAge)', !!row0);
  const baseCtx = { income: 0, pensionIncome: 20000, nii: 0, ltcg: 0, ss: 0, status: 'single', stD: ST[''], stateCode: '', curAge: 68, spouseAge: undefined, isCouple: false, taxableFrac: 1 };
  const withRawNSr = computeConversionCost(row0.convert, { ...baseCtx, nSr: 0 }).cvtTxTot;
  const withDerivedNSr = computeConversionCost(row0.convert, { ...baseCtx, nSr: 1 }).cvtTxTot;
  check('already-retired: raw nSr=0 vs. derived nSr=1 actually differ for this amount (test is meaningful)', withRawNSr !== withDerivedNSr);
  check('already-retired: golden row 0 (age===curAge) matches the RAW nSr=0 computation, not the derived nSr=1 one', Math.round(withRawNSr) === row0.tax);
  setRet(0, 0, 0, 0, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
