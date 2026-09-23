#!/usr/bin/env node
// Tests for core/share-link.js
//
// Covers encode/decode round-trips, clamping, event dispatch, and
// the no-crash guarantee on malformed input.
//
// Coverage gap note: initShareLink() creates DOM structure and reads
// location.hash — that path is verified by live browser testing, not here.
// The pure functions (encode/decode/apply) are the meaningful unit under test.
//
// Run: node _dev/test-core-share-link.mjs

import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

// ─── Minimal DOM harness ────────────────────────────────────────────────────
const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window   = dom.window;
globalThis.document = dom.window.document;
globalThis.location = { hash: '', origin: 'https://example.com', pathname: '/test/', search: '' };
globalThis.history  = { replaceState() {} };
globalThis.Event    = dom.window.Event; // share-link.js calls new Event(...) — must be JSDOM's own
// navigator not mocked — initShareLink (clipboard) is not under test here

// ─── Import the module ───────────────────────────────────────────────────────
const { encodeShareState, decodeShareState, applyShareInputs } =
  await import('../core/share-link.js');

// ─── Test harness ────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function ok(label, cond) {
  if (cond) { passed++; console.log('ok   ', label); }
  else      { failed++; console.error('FAIL ', label); }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeInput(id, type, value, min, max) {
  const el = document.createElement('input');
  el.id = id; el.type = type; el.value = value;
  if (min !== undefined) el.min = String(min);
  if (max !== undefined) el.max = String(max);
  document.body.appendChild(el);
  return el;
}
function makeSelect(id, options, value) {
  const el = document.createElement('select');
  el.id = id;
  for (const v of options) {
    const o = document.createElement('option');
    o.value = v; el.appendChild(o);
  }
  el.value = value;
  document.body.appendChild(el);
  return el;
}

// ─── Social Security field list ───────────────────────────────────────────────
const SS_FIELDS = [
  'ctl-piaHigh', 'ctl-claimHigh', 'ctl-claimHighEarly',
  'ctl-piaLow',  'ctl-claimLow',
  'ctl-ageGap',
  'ctl-lifeHigh', 'ctl-lifeLow',
  'ctl-discountRate',
  'ctl-tie-threshold',
];

// ─── Medicare field list ──────────────────────────────────────────────────────
const MED_FIELDS = [
  'ctl-stateCode',
  'ctl-medigapMonthlyPremium', 'ctl-partDMonthlyPremium',
  'ctl-advantageMonthlyPremium', 'ctl-advantageOOPMax',
];

// ─── Relocation field list ────────────────────────────────────────────────────
const RELO_FIELDS = [
  'ctl-fromState', 'ctl-toState', 'ctl-status', 'ctl-age', 'ctl-sex',
  'ctl-socialSecurity', 'ctl-iraWithdrawal', 'ctl-pension',
  'ctl-capGains', 'ctl-moveCost', 'ctl-discountRate',
  'fromNyLocalTax', 'fromOrLocalTax', 'toNyLocalTax', 'toOrLocalTax',
];

// ─── Group 1: encode / decode ─────────────────────────────────────────────────

// Build DOM elements for SS
makeInput('ctl-piaHigh',        'number', '2500',  0, 6000);
makeInput('ctl-claimHigh',      'range',  '67',   62,   70);
makeInput('ctl-claimHighEarly', 'range',  '62',   62,   70);
makeInput('ctl-piaLow',         'number', '1200',  0, 6000);
makeInput('ctl-claimLow',       'range',  '62',   62,   70);
makeInput('ctl-ageGap',         'range',  '2',   -20,   20);
makeInput('ctl-lifeHigh',       'range',  '90',   60,  100);
makeInput('ctl-lifeLow',        'range',  '85',   60,  100);
makeInput('ctl-discountRate',   'range',  '2',     0,    6);
makeInput('ctl-tie-threshold',  'range',  '10',    0,   30);

const ssEncoded = encodeShareState(SS_FIELDS);
ok('1.1 SS encodeShareState produces a v1. prefix', ssEncoded.startsWith('v1.'));

const ssDecoded = decodeShareState(ssEncoded);
ok('1.2 SS decode → piaHigh round-trips',     ssDecoded?.['ctl-piaHigh']      === '2500');
ok('1.3 SS decode → claimHigh round-trips',   ssDecoded?.['ctl-claimHigh']    === '67');
ok('1.4 SS decode → ageGap round-trips',      ssDecoded?.['ctl-ageGap']       === '2');
ok('1.5 SS decode → discountRate round-trips',ssDecoded?.['ctl-discountRate'] === '2');
ok('1.6 SS decode produces all 10 keys',      Object.keys(ssDecoded || {}).length === 10);

// Build DOM elements for Medicare
makeSelect('ctl-stateCode', ['OH','MI','NY','FL'], 'MI');
makeInput('ctl-medigapMonthlyPremium',   'number', '210',    0, 1000);
makeInput('ctl-partDMonthlyPremium',     'number', '45',     0,  300);
makeInput('ctl-advantageMonthlyPremium', 'number', '0',      0,  400);
makeInput('ctl-advantageOOPMax',         'number', '8500', 1000,13900);

const medEncoded = encodeShareState(MED_FIELDS);
const medDecoded = decodeShareState(medEncoded);
ok('1.7 Med decode → stateCode round-trips',            medDecoded?.['ctl-stateCode']              === 'MI');
ok('1.8 Med decode → medigapMonthlyPremium round-trips',medDecoded?.['ctl-medigapMonthlyPremium']   === '210');
ok('1.9 Med decode → advantageOOPMax round-trips',      medDecoded?.['ctl-advantageOOPMax']         === '8500');
ok('1.10 Med decode produces all 5 keys',               Object.keys(medDecoded || {}).length === 5);

// Build DOM elements for Relocation
makeSelect('ctl-fromState', ['CA','TX','NY','MI'], 'NY');
makeSelect('ctl-toState',   ['CA','TX','FL','MI'], 'FL');
makeSelect('ctl-status',    ['single','mfj','mfs','hoh'], 'mfj');
makeInput('ctl-age',            'number', '65',  50, 100);
makeSelect('ctl-sex',           ['female','male'], 'female');
makeInput('ctl-socialSecurity', 'number', '28000', 0, 120000);
makeInput('ctl-iraWithdrawal',  'number', '40000', 0, 500000);
makeInput('ctl-pension',        'number', '12000', 0, 300000);
makeInput('ctl-capGains',       'number', '5000',  0, 500000);
makeInput('ctl-moveCost',       'number', '20000', 0, 200000);
makeInput('ctl-discountRate',   'range',  '2',    0,   6);
makeSelect('fromNyLocalTax', ['','nyc','yonkers'], 'nyc');
makeSelect('fromOrLocalTax', ['','metro','multnomah'], '');
makeSelect('toNyLocalTax',   ['','nyc','yonkers'], '');
makeSelect('toOrLocalTax',   ['','metro','multnomah'], '');

const reloEncoded = encodeShareState(RELO_FIELDS);
const reloDecoded = decodeShareState(reloEncoded);
ok('1.11 Relo decode → fromState round-trips',    reloDecoded?.['ctl-fromState']  === 'NY');
ok('1.12 Relo decode → toState round-trips',      reloDecoded?.['ctl-toState']    === 'FL');
ok('1.13 Relo decode → fromNyLocalTax round-trips',reloDecoded?.['fromNyLocalTax'] === 'nyc');
ok('1.14 Relo decode → blank toNyLocalTax',       reloDecoded?.['toNyLocalTax']   === '');
ok('1.15 Relo decode produces all 15 keys',       Object.keys(reloDecoded || {}).length === 15);

// ─── Group 2: version rejection and malformed input ───────────────────────────

ok('2.1 v2. prefix rejected',       decodeShareState('v2.abc123')  === null);
ok('2.2 empty string returns null',  decodeShareState('')           === null);
ok('2.3 null returns null',          decodeShareState(null)         === null);
ok('2.4 garbage payload returns null',decodeShareState('v1.!@#$%') === null);
ok('2.5 valid encode never returns null', decodeShareState(ssEncoded) !== null);

// ─── Group 3: applyShareInputs clamping ──────────────────────────────────────

// Make fresh elements so we can observe what applyShareInputs writes.
const numEl = makeInput('test-num', 'number', '50', 0, 100);
const rngEl = makeInput('test-rng', 'range',  '5',  0,  10);

// Normal value — just lands where it should
applyShareInputs({ 'test-num': '75' }, ['test-num']);
ok('3.1 numeric value within bounds applied correctly', numEl.value === '75');

// Below min
applyShareInputs({ 'test-num': '-999' }, ['test-num']);
ok('3.2 value below min is clamped to 0', numEl.value === '0');

// Above max
applyShareInputs({ 'test-num': '9999' }, ['test-num']);
ok('3.3 value above max is clamped to 100', numEl.value === '100');

// Range slider clamping
applyShareInputs({ 'test-rng': '15' }, ['test-rng']);
ok('3.4 range slider value above max is clamped to 10', rngEl.value === '10');

applyShareInputs({ 'test-rng': '-5' }, ['test-rng']);
ok('3.5 range slider value below min is clamped to 0', rngEl.value === '0');

// ─── Group 4: event dispatch ──────────────────────────────────────────────────

const evtNum = makeInput('test-evt-num', 'number', '1', 0, 100);
let inputFired = false;
evtNum.addEventListener('input', () => { inputFired = true; });
applyShareInputs({ 'test-evt-num': '42' }, ['test-evt-num']);
ok('4.1 input event fires on number field after apply', inputFired);

const evtSel = makeSelect('test-evt-sel', ['a','b','c'], 'a');
let changeFired = false;
evtSel.addEventListener('change', () => { changeFired = true; });
applyShareInputs({ 'test-evt-sel': 'b' }, ['test-evt-sel']);
ok('4.2 change event fires on select field after apply', changeFired);
ok('4.3 select value was updated to b', evtSel.value === 'b');

// ─── Group 5: fields not in payload are left alone ────────────────────────────

const untouched = makeInput('test-untouched', 'number', '77', 0, 100);
applyShareInputs({ 'other-field': '99' }, ['test-untouched']);
ok('5.1 field not in payload is not modified', untouched.value === '77');

// ─── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
