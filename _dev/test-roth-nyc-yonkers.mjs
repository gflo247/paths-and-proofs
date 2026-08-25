#!/usr/bin/env node
// Regression test for New York City's and Yonkers' local income tax — added
// 2026-08-25 alongside the feature itself. Unlike Maryland/Indiana's mandatory,
// unconditional county tax (a flat rate baked into every resident's calculation),
// NYC/Yonkers only apply when the filer explicitly selects one via the wizard's
// nyLocalTax field, and NYC's own tax is genuinely graduated (4 brackets), not
// flat, layered on top of NY's existing $20k/59.5+ per-spouse retirement exclusion
// rather than the raw conversion amount.
//
// Extracts the REAL computeConversionCost/NYCTAX/bracketTax definitions verbatim
// from the shipped HTML via jsdom (same approach as test-roth-rix.mjs). The
// "neither" regression guard (#6 below) checks against hardcoded expected values
// computed once from commit b93655b (the last commit before this feature), not a
// live `git show HEAD` diff -- see that check's own comment for why a dynamic HEAD
// comparison would silently stop meaning anything the moment this file is committed.

import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolveRetirementIncome, federalTaxableSS } from '../core/retirement-rules.js';

// Same harness pattern as test-roth-rix.mjs: computeConversionCost calls
// window.resolveRetirementIncome(...) (explicit property access) but calcTaxableSS(...)
// as a bare identifier — a real browser's window IS the global object, so the bare
// call falls through to window.calcTaxableSS automatically; in this jsdom+Function
// sandbox, Node's globalThis and jsdom's window are distinct objects, so both must be
// bound explicitly (on globalThis for the bare call, on window for the property call).
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
  return new Function(scriptSrc + '\nreturn {computeConversionCost, NYCTAX, bracketTax};')();
}

const html = readFileSync(new URL('../roth-conversion/index.html', import.meta.url), 'utf8');
const { computeConversionCost, NYCTAX, bracketTax } = extractCC(html);

let pass = 0, fail = 0;
function check(label, actual, expected, tolerance = 0.01) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) pass++;
  else { fail++; console.log(`FAIL  ${label}  (got=${actual}, expected=${expected})`); }
}
function checkTrue(label, cond) {
  if (cond) pass++;
  else { fail++; console.log(`FAIL  ${label}`); }
}

const baseCtx = { pensionIncome: 0, nii: 0, ltcg: 0, ss: 0, nSr: 0, stD: { cr: 0.06, ex: false }, stateCode: 'NY', spouseAge: undefined, isCouple: false, taxableFrac: 1 };

// --- 1. NYC: a conversion straddling the single-filer $50,000 top-bracket boundary,
// entirely outside NY's own $20,000 exclusion (curAge under 59.5, so no shelter
// competes), independently hand-verified against NYCTAX's own bracket table. ---
{
  const wages = 40000; // ordinary income before conversion
  const cvt = 20000;   // pushes ordinary+converted from 40k to 60k, straddling $50k
  const ctx = { ...baseCtx, income: wages, status: 'single', curAge: 45, localTax: 'nyc' };
  const r = computeConversionCost(cvt, ctx);
  const brax = NYCTAX.nyc.single;
  const expectedNycDelta = bracketTax(wages + cvt, brax) - bracketTax(wages, brax);
  const expectedStateOnly = cvt * ctx.stD.cr; // no NY exclusion applies below 59.5
  check('NYC single: total state tax = NY state + NYC city delta', r.cvtTxSt, expectedStateOnly + expectedNycDelta);
  checkTrue('NYC single: nonzero city tax actually applied (test is meaningful)', expectedNycDelta > 0);
  check('NYC single: stMarginalDisp reflects the combined top NYC bracket rate', r.stMarginalDisp, ctx.stD.cr + 0.03876);
}

// --- 2. NYC: a conversion ENTIRELY inside NY's $20,000/person exclusion (age 60,
// well under the cap) must owe ZERO city tax, not just zero state tax -- the key
// regression guard for layering NYC on the NY-exclusion-adjusted delta rather than
// the raw conversion amount. ---
{
  const ctx = { ...baseCtx, income: 30000, status: 'single', curAge: 60, localTax: 'nyc' };
  const r = computeConversionCost(15000, ctx); // well under the $20k cap
  check('NYC single, fully NY-sheltered conversion: $0 state tax', r.cvtTxSt, 0);
}

// --- 3. NYC: MFJ, both spouses 59.5+, a $50,000 conversion where $40,000 is NY-
// sheltered (both spouses' $20k caps) and $10,000 spills over -- confirms NYC tax
// applies only to the spillover, at the MFJ bracket schedule, not the full amount. ---
{
  const ctx = { ...baseCtx, income: 60000, status: 'mfj', curAge: 62, spouseAge: 62, isCouple: true, localTax: 'nyc' };
  const r = computeConversionCost(50000, ctx);
  const brax = NYCTAX.nyc.mfj;
  const expectedNycDelta = bracketTax(60000 + 10000, brax) - bracketTax(60000, brax); // only the $10k spillover
  const expectedStateOnly = 10000 * ctx.stD.cr;
  check('NYC MFJ with partial NY shelter: only the spillover is NYC-taxable', r.cvtTxSt, expectedStateOnly + expectedNycDelta);
}

// --- 4. Yonkers: the surcharge must be EXACTLY 16.75% of the conversion's own
// already-computed NY state tax (a linear surcharge on state tax, not a separate
// income-based calc) -- tight tolerance since this is claimed exact, not approximate. ---
{
  const ctx = { ...baseCtx, income: 50000, status: 'single', curAge: 45, localTax: 'yonkers' };
  const rYonkers = computeConversionCost(20000, ctx);
  const rNeither = computeConversionCost(20000, { ...ctx, localTax: '' });
  check('Yonkers: total = state tax * (1 + 16.75%)', rYonkers.cvtTxSt, rNeither.cvtTxSt * 1.1675, 0.001);
  check('Yonkers: stMarginalDisp reflects the surcharge', rYonkers.stMarginalDisp, ctx.stD.cr * 1.1675, 0.0001);
}
{
  // Same check with a partially-NY-sheltered MFJ conversion, to confirm the
  // surcharge is exact even when the underlying state tax itself isn't a flat
  // taxableCvt*cr (i.e. it already reflects NY's own exclusion math).
  const ctx = { ...baseCtx, income: 60000, status: 'mfj', curAge: 62, spouseAge: 62, isCouple: true, localTax: 'yonkers' };
  const rYonkers = computeConversionCost(50000, ctx);
  const rNeither = computeConversionCost(50000, { ...ctx, localTax: '' });
  check('Yonkers MFJ (partial NY shelter): surcharge still exact', rYonkers.cvtTxSt, rNeither.cvtTxSt * 1.1675, 0.001);
}

// --- 5. Non-NY state with a stray localTax value must be silently ignored. ---
{
  const ctx = { ...baseCtx, income: 40000, status: 'single', curAge: 45, stateCode: 'MD', localTax: 'nyc' };
  const rStray = computeConversionCost(20000, ctx);
  const rClean = computeConversionCost(20000, { ...ctx, localTax: '' });
  check('Non-NY state ignores a stray localTax value', rStray.cvtTxSt, rClean.cvtTxSt, 0.01);
}

// --- 6. Golden-snapshot regression guard: "neither" (localTax='') must produce
// the SAME results as the pre-feature code, across several NY scenarios -- proof
// ordinary NY behavior (including the existing per-spouse $20k/40k exclusion logic)
// is untouched. Expected values are HARDCODED, computed once from commit b93655b
// (the last commit before any NYC/Yonkers work) rather than fetched live via `git
// show HEAD` -- a dynamic HEAD comparison only means anything in the single moment
// before this feature's own commit lands; the instant it does, HEAD IS this code,
// so the comparison would silently degrade into comparing the file against itself,
// always passing regardless of any future regression. Hardcoding is what every
// other test in this suite already does (test-roth-multiyear.mjs's "$2,620"/"$4,320"
// etc.), and is what actually keeps this check meaningful going forward. ---
{
  const scenarios = [
    { income: 40000, status: 'single', curAge: 45, cvt: 20000, expected: 1200 },
    { income: 30000, status: 'single', curAge: 60, cvt: 15000, expected: 0 },
    { income: 60000, status: 'mfj', curAge: 62, spouseAge: 62, isCouple: true, cvt: 50000, expected: 600 },
    { income: 60000, status: 'mfj', curAge: 45, spouseAge: 62, isCouple: true, cvt: 50000, expected: 1800 },
    { income: 20000, status: 'hoh', curAge: 65, cvt: 25000, expected: 300 },
  ];
  for (const s of scenarios) {
    const ctx = { ...baseCtx, income: s.income, status: s.status, curAge: s.curAge, spouseAge: s.spouseAge, isCouple: !!s.isCouple, localTax: '' };
    const got = computeConversionCost(s.cvt, ctx).cvtTxSt;
    check(`Golden snapshot (localTax=''), ${s.status} age=${s.curAge} income=${s.income} cvt=${s.cvt}: matches pre-feature code (b93655b)`, got, s.expected, 0.001);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
