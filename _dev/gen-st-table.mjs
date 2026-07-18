#!/usr/bin/env node
// gen-st-table.mjs — Build-time generator: states.json -> inline ST={...} in index.html
//
// WHY THIS EXISTS:
//   states.json is the canonical, primary-source-verified fact base for all 51
//   jurisdictions. The Roth tool's engine reads an inline `const ST={...}` table for
//   zero-network, fully-self-contained operation (privacy: nothing leaves the device).
//   Rather than hand-maintain that table in sync with states.json (drift-prone, which the
//   old guard could only DETECT after the fact), we GENERATE it from states.json. This
//   makes drift structurally impossible: the JSON is the source, the table is an artifact.
//
//   The generated `ST` entry shape is the roth-layer view the engine consumes:
//     KEY: {n, cr, ex, note}
//   (plus the leading blank '' placeholder the engine uses as its no-state default.)
//
// USAGE:
//   node _dev/gen-st-table.mjs            # rewrite index.html's ST block in place
//   node _dev/gen-st-table.mjs --check    # exit 1 if the file would change (CI drift check)
//
// The block is spliced between the exact markers `const ST={` and the matching ` };`.

import { readFileSync, writeFileSync } from 'node:fs';

const HTML = 'roth-conversion/index.html';
const JSON_PATH = 'roth-conversion/states.json';
const OPEN = 'const ST={';
const CLOSE = '};'; // the closing line of the block (no leading space; first `};` after OPEN)

// Single-quoted JS string literal: escape backslash first, then single quote.
// (Notes are author-controlled prose; newlines are not expected, but guard anyway.)
function jsStr(s) {
  return "'" + String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, ' ') + "'";
}

// A numeric literal matching the table's hand style: 0 stays 0, decimals drop the
// leading zero (0.05 -> .05) to mirror the original inline formatting.
function num(n) {
  if (n === 0) return '0';
  const s = String(n);
  return s.startsWith('0.') ? s.slice(1) : s;
}

function buildBlock(json) {
  const codes = Object.keys(json).filter((k) => k !== '_schema');
  const lines = [];
  lines.push(OPEN);
  // Leading blank placeholder: the engine's no-state default (ST['']).
  lines.push("  '': {n:'',cr:0,ex:false,note:''},");
  for (const code of codes) {
    const r = json[code].roth;
    if (!r) throw new Error(`states.json: ${code} has no roth block`);
    lines.push(
      `  ${code}: {n:${jsStr(json[code].facts?.name ?? '')},cr:${num(r.cr)},ex:${r.ex},note:${jsStr(r.note)}},`
    );
  }
  lines.push(CLOSE);
  return lines.join('\n');
}

// RETDED: a separate, sparse table — only states with a verified flat, non-phased-out
// retirement-income deduction (see states.json _schema.fields["roth.retDeduction"]) get
// an entry. Kept out of the ST block so the audited {n,cr,ex,note} shape and its strict
// parser (parse-states.mjs) never have to change as more states are added here over time.
const RD_OPEN = 'const RETDED={';
const RD_CLOSE = '};';

function buildRetDedBlock(json) {
  const codes = Object.keys(json).filter((k) => k !== '_schema');
  const lines = [];
  lines.push(RD_OPEN);
  for (const code of codes) {
    const rd = json[code].roth?.retDeduction;
    if (!rd) continue;
    lines.push(
      `  ${code}: {single:${num(rd.single)},mfj:${num(rd.mfj)},mfs:${num(rd.mfs)},hoh:${num(rd.hoh)}},`
    );
  }
  lines.push(RD_CLOSE);
  return lines.join('\n');
}

// EXAGE: a separate, sparse table — only ex:true states whose exemption is age-gated
// (see states.json _schema.fields["roth.exMinAge"]) get an entry. Absence means an
// ex:true state's exemption is unconditional.
const EA_OPEN = 'const EXAGE={';
const EA_CLOSE = '};';

function buildExAgeBlock(json) {
  const codes = Object.keys(json).filter((k) => k !== '_schema');
  const lines = [];
  lines.push(EA_OPEN);
  for (const code of codes) {
    const age = json[code].roth?.exMinAge;
    if (age === undefined) continue;
    lines.push(`  ${code}: ${num(age)},`);
  }
  lines.push(EA_CLOSE);
  return lines.join('\n');
}

function splice(html, block, open, close) {
  const start = html.indexOf(open);
  if (start === -1) throw new Error(`Could not find "${open}" in ${HTML}`);
  // Find the closing line that terminates the object, starting from open.
  const closeIdx = html.indexOf('\n' + close, start);
  if (closeIdx === -1) throw new Error(`Could not find closing "${close}" after "${open}" block`);
  const end = closeIdx + 1 + close.length; // include the close line
  return html.slice(0, start) + block + html.slice(end);
}

const json = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const html = readFileSync(HTML, 'utf8');
const block = buildBlock(json);
const rdBlock = buildRetDedBlock(json);
const eaBlock = buildExAgeBlock(json);
const withSt = splice(html, block, OPEN, CLOSE);
const withRd = splice(withSt, rdBlock, RD_OPEN, RD_CLOSE);
const next = splice(withRd, eaBlock, EA_OPEN, EA_CLOSE);

const isCheck = process.argv.includes('--check');
if (isCheck) {
  if (next !== html) {
    console.error('DRIFT: index.html ST table is out of sync with states.json.');
    console.error('Run `node _dev/gen-st-table.mjs` to regenerate (edit states.json, never the inline table).');
    process.exit(1);
  }
  console.log('ST table is in sync with states.json (no drift).');
} else {
  if (next === html) {
    console.log('ST table already current; no change written.');
  } else {
    writeFileSync(HTML, next);
    const n = Object.keys(json).filter((k) => k !== '_schema').length;
    console.log(`Regenerated ST table from states.json (${n} jurisdictions + blank placeholder).`);
  }
}
