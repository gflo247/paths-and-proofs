#!/usr/bin/env node
// gen-header.mjs — Build-time generator: shared/brand-header.html -> each calculator's index.html
//
// WHY THIS EXISTS:
//   The "Paths and Proofs" home link is shared chrome across the calculator family.
//   Rather than hand-copy markup into each tool (drift-prone — the sixth tool always
//   diverges), we inject it from ONE canonical source (shared/brand-header.html) into
//   each tool between marker comments. Same anti-drift discipline as gen-st-table.mjs.
//
//   Excluded by design: in-case-im-not-there (the family vault is a SEPARATE product,
//   not part of the calculator family, so it does not carry the calculator-family brand).
//
// USAGE:
//   node _dev/gen-header.mjs            # inject/update the header in all target tools
//   node _dev/gen-header.mjs --check     # exit 1 if any tool's injected copy is stale (CI gate)

import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'shared/brand-header.html';
const START = '<!-- PNP-BRAND-START -->';
const END = '<!-- PNP-BRAND-END -->';

// The calculator family only — NOT in-case-im-not-there (separate product).
const TARGETS = [
  'social-security/index.html',
  'roth-conversion/index.html',
  'rent-vs-buy/index.html',
];

// Strip the leading documentation comment block from the canonical source, keeping
// only the actual component (the <style> + <a> markup that gets injected).
function componentMarkup() {
  const raw = readFileSync(SOURCE, 'utf8');
  const styleAt = raw.indexOf('<style>');
  if (styleAt === -1) throw new Error(`${SOURCE}: expected a <style> block`);
  return raw.slice(styleAt).trim();
}

// Replace everything between START and END (inclusive of the markers) with the
// markers wrapping the freshly-injected component. Idempotent.
function inject(html, component, file) {
  const s = html.indexOf(START);
  const e = html.indexOf(END);
  if (s === -1 || e === -1) {
    throw new Error(`${file}: missing ${START} / ${END} markers`);
  }
  if (e < s) throw new Error(`${file}: END marker precedes START`);
  const before = html.slice(0, s);
  const after = html.slice(e + END.length);
  // Indent the component to match the marker's column for tidy output.
  const indentMatch = before.match(/\n([ \t]*)$/);
  const indent = indentMatch ? indentMatch[1] : '';
  const block = component.split('\n').map((l, i) => (i === 0 ? l : indent + l)).join('\n');
  return `${before}${START}\n${indent}${block}\n${indent}${END}${after}`;
}

const component = componentMarkup();
const isCheck = process.argv.includes('--check');
let changed = 0;
let drift = [];

for (const file of TARGETS) {
  const html = readFileSync(file, 'utf8');
  const next = inject(html, component, file);
  if (next !== html) {
    if (isCheck) drift.push(file);
    else {
      writeFileSync(file, next);
      changed++;
    }
  }
}

if (isCheck) {
  if (drift.length) {
    console.error('DRIFT: brand header is stale in: ' + drift.join(', '));
    console.error('Run `node _dev/gen-header.mjs` to regenerate (edit shared/brand-header.html, never the injected copies).');
    process.exit(1);
  }
  console.log(`Brand header in sync across ${TARGETS.length} calculators (no drift).`);
} else {
  console.log(changed ? `Brand header injected/updated in ${changed} tool(s).` : 'Brand header already current; no change written.');
}
