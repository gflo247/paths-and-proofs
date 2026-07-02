// check-states-json.mjs — the extraction guard.
//
// Proves that states.json is a faithful, lossless restructuring of the audited
// ST table in roth-conversion/index.html. Run by `npm run verify` so a drift can
// never pass the harness. Exits non-zero (and prints what diverged) on any mismatch.
//
// Checks:
//   1. The HTML table parses to exactly 50 states + DC (51 real entries).
//   2. states.json has exactly the same 51 state codes — none missing, none extra.
//   3. For every state, the roth block (cr, ex, note) in states.json is byte-for-byte
//      identical to the parsed HTML. This is the anti-drift guarantee.
//   4. Every state has a facts.name that matches the HTML name.
//
// It does NOT check the facts brackets against anything (those are new data with no
// HTML counterpart); their correctness is a separate, source-based review.

import { readFileSync } from 'node:fs';
import { parseStatesFromHtml } from './parse-states.mjs';

const htmlPath = new URL('../roth-conversion/index.html', import.meta.url);
const jsonPath = new URL('../roth-conversion/states.json', import.meta.url);

const fail = (msg) => { console.error(`STATES-JSON GUARD FAILED: ${msg}`); process.exit(1); };

// Reusable bracket-sanity: ordering, rate range, final-null shape. Returns array of
// problem strings (empty = valid). `label` identifies which schedule for error messages.
const bracketProblems = (arr, code, label) => {
  const out = [];
  if (!Array.isArray(arr) || arr.length === 0) {
    out.push(`${code}: ${label} must be a non-empty array`);
    return out;
  }
  let prevUpTo = -Infinity;
  arr.forEach((row, i) => {
    if (typeof row.rate !== 'number' || row.rate < 0 || row.rate > 0.15) {
      out.push(`${code}: ${label}[${i}] rate ${row.rate} out of range 0-0.15`);
    }
    const isLast = i === arr.length - 1;
    if (isLast) {
      if (row.upTo !== null) out.push(`${code}: ${label} final bracket upTo must be null`);
    } else if (typeof row.upTo !== 'number') {
      out.push(`${code}: ${label}[${i}] upTo must be a number`);
    } else if (row.upTo <= prevUpTo) {
      out.push(`${code}: ${label}[${i}] upTo ${row.upTo} not strictly ascending`);
    } else {
      prevUpTo = row.upTo;
    }
  });
  return out;
};

// --- 1. Parse the live HTML table ---
let parsed;
try { parsed = parseStatesFromHtml(htmlPath); }
catch (e) { fail(`could not parse HTML table: ${e.message}`); }

const htmlCodes = Object.keys(parsed).filter((k) => k !== '').sort();
if (htmlCodes.length !== 51) {
  fail(`HTML table has ${htmlCodes.length} real entries; expected 51 (50 states + DC).`);
}

// --- 2. Load states.json and compare the code sets ---
let json;
try { json = JSON.parse(readFileSync(jsonPath, 'utf8')); }
catch (e) { fail(`could not read/parse states.json: ${e.message}`); }

const jsonCodes = Object.keys(json).filter((k) => k !== '_schema').sort();
const missing = htmlCodes.filter((c) => !jsonCodes.includes(c));
const extra = jsonCodes.filter((c) => !htmlCodes.includes(c));
if (missing.length) fail(`states.json is missing: ${missing.join(', ')}`);
if (extra.length) fail(`states.json has unexpected codes: ${extra.join(', ')}`);

// --- 3 & 4. Per-state field-level comparison ---
const diffs = [];
for (const code of htmlCodes) {
  const h = parsed[code];
  const j = json[code];
  if (!j.roth) { diffs.push(`${code}: missing roth block`); continue; }
  if (!j.facts || j.facts.name !== h.n) {
    diffs.push(`${code}: facts.name "${j.facts?.name}" != HTML "${h.n}"`);
  }
  if (j.roth.cr !== h.cr) diffs.push(`${code}: cr ${j.roth.cr} != HTML ${h.cr}`);
  if (j.roth.ex !== h.ex) diffs.push(`${code}: ex ${j.roth.ex} != HTML ${h.ex}`);
  if (j.roth.note !== h.note) diffs.push(`${code}: note differs from HTML`);

  // --- Bracket sanity (only for states whose brackets have been transcribed) ---
  // These are internal-consistency checks; they CANNOT verify a threshold was copied
  // correctly from the source (no external reference), but they catch transposition,
  // bad ordering, out-of-range rates, malformed entries, and — importantly — a roth.cr
  // that doesn't correspond to any bracket (the two layers silently disagreeing).
  const b = j.facts?.brackets;
  if (b !== undefined) {
    if (!Array.isArray(b) || b.length === 0) {
      diffs.push(`${code}: facts.brackets must be a non-empty array when present`);
    } else {
      let prevUpTo = -Infinity;
      const rates = [];
      b.forEach((row, i) => {
        if (typeof row.rate !== 'number' || row.rate < 0 || row.rate > 0.15) {
          diffs.push(`${code}: bracket[${i}] rate ${row.rate} out of range 0-0.15`);
        }
        rates.push(row.rate);
        // upTo is a number for all but the final (open-ended) bracket, which uses null.
        const isLast = i === b.length - 1;
        if (isLast) {
          if (row.upTo !== null) diffs.push(`${code}: final bracket upTo must be null (open-ended)`);
        } else {
          if (typeof row.upTo !== 'number') {
            diffs.push(`${code}: bracket[${i}] upTo must be a number`);
          } else if (row.upTo <= prevUpTo) {
            diffs.push(`${code}: bracket[${i}] upTo ${row.upTo} not strictly ascending`);
          } else {
            prevUpTo = row.upTo;
          }
        }
      });
      // Cross-layer: the representative roth.cr should be one of the bracket rates,
      // so the interpretation layer can't drift from the facts it's meant to derive from.
      if (rates.length && !rates.some((r) => Math.abs(r - j.roth.cr) < 1e-9)) {
        diffs.push(`${code}: roth.cr ${j.roth.cr} is not among facts.brackets rates [${rates.join(', ')}]`);
      }
    }
  }
}

// --- 5. Relocation layer (G1-G4) — only runs once taxRules is present (post-merge). ---
// Pre-merge these are no-ops, so the guard stays green throughout the transition.
let reloStates = 0;
for (const code of htmlCodes) {
  const j = json[code];
  if (!j.taxRules) continue; // not yet merged — skip
  reloStates++;
  const tr = j.taxRules;

  // G1 — structure: all four filing-status schedules present and internally valid.
  const bbs = tr.bracketsByStatus;
  if (!bbs || typeof bbs !== 'object') {
    diffs.push(`${code}: taxRules.bracketsByStatus missing`);
  } else {
    for (const status of ['single', 'mfj', 'mfs', 'hoh']) {
      if (!(status in bbs)) {
        diffs.push(`${code}: bracketsByStatus.${status} missing`);
      } else {
        diffs.push(...bracketProblems(bbs[status], code, `bracketsByStatus.${status}`));
      }
    }
  }

  // G2 — THE INVARIANT: facts.brackets must deep-equal bracketsByStatus.single.
  // This is the load-bearing guarantee: the Roth tool reads facts.brackets, relocation
  // reads bracketsByStatus; if they ever diverge, that is a data-integrity bug.
  if (bbs && bbs.single) {
    if (JSON.stringify(j.facts.brackets) !== JSON.stringify(bbs.single)) {
      diffs.push(`${code}: facts.brackets != bracketsByStatus.single (invariant broken)`);
    }
  }

  // G3 — taxContext presence/type (light — not value verification).
  const tc = j.taxContext;
  if (!tc || typeof tc !== 'object') {
    diffs.push(`${code}: taxContext missing`);
  } else {
    if (typeof tc.salesTaxRate !== 'number') diffs.push(`${code}: taxContext.salesTaxRate must be a number`);
    if (typeof tc.propertyTaxRateMedian !== 'number') diffs.push(`${code}: taxContext.propertyTaxRateMedian must be a number`);
    if (!tc.estateTax || typeof tc.estateTax.has !== 'boolean') diffs.push(`${code}: taxContext.estateTax.has must be a boolean`);
  }

  // G4 — status sanity: mfj thresholds never NARROWER than single (mfj >= single at each
  // index). Catches a stale/swapped status. Equality allowed (flat/no-tax states).
  // ONLY meaningful when the two schedules share the same structure (same length) — some
  // states (e.g. NJ: single=7 brackets, mfj=8) have genuinely different-shaped schedules,
  // where a positional index comparison is meaningless. Skip the check in that case.
  if (bbs && Array.isArray(bbs.single) && Array.isArray(bbs.mfj) &&
      bbs.single.length === bbs.mfj.length && j.facts.incomeTax !== false) {
    for (let i = 0; i < bbs.single.length - 1; i++) { // skip final open-ended bracket
      const s = bbs.single[i].upTo, m = bbs.mfj[i].upTo;
      if (typeof s === 'number' && typeof m === 'number' && m < s) {
        diffs.push(`${code}: bracketsByStatus.mfj[${i}] upTo ${m} < single ${s} (mfj should not be narrower)`);
      }
    }
  }
}

if (diffs.length) {
  fail(`${diffs.length} field mismatch(es):\n  ` + diffs.join('\n  '));
}

const reloNote = reloStates ? `, relocation taxRules validated on ${reloStates} states (G1-G4)` : '';
console.log(`states.json guard OK: 51 states (50 + DC), roth blocks match HTML exactly${reloNote}.`);
