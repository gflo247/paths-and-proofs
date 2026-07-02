// merge-relocation.mjs — merge relocation staging into canonical states.json (Option A).
//
// WHAT IT DOES (per state code):
//   1. Splices `taxRules` (bracketsByStatus + socialSecurity + retirementIncome +
//      pensionIncome + capitalGains) and `taxContext` from the relocation staging file
//      into the canonical entry.
//   2. Sets facts.brackets = taxRules.bracketsByStatus.single  (PROPAGATE decision:
//      the hardened, primary-sourced single-filer table becomes the statutory brackets
//      for ALL tools, replacing the older audit values where they differ).
//   3. Leaves the `roth` interpretation layer (cr/ex/note) UNTOUCHED.
//
// It does NOT touch the inline ST table (that regenerates via `npm run gen`), and does
// NOT touch the roth blocks. Idempotent.
//
// USAGE:
//   node _dev/merge-relocation.mjs            # DRY RUN — reports changes, writes nothing
//   node _dev/merge-relocation.mjs --write    # actually writes states.json
//
// Strips staging-only bookkeeping keys (_note, _hardening_note) — those are working
// annotations, not canonical data.

import { readFileSync, writeFileSync } from 'node:fs';

const WRITE = process.argv.includes('--write');

const canonPath = new URL('../roth-conversion/states.json', import.meta.url);
const stagPath = new URL('../relocation/_staging-stress-test.json', import.meta.url);

const canon = JSON.parse(readFileSync(canonPath, 'utf8'));
const stag = JSON.parse(readFileSync(stagPath, 'utf8'));

const codes = Object.keys(canon).filter((k) => k !== '_schema');
const stagCodes = Object.keys(stag).filter((k) => !k.startsWith('_'));

// --- Safety: code sets must match exactly ---
const missing = codes.filter((c) => !stagCodes.includes(c));
const extra = stagCodes.filter((c) => !codes.includes(c));
if (missing.length || extra.length) {
  console.error('CODE SET MISMATCH — aborting.');
  if (missing.length) console.error('  in canonical, not staging:', missing.join(', '));
  if (extra.length) console.error('  in staging, not canonical:', extra.join(', '));
  process.exit(1);
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const starts = (arr) => (Array.isArray(arr) ? [0, ...arr.slice(0, -1).map((x) => x.upTo)] : null);

const bracketChanges = [];
let spliced = 0;

for (const code of codes) {
  const s = stag[code];
  const c = canon[code];

  // Deep-copy the two relocation blocks, stripping staging-only bookkeeping keys.
  const taxRules = JSON.parse(JSON.stringify(s.taxRules));
  const taxContext = JSON.parse(JSON.stringify(s.taxContext));

  // --- PROPAGATE: facts.brackets <- bracketsByStatus.single ---
  const newBrackets = JSON.parse(JSON.stringify(taxRules.bracketsByStatus.single));
  const oldBrackets = c.facts.brackets;
  if (!eq(oldBrackets, newBrackets)) {
    bracketChanges.push({ code, old: starts(oldBrackets), new: starts(newBrackets) });
  }

  if (WRITE) {
    c.facts.brackets = newBrackets;
    c.taxRules = taxRules;
    c.taxContext = taxContext;
  }
  spliced++;
}

// --- Report ---
console.log(`Merge (${WRITE ? 'WRITE' : 'DRY RUN'}): ${spliced} states processed, code sets match.`);
console.log('');
console.log(`facts.brackets CHANGES (propagated fresher single-filer data): ${bracketChanges.length} states`);
for (const ch of bracketChanges) {
  console.log(`  ${ch.code}: ${JSON.stringify(ch.old)}  ->  ${JSON.stringify(ch.new)}`);
}
console.log('');
console.log(`facts.brackets UNCHANGED: ${spliced - bracketChanges.length} states (flat/no-tax/already-current)`);

if (WRITE) {
  // Preserve _schema at top; write with 1-space indent to match existing file style.
  writeFileSync(canonPath, JSON.stringify(canon, null, 1) + '\n');
  console.log('');
  console.log('WROTE roth-conversion/states.json. Run `npm run gen` then `npm run verify`.');
} else {
  console.log('');
  console.log('DRY RUN — nothing written. Re-run with --write to apply.');
}
