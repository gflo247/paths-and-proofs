#!/usr/bin/env node
// Adversarial scenario battery for roth-conversion/index.html — 2026-09-04
//
// 50 checks across 6 groups, each expected value hand-derived from primary sources
// and the actual code constants (not from running the code first):
//
//   Group 1: SS torpedo — federalTaxableSS two-tier formula
//   Group 2: IRMAA tier detection — actual ITHR thresholds from the code
//   Group 3: Senior deduction phaseout — seniorDed() formula
//   Group 4: LTCG stacking — calcLTCGTax() with STDD=16100 and LTCGX actual boundaries
//   Group 5: Multi-year plan — row counts and conversion amounts
//   Group 6: State edge cases — PA, IL, MS (ex:true), CT (iraWeightPct)
//
// Primary sources used:
//   - IRS Rev. Proc. 2025-32 (2026 brackets/deductions/LTCG thresholds, as enacted
//     by the One Big Beautiful Bill Act — OBBBA pushes standard deduction and bracket
//     widths above the base IRS figures; the actual STDD/BRAX/LTCGX constants in the
//     code are the authoritative numbers here)
//   - IRS Pub 915 (SS taxability two-tier formula — verified byte-identical in
//     core/retirement-rules.js federalTaxableSS, which this tool bridges in)
//   - CMS 2026 IRMAA fact sheet (ITHR actual thresholds in the code: single 109k/137k/
//     171k/205k/500k — different from the task description's 106k/133k/etc., which
//     appear to be 2025 figures; 2026 thresholds confirmed from the code itself)
//   - PA DOR Personal Income Tax Guide (conversions tax-free)
//   - IL DOR Schedule M guidance (ex:true, no age gate)
//   - MS ex:true, age gate 59.5 (EXAGE table)
//   - CT states.json iraWeightPct=0.75 + RIX cliffType logic
//
// NOTE: The task description's SS formula for zone1 used a simplified derivation
// that disagreed with IRS Pub 915 and the actual code. For example, with PI=$42k
// (wages=$20k + cvt=$10k + halfSS=$12k), zone1 = min(benefit*0.5, (hi-lo)*0.5)
// = min($12k, $4,500) = $4,500 — not $1,750 (which was $3,500/2, an algebraic
// error). All expected values below are derived from the real two-tier formula.
//
// Similarly, STDD in the code is single=$16,100 / MFJ=$32,200 (OBBBA-enhanced),
// not the $15,000/$30,000 base IRS figures — this shifts LTCG bracket-push amounts
// relative to the task description's hand-calc.
//
// This file does NOT wire into npm run verify yet — adversarial review first.

import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolveRetirementIncome, federalTaxableSS } from '../core/retirement-rules.js';

// ─── Harness setup (mirrors test-roth-multiyear.mjs exactly) ────────────────
// computeMultiYear reads DOM inputs directly for golden-window retirement income,
// so those elements need to exist even though Group 5's non-golden scenarios
// set them to 0 via setRet().
const vc = new VirtualConsole();
const dom = new JSDOM(`<!doctype html><body>
  <input id="retSS"><input id="retPen"><input id="retOther">
  <input id="niiIncome"><input id="ltcgIncome">
</body>`, { virtualConsole: vc });
globalThis.window   = dom.window;
globalThis.document = dom.window.document;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.matchMedia = () => ({ matches: true });
// Bridge shared module the same way the real <script type="module"> does it:
// bind on BOTH window and Node's globalThis, since they are two separate objects
// in this jsdom+Function-constructor sandbox — bare identifier resolution falls
// through to window.X in a real browser automatically, but not here.
globalThis.window.resolveRetirementIncome = resolveRetirementIncome;
globalThis.window.calcTaxableSS           = federalTaxableSS;
globalThis.resolveRetirementIncome        = resolveRetirementIncome;
globalThis.calcTaxableSS                  = federalTaxableSS;

const html = readFileSync(new URL('../roth-conversion/index.html', import.meta.url), 'utf8');
const marker     = 'function computeConversionCost';
const markerIdx  = html.indexOf(marker);
if (markerIdx === -1) throw new Error('computeConversionCost not found in index.html');
const scriptStart = html.lastIndexOf('<script>', markerIdx) + '<script>'.length;
const scriptEnd   = html.indexOf('</script>', markerIdx);
const scriptSrc   = html.slice(scriptStart, scriptEnd);
const { computeConversionCost, computeMultiYear, ST } =
  new Function(scriptSrc + '\nreturn {computeConversionCost, computeMultiYear, ST};')();

function setRet(ss, pen, other, nii = 0, ltcg = 0) {
  document.getElementById('retSS').value    = String(ss);
  document.getElementById('retPen').value   = String(pen);
  document.getElementById('retOther').value = String(other);
  document.getElementById('niiIncome').value  = String(nii);
  document.getElementById('ltcgIncome').value = String(ltcg);
}
setRet(0, 0, 0);

// ─── Assertions ─────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`ok    ${label}`); }
  else       { fail++; console.log(`FAIL  ${label}`); }
}
function near(label, actual, expected, tol = 1) {
  const passes = Math.abs(actual - expected) <= tol;
  if (passes) { pass++; console.log(`ok    ${label}  (${actual} ≈ ${expected})`); }
  else        { fail++; console.log(`FAIL  ${label}  — expected ${expected} got ${actual}`); }
}

// ─── Minimal ctx builder ─────────────────────────────────────────────────────
// Mirrors computeConversionCost's own signature; wages = ctx.income (wagesInc),
// and the function adds pensionIncome internally, so pass wages only here.
function ctx({ wages = 0, pension = 0, nii = 0, ltcg = 0, ss = 0,
               status = 'single', nSr = 0,
               stateCode = '', curAge = 65, spouseAge = undefined,
               isCouple = false, taxableFrac = 1, localTax = '' } = {}) {
  return {
    income: wages, pensionIncome: pension, nii, ltcg, ss, status, nSr,
    stD: ST[stateCode] || ST[''],
    stateCode, curAge, spouseAge, isCouple, taxableFrac, localTax,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 1: SS TORPEDO — the two-tier IRS Pub 915 formula
//
// federalTaxableSS(benefit, otherIncome, status):
//   PI = otherIncome + benefit*0.5
//   single/hoh: lo=25000, hi=34000
//   mfj:        lo=32000, hi=44000
//   mfs:        always benefit*0.85
//   zone1 = min(benefit*0.5, (hi-lo)*0.5)
//   result = min(benefit*0.85, zone1 + (PI-hi)*0.85)  [above hi]
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n─── Group 1: SS torpedo ───');
{
  // 1.1 Single, wages=$20k, ss=$24k, cvt=$0
  // PI = 20000 + 12000 = 32000 — between lo(25000) and hi(34000)
  // ssBase = min(24000*0.5, (32000-25000)*0.5) = min(12000, 3500) = 3500
  const cc0 = computeConversionCost(0, ctx({ wages: 20000, ss: 24000 }));
  near('1.1 single wages=20k ss=24k cvt=0: ssBase=3500', cc0.ssBase, 3500);

  // 1.2 Single, wages=$20k, ss=$24k, cvt=$10k
  // PI = 30000 + 12000 = 42000 — above hi(34000)
  // zone1 = min(12000, (34000-25000)*0.5) = min(12000, 4500) = 4500
  // ssWith = min(20400, 4500 + (42000-34000)*0.85) = min(20400, 4500+6800) = min(20400, 11300) = 11300
  const cc10 = computeConversionCost(10000, ctx({ wages: 20000, ss: 24000 }));
  near('1.2 single wages=20k ss=24k cvt=10k: ssWith=11300', cc10.ssWith, 11300);

  // 1.3 Delta: torpedoInc (taxable SS increase) = 11300 - 3500 = 7800
  near('1.3 delta: torpedoInc = ssWith-ssBase = 7800', cc10.torpedoInc, 7800);

  // 1.4 The torpedo amplifies total federal tax vs a plain $10k conversion.
  // tiBase = max(0, 23500-16100) = 7400; tiWith = max(0, 41300-16100) = 25200.
  // Tax(7400) = 740; Tax(25200) = 12400×0.10 + (25200-12400)×0.12 = 1240+1536 = 2776.
  // cvtTxFed = 2776-740 = 2036.
  near('1.4 cvtTxFed=2036 (torpedo pushed tiWith into 12% band)', cc10.cvtTxFed, 2036);

  // 1.5 MFJ, wages=$30k, ss=$36k, cvt=$0
  // PI = 30000 + 18000 = 48000 — above mfj hi(44000)
  // zone1 = min(18000, (44000-32000)*0.5) = min(18000, 6000) = 6000
  // ssBase = min(0.85*36000, 6000 + (48000-44000)*0.85) = min(30600, 6000+3400) = 9400
  const ccMFJ = computeConversionCost(0, ctx({ wages: 30000, ss: 36000, status: 'mfj', isCouple: true }));
  near('1.5 mfj wages=30k ss=36k cvt=0: ssBase=9400', ccMFJ.ssBase, 9400);

  // 1.6 MFS: taxable SS = 0.85 × benefit unconditionally (IRS Pub 915 MFS rule)
  // ss=24000, any other income: ssBenefit*0.85 = 20400
  const ccMFS = computeConversionCost(0, ctx({ wages: 0, ss: 24000, status: 'mfs' }));
  near('1.6 mfs: ssBase = 0.85 × ss benefit = 20400 (flat, no provisional-income calc)', ccMFS.ssBase, 20400);

  // 1.7 torpedoTax = Tax(tiWith) - Tax(tiWithNoTorpedo).
  // tiWithNoTorpedo = ordAgiWith - torpedoInc - std = 41300-7800-16100 = 17400.
  // Tax(17400) = 12400×0.10 + (17400-12400)×0.12 = 1240+600 = 1840.
  // torpedoTax = 2776-1840 = 936.
  near('1.7 torpedoTax=936 (extra federal cost attributable to SS pull-in)', cc10.torpedoTax, 936);

  // 1.8 LTCG correctly feeds into SS provisional income (IRS Pub 915: PI = other income
  // + ½ SS; "other income" = AGI, which includes qualified dividends/LTCG).
  // wages=$20k, ss=$24k, ltcg=$10k, cvt=$0, single:
  // PI = 20000+10000+12000 = 42000 — above hi(34000).
  // zone1 = min(12000, (34000-25000)*0.5) = 4500.
  // ssBase = min(20400, 4500+(42000-34000)*0.85) = min(20400,11300) = 11300.
  // Without ltcg in PI: would have been 3500 (test 1.1). The $20k of dividends
  // pushes a filer from 3500 to 11300 taxable SS — a $7,800 difference.
  const cc_ltcg = computeConversionCost(0, ctx({ wages: 20000, ss: 24000, ltcg: 10000 }));
  near('1.8 ssBase=11300 with ltcg=10k (qualified dividends raise SS provisional income)',
       cc_ltcg.ssBase, 11300);
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 2: IRMAA TIER DETECTION
//
// irmaaT(magi, status) where:
//   mfs: ≤109k→0, <391k→4, else 5
//   single ITHR: [0,109000,137000,171000,205000,500000]
//   mfj   ITHR: [0,218000,274000,342000,410000,750000]
//   hoh maps to single (see computeConversionCost: iSt = status==='hoh'?'single':status)
//
// Note: 2026 thresholds differ from the task description's 2025 figures (106k/133k
// vs. actual 109k/137k). Tests use the actual code constants confirmed by grepping
// ITHR out of index.html.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n─── Group 2: IRMAA tier detection ───');
{
  // 2.1 Single, MAGI=108999 (just below single threshold[1]=109000): tier=0
  // agiBase with wages=108999, ss=0, nii=0, ltcg=0, cvt=0: agiBase=108999
  const cc1 = computeConversionCost(0, ctx({ wages: 108999 }));
  ok('2.1 single MAGI=108999 (just below 109k threshold): tierBase=0', cc1.tierBase === 0);

  // 2.2 Single, MAGI=109001 (just above single threshold[1]=109000): tier=1
  const cc2 = computeConversionCost(0, ctx({ wages: 109001 }));
  ok('2.2 single MAGI=109001 (just above 109k threshold): tierBase=1', cc2.tierBase === 1);

  // 2.3 Conversion takes MAGI from 107k to 117k: crosses tier 1 boundary
  // tierBase = irmaaT(107000,'single') = 0
  // tierWith = irmaaT(107000+10000,'single') = irmaaT(117000,'single') = 1
  const cc3 = computeConversionCost(10000, ctx({ wages: 107000 }));
  ok('2.3 cvt crosses single tier-1 boundary (107k+10k): tierBase=0, tierWith=1',
     cc3.tierBase === 0 && cc3.tierWith === 1);

  // 2.4 MFJ, MAGI=219000 (just above mfj threshold[1]=218000): tier=1
  // Note: isCouple=true, status=mfj. agiBase=219000 (wages only, no SS/LTCG).
  const cc4 = computeConversionCost(0, ctx({ wages: 219000, status: 'mfj', isCouple: true }));
  ok('2.4 mfj MAGI=219000 (just above 218k threshold): tierBase=1', cc4.tierBase === 1);

  // 2.5 MFS, MAGI=110000: directly to tier 4 (severely compressed MFS IRMAA)
  // mfs rule: >109k and <391k → tier 4
  const cc5 = computeConversionCost(0, ctx({ wages: 110000, status: 'mfs' }));
  ok('2.5 mfs MAGI=110000 (>109k): jumps directly to tier 4 (compressed MFS bracket)',
     cc5.tierBase === 4);

  // 2.6 MFS, MAGI=109000 (at boundary, ≤109k): tier=0
  const cc6 = computeConversionCost(0, ctx({ wages: 109000, status: 'mfs' }));
  ok('2.6 mfs MAGI=109000 (≤109k boundary): tier=0', cc6.tierBase === 0);

  // 2.7 MFS, MAGI=391000 (at or above mfs threshold[5]=391000): tier=5
  // mfs rule: magi<391000→4, else 5. At magi=391000 (not < 391000) → tier=5.
  const cc7 = computeConversionCost(0, ctx({ wages: 391000, status: 'mfs' }));
  ok('2.7 mfs MAGI=391000 (≥391k): tier=5 (top MFS tier)', cc7.tierBase === 5);

  // 2.8 HOH maps to single for IRMAA (iSt = status==='hoh'?'single':status)
  // HOH at MAGI=110000 should give tier=1, same as single at 110000
  const ccHOH = computeConversionCost(0, ctx({ wages: 110000, status: 'hoh' }));
  const ccSingle = computeConversionCost(0, ctx({ wages: 110000, status: 'single' }));
  ok('2.8 hoh uses single IRMAA thresholds (not a separate table)',
     ccHOH.tierBase === ccSingle.tierBase);
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 3: SENIOR DEDUCTION PHASEOUT
//
// seniorDed(inc, status, n):
//   if n=0 or status='mfs': return 0
//   full = n * 6000
//   phase = max(0, inc - (status==='mfj' ? 150000 : 75000)) * 0.06
//   return max(0, full - phase)
//
// Important: `inc` is agiBase (= income+nii+ltcg+ssBase). Tests below use
// wages=pension (no SS, no NII, no LTCG) so agiBase=income for clarity.
// The tool reads nSr from the wizard; in computeConversionCost it uses nSr
// from ctx, and srD/srDW are the resolved dollar amounts.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n─── Group 3: Senior deduction phaseout ───');
{
  // 3.1 Age 66, single, income just below $75k phaseout start: full $6,000 deduction
  // agiBase = 74999, phase = max(0, 74999-75000)*0.06 = 0, srD = 6000
  const cc1 = computeConversionCost(0, ctx({ wages: 74999, nSr: 1, curAge: 66 }));
  near('3.1 single inc=74999 nSr=1: srD=6000 (no phaseout yet)', cc1.srD, 6000);

  // 3.2 Age 66, single, income=$95k: phaseout = (95000-75000)*0.06 = 1200, srD = 4800
  const cc2 = computeConversionCost(0, ctx({ wages: 95000, nSr: 1, curAge: 66 }));
  near('3.2 single inc=95000 nSr=1: srD=4800 (1200 phaseout)', cc2.srD, 4800);

  // 3.3 Age 66, single, income=$175k: fully phased out, srD=0
  // phase = (175000-75000)*0.06 = 6000, srD = max(0, 6000-6000) = 0
  const cc3 = computeConversionCost(0, ctx({ wages: 175000, nSr: 1, curAge: 66 }));
  near('3.3 single inc=175000 nSr=1: srD=0 (fully phased out)', cc3.srD, 0);

  // 3.4 MFS filer, nSr=1: senior deduction is $0 (unconditional MFS exclusion in seniorDed)
  const cc4 = computeConversionCost(0, ctx({ wages: 50000, nSr: 1, status: 'mfs', curAge: 66 }));
  near('3.4 mfs nSr=1: srD=0 (MFS unconditionally excluded from senior deduction)', cc4.srD, 0);

  // 3.5 MFJ, both 65+, nSr=2, income=$160k: phaseout = (160000-150000)*0.06=600, full=12000, net=11400
  const cc5 = computeConversionCost(0, ctx({ wages: 160000, nSr: 2, status: 'mfj', isCouple: true, curAge: 66 }));
  near('3.5 mfj nSr=2 inc=160k: srD=11400 (600 phaseout on 12000 full)', cc5.srD, 11400);

  // 3.6 Confirm the deduction actually changes tiBase (not just srD):
  // single, income=$74999, nSr=0 vs nSr=1 — tiBase should differ by 6000
  const cc_no = computeConversionCost(0, ctx({ wages: 74999, nSr: 0, curAge: 66 }));
  const cc_sr = computeConversionCost(0, ctx({ wages: 74999, nSr: 1, curAge: 66 }));
  near('3.6 nSr=1 vs nSr=0: tiBase differs by exactly 6000', cc_no.tiBase - cc_sr.tiBase, 6000);

  // 3.7 phaseout is continuous: income=$80k should give srD = 6000-(80000-75000)*0.06=6000-300=5700
  const cc7 = computeConversionCost(0, ctx({ wages: 80000, nSr: 1, curAge: 66 }));
  near('3.7 single inc=80000 nSr=1: srD=5700 (300 phaseout)', cc7.srD, 5700);
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 4: LTCG STACKING
//
// LTCGX single: [{m:49450,r:0},{m:545500,r:.15},{m:1/0,r:.20}]
// STDD single: 16100 (not the $15,000 base figure — OBBBA-enhanced)
//
// cvtTxLtcg = max(0, ltcgTaxWith - ltcgTaxBase)
// ltcgTaxWith = calcLTCGTax(tiWith, ltcgAmtWith, status)
//   where tiWith = ordAgiWith - std - srDW (ordinary-income taxable)
//         ltcgAmtWith = totalTiWith - tiWith (the LTCG slice above ordinary)
//
// Key principle: LTCG stacks on top of ordinary income, using the same bracket
// boundaries. A conversion raises ordinary tiWith, potentially pushing part of the
// LTCG stack from the 0% tier into the 15% tier.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n─── Group 4: LTCG stacking ───');
{
  // 4.1 Single, wages=$30k, LTCG=$20k, cvt=$0: no bump, all LTCG in 0% tier
  // income=30000, nii=0, ltcg=20000, ss=0
  // agiBase=50000, ordAgiBase=30000, std=16100, srD=0
  // tiBase = max(0, 30000-16100) = 13900
  // totalTiBase = max(0, 50000-16100) = 33900
  // ltcgAmtBase = 33900-13900 = 20000
  // calcLTCGTax(13900, 20000, 'single'): stackStart=13900, end=33900
  //   LTCGX[0]: m=49450, r=0; top=min(49450,33900)=33900 > 13900 → 0%
  //   → ltcgTaxBase = 0
  // cvt=0 → cvtTxLtcg = 0
  const cc1 = computeConversionCost(0, ctx({ wages: 30000, ltcg: 20000 }));
  near('4.1 wages=30k ltcg=20k cvt=0: no LTCG bump (all in 0% tier)', cc1.cvtTxLtcg, 0);

  // 4.2 Single, wages=$30k, LTCG=$20k, cvt=$20k: conversion pushes $4,450 of LTCG into 15% tier
  // ordAgiWith = 30000+20000 = 50000 (wages + conversion; no SS)
  // tiWith = max(0, 50000-16100) = 33900
  // totalTiWith = max(0, 70000-16100) = 53900
  // ltcgAmtWith = 53900-33900 = 20000
  // calcLTCGTax(33900, 20000, 'single'): stackStart=33900, end=53900
  //   LTCGX[0]: m=49450, r=0; top=min(49450,53900)=49450 > 33900 → (49450-33900)*0 = 0
  //   LTCGX[1]: m=545500, r=0.15; top=min(545500,53900)=53900 > 49450 → (53900-49450)*0.15 = 4450*0.15 = 667.5
  //   → ltcgTaxWith = 667.5
  // cvtTxLtcg = max(0, 667.5 - 0) = 667.5, rounds to 668
  const cc2 = computeConversionCost(20000, ctx({ wages: 30000, ltcg: 20000 }));
  near('4.2 wages=30k ltcg=20k cvt=20k: cvtTxLtcg≈668 ($4,450 of LTCG bumped to 15%)',
       cc2.cvtTxLtcg, 668, 2);  // tolerance 2 for fp rounding

  // 4.3 Single, wages=$40k, LTCG=$5k, cvt=$0: LTCG still entirely in 0% tier
  // tiBase = 40000-16100 = 23900; totalTiBase = 40000+5000-16100 = 28900
  // ltcgAmtBase=5000; calcLTCGTax(23900,5000,'single')=0 (33900 < 49450, stays in 0%)
  const cc3 = computeConversionCost(0, ctx({ wages: 40000, ltcg: 5000 }));
  near('4.3 wages=40k ltcg=5k cvt=0: no LTCG bump (ordinary+LTCG=28900 < 49450 threshold)',
       cc3.cvtTxLtcg, 0);

  // 4.4 Single, wages=$40k, LTCG=$5k, small cvt=$5k: ordinary+LTCG=28900+5000=33900 < 49450,
  // still no bump
  // tiWith = 40000+5000-16100=28900; totalTiWith=50000-16100=33900; ltcgAmtWith=5000
  // calcLTCGTax(28900,5000,'single'): end=33900 < 49450, all in 0% → 0
  const cc4 = computeConversionCost(5000, ctx({ wages: 40000, ltcg: 5000 }));
  near('4.4 wages=40k ltcg=5k cvt=5k: still no bump (tiWith+LTCG=33900 < 49450)',
       cc4.cvtTxLtcg, 0);

  // 4.5 Single, wages=$40k, LTCG=$5k, cvt=$15k: ordinary now 40k+15k=55k; tiWith=55k-16100=38900
  // totalTiWith=70k-16100=53900; ltcgAmtWith=53900-38900=15000... wait
  // Actually ltcg is still only $5k in the inputs, so:
  // totalTiWith = agiWith - std - srDW = (40000+15000+5000+0) - 16100 - 0 = 43900
  // tiWith = ordAgiWith - std - srDW = (40000+15000) - 16100 = 38900
  // ltcgAmtWith = 43900-38900 = 5000
  // calcLTCGTax(38900,5000,'single'): stackStart=38900, end=43900
  //   LTCGX[0]: top=min(49450,43900)=43900 > 38900 → (43900-38900)*0=0
  //   → ltcgTaxWith=0, cvtTxLtcg=0
  // Still below the threshold since ordinary fills 38900 and total is 43900 < 49450.
  const cc5 = computeConversionCost(15000, ctx({ wages: 40000, ltcg: 5000 }));
  near('4.5 wages=40k ltcg=5k cvt=15k: still no bump (total=43900 < 49450)',
       cc5.cvtTxLtcg, 0);

  // 4.6 Single, wages=$40k, LTCG=$5k, cvt=$25k: ordinary 40k+25k=65k; tiWith=65k-16100=48900
  // totalTiWith=70k-16100=53900; ltcgAmtWith=53900-48900=5000
  // calcLTCGTax(48900,5000,'single'): stackStart=48900, end=53900
  //   LTCGX[0]: top=min(49450,53900)=49450 > 48900 → (49450-48900)*0=0
  //   LTCGX[1]: top=min(545500,53900)=53900 > 49450 → (53900-49450)*0.15=4450*0.15=667.5
  //   → ltcgTaxWith=667.5; ltcgTaxBase=0; cvtTxLtcg=668 (rounded)
  const cc6 = computeConversionCost(25000, ctx({ wages: 40000, ltcg: 5000 }));
  near('4.6 wages=40k ltcg=5k cvt=25k: cvtTxLtcg≈668 ($4,450 of LTCG bumped to 15%)',
       cc6.cvtTxLtcg, 668, 2);
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 5: MULTI-YEAR PLAN — row counts and structural behavior
//
// computeMultiYear(income, nii, ltcg, ss, status, tradBal, rothBal, basis, g,
//                 nSr, stD, stateCode, nMed, curAge, retAge, taxableFrac,
//                 planConvert, spouseAge, isCouple, pensionIncome, localTax, taxSrc)
//
// Returns: {preRows, goldRows, ...} or null if planConvert<=0 or tradBal<=0
// goldRows only populate when retSSV+retPenV+retOtherV > 0 (DOM inputs).
// rmdStartAge = (new Date().getFullYear() - curAge) >= 1960 ? 75 : 73
// goldStartAge = max(retAge, curAge)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n─── Group 5: Multi-year plan ───');
{
  // 5.1 curAge=72, retAge=65, no retirement income: already-retired (curAge>retAge),
  // goldStartAge=72, rmdStartAge=75 (born 2026-72=1954 — not ≥1960, but the code checks
  // (new Date().getFullYear()-curAge)>=1960, i.e. birth year ≥1960; 1954 < 1960 → rmd=73.
  // Wait: born ~1954. goldStartAge(72) < rmdStartAge(73) → golden window MIGHT exist,
  // but retSSV+retPenV+retOtherV = 0 (DOM) → goldRows=[]. preRows: nWork=max(0,65-72)=0.
  // Actually hold on: (new Date().getFullYear()-72) = 2026-72 = 1954. 1954 >= 1960? No.
  // So rmdStartAge=73. goldStartAge=max(65,72)=72. 72<73 → window exists, gYears=min(1,10)=1.
  // But retirement income = 0 → goldRows stays empty. preRows=0.
  setRet(0, 0, 0);
  const plan1 = computeMultiYear(
    0, 0, 0, 0, 'single', 500000, 0, 0, 0.05, 0, ST[''], '', 0,
    72, 65, 1, 30000, undefined, false, 0
  );
  ok('5.1 curAge=72,retAge=65,no ret-income: preRows=0 (already retired)',
     plan1.preRows.length === 0);
  ok('5.2 curAge=72,retAge=65,no ret-income: goldRows=0 (retirement income not entered)',
     plan1.goldRows.length === 0);

  // 5.3 curAge=75 — this is a 75-year-old. Birth year = 2026-75 = 1951. 1951<1960 → rmdStartAge=73.
  // goldStartAge=max(65,75)=75. 75 < 73? No — 75 >= 73 → no golden window.
  // preRows=0 (curAge>=retAge). goldRows=0.
  const plan3 = computeMultiYear(
    0, 0, 0, 0, 'single', 500000, 0, 0, 0.05, 0, ST[''], '', 0,
    75, 65, 1, 30000, undefined, false, 0
  );
  ok('5.3 curAge=75 (past rmdStartAge=73): no golden window, goldRows=0',
     plan3.goldRows.length === 0);
  ok('5.4 curAge=75,retAge=65: no pre-retirement rows (already retired)',
     plan3.preRows.length === 0);

  // 5.5 curAge=60, retAge=65: pre-retirement phase has 5 rows (ages 60-64)
  // nWork = min(max(0, 65-60), 15) = 5
  // No golden window without retirement income.
  setRet(0, 0, 0);
  const plan5 = computeMultiYear(
    30000, 0, 0, 0, 'single', 500000, 0, 0, 0.05, 0, ST[''], '', 0,
    60, 65, 1, 20000, undefined, false, 0
  );
  ok('5.5 curAge=60,retAge=65: preRows has 5 rows (ages 60-64)',
     plan5.preRows.length === 5);

  // 5.6 Pre-retirement row ages should be curAge, curAge+1, ..., curAge+4
  const expectedAges = [60, 61, 62, 63, 64];
  ok('5.6 pre-retirement row ages = [60,61,62,63,64]',
     plan5.preRows.every((r, i) => r.age === expectedAges[i]));

  // 5.7 With retirement income entered, golden window appears
  // curAge=60, retAge=65, goldStartAge=65, rmdStartAge=?
  // birth year = 2026-60=1966. 1966>=1960 → rmdStartAge=75. gYears=min(75-65,10)=10.
  setRet(0, 20000, 0); // pension income entered → golden window fires
  const plan7 = computeMultiYear(
    30000, 0, 0, 0, 'single', 5000000, 0, 0, 0.05, 0, ST[''], '', 0,
    60, 65, 1, 20000, undefined, false, 0
  );
  ok('5.7 curAge=60,retAge=65,ret-income entered: goldRows exists (golden window active)',
     plan7.goldRows.length > 0);
  ok('5.8 golden window has up to 10 rows (rmdStartAge=75, goldStartAge=65, gYears=10)',
     plan7.goldRows.length === 10);

  // 5.9 User-supplied planConvert ($20k) is honored in golden rows (not overridden by optimizer)
  // effectiveGConv = planConvert>0 ? planConvert : gConv → 20000
  ok('5.9 planConvert=20000 honored in all goldRows (not overridden by optimizer)',
     plan7.goldRows.every(r => r.convert === 20000));

  // 5.11 Golden-window row ages are pinned: row[0].age = goldStartAge = 65
  // rowAge = goldStartAge+j; year = 2026+(goldStartAge-curAge)+j = 2026+5+0 = 2031.
  // A bug using curAge+j instead of goldStartAge+j would give age=60 here.
  ok('5.11 goldRows[0].age=65 (goldStartAge, not curAge)', plan7.goldRows[0].age === 65);
  ok('5.12 goldRows[9].age=74 (goldStartAge+9, last row of 10)', plan7.goldRows[9].age === 74);

  // 5.10 Returns null when planConvert=0
  setRet(0, 0, 0);
  const planNull = computeMultiYear(
    0, 0, 0, 0, 'single', 500000, 0, 0, 0.05, 0, ST[''], '', 0,
    60, 65, 1, 0, undefined, false, 0  // planConvert=0
  );
  ok('5.10 returns null when planConvert=0', planNull === null);

  setRet(0, 0, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 6: STATE EDGE CASES
//
// PA: ex:true, no age gate → cvtTxSt = 0 at ANY age (conversions are
//     transfers into an eligible PA retirement plan, not taxable distributions)
// IL: ex:true, no age gate → cvtTxSt = 0 (Schedule M exemption)
// MS: ex:true, age gate = 59.5 (EXAGE table) → taxable before 59.5, free after
// CT: RIX state, iraWeightPct=0.75 → only 75% of conversion is IRA-eligible
//     for the pension exclusion tiers; even at the 100% tier, 25% of conversion
//     is always taxable (at CT's 5.5% cr)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n─── Group 6: State edge cases ───');
{
  // 6.1 PA: single, age 55, $100k conversion — $0 state tax at any age
  const ccPA = computeConversionCost(100000, ctx({
    wages: 0, stateCode: 'PA', curAge: 55,
  }));
  near('6.1 PA: single age=55 cvt=100k: cvtTxSt=0 (conversions tax-free at any age in PA)',
       ccPA.cvtTxSt, 0);

  // 6.2 PA: age 45 (pre-59.5) — still $0 (NOT gated on age)
  const ccPA2 = computeConversionCost(50000, ctx({
    wages: 0, stateCode: 'PA', curAge: 45,
  }));
  near('6.2 PA: age=45 cvt=50k: cvtTxSt=0 (PA does not gate conversions on age)',
       ccPA2.cvtTxSt, 0);

  // 6.3 IL: ex:true, no age gate — state tax is $0 regardless of age
  const ccIL = computeConversionCost(50000, ctx({
    wages: 0, stateCode: 'IL', curAge: 55,
  }));
  near('6.3 IL: single age=55 cvt=50k: cvtTxSt=0 (IL exempts IRA income unconditionally)',
       ccIL.cvtTxSt, 0);

  // 6.4 IL: even younger filer — still exempt (no EXAGE gate for IL)
  const ccIL2 = computeConversionCost(50000, ctx({
    wages: 0, stateCode: 'IL', curAge: 40,
  }));
  near('6.4 IL: age=40 cvt=50k: cvtTxSt=0 (no age gate)', ccIL2.cvtTxSt, 0);

  // 6.5 MS: ex:true with EXAGE=59.5 — taxable BEFORE the gate
  // curAge=55, $50k conversion: exQualifies = stD.ex && exQualAge(55) >= exAge(59.5)
  // = true && 55>=59.5 = false → NOT exempt → cvtTxSt = taxableCvt * stD.cr
  // stD.cr for MS = 0.044 → cvtTxSt = 50000*0.044 = 2200
  const ccMS_young = computeConversionCost(50000, ctx({
    wages: 0, stateCode: 'MS', curAge: 55,
  }));
  near('6.5 MS: age=55 (below 59.5 gate): cvtTxSt=2200 (4.4% applies)',
       ccMS_young.cvtTxSt, 2200);

  // 6.6 MS: curAge=60 (above 59.5 gate) — exempt
  const ccMS_old = computeConversionCost(50000, ctx({
    wages: 0, stateCode: 'MS', curAge: 60,
  }));
  near('6.6 MS: age=60 (above 59.5 gate): cvtTxSt=0 (exemption applies)',
       ccMS_old.cvtTxSt, 0);

  // 6.7 CT: iraWeightPct=0.75 means only 75% of the conversion is eligible for
  // CT's pension-exclusion tiers. At low AGI (below $75k single), the 100% pension
  // exclusion applies — but IRA income only gets 75% into that shelter bucket.
  // So effective shelter on conversion = 75% × conversion. The remaining 25% is
  // always taxable at CT's cr (5.5% ≈ the tool's stD.cr=0.055).
  // Concrete: single, age=70, $0 other income, $20k conversion
  //   agiWith = 0 + 20000 + 0 = 20000 (below $75k CT threshold → 100% pension tier)
  //   IRA-eligible = 20000 × 0.75 = 15000 → fully sheltered by the 100% tier
  //   Taxable remainder = 20000 - 15000 = 5000
  //   cvtTxSt = 5000 × 0.055 = 275
  // (The exact RIX computation is more complex — resolveRetirementIncome handles it —
  // but the 25%-always-taxable property is the key invariant to test.)
  const ccCT = computeConversionCost(20000, ctx({
    wages: 0, stateCode: 'CT', curAge: 70,
  }));
  ok('6.7 CT: iraWeightPct=0.75 — at 100% exclusion tier, 25% of conversion remains taxable',
     ccCT.cvtTxSt > 0);
  // Also verify the amount is consistent with 25% of conversion being taxable:
  // cvtTxSt ≈ 20000 * 0.25 * 0.055 = 275
  near('6.8 CT: cvtTxSt ≈ 275 (25% of 20k at 5.5% CR — only 75% eligible for 100% exclusion)',
       ccCT.cvtTxSt, 275, 5);

  // 6.9 CT at higher AGI: conversion raises AGI past a CT tier boundary, sheltering less
  // than 75%×100%. With wages=$90k (above CT's $75k single cliff), the exclusion
  // drops toward 0 as AGI rises. A $10k conversion should still produce some state tax
  // (CT's exclusion falls proportionally with AGI in the $75k-$100k band), and that
  // tax must be more than the low-AGI case on a per-dollar basis.
  const ccCT_hi = computeConversionCost(10000, ctx({
    wages: 90000, stateCode: 'CT', curAge: 70,
  }));
  // At agiWith=$100k the step lookup hits {upTo:null,pct:0} → 0% exclusion.
  // IRA-eligible = 10000×0.75=7500; excluded = 7500×0 = 0; iraTaxable = 10000.
  // cvtTxSt = 10000×0.055 = 550.
  near('6.9 CT: agiWith=100k hits pct=0 tier, cvtTxSt=550 (full 10k at 5.5% CR)',
       ccCT_hi.cvtTxSt, 550, 5);
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
