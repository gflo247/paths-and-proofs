#!/usr/bin/env node
// Tests for espp/index.html: typing into a field must not rewrite that field.
//
// recompute() runs on every keystroke and used to write clamped values back into
// the inputs. Writing into fields mid-typing eats keystrokes in a browser: "4."
// becomes "4", so "4.5" ends up "45" and then 13.3; a lone "-" becomes "0", so
// "-5" ends up "5"; and the "1" on the way to a cap of "15" clamped the
// contribution to 1 for good. Fields are left alone until committed (change).
//
// Run: node _dev/test-espp-typing.mjs

import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../espp/index.html', import.meta.url), 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(e.message));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/espp/', virtualConsole: vc });
const d = dom.window.document;
const $ = (id) => d.getElementById(id);
const fire = (el, t) => el.dispatchEvent(new dom.window.Event(t, { bubbles: true }));
const type = (id, v) => { $(id).value = v; fire($(id), 'input'); return $(id).value; };
const commit = (id) => { fire($(id), 'change'); return $(id).value; };

let passed = 0, failed = 0;
function ok(label, cond, extra = '') {
  if (cond) { passed++; console.log('ok   ', label); }
  else      { failed++; console.error('FAIL ', label, extra); }
}

// An unfinished number ("4.", "-") reads back as "" here, as in browsers.
ok('price move: a lone "-" is left alone while typing', type('inpMove', '') === '', JSON.stringify($('inpMove').value));
ok('price move: "-5" is used as typed', type('inpMove', '-5') === '-5' && $('sellNowSub').textContent.includes('-5.0%'), $('sellNowSub').textContent);
ok('holding-period move: a lone "-" is left alone while typing', type('inpHoldMove', '') === '', JSON.stringify($('inpHoldMove').value));
ok('state rate: "4." is left alone while typing', type('inpStateRate', '') === '', JSON.stringify($('inpStateRate').value));
ok('state rate: "4.5" is kept', type('inpStateRate', '4.5') === '4.5');
ok('contribution: an over-cap entry is left alone while typing', type('inpContribPct', '65') === '65', JSON.stringify($('inpContribPct').value));
ok('contribution: commit clamps it to the cap', commit('inpContribPct') === '10');
ok('state rate: an over-max entry is left alone while typing', type('inpStateRate', '45') === '45', JSON.stringify($('inpStateRate').value));
ok('state rate: commit clamps it to 13.3', commit('inpStateRate') === '13.3');
type('inpHoldMove', '');
ok('holding-period move: commit fills an emptied field with 0', commit('inpHoldMove') === '0');
// The cap's keystrokes pass through smaller numbers ("1" on the way to "15").
$('inpContribPct').value = '10'; commit('inpContribPct');
type('inpCapPct', '1'); type('inpCapPct', '15'); commit('inpCapPct');
ok('typing a new cap doesn\'t lower the contribution on the way', $('inpContribPct').value === '10', JSON.stringify($('inpContribPct').value));
type('inpCapPct', '5');   // $200,000 salary, 6-month offering: 5% is $5,000
ok('a lower cap caps the math while typing', $('statContrib').textContent === '$5,000', $('statContrib').textContent);
ok('and clamps the contribution field on commit', commit('inpCapPct') === '5' && $('inpContribPct').value === '5', JSON.stringify($('inpContribPct').value));
// §423 discount cap: anything over 15% is a non-qualified plan; cap enforces the statutory limit.
ok('discount: an over-cap entry is left alone while typing', type('inpDiscount', '25') === '25', JSON.stringify($('inpDiscount').value));
ok('discount: commit clamps it to 15', commit('inpDiscount') === '15', JSON.stringify($('inpDiscount').value));
ok('no script errors', errors.length === 0, JSON.stringify(errors));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
