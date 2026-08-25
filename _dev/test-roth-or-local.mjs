#!/usr/bin/env node
// Regression test for Portland Metro's Supportive Housing Services (SHS) tax and
// Multnomah County's Preschool For All (PFA) tax — added 2026-08-25, following the
// NYC/Yonkers local-tax feature (see test-roth-nyc-yonkers.mjs). Structurally
// different from NYC/Yonkers in one important way: Metro and Multnomah are NOT
// mutually exclusive — Multnomah County is a SUBSET of Metro's 3-county district
// (Multnomah/Washington/Clackamas), so a Multnomah filer owes BOTH taxes, stacked,
// while a Washington/Clackamas filer inside Metro owes only Metro's. Both taxes are
// threshold-gated (flat/stepped above a dollar amount), modeled as ordinary
// {rate,upTo} bracket ladders with a deliberate rate:0 leading tier, reusing the
// SAME generic bracketTax() helper NYC's graduated schedule uses.
//
// Extracts the REAL computeConversionCost/ORTAX/bracketTax definitions verbatim
// from the shipped HTML via jsdom (same approach as test-roth-nyc-yonkers.mjs).
// The "neither" regression guard (#7 below) uses hardcoded expected values, not a
// live `git show HEAD` diff — see test-roth-nyc-yonkers.mjs's own comment for why a
// dynamic HEAD comparison silently stops meaning anything the moment it's committed.

import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolveRetirementIncome, federalTaxableSS } from '../core/retirement-rules.js';

// Same harness pattern as test-roth-nyc-yonkers.mjs.
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
  return new Function(scriptSrc + '\nreturn {computeConversionCost, ORTAX, bracketTax, ST};')();
}

const html = readFileSync(new URL('../roth-conversion/index.html', import.meta.url), 'utf8');
const { computeConversionCost, ORTAX, bracketTax, ST } = extractCC(html);

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

const baseCtx = { pensionIncome: 0, nii: 0, ltcg: 0, ss: 0, nSr: 0, stD: ST.OR, stateCode: 'OR', curAge: 45, spouseAge: undefined, isCouple: false, taxableFrac: 1 };

// --- 1. Metro-only: a conversion straddling the single-filer $125,000 threshold,
// independently hand-verified against ORTAX's own bracket table. ---
{
  const income = 100000, cvt = 50000; // 100k -> 150k, straddles 125k
  const ctx = { ...baseCtx, income, status: 'single', localTax: 'metro' };
  const r = computeConversionCost(cvt, ctx);
  const brax = ORTAX.metro.single;
  const expectedMetroDelta = bracketTax(income + cvt, brax) - bracketTax(income, brax);
  const expectedStateOnly = cvt * ctx.stD.cr;
  check('Metro single: total = OR state tax + Metro delta', r.cvtTxSt, expectedStateOnly + expectedMetroDelta);
  checkTrue('Metro single: nonzero Metro tax actually applied (test is meaningful)', expectedMetroDelta > 0);
  check('Metro single: stMarginalDisp reflects OR cr + 1%', r.stMarginalDisp, ctx.stD.cr + 0.01);
}

// --- 2. Multnomah: the SAME scenario must stack BOTH Metro's delta AND PFA's delta
// -- the central claim of this whole feature (Multnomah is a subset of Metro, so a
// Multnomah filer owes both, not just one). ---
{
  const income = 100000, cvt = 50000;
  const ctxMetro = { ...baseCtx, income, status: 'single', localTax: 'metro' };
  const ctxMulti = { ...baseCtx, income, status: 'single', localTax: 'multnomah' };
  const rMetro = computeConversionCost(cvt, ctxMetro);
  const rMulti = computeConversionCost(cvt, ctxMulti);
  const pfaBrax = ORTAX.multnomah.single;
  const expectedPfaDelta = bracketTax(income + cvt, pfaBrax) - bracketTax(income, pfaBrax);
  checkTrue('Multnomah adds a real, additional PFA delta on top of Metro (test is meaningful)', expectedPfaDelta > 0);
  check('Multnomah total = Metro-only total + PFA delta (both layers stack)', rMulti.cvtTxSt, rMetro.cvtTxSt + expectedPfaDelta);
  checkTrue('Multnomah is taxed strictly more than Metro-only for the same scenario', rMulti.cvtTxSt > rMetro.cvtTxSt);
}

// --- 3. A conversion entirely below both thresholds shows $0 local tax for either
// option -- confirms the rate:0 leading tier correctly shelters low incomes, not
// just that SOME number comes back. ---
{
  const ctx = { ...baseCtx, income: 50000, status: 'single', localTax: 'metro' };
  const r = computeConversionCost(20000, ctx); // 50k -> 70k, well under 125k
  check('Metro, fully below threshold: $0 local tax (matches flat state-only formula)', r.cvtTxSt, 20000 * ctx.stD.cr);
}
{
  const ctx = { ...baseCtx, income: 50000, status: 'single', localTax: 'multnomah' };
  const r = computeConversionCost(20000, ctx);
  check('Multnomah, fully below threshold: $0 local tax either layer', r.cvtTxSt, 20000 * ctx.stD.cr);
}

// --- 4. Multnomah's second tier: a conversion straddling the $250,000 (single)
// step from 1.5% to 3% -- confirms the stepped transition, not just the first tier. ---
{
  const income = 240000, cvt = 20000; // 240k -> 260k, straddles 250k
  const ctx = { ...baseCtx, income, status: 'single', localTax: 'multnomah' };
  const r = computeConversionCost(cvt, ctx);
  const metroBrax = ORTAX.metro.single, pfaBrax = ORTAX.multnomah.single;
  const expectedMetroDelta = bracketTax(income + cvt, metroBrax) - bracketTax(income, metroBrax);
  const expectedPfaDelta = bracketTax(income + cvt, pfaBrax) - bracketTax(income, pfaBrax);
  const expectedStateOnly = cvt * ctx.stD.cr;
  check('Multnomah straddling the $250k step: full stack matches independent bracket walk', r.cvtTxSt, expectedStateOnly + expectedMetroDelta + expectedPfaDelta);
  // Sanity: the PFA delta on this straddling conversion should exceed what a flat
  // 1.5% would give (some of the $20k lands in the 3% tier), proving the stepped
  // transition actually fired, not just the first tier.
  checkTrue('PFA delta reflects the 3% tier kicking in partway through the conversion', expectedPfaDelta > cvt * 0.015);
}

// --- 5. Filing-status grouping: HOH uses the JOINT thresholds ($200k/$400k), MFS
// uses the SINGLE thresholds ($125k/$250k) -- confirmed directly from Form MET-40's
// own filing-status checkboxes, the opposite of this project's more common
// single-vs-hoh-as-its-own-bracket convention, so worth a dedicated check. ---
{
  // $150k income + $60k conversion = $210k total: single/MFS threshold is $125k
  // (fully in the 1% Metro tier by $210k), but joint/HOH threshold is $200k -- a
  // small conversion should barely clear it for HOH, producing a much smaller
  // Metro delta than the same scenario would for single/MFS.
  const income = 150000, cvt = 60000; // 150k -> 210k
  const single = computeConversionCost(cvt, { ...baseCtx, income, status: 'single', localTax: 'metro' });
  const hoh    = computeConversionCost(cvt, { ...baseCtx, income, status: 'hoh',    localTax: 'metro' });
  const mfs    = computeConversionCost(cvt, { ...baseCtx, income, status: 'mfs',    localTax: 'metro' });
  const mfj    = computeConversionCost(cvt, { ...baseCtx, income, status: 'mfj',    localTax: 'metro' });
  check('HOH matches MFJ (both use the $200k joint threshold)', hoh.cvtTxSt, mfj.cvtTxSt, 0.01);
  check('MFS matches single (both use the $125k single threshold)', mfs.cvtTxSt, single.cvtTxSt, 0.01);
  checkTrue('HOH/MFJ (higher threshold) owes strictly less Metro tax than single/MFS for the same income', hoh.cvtTxSt < single.cvtTxSt);
}

// --- 6. Non-OR state with a stray orLocalTax-shaped value must be silently
// ignored. Uses GA (a RIX state) as the non-OR example, matching the analogous NY
// test's own correction (an earlier version of that test used a dedicated-branch
// state and never actually exercised the guard it claimed to). ---
{
  const ctx = { pensionIncome: 0, nii: 0, ltcg: 0, ss: 0, nSr: 0, stD: { cr: 0.0539, ex: false }, stateCode: 'GA', status: 'single', curAge: 45, spouseAge: undefined, isCouple: false, taxableFrac: 1, localTax: 'multnomah' };
  const rStray = computeConversionCost(50000, ctx);
  const rClean = computeConversionCost(50000, { ...ctx, localTax: '' });
  check('Non-OR RIX state (GA) ignores a stray localTax value', rStray.cvtTxSt, rClean.cvtTxSt, 0.01);
}

// --- 7. Golden-snapshot regression guard: "neither" (localTax='') must match OR's
// existing flat-cr formula exactly, for a few scenarios spanning both thresholds --
// proof the new stateCode==='OR' branch doesn't change ordinary (no-locality-
// selected) OR behavior from the pre-feature flat computation. ---
{
  const scenarios = [
    { income: 40000, status: 'single', cvt: 20000 },
    { income: 100000, status: 'single', cvt: 50000 },
    { income: 240000, status: 'mfj', isCouple: true, cvt: 20000 },
    { income: 20000, status: 'hoh', cvt: 25000 },
  ];
  for (const s of scenarios) {
    const ctx = { ...baseCtx, income: s.income, status: s.status, isCouple: !!s.isCouple, localTax: '' };
    const got = computeConversionCost(s.cvt, ctx).cvtTxSt;
    const expected = s.cvt * ctx.stD.cr;
    check(`Golden snapshot (localTax=''), ${s.status} income=${s.income} cvt=${s.cvt}: matches OR's flat-cr formula`, got, expected, 0.001);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
