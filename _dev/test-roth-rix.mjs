#!/usr/bin/env node
// Parity test: roth-conversion/index.html's rixExcluded() vs. the already-verified
// relocation/relo-engine.mjs's computeStateIncomeTax(). rixExcluded is a PORT of the
// same 5 shapes (ageTieredCap, steppedAmount, perSpousePhaseout, offsetStack, plus the
// generic hard/steppedPercent fallback) adapted to the Roth tool's before/with delta
// pattern — this test extracts the REAL function from the actual shipped HTML (not a
// third hand-transcription of the logic) and checks it against the REAL relo-engine
// function for equivalent inputs, across a systematic sweep per state. Divergence here
// means the port drifted from the reference, not that either implementation is "more
// right" — relo-engine is the trusted baseline since it already has its own 41-check
// suite verified against primary-source figures.
//
// Deliberately uses ss=0 in every case: relo-engine's AGI proxy is a crude
// ss+ira+pension+capGains+wages sum, while roth-conversion's agiBase uses the REAL
// taxable-SS-worksheet result (calcTaxableSS) — an intentional precision improvement,
// not a porting bug, but it means the two tools' AGI figures only coincide when SS is
// zero. Setting ss=0 isolates the actual thing under test: does the exclusion SHAPE
// logic (tiers, phase-outs, offset-stacking) produce the same dollar figure.

import { computeStateIncomeTax } from '../relocation/relo-engine.mjs';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

// Extract the real rixExcluded() function verbatim from the shipped HTML.
const html = readFileSync(new URL('../roth-conversion/index.html', import.meta.url), 'utf8');
const startMarker = 'function rixExcluded(';
const startIdx = html.indexOf(startMarker);
if (startIdx === -1) throw new Error('rixExcluded not found in index.html');
const fnStart = html.lastIndexOf('function', startIdx);
let depth = 0, i = html.indexOf('{', startIdx), bodyStart = i;
for (; i < html.length; i++) {
  if (html[i] === '{') depth++;
  else if (html[i] === '}') { depth--; if (depth === 0) break; }
}
const src = html.slice(fnStart, i + 1);
const tmpPath = new URL('../_dev/.rixExcluded.generated.mjs', import.meta.url);
writeFileSync(tmpPath, src + '\nexport { rixExcluded };\n');
const { rixExcluded } = await import(tmpPath.href + '?t=' + Date.now());
unlinkSync(tmpPath); // scratch extraction artifact, not meant to be committed

const states = JSON.parse(readFileSync(new URL('../roth-conversion/states.json', import.meta.url), 'utf8'));

let pass = 0, fail = 0;
function check(label, actual, expected, tolerance = 1) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) pass++;
  else { fail++; console.log(`FAIL  ${label}  (rixExcluded=${actual}, relo-engine=${expected})`); }
}

// Sweep: for each RIX state, a range of (status, age, spouseAge, income, agi-driving-wages)
// combinations, comparing rixExcluded's returned excluded-amount against what relo-engine
// implies (competingAmt - penTaxable, feeding the SAME amount in as `pension` alone so
// there's nothing to pool).
// CT is deliberately EXCLUDED from this sweep: since the 2026-08-24 CT IRA-haircut fix,
// computeConversionCost() no longer routes CT through the generic rixExcluded() path at
// all — it has its own stateCode==='CT' branch (see below for a dedicated parity check
// against that branch's mirrored logic instead). rixExcluded()'s CT handling is now dead
// code for the Roth tool specifically (still reachable from relo-engine.mjs's own
// generic fallback, but only for hypothetical future non-CT steppedPercent states with
// no iraWeightPct — CT itself takes relo-engine's dedicated weighted branch).
const RIX_STATES = ['GA', 'LA', 'SC', 'VA', 'WI', 'NM', 'NJ', 'WV', 'NY'];
// Added 'hoh' 2026-08-24 after finding NM's steppedAmount table groups HOH with 'joint'
// (wider thresholds) instead of the usual single/mfs/hoh -> "single" mapping — the
// generic sweep never exercised HOH for ANY state before this, so it couldn't have
// caught that bug. HOH files alone like single (see `status === 'mfj' ? ages : [age]`
// below — only mfj triggers the spouse-age loop), so adding it here is a pure
// regression-coverage improvement, not a new dimension needing its own loop structure.
// Added 'mfs' the same day for the same reason — closing the last untested filing
// status in this sweep. Same "files alone" shape as single/hoh, so no loop changes
// needed here either.
const statuses = ['single', 'mfj', 'hoh', 'mfs'];
const ages = [45, 55, 62, 63, 65, 67, 70, 80];
const competingAmts = [0, 5000, 20000, 50000, 90000, 150000];
const otherWages = [0, 30000, 80000, 140000];

let checked = 0;
for (const code of RIX_STATES) {
  const rix = states[code].taxRules.retirementIncome;
  const rules = states[code].taxRules;
  for (const status of statuses) {
    for (const age of ages) {
      for (const spouseAge of status === 'mfj' ? ages : [age]) {
        for (const competingAmt of competingAmts) {
          for (const wages of otherWages) {
            checked++;
            const agiProxy = wages + competingAmt; // ss=0, no nii/ltcg equivalent in relo-engine either
            const got = rixExcluded(rix, status, age, spouseAge, competingAmt, agiProxy, 0);

            // iraWithdrawal, not pension: for pooled states (pensionIncome.sameAs ===
            // "retirementIncome") relo-engine combines iraWithdrawal+pension before
            // applying the exclusion, so feeding the whole competingAmt through either
            // field alone gives the same combined total and the same result. For NOT-
            // pooled states — NY, whose pensionIncome is its own separate always-exempt
            // government-pension category — "pension" input skips retirementIncome's
            // exclusion logic entirely (comparing against the wrong statutory bucket);
            // iraWithdrawal is the field that always routes through retirementIncome,
            // pooled or not, so it's the one that actually tests the shape under test.
            const relo = computeStateIncomeTax(rules, status, {
              iraWithdrawal: competingAmt, wages, age, spouseAge,
            });
            const expected = competingAmt - relo.breakdown.iraTaxable;

            check(`${code} ${status} age=${age} spouseAge=${spouseAge} amt=${competingAmt} wages=${wages}`, got, expected);
          }
        }
      }
    }
  }
}

console.log(`Checked ${checked.toLocaleString()} combinations across ${RIX_STATES.length} states.`);

// WV-only supplemental sweep: netAgainstSS nets the SS BENEFIT against the cap, so
// (unlike every other RIX state) its result actually depends on a nonzero ss — the
// ss=0 sweep above only exercises the no-netting-effect base case. Feeding the same
// `ss` value as both rixExcluded's ssGross and relo-engine's income.ss is an
// equivalence-testing simplification (real callers use taxable-SS for the tool's own
// ssAmt param, a different, generally smaller figure) — fine here since this test
// checks the netAgainstSS SHAPE matches, not AGI precision (see file header).
{
  const rix = states.WV.taxRules.retirementIncome;
  const rules = states.WV.taxRules;
  const ssAmounts = [0, 3000, 8000, 16000, 24000];
  let wvChecked = 0;
  for (const status of statuses) {
    for (const age of ages) {
      for (const spouseAge of status === 'mfj' ? ages : [age]) {
        for (const competingAmt of competingAmts) {
          for (const ss of ssAmounts) {
            wvChecked++;
            const agiProxy = competingAmt + ss;
            const got = rixExcluded(rix, status, age, spouseAge, competingAmt, agiProxy, 0, ss);
            const relo = computeStateIncomeTax(rules, status, { pension: competingAmt, ss, age, spouseAge });
            const expected = competingAmt - relo.breakdown.penTaxable;
            check(`WV ${status} age=${age} spouseAge=${spouseAge} amt=${competingAmt} ss=${ss}`, got, expected);
          }
        }
      }
    }
  }
  console.log(`Checked ${wvChecked.toLocaleString()} additional WV ss-netting combinations.`);
}

// CT-specific check: computeConversionCost()'s dedicated stateCode==='CT' branch
// (2026-08-24 IRA-haircut fix) vs. relo-engine.mjs's matching weighted branch. Unlike
// the generic sweep above, this doesn't extract computeConversionCost() verbatim — it's
// a huge function with federal-tax-calc dependencies, not a small pure function like
// rixExcluded(). Instead this MIRRORS the shipped CT branch's formula by hand (same
// tradeoff the file header already accepts for rixExcluded's port from relo-engine) —
// if the shipped CT branch's logic changes, this mirror needs updating too.
{
  const rix = states.CT.taxRules.retirementIncome;
  const rules = states.CT.taxRules;
  const CT_IRA_FACTOR = 0.75;
  let ctChecked = 0, ctPass = 0, ctFail = 0;
  for (const status of statuses) {
    const ctStatus = status === 'mfj' ? 'joint' : 'single';
    const ctSteps = rix.exclusion.steps[ctStatus];
    const ctTierPct = (agi) => (ctSteps.find((t) => t.upTo == null || agi <= t.upTo) || ctSteps[ctSteps.length - 1]).pct;
    for (const pensionIncome of [0, 10000, 30000]) {
      for (const taxableCvt of competingAmts) {
        for (const wages of otherWages) {
          ctChecked++;
          const agiBase = wages + pensionIncome;
          const agiWith = agiBase + taxableCvt;
          // Mirrors computeConversionCost's CT branch exactly.
          const exBase = pensionIncome * ctTierPct(agiBase);
          const exWith = (pensionIncome + taxableCvt * CT_IRA_FACTOR) * ctTierPct(agiWith);
          const stTiBase = Math.max(0, pensionIncome - exBase);
          const stTiWith = Math.max(0, (pensionIncome + taxableCvt) - exWith);
          const gotConvTaxable = stTiWith - stTiBase;

          // relo-engine reports pension/IRA taxable separately rather than a before/with
          // delta, so compare the taxable amount each side attributes to ADDING the
          // conversion: feed pensionIncome alone for "base", pensionIncome+conversion
          // (via iraWithdrawal, since a conversion is IRA-sourced) for "with".
          const reloBase = computeStateIncomeTax(rules, status, { pension: pensionIncome, wages, age: 67, spouseAge: 67 });
          const reloWith = computeStateIncomeTax(rules, status, { pension: pensionIncome, iraWithdrawal: taxableCvt, wages, age: 67, spouseAge: 67 });
          const reloConvTaxable = (reloWith.breakdown.iraTaxable + reloWith.breakdown.penTaxable)
            - (reloBase.breakdown.iraTaxable + reloBase.breakdown.penTaxable);

          const ok = Math.abs(gotConvTaxable - reloConvTaxable) <= 1;
          if (ok) ctPass++;
          else { ctFail++; console.log(`FAIL  CT ${status} pension=${pensionIncome} conv=${taxableCvt} wages=${wages}  (computeConversionCost-mirror=${gotConvTaxable}, relo-engine=${reloConvTaxable})`); }
        }
      }
    }
  }
  pass += ctPass; fail += ctFail;
  console.log(`Checked ${ctChecked.toLocaleString()} additional CT IRA-haircut combinations.`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
