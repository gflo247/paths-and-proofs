#!/usr/bin/env node
// Edge-case sweep for roth-conversion/index.html — computeConversionCost().
//
// Covers the precision gaps NOT exercised by the existing test suite
// (test-roth-scenarios.mjs, test-roth-rix.mjs, test-roth-retded.mjs, etc.):
//
//   Group 1: NIIT threshold straddling — 3.8% Medicare surcharge edge cases
//   Group 2: LTCG bracket-stacking across the 0%→15% and 15%→20% zone boundaries
//   Group 3: Senior deduction phaseout at the $75k/$150k AGI boundary
//   Group 4: Michigan RETDED — wages do NOT compete for pension cap; age-gate isolation
//   Group 5: EXAGE spouse age desync — IA/MS exemption requires BOTH spouses to qualify
//   Group 6: Ohio zero-bracket and Massachusetts surtax threshold straddling
//   Group 7: Connecticut iraWeightPct=0.75 — IRA gets lighter weight than pension
//
// All expected values are hand-derived from the production code's own formulas and
// constants (BRAX/STDD/LTCGX/NIIT thresholds/RETDED/EXAGE/RIX data), then
// cross-checked against the primary sources the production code cites.

import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolveRetirementIncome, federalTaxableSS } from '../core/retirement-rules.js';

// ─── Harness setup (mirrors test-roth-scenarios.mjs exactly) ────────────────
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
globalThis.window.resolveRetirementIncome = resolveRetirementIncome;
globalThis.window.calcTaxableSS           = federalTaxableSS;
globalThis.resolveRetirementIncome        = resolveRetirementIncome;
globalThis.calcTaxableSS                  = federalTaxableSS;

const html = readFileSync(new URL('../roth-conversion/index.html', import.meta.url), 'utf8');
const marker    = 'function computeConversionCost';
const markerIdx = html.indexOf(marker);
if (markerIdx === -1) throw new Error('computeConversionCost not found in index.html');
const scriptStart = html.lastIndexOf('<script>', markerIdx) + '<script>'.length;
const scriptEnd   = html.indexOf('</script>', markerIdx);
const scriptSrc   = html.slice(scriptStart, scriptEnd);
const { computeConversionCost, ST } =
  new Function(scriptSrc + '\nreturn {computeConversionCost, ST};')();

// ─── Assertions ─────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function ok(label, cond) {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL  ${label}`); }
}
function near(label, actual, expected, tol = 1) {
  const passes = Math.abs(actual - expected) <= tol;
  if (passes) { pass++; }
  else { fail++; console.log(`FAIL  ${label}  — expected ${expected} got ${actual}`); }
}

// ─── Minimal ctx builder (same as test-roth-scenarios.mjs) ──────────────────
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
// GROUP 1: NIIT THRESHOLD STRADDLING
//
// niiPool = nii + ltcg   (both count as NII for NIIT purposes)
// niitThr = {single:200000, mfj:250000, mfs:125000, hoh:200000}
// niitBase = niiPool>0 ? max(0, min(niiPool, agiBase-niitThr))*0.038 : 0
// niitWith = niiPool>0 ? max(0, min(niiPool, agiWith-niitThr))*0.038 : 0
// niitCost = max(0, niitWith - niitBase)
//
// Key property: once niiPool is FULLY in the NIIT zone (agiBase-niitThr >= niiPool),
// adding more ordinary income (via a conversion) doesn't increase NIIT at all —
// the pool is capped at niiPool. This is a real planning insight that tests 1.3/1.4
// bracket together.
// ═══════════════════════════════════════════════════════════════════════════

{
  // 1.1 agiBase exactly at threshold, no conversion → niitBase = 0.
  // wages=190k, nii=10k → agiBase=200000; min(10000, 200000-200000)*0.038 = 0.
  const c0 = computeConversionCost(0, ctx({ wages: 190000, nii: 10000 }));
  near('1.1 NIIT: agiBase=threshold, cvt=0 → niitBase=0', c0.niitBase, 0);

  // 1.2 $5k conversion crosses threshold — only the $5k above $200k is in the pool.
  // agiWith=205000; min(10000,5000)*0.038=190; niitBase=0; niitCost=190.
  const c5 = computeConversionCost(5000, ctx({ wages: 190000, nii: 10000 }));
  near('1.2 NIIT: cvt=5k straddles threshold → niitCost=190 (partial pool in zone)', c5.niitCost, 190);

  // 1.3 Already partially in NIIT zone; conversion fills the rest.
  // wages=194k, nii=10k → agiBase=204000; niitBase=min(10k,4k)*0.038=152.
  // cvt=10k: agiWith=214000; niitWith=min(10k,14k)*0.038=380; niitCost=228.
  const c10 = computeConversionCost(10000, ctx({ wages: 194000, nii: 10000 }));
  near('1.3 NIIT: partial zone at base, full at with → niitCost=228', c10.niitCost, 228);

  // 1.4 Pool FULLY in NIIT zone before the conversion — adding a conversion adds
  // NOTHING to NIIT because the pool is already capped.
  // wages=200k, nii=20k → agiBase=220k; niitBase=min(20k,20k)*0.038=760 (capped at pool).
  // cvt=10k: agiWith=230k; niitWith=min(20k,30k)*0.038=760 (still capped); niitCost=0.
  const c10b = computeConversionCost(10000, ctx({ wages: 200000, nii: 20000 }));
  near('1.4 NIIT: pool fully in zone before conversion → niitCost=0 (cap prevents further increase)', c10b.niitCost, 0);

  // 1.5 MFS has a lower threshold ($125k vs single's $200k) — verifies MFS path.
  // wages=120k, nii=10k → agiBase=130000; niitBase=min(10k,5k)*0.038=190.
  // cvt=10k: agiWith=140000; niitWith=min(10k,15k)*0.038=380; niitCost=190.
  const cMFS = computeConversionCost(10000, ctx({ wages: 120000, nii: 10000, status: 'mfs' }));
  near('1.5 NIIT MFS threshold=$125k: niitCost=190 (different threshold than single)', cMFS.niitCost, 190);
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 2: LTCG BRACKET-STACKING
//
// Roth conversions are ORDINARY income — they raise tiWith, which raises the
// floor LTCG stacks on, potentially pushing LTCG from a lower preferential
// bracket into a higher one. This shows up as cvtTxLtcg > 0.
//
// LTCGX single: 0% ≤$49,450 / 15% $49,450–$545,500 / 20% above
// STDD single = $16,100
// ═══════════════════════════════════════════════════════════════════════════

{
  // 2.1 Conversion pushes ALL LTCG from the 0% zone into the 15% zone.
  // wages=$31,100 → tiBase=15,000. ltcg=$30,000. cvt=$34,450 → tiWith=49,450 (= 0% top).
  // Base: calcLTCGTax(15000, 30000) — end=45000 < 49450 → all at 0% → $0.
  // With: calcLTCGTax(49450, 30000) — stack starts at the 15% boundary → 30000*0.15=$4500.
  // cvtTxLtcg = $4500.
  const c1 = computeConversionCost(34450, ctx({ wages: 31100, ltcg: 30000 }));
  near('2.1 LTCG: conversion pushes $30k LTCG from 0%→15% zone → cvtTxLtcg=$4500', c1.cvtTxLtcg, 4500);

  // 2.2 Conversion pushes some LTCG from the 15% zone into the 20% zone.
  // wages=$557,100 → tiBase=$541,000. ltcg=$100,000. cvt=$10,000 → tiWith=$551,000.
  // Base: $4,500 (541k→545.5k) at 15% + $95,500 at 20% = $675 + $19,100 = $19,775.
  // With: all $100k sits above 551k → only 20% zone → $20,000.
  // cvtTxLtcg = $225 (=$4,500 of LTCG shifted from 15%→20%, extra cost = $4,500×0.05).
  const c2 = computeConversionCost(10000, ctx({ wages: 557100, ltcg: 100000 }));
  near('2.2 LTCG: conversion shifts $4.5k LTCG from 15%→20% → cvtTxLtcg=$225', c2.cvtTxLtcg, 225);

  // 2.3 All LTCG stays in 0% zone even after a $5k conversion — cvtTxLtcg=0.
  // wages=$16,100 → tiBase=0. ltcg=$40,000. cvt=$5,000 → tiWith=$5,000.
  // Both: end=45000 < LTCG 0% top ($49,450) → all at 0%.
  const c3 = computeConversionCost(5000, ctx({ wages: 16100, ltcg: 40000 }));
  near('2.3 LTCG: all LTCG stays in 0% zone → cvtTxLtcg=0', c3.cvtTxLtcg, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 3: SENIOR DEDUCTION PHASEOUT BOUNDARY
//
// seniorDed(agi, status, n) = max(0, n*6000 - max(0, agi-threshold)*0.06)
// single threshold=$75,000 / MFJ threshold=$150,000
// Phase-out rate: $60 per $1,000 of AGI over threshold (6%).
//
// A conversion raises agiWith → srDW may be LOWER than srD → tiWith grows
// by MORE than the raw conversion amount → effective rate exceeds the marginal
// bracket rate. This amplifier is tested via the srDW return value.
// ═══════════════════════════════════════════════════════════════════════════

{
  // 3.1 Just below $75k threshold: full $6k deduction, no phaseout.
  // wages=$74,000, nSr=1 → agiBase=74000 < 75000 → srD=max(0,6000-0)=6000.
  const c1 = computeConversionCost(0, ctx({ wages: 74000, nSr: 1 }));
  near('3.1 senior ded: wages=74k below threshold → srD=6000 (full deduction)', c1.srD, 6000);

  // 3.2 Conversion crosses $75k threshold → phaseout bites srDW.
  // wages=$75k, nSr=1, cvt=$5k → agiWith=80000.
  // srDW = max(0, 6000 - (80000-75000)*0.06) = max(0, 6000-300) = 5700.
  const c2 = computeConversionCost(5000, ctx({ wages: 75000, nSr: 1 }));
  near('3.2 senior ded: cvt crosses $75k → srDW=5700 (phaseout reduces deduction by $300)', c2.srDW, 5700);

  // 3.3 MFJ both seniors: threshold=$150k.
  // wages=$149k, nSr=2, cvt=$5k → agiWith=154000.
  // srDW = max(0, 12000 - (154000-150000)*0.06) = max(0, 12000-240) = 11760.
  const c3 = computeConversionCost(5000, ctx({ wages: 149000, nSr: 2, status: 'mfj', isCouple: true }));
  near('3.3 senior ded MFJ: cvt crosses $150k → srDW=11760 (nSr=2, phaseout=$240)', c3.srDW, 11760);
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 4: MICHIGAN RETDED — WAGES DO NOT COMPETE FOR PENSION CAP
//
// RETDED.MI = {single:67610, mfj:135220, conversionAgeGate:59.5}
// Only pensionIncome competes for the cap — wagesInc is irrelevant.
//
// Formula:
//   stTiBase        = max(0, pension - min(cap, pension))
//   stTiWithEligible= max(0, (pension+cvtEligible) - min(cap, pension+cvtEligible))
//   cvtTxSt         = ((stTiWithEligible-stTiBase) + (cvt-cvtEligible)) * MI.cr
// MI.cr = 4.25%, conversionAgeGate = 59.5
// ═══════════════════════════════════════════════════════════════════════════

{
  // 4.1 Wages=$80k (> cap=$67,610), pension=$0, age=65 (≥59.5) → wages don't compete.
  // stTiBase=max(0,0-0)=0; stTiWithEligible=max(0,20000-20000)=0 (cvt<cap); cvtTxSt=0.
  // Wages above the cap is intentional: if wages were incorrectly fed into the cap
  // formula (e.g., using wages+pension instead of just pension), stTiBase would become
  // max(0,80000-67610)=12390 and cvtTxSt would be non-zero → test would FAIL, catching
  // the bug. Wages below the cap (e.g. $60k) would be silently absorbed by the cap
  // clamp and miss that exact bug class.
  const c1 = computeConversionCost(20000, ctx({ wages: 80000, stateCode: 'MI', curAge: 65 }));
  near('4.1 MI wages=80k (>cap) pension=0 age=65: cvtTxSt=0 (wages don\'t compete for cap)', c1.cvtTxSt, 0);

  // 4.2 Pension=$70k (>cap=$67,610), age=65 → cap fully exhausted by pension.
  // stTiBase=max(0,70000-67610)=2390; stTiWithEligible=max(0,90000-67610)=22390.
  // cvtTxSt = (20000+0) * 0.0425 = 850.
  const c2 = computeConversionCost(20000, ctx({ pension: 70000, stateCode: 'MI', curAge: 65 }));
  near('4.2 MI pension=70k (>cap) age=65: cvtTxSt=850 (cap exhausted, conversion fully taxable)', c2.cvtTxSt, 850);

  // 4.3 Age=55 (< conversionAgeGate=59.5) → ZERO shelter for the conversion.
  // cvtEligible=0; cvtTxSt = (0 + cvt) * 0.0425 = 850.
  // Distinct from 4.2: same cvtTxSt, different reason — age gate, not cap exhaustion.
  const c3 = computeConversionCost(20000, ctx({ stateCode: 'MI', curAge: 55 }));
  near('4.3 MI age=55 (<59.5 gate): cvtTxSt=850 (zero shelter under conversionAgeGate)', c3.cvtTxSt, 850);
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 5: EXAGE SPOUSE AGE DESYNC
//
// EXAGE = {IA:55, MS:59.5}
// exQualAge = isCouple ? Math.min(curAge, spouseAge) : curAge
// exQualifies = stD.ex && (exAge===undefined || exQualAge >= exAge)
//
// Joint returns: the YOUNGER spouse's age is used. Both spouses must meet the
// threshold before the conversion is exempt. This is the conservative reading —
// the tool has no way to know per-spouse IRA ownership.
// ═══════════════════════════════════════════════════════════════════════════

{
  // 5.1 IA couple: primary=56, spouse=53. min(56,53)=53 < EXAGE.IA=55 → NOT exempt.
  // cvtTxSt = 20000 * IA.cr = 20000 * 0.038 = 760.
  const c1 = computeConversionCost(20000, ctx({
    stateCode: 'IA', status: 'mfj', isCouple: true, curAge: 56, spouseAge: 53,
  }));
  near('5.1 IA couple age=56/53: NOT exempt (53<55) → cvtTxSt=760', c1.cvtTxSt, 760);

  // 5.2 IA couple: primary=56, spouse=55. min(56,55)=55 ≥ EXAGE.IA=55 → exempt.
  // cvtTxSt = 0.
  const c2 = computeConversionCost(20000, ctx({
    stateCode: 'IA', status: 'mfj', isCouple: true, curAge: 56, spouseAge: 55,
  }));
  near('5.2 IA couple age=56/55: exempt (min=55 meets threshold exactly) → cvtTxSt=0', c2.cvtTxSt, 0);

  // 5.3 MS single: age=58 < EXAGE.MS=59.5 → NOT exempt (early-distribution rule).
  // cvtTxSt = 20000 * MS.cr = 20000 * 0.044 = 880.
  const c3 = computeConversionCost(20000, ctx({ stateCode: 'MS', curAge: 58 }));
  near('5.3 MS single age=58 (<59.5): NOT exempt → cvtTxSt=880', c3.cvtTxSt, 880);

  // 5.4 MS single: age=59.5 (exactly at EXAGE.MS gate) → exempt.
  // cvtTxSt = 0.
  const c4 = computeConversionCost(20000, ctx({ stateCode: 'MS', curAge: 59.5 }));
  near('5.4 MS single age=59.5 (exactly at gate): exempt → cvtTxSt=0', c4.cvtTxSt, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 6: OHIO ZERO-BRACKET AND MASSACHUSETTS SURTAX THRESHOLD
//
// OH: 0% on ordinary income ≤$26,050; 2.75% above (no age gate).
//   ohBase = income + nii + ltcg  (SS excluded per OH SS exemption)
//   cvtTxSt = max(0, ohBase+cvt-26050) - max(0, ohBase-26050)) * stD.cr
//
// MA: flat 5% base + 4% surtax on income above $1,107,750 (2026 DOR threshold).
//   maBase = income + nii + ltcg
//   cvtTxSt = cvt*0.05 + (max(0,maBase+cvt-1107750) - max(0,maBase-1107750))*0.04
// ═══════════════════════════════════════════════════════════════════════════

{
  // 6.1 OH: all income below threshold → cvtTxSt=0 regardless of conversion.
  const c1 = computeConversionCost(0, ctx({ wages: 24000, stateCode: 'OH' }));
  near('6.1 OH wages=24k cvt=0: cvtTxSt=0 (below $26,050 threshold)', c1.cvtTxSt, 0);

  // 6.2 OH: conversion straddles threshold — only the $2,950 above $26,050 is taxed.
  // ohBase=24000; stTiWith=max(0,29000-26050)=2950; cvtTxSt=2950*0.0275=$81.13.
  const c2 = computeConversionCost(5000, ctx({ wages: 24000, stateCode: 'OH' }));
  near('6.2 OH wages=24k cvt=5k: cvtTxSt≈$81.13 (straddles $26,050, only above portion taxed)', c2.cvtTxSt, 81.13, 0.02);

  // 6.3 MA: well below $1,107,750 surtax threshold — only flat 5% applies.
  // cvtTxSt = 20000 * 0.05 = 1000.
  const c3 = computeConversionCost(20000, ctx({ wages: 600000, stateCode: 'MA' }));
  near('6.3 MA wages=600k cvt=20k: cvtTxSt=1000 (below surtax threshold, flat 5% only)', c3.cvtTxSt, 1000);

  // 6.4 MA: conversion straddles $1,107,750 surtax threshold.
  // maBase=1100000; stTiWith=max(0,1120000-1107750)=12250; surtax=12250*0.04=490.
  // cvtTxSt = 20000*0.05 + 490 = $1490.
  const c4 = computeConversionCost(20000, ctx({ wages: 1100000, stateCode: 'MA' }));
  near('6.4 MA wages=1.1M cvt=20k: cvtTxSt=1490 (straddles $1,107,750 surtax threshold)', c4.cvtTxSt, 1490);
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 7: CONNECTICUT iraWeightPct=0.75
//
// CT is the only state where IRA distributions (Roth conversions ARE IRA
// distributions per CT-1040 Pension/Annuity Worksheet) enter the exclusion at
// 75% weight — pension/annuity gets 100%. This applies at EVERY AGI tier,
// including the 100% exclusion tier below $75k single.
//
// Formula for conversion with no pension:
//   weighted   = cvt * 0.75
//   totalEx    = weighted * tier.pct
//   iraTaxable = cvt - totalEx = cvt * (1 - 0.75 * pct)
//   cvtTxSt    = iraTaxable * CT.cr   (CT.cr = 0.055)
//
// CT single AGI step tiers (agiWith determines the tier):
//   ≤$74,999 → pct=1.00   $75k–$77.5k → pct=0.85   $77.5k–$80k → pct=0.70
//   $80k–$82.5k → 0.55    $82.5k–$85k → 0.40       $85k–$87.5k → 0.25
//   $87.5k–$90k → 0.10    $90k–$95k   → 0.05       $95k–$100k  → 0.025
//   ≥$100,000 → pct=0.00 (fully taxable)
// ═══════════════════════════════════════════════════════════════════════════

{
  // 7.1 agiWith=$70k → 100% exclusion tier. Despite pct=1.0, the IRA weight means
  // 25% of the conversion is still taxable. If weight were 1.0 (wrong), cvtTxSt=0.
  // iraTaxable=10000*(1-0.75*1.0)=2500; cvtTxSt=2500*0.055=$137.50.
  const c1 = computeConversionCost(10000, ctx({ wages: 60000, stateCode: 'CT' }));
  near('7.1 CT wages=60k cvt=10k (agiWith=70k, pct=1.0): cvtTxSt=$137.50 (75% IRA weight at top tier)', c1.cvtTxSt, 137.50, 0.5);

  // 7.2 agiWith=$110k → 0% exclusion tier, fully taxable (pct=0 → no IRA weight effect).
  // iraTaxable=10000; cvtTxSt=10000*0.055=$550.
  const c2 = computeConversionCost(10000, ctx({ wages: 100000, stateCode: 'CT' }));
  near('7.2 CT wages=100k cvt=10k (agiWith=110k, pct=0): cvtTxSt=$550 (fully taxable above $100k)', c2.cvtTxSt, 550, 0.5);

  // 7.3 agiWith=$77k → 85% exclusion tier. IRA weight applied within the tier.
  // wages=$74k, cvt=$3k → agiWith=$77,000 (tier: upTo:77499, pct=0.85).
  // weighted=3000*0.75=2250; totalEx=2250*0.85=1912.50; iraTaxable=3000-1912.50=1087.50.
  // cvtTxSt=1087.50*0.055=$59.81.
  const c3 = computeConversionCost(3000, ctx({ wages: 74000, stateCode: 'CT' }));
  near('7.3 CT wages=74k cvt=3k (agiWith=77k, pct=0.85): cvtTxSt≈$59.81 (IRA weight in 85% tier)', c3.cvtTxSt, 59.81, 0.5);
}

// ── Done ─────────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
