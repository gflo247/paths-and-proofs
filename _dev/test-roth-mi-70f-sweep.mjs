#!/usr/bin/env node
// Michigan stress test — 70yo single filer, $250k traditional IRA
//
// Sweeps conversion amounts $0→$200k for two SS scenarios:
//   · Modest  — $18,000/yr SS benefit
//   · Higher  — $28,000/yr SS benefit
//
// Assumptions:
//   · No wages, no pension, no NII, no LTCG (SS income + conversion only)
//   · nSr=1  (single filer 65+, senior deduction applies)
//   · No local tax
//   · Birth year 2026-70=1956 → rmdStartAge=73; age 70 → no RMDs yet
//
// Key 2026 constants (OBBBA-enhanced, from the code itself):
//   Standard deduction single:        $16,100
//   Senior deduction (nSr=1, <$75k):   $6,000  (phases out at $0.06/$ above $75k AGI)
//   12% bracket top (taxable income):  $48,475
//   22% bracket top (taxable income): $103,350
//   24% bracket top (taxable income): $197,300
//   SS taxability single thresholds:  $25,000 (lo) / $34,000 (hi)
//   IRMAA single tier-1 threshold:    $109,000 MAGI
//   MI pension deduction cap (single, age 70): $67,610
//   MI tax rate (cr):                   4.25%
//
// Run: node _dev/test-roth-mi-70f-sweep.mjs

import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolveRetirementIncome, federalTaxableSS } from '../core/retirement-rules.js';

// ─── Harness setup ────────────────────────────────────────────────────────────
const vc = new VirtualConsole();
const dom = new JSDOM(`<!doctype html><body>
  <input id="retSS"><input id="retPen"><input id="retOther">
  <input id="niiIncome"><input id="ltcgIncome">
</body>`, { virtualConsole: vc });
globalThis.window   = dom.window;
globalThis.document = dom.window.document;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.matchMedia = () => ({ matches: true });
globalThis.window.resolveRetirementIncome = resolveRetirementIncome;
globalThis.window.calcTaxableSS           = federalTaxableSS;
globalThis.resolveRetirementIncome        = resolveRetirementIncome;
globalThis.calcTaxableSS                  = federalTaxableSS;

const html = readFileSync(new URL('../roth-conversion/index.html', import.meta.url), 'utf8');
const marker    = 'function computeConversionCost';
const markerIdx = html.indexOf(marker);
if (markerIdx === -1) throw new Error('computeConversionCost not found');
const scriptStart = html.lastIndexOf('<script>', markerIdx) + '<script>'.length;
const scriptEnd   = html.indexOf('</script>', markerIdx);
const { computeConversionCost, ST } =
  new Function(html.slice(scriptStart, scriptEnd) + '\nreturn {computeConversionCost, ST};')();

// ─── Formatting ───────────────────────────────────────────────────────────────
const $   = n  => ('$' + Math.round(n).toLocaleString()).padStart(10);
const pct = n  => (n * 100).toFixed(1).padStart(5) + '%';
const MI_CAP = 67610; // single, age 70, no other pension to compete

function makeCtx(ss) {
  return {
    income: 0, pensionIncome: 0, nii: 0, ltcg: 0, ss,
    status: 'single', nSr: 1,
    stD: ST['MI'], stateCode: 'MI',
    curAge: 70, spouseAge: undefined, isCouple: false,
    taxableFrac: 1, localTax: '',
  };
}

// Monotonic binary search: finds smallest cvt in [lo,hi] where fn(cvt) is true.
// Only use for monotonic predicates (once true, stays true).
function findCrossing(fn, lo = 0, hi = 200000) {
  if (!fn(hi)) return null; // never crosses in range
  let a = lo, b = hi;
  for (let i = 0; i < 22; i++) {
    const m = Math.round((a + b) / 2);
    fn(m) ? (b = m) : (a = m);
  }
  return b;
}

// Torpedo zone: analytically derived from IRS Pub 915 two-tier formula (single).
// single lo=$25k, hi=$34k; zone1 = min(ss*0.5, (hi-lo)*0.5) = min(ss*0.5, 4500)
// Torpedo starts when PI = cvt + ss*0.5 > lo=25000  → cvt > 25000 - ss*0.5
// Torpedo ends  when ssWith = ss*0.85 (cap):
//   ss*0.85 = zone1 + (PI - hi)*0.85  → PI = (ss*0.85 - zone1)/0.85 + hi
//   → cvt = PI - ss*0.5
function torpedoZone(ss) {
  const lo = 25000, hi = 34000;
  const zone1 = Math.min(ss * 0.5, (hi - lo) * 0.5);
  const start = Math.max(0, lo - ss * 0.5);
  const piEnd = (ss * 0.85 - zone1) / 0.85 + hi;
  const end   = Math.max(start, piEnd - ss * 0.5);
  return { start: Math.round(start), end: Math.round(end), ssAt85: Math.round(ss * 0.85) };
}

function runScenario(ssLabel, ss) {
  const ctx = makeCtx(ss);
  const base = computeConversionCost(0, ctx);
  const torp = torpedoZone(ss);

  // Monotonic crossings (ssWith plateaus, IRMAA, MI shelter, bracket shifts all increase monotonically)
  const miCapCvt    = findCrossing(cvt => computeConversionCost(cvt, ctx).cvtTxSt > 0);
  const irmaaCvt    = findCrossing(cvt => computeConversionCost(cvt, ctx).tierWith >= 1);
  const bracket22   = findCrossing(cvt => {
    if (cvt < 500) return false;
    const lo = computeConversionCost(cvt - 500, ctx);
    const hi = computeConversionCost(cvt + 500, ctx);
    return (hi.cvtTxFed - lo.cvtTxFed) / 1000 >= 0.205; // 22% marginal
  });
  const bracket24   = findCrossing(cvt => {
    if (cvt < 500) return false;
    const lo = computeConversionCost(cvt - 500, ctx);
    const hi = computeConversionCost(cvt + 500, ctx);
    return (hi.cvtTxFed - lo.cvtTxFed) / 1000 >= 0.235; // 24% marginal
  });

  console.log(`\n${'═'.repeat(100)}`);
  console.log(`  MICHIGAN · Age 70 · Single · SS = $${ss.toLocaleString()}/yr (${ssLabel}) · $250k traditional IRA`);
  console.log(`  No wages / no pension / no NII or LTCG`);
  console.log(`${'═'.repeat(100)}`);
  console.log(`  Baseline (cvt=$0):  taxable SS = ${$(base.ssBase)}    senior deduction = ${$(base.srD)}    IRMAA tier ${base.tierBase}`);
  console.log(`\n  Key thresholds for this profile:`);
  console.log(`    SS torpedo zone:       ~${$(torp.start).trim()} → ~${$(torp.end).trim()} conversion  (SS taxability rises $0 → ${$(torp.ssAt85).trim()})`);
  console.log(`    MI shelter cap:        ~${$(miCapCvt).trim()} conversion  (first $${MI_CAP.toLocaleString()} sheltered; 4.25% MI tax applies above)`);
  console.log(`    12% → 22% federal:     ~${bracket22 !== null ? $(bracket22).trim() : 'n/a'} conversion`);
  console.log(`    22% → 24% federal:     ~${bracket24 !== null ? $(bracket24).trim() : 'n/a'} conversion`);
  console.log(`    IRMAA tier 1 ($109k):  ~${irmaaCvt !== null ? $(irmaaCvt).trim() : 'n/a'} conversion  (⚠ Part B + D premium surcharge)`);

  // ── Sweep table ───────────────────────────────────────────────────────────
  const checkpoints = new Set([
    0, 5000, 10000, 15000, 20000, 25000,
    Math.round(torp.start / 1000) * 1000,
    Math.round(torp.end   / 1000) * 1000,
    30000, 35000, 40000, 45000, 50000,
    miCapCvt !== null ? Math.round(miCapCvt / 1000) * 1000 : null,
    bracket22 !== null ? Math.round(bracket22 / 1000) * 1000 : null,
    60000, 70000, 80000,
    irmaaCvt !== null ? Math.round(irmaaCvt / 1000) * 1000 : null,
    90000, 100000,
    bracket24 !== null ? Math.round(bracket24 / 1000) * 1000 : null,
    110000, 120000, 130000, 140000, 150000, 175000, 200000,
  ].filter(v => v !== null && v >= 0 && v <= 200000));

  const rows = [...checkpoints].sort((a, b) => a - b);

  console.log(`\n  ${'─'.repeat(98)}`);
  console.log(`  ${'Convert'.padEnd(12)} ${'Fed tax'.padEnd(11)} ${'MI tax'.padEnd(10)} ${'Total'.padEnd(11)} ${'Eff %'.padEnd(8)} ${'Marg %'.padEnd(8)} ${'SS taxbl'.padEnd(11)} ${'IRMAA'.padEnd(7)} Notes`);
  console.log(`  ${'─'.repeat(98)}`);

  let prevFed = 0, prevSt = 0, prevCvt = 0;

  for (const cvt of rows) {
    const cc     = computeConversionCost(cvt, ctx);
    const total  = cc.cvtTxFed + cc.cvtTxSt;
    const effR   = cvt > 0 ? total / cvt : 0;
    const margR  = (cvt > prevCvt)
      ? ((cc.cvtTxFed + cc.cvtTxSt) - (prevFed + prevSt)) / (cvt - prevCvt)
      : 0;

    const notes = [];
    if (cvt > 0 && cvt >= torp.start && cvt <= torp.end + 1000) {
      const gain = cc.ssWith - base.ssBase;
      if (gain > 0 && gain < torp.ssAt85) notes.push(`torpedo (+${$(gain).trim()} SS taxable)`);
      if (gain >= torp.ssAt85) notes.push('SS fully taxable (85% cap)');
    }
    if (cvt > torp.end && cc.ssWith >= torp.ssAt85 && computeConversionCost(Math.max(0, cvt - 1000), ctx).ssWith < torp.ssAt85) {
      notes.push('SS hits 85% cap');
    }
    if (cc.cvtTxSt > 0 && prevCvt <= (miCapCvt || 0) && cvt > (miCapCvt || 0)) {
      notes.push('MI shelter exhausted');
    }
    if (cc.tierWith > 0 && cc.tierWith > cc.tierBase) {
      notes.push(`⚠ IRMAA tier ${cc.tierWith}`);
    } else if (cc.tierBase > 0) {
      notes.push(`IRMAA tier ${cc.tierBase}`);
    }

    const irmaaStr = cc.tierBase === cc.tierWith
      ? String(cc.tierBase)
      : `${cc.tierBase}→${cc.tierWith}`;
    const margStr  = cvt > 0 ? pct(margR) : '    —  ';

    console.log(
      '  ' +
      $(cvt        ).padEnd(12) +
      $(cc.cvtTxFed).padEnd(11) +
      $(cc.cvtTxSt ).padEnd(10) +
      $(total      ).padEnd(11) +
      pct(effR     ).padEnd(8)  +
      margStr.padEnd(8)         +
      $(cc.ssWith  ).padEnd(11) +
      irmaaStr.padStart(3).padEnd(7) +
      notes.join(' · ')
    );

    prevFed = cc.cvtTxFed; prevSt = cc.cvtTxSt; prevCvt = cvt;
  }
}

runScenario('Modest', 18000);
runScenario('Higher', 28000);
