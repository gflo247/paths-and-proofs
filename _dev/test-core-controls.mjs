#!/usr/bin/env node
// Tests for core/controls.js number inputs.
//
// A strict control ignores an emptied or out-of-range entry while typing (the
// "19" on the way to "1964", or a typo like "19622"), stops that keystroke from
// bubbling to page-level listeners, and on commit (blur / Enter) snaps the field
// back into range and replays it as a normal input. Non-strict controls keep
// accepting any typed number, since some maxes are soft (pay, savings).
//
// Run: node _dev/test-core-controls.mjs

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div id="c"></div></body>');
globalThis.window   = dom.window;
globalThis.document = dom.window.document;
globalThis.Event    = dom.window.Event;

const { buildControls } = await import('../core/controls.js');

let passed = 0, failed = 0;
function ok(label, cond) {
  if (cond) { passed++; console.log('ok   ', label); }
  else      { failed++; console.error('FAIL ', label); }
}

const inputs = [
  { id: 'year', type: 'number', label: 'Birth year', min: 1924, max: 1970, step: 1, default: 1960, strict: true },
  { id: 'pay',  type: 'number', label: 'Pay', min: 0, max: 500000, step: 1000, default: 95000, unit: '$' },
];
const values = { year: 1960, pay: 95000 };
let calls = 0, bubbled = 0;
const container = document.getElementById('c');
buildControls(inputs, values, () => { calls++; }, container);
container.addEventListener('input', () => { bubbled++; });   // stands in for a page-level listener
const year = document.getElementById('ctl-year');
const pay  = document.getElementById('ctl-pay');
const type   = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
const commit = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));

// Select-all, then type "1964": 1, 19, 196 are below the range.
for (const v of ['1', '19', '196']) type(year, v);
ok('strict: out-of-range keystrokes do not recompute', calls === 0 && values.year === 1960);
ok('strict: out-of-range keystrokes do not reach page listeners', bubbled === 0);
type(year, '1964');
ok('strict: an in-range value recomputes and bubbles', calls === 1 && values.year === 1964 && bubbled === 1);
type(year, '19642');
ok('strict: a typo above max does not recompute or bubble', calls === 1 && values.year === 1964 && bubbled === 1);
commit(year);
ok('strict: commit snaps an above-max entry to max and replays it', year.value === '1970' && values.year === 1970 && calls === 2 && bubbled === 2);
type(year, '19'); commit(year);
ok('strict: commit snaps a below-min entry to min', year.value === '1924' && values.year === 1924 && calls === 3 && bubbled === 3);
type(year, '');
ok('strict: an emptied field does not reach page listeners', bubbled === 3);
commit(year);
ok('strict: commit restores an emptied field without recomputing', year.value === '1924' && values.year === 1924 && calls === 3 && bubbled === 3);
type(year, '1958'); commit(year);
ok('strict: commit leaves an in-range entry alone', year.value === '1958' && values.year === 1958 && calls === 4 && bubbled === 4);

// Non-strict controls are unchanged.
const before = calls, beforeB = bubbled;
type(pay, '600000');
ok('non-strict: an above-max value still applies', values.pay === 600000 && calls === before + 1 && bubbled === beforeB + 1);
commit(pay);
ok('non-strict: commit does not clamp', pay.value === '600000' && values.pay === 600000 && calls === before + 1);
type(pay, '');
ok('non-strict: an emptied field still bubbles without recomputing', calls === before + 1 && bubbled === beforeB + 2 && values.pay === 600000);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
