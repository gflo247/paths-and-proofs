#!/usr/bin/env node
// gen-medicare-data.mjs — Build-time generator: medicare/states.json -> inline
// MEDICARE_STATES={...} in medicare/index.html
//
// WHY THIS EXISTS: same anti-drift discipline as gen-relo-data.mjs. medicare/states.json
// is the canonical, primary-source-verified Medigap regulatory data. The page runs fully
// in-browser with zero network calls (privacy: nothing leaves the device), so rather than
// hand-maintain an inline copy, we GENERATE it — the JSON is the source, the inline block
// is an artifact, so drift is structurally impossible.
//
// State display names ("Alabama", not "AL") are NOT duplicated into medicare/states.json —
// that would be a second source of truth for a fact roth-conversion/states.json already
// has verified (facts.name). This generator merges them in at build time, same reasoning
// as gen-relo-data.mjs pulling taxRules/taxContext from that one file.
//
// USAGE:
//   node _dev/gen-medicare-data.mjs            # rewrite the block in place
//   node _dev/gen-medicare-data.mjs --check    # exit 1 if the file would change (drift check)
//
// The block is spliced between the exact markers `const MEDICARE_STATES=` and `;// END-MEDICARE-STATES`.

import { readFileSync, writeFileSync } from 'node:fs';

const HTML = 'medicare/index.html';
const MEDICARE_JSON_PATH = 'medicare/states.json';
const NAMES_JSON_PATH = 'roth-conversion/states.json';
const OPEN = 'const MEDICARE_STATES=';
const CLOSE = ';// END-MEDICARE-STATES';

function buildBlock(medicareJson, namesJson) {
  const codes = Object.keys(medicareJson).filter((k) => k !== '_schema').sort();
  const out = {};
  for (const code of codes) {
    const s = medicareJson[code];
    out[code] = {
      name: namesJson[code]?.facts?.name || code,
      benefitStructure: s.benefitStructure,
      customPlanNote: s.customPlanNote,
      rating: s.rating,
      guaranteedIssuePeriods: s.guaranteedIssuePeriods,
    };
  }
  const lines = codes.map(
    (code) => `  ${JSON.stringify(code)}: ${JSON.stringify(out[code])}`
  );
  return `${OPEN}{\n${lines.join(',\n')}\n}${CLOSE}`;
}

function splice(html, block) {
  const openIdx = html.indexOf(OPEN);
  if (openIdx === -1) throw new Error(`gen-medicare-data: marker "${OPEN}" not found in ${HTML}`);
  const closeIdx = html.indexOf(CLOSE, openIdx);
  if (closeIdx === -1) throw new Error(`gen-medicare-data: marker "${CLOSE}" not found after MEDICARE_STATES in ${HTML}`);
  const before = html.slice(0, openIdx);
  const after = html.slice(closeIdx + CLOSE.length);
  return before + block + after;
}

const medicareJson = JSON.parse(readFileSync(MEDICARE_JSON_PATH, 'utf8'));
const namesJson = JSON.parse(readFileSync(NAMES_JSON_PATH, 'utf8'));
const html = readFileSync(HTML, 'utf8');
const block = buildBlock(medicareJson, namesJson);
const next = splice(html, block);

const check = process.argv.includes('--check');
if (check) {
  if (next !== html) {
    console.error('MEDICARE_STATES data block is OUT OF SYNC with medicare/states.json. Run `node _dev/gen-medicare-data.mjs`.');
    process.exit(1);
  }
  console.log('MEDICARE_STATES data block is in sync with medicare/states.json (no drift).');
} else {
  writeFileSync(HTML, next);
  console.log(`Regenerated MEDICARE_STATES data block from medicare/states.json (${Object.keys(medicareJson).filter((k) => k !== '_schema').length} jurisdictions).`);
}
