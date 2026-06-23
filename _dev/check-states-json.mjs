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

const jsonCodes = Object.keys(json).sort();
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
}

if (diffs.length) {
  fail(`${diffs.length} field mismatch(es):\n  ` + diffs.join('\n  '));
}

console.log(`states.json guard OK: 51 states (50 + DC), roth blocks match HTML exactly.`);
