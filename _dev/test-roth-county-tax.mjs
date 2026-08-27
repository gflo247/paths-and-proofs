#!/usr/bin/env node
// Regression test for Maryland's and Indiana's mandatory county income tax in
// Roth's computeConversionCost() (2026-08-27 Stage 3 migration). Both rates
// previously lived ONLY as hardcoded JS literals (MD_COUNTY_RATE=0.032,
// IN_COUNTY_RATE=0.0197) with zero build-guard coverage; this migration moves
// them to states.json's shared localTax.county.rate (also read by Relocation's
// computeLocalTax — see _dev/test-relo-local-tax.mjs), generated into a new
// COUNTYTAX constant by _dev/gen-st-table.mjs.
//
// This is a GOLDEN-SNAPSHOT regression: the formula shape (taxableCvt * (stD.cr
// + rate)) and the rate values themselves (0.032, 0.0197) are UNCHANGED by this
// migration -- only where the rate is read FROM changed (a hand-maintained
// literal -> COUNTYTAX, generated from the same guard-validated JSON Relocation
// now also reads). Expected values are hand-computed directly from that
// unchanged formula, not diffed against git HEAD (see test-roth-nyc-yonkers.mjs's
// own comment for why a live HEAD diff would stop meaning anything once this
// file is committed).
//
// Extracts the REAL computeConversionCost/COUNTYTAX definitions verbatim from
// the shipped HTML via jsdom (same approach as test-roth-nyc-yonkers.mjs).

import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolveRetirementIncome, federalTaxableSS } from '../core/retirement-rules.js';

function extractCC(html) {
  const vc = new VirtualConsole();
  const dom = new JSDOM('<!doctype html><body></body>', { virtualConsole: vc });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.matchMedia = () => ({ matches: true });
  globalThis.window.resolveRetirementIncome = resolveRetirementIncome;
  globalThis.window.calcTaxableSS = federalTaxableSS;
  globalThis.resolveRetirementIncome = resolveRetirementIncome;
  globalThis.calcTaxableSS = federalTaxableSS;

  const marker = 'function computeConversionCost';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) throw new Error('computeConversionCost not found');
  const scriptStart = html.lastIndexOf('<script>', markerIdx) + '<script>'.length;
  const scriptEnd = html.indexOf('</script>', markerIdx);
  const scriptSrc = html.slice(scriptStart, scriptEnd);
  return new Function(scriptSrc + '\nreturn {computeConversionCost, COUNTYTAX};')();
}

const html = readFileSync(new URL('../roth-conversion/index.html', import.meta.url), 'utf8');
const { computeConversionCost, COUNTYTAX } = extractCC(html);

let pass = 0, fail = 0;
function check(label, actual, expected, tolerance = 0.01) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) pass++;
  else { fail++; console.log(`FAIL  ${label}  (got=${actual}, expected=${expected})`); }
}

// The two rates themselves, unchanged by the migration.
check('COUNTYTAX.MD is 3.20%, unchanged from the old MD_COUNTY_RATE literal', COUNTYTAX.MD, 0.032);
check('COUNTYTAX.IN is 1.97%, unchanged from the old IN_COUNTY_RATE literal', COUNTYTAX.IN, 0.0197);

const baseCtx = { pensionIncome: 0, nii: 0, ltcg: 0, ss: 0, nSr: 0, spouseAge: undefined, isCouple: false, taxableFrac: 1, localTax: '' };

// --- MD: golden-snapshot, formula unchanged (taxableCvt * (stD.cr + 0.032)) ---
{
  const cvt = 50000;
  const cr = 0.0475; // MD's real roth.cr
  const ctx = { ...baseCtx, income: 0, status: 'single', curAge: 67, stateCode: 'MD', stD: { cr, ex: false } };
  const r = computeConversionCost(cvt, ctx);
  check('MD: $50,000 conversion at the real 4.75% state rate + 3.20% county', r.cvtTxSt, cvt * (cr + 0.032));
}
{
  const cvt = 15000;
  const cr = 0.0475;
  const ctx = { ...baseCtx, income: 20000, status: 'mfj', curAge: 55, stateCode: 'MD', stD: { cr, ex: false } };
  const r = computeConversionCost(cvt, ctx);
  check('MD: smaller conversion, joint filer, same unconditional formula', r.cvtTxSt, cvt * (cr + 0.032));
}

// --- IN: golden-snapshot, formula unchanged (taxableCvt * (stD.cr + 0.0197)) ---
{
  const cvt = 50000;
  const cr = 0.0295; // IN's real roth.cr
  const ctx = { ...baseCtx, income: 0, status: 'single', curAge: 67, stateCode: 'IN', stD: { cr, ex: false } };
  const r = computeConversionCost(cvt, ctx);
  check('IN: $50,000 conversion at the real 2.95% flat state rate + 1.97% county', r.cvtTxSt, cvt * (cr + 0.0197));
}
{
  const cvt = 15000;
  const cr = 0.0295;
  const ctx = { ...baseCtx, income: 20000, status: 'mfj', curAge: 55, stateCode: 'IN', stD: { cr, ex: false } };
  const r = computeConversionCost(cvt, ctx);
  check('IN: smaller conversion, joint filer, same unconditional formula', r.cvtTxSt, cvt * (cr + 0.0197));
}

// Unconditional: county tax applies regardless of the (irrelevant, NY/OR-only)
// localTax selector value -- MD/IN have no opt-out.
{
  const cvt = 50000;
  const cr = 0.0475;
  const ctxEmpty = { ...baseCtx, income: 0, status: 'single', curAge: 67, stateCode: 'MD', stD: { cr, ex: false }, localTax: '' };
  const ctxStray = { ...ctxEmpty, localTax: 'nyc' }; // a stray value that should never reach an MD filer, but must not change anything if it does
  const rEmpty = computeConversionCost(cvt, ctxEmpty);
  const rStray = computeConversionCost(cvt, ctxStray);
  check('MD: unaffected by an (irrelevant) stray localTax value', rStray.cvtTxSt, rEmpty.cvtTxSt);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
