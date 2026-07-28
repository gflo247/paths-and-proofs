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
const RIX_STATES = ['GA', 'LA', 'SC', 'VA', 'WI', 'NM', 'CT', 'NJ'];
const statuses = ['single', 'mfj'];
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

            const relo = computeStateIncomeTax(rules, status, {
              pension: competingAmt, wages, age, spouseAge,
            });
            const expected = competingAmt - relo.breakdown.penTaxable;

            check(`${code} ${status} age=${age} spouseAge=${spouseAge} amt=${competingAmt} wages=${wages}`, got, expected);
          }
        }
      }
    }
  }
}

console.log(`Checked ${checked.toLocaleString()} combinations across ${RIX_STATES.length} states.`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
