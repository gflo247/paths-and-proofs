#!/usr/bin/env node
// gen-relo-data.mjs — Build-time generator: states.json -> inline RELO={...} in relocation/index.html
//
// WHY THIS EXISTS:
//   states.json is the canonical, primary-source-verified fact base. The relocation tool,
//   like the Roth tool, runs fully in-browser with zero network calls (privacy: nothing
//   leaves the device). Rather than hand-maintain the relocation data table in sync with
//   states.json, we GENERATE it — the JSON is the source, the inline table is an artifact,
//   so drift is structurally impossible.
//
//   The generated RELO entry is the relocation-layer view the engine consumes:
//     KEY: { name, taxRules, taxContext }
//   (taxRules drives computeStateIncomeTax; taxContext is the disclosed Tier-2 panel.)
//
// USAGE:
//   node _dev/gen-relo-data.mjs            # rewrite the RELO block in place
//   node _dev/gen-relo-data.mjs --check    # exit 1 if the file would change (drift check)
//
// The block is spliced between the exact markers `const RELO=` and the matching `;// END-RELO`.

import { readFileSync, writeFileSync } from 'node:fs';

const HTML = 'relocation/index.html';
const JSON_PATH = 'roth-conversion/states.json';
const OPEN = 'const RELO=';
const CLOSE = ';// END-RELO';

function buildBlock(json) {
  const codes = Object.keys(json).filter((k) => k !== '_schema').sort();
  const out = {};
  for (const code of codes) {
    const s = json[code];
    out[code] = {
      name: s.facts.name,
      taxRules: s.taxRules,
      taxContext: s.taxContext,
    };
  }
  // Compact but readable: one state per line keeps diffs legible.
  const lines = codes.map(
    (code) => `  ${JSON.stringify(code)}: ${JSON.stringify(out[code])}`
  );
  return `${OPEN}{\n${lines.join(',\n')}\n}${CLOSE}`;
}

function splice(html, block) {
  const openIdx = html.indexOf(OPEN);
  if (openIdx === -1) throw new Error(`gen-relo-data: marker "${OPEN}" not found in ${HTML}`);
  const closeIdx = html.indexOf(CLOSE, openIdx);
  if (closeIdx === -1) throw new Error(`gen-relo-data: marker "${CLOSE}" not found after RELO in ${HTML}`);
  const before = html.slice(0, openIdx);
  const after = html.slice(closeIdx + CLOSE.length);
  return before + block + after;
}

const json = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const html = readFileSync(HTML, 'utf8');
const block = buildBlock(json);
const next = splice(html, block);

const check = process.argv.includes('--check');
if (check) {
  if (next !== html) {
    console.error('RELO data block is OUT OF SYNC with states.json. Run `node _dev/gen-relo-data.mjs`.');
    process.exit(1);
  }
  console.log('RELO data block is in sync with states.json (no drift).');
} else {
  writeFileSync(HTML, next);
  console.log(`Regenerated RELO data block from states.json (${Object.keys(json).filter((k) => k !== '_schema').length} jurisdictions).`);
}
