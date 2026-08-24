#!/usr/bin/env node
// Integration test for roth-conversion/index.html's computeConversionCost(): does it
// correctly wire the shared core/retirement-rules.js module in (right AGI/SS figures,
// right before/with delta pattern, right multiplication by stD.cr)?
//
// Before 2026-08-24 this file compared Roth's OWN independent rixExcluded()
// implementation against relocation/relo-engine.mjs, since the two tools each
// re-implemented the same per-cliffType exclusion math by hand. That duplication is
// gone — rixExcluded() and the dedicated CT/AL/NY branches were deleted, and
// computeConversionCost() now calls the SAME resolveRetirementIncome() (core/
// retirement-rules.js) that relo-engine.mjs calls. So there is no longer a second
// independent implementation to compare against; resolveRetirementIncome's own
// correctness is already proven exhaustively elsewhere (a standalone 1.1M-combination
// proof against the pre-refactor relo-engine.mjs, run before either production file was
// touched, plus relo-engine's own primary-source-verified _dev/test-relo-exclusions.mjs
// suite, which still exercises the exact same shared function via computeStateIncomeTax).
//
// What THIS file checks now: does computeConversionCost() actually call
// resolveRetirementIncome() with the RIGHT inputs? Specifically — the right agiBase/
// agiWith (this tool's own precise taxable-SS-derived AGI, not a crude sum), the right
// otherIncomeForSS/ssForThreshold split (found live during the 2026-08-24 migration:
// naively reusing relo-engine's ss-only convention here would have silently broken CO's
// shared-cap math for this tool specifically — see core/retirement-rules.js's own header
// comment), and the right before/with delta pattern. Does this by reconstructing the
// expected AGI/SS figures independently (via the SAME federalTaxableSS primitive, not by
// re-calling whatever computeConversionCost already computed) and calling
// resolveRetirementIncome the same way computeConversionCost should, then comparing
// against computeConversionCost's REAL output — extracted and evaluated from the actual
// shipped HTML via jsdom, not a hand-transcription.

import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolveRetirementIncome, federalTaxableSS } from '../core/retirement-rules.js';
import { RIX_STATES } from './gen-st-table.mjs';

// --- Extract the real computeConversionCost() (and RIX/RETDED/EXAGE tables it reads)
// verbatim from the shipped HTML, evaluated in a minimal jsdom sandbox. A VirtualConsole
// suppresses jsdom's own internal error reporting — the file's eager, DOMContentLoaded-
// wrapped initial render will throw harmlessly against our empty stub body (we only need
// the function/table DEFINITIONS, not that eager render, and we never dispatch
// DOMContentLoaded ourselves).
const vc = new VirtualConsole();
const dom = new JSDOM('<!doctype html><body></body>', { virtualConsole: vc });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.matchMedia = () => ({ matches: true });
// Bridges the shared module in exactly like the real <script type="module"> block does
// (window.resolveRetirementIncome/window.calcTaxableSS) — PLUS binds the same names on
// Node's own globalThis, a harness-only quirk: in a real browser `window` IS the global
// object, so an unresolved bare identifier falls through to window.X automatically; in
// this jsdom+Function-constructor sandbox, Node's globalThis and jsdom's window are two
// separate objects, so that fallback doesn't happen unless both are bound. (Already
// confirmed working via the real bridging mechanism in an actual browser separately —
// this is purely about making the extracted code resolve in THIS synthetic harness.)
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
const { computeConversionCost, RIX } = new Function(scriptSrc + '\nreturn {computeConversionCost, RIX};')();

const states = JSON.parse(readFileSync(new URL('../roth-conversion/states.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
function check(label, actual, expected, tolerance = 1) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) pass++;
  else { fail++; console.log(`FAIL  ${label}  (got=${actual}, expected=${expected})`); }
}

const statuses = ['single', 'mfj', 'hoh', 'mfs'];
const ages = [45, 55, 62, 63, 65, 67, 70, 80];
const competingAmts = [0, 5000, 20000, 50000, 90000, 150000];
const otherWages = [0, 30000, 80000, 140000];
const ssAmts = [0, 8000, 25000, 40000]; // CO/WV-sensitive; other states mostly ignore ss.

let checked = 0;
for (const code of RIX_STATES) {
  const rules = states[code].taxRules; // full taxRules, for computing expected values
  const rix = RIX[code]; // the Roth tool's own generated table entry
  for (const status of statuses) {
    for (const age of ages) {
      for (const spouseAge of status === 'mfj' ? ages : [age]) {
        for (const pensionIncome of [0, 10000]) {
          for (const taxableCvt of competingAmts) {
            for (const wages of otherWages) {
              for (const ss of ssAmts) {
                checked++;
                const income = wages + pensionIncome;

                // Independently reconstruct this tool's own AGI/SS figures (the same
                // primitive federalTaxableSS both engines share, not a re-call of
                // whatever computeConversionCost already computed).
                const ssBase = federalTaxableSS(ss, income, status);
                const ssWith = federalTaxableSS(ss, income + taxableCvt, status);
                const agiBase = income + ssBase;
                const agiWith = income + taxableCvt + ssWith;

                const base = resolveRetirementIncome(rules, status, {
                  age, spouseAge, ira: 0, pension: pensionIncome, agiProxy: agiBase,
                  ss, ssForThreshold: ssBase, otherIncomeForSS: income,
                });
                const withCvt = resolveRetirementIncome(rules, status, {
                  age, spouseAge, ira: taxableCvt, pension: pensionIncome, agiProxy: agiWith,
                  ss, ssForThreshold: ssWith, otherIncomeForSS: income + taxableCvt,
                });
                const expectedDelta = (withCvt.iraTaxable + withCvt.penTaxable) - (base.iraTaxable + base.penTaxable);

                // ctx.income is WAGES ONLY — computeConversionCost internally does
                // `income = wagesInc + pensionIncome` itself, so passing our own
                // combined `income` here would double-count pensionIncome.
                const ctx = {
                  income: wages, pensionIncome, nii: 0, ltcg: 0, ss, status, nSr: 0,
                  stD: { cr: states[code].roth.cr, ex: false }, stateCode: code,
                  curAge: age, spouseAge, isCouple: status === 'mfj', taxableFrac: 1,
                };
                const got = computeConversionCost(taxableCvt, ctx).cvtTxSt;
                const expected = expectedDelta * states[code].roth.cr;

                check(`${code} ${status} age=${age} sp=${spouseAge} pen=${pensionIncome} cvt=${taxableCvt} wages=${wages} ss=${ss}`, got, expected, Math.max(1, Math.abs(expected) * 0.001));
              }
            }
          }
        }
      }
    }
  }
}

console.log(`Checked ${checked.toLocaleString()} combinations across ${RIX_STATES.length} states (incl. CO with ss>0, previously untested).`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
