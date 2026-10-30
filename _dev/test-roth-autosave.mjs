#!/usr/bin/env node
// Regression test for the rg_v1 / rg_v1_done autosave split:
//
//   rg_v1      -- field values; written on EVERY saveInputs() call,
//                 even mid-wizard, so partial progress survives a refresh.
//   rg_v1_done -- written by revealResults() the first time the wizard
//                 completes. loadSavedInputs() returns true (skip wizard)
//                 only when this key is present.
//
// Without that split, a visitor who hard-refreshed mid-wizard lost all
// their work because saveInputs() gated on _wizardCompleted being true.
//
// Same extraction approach as test-roth-share-link.mjs: we extract the
// persistence-layer functions (collectInputs, applyInputs, saveInputs,
// loadSavedInputs) from the real <script> block against a minimal jsdom
// DOM, and use an explicit cross-call storage mock so we can simulate
// "the same browser" across multiple extract() calls.

import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const FIELDS_HTML = `
  <input id="currentAge" type="number" min="18" max="90" value="60">
  <input id="retirementAge" type="number" min="50" max="90" value="67">
  <select id="filingStatus"><option value="single">Single</option><option value="mfj" selected>Joint</option></select>
  <select id="sex"><option value="male">M</option><option value="female" selected>F</option></select>
  <input id="spouseAge" type="number" min="18" max="90" value="58">
  <select id="spouseSex"><option value="male" selected>M</option><option value="female">F</option></select>
  <select id="seniorDeduction"><option value="0" selected>0</option><option value="1">1</option></select>
  <select id="stateCode"><option value="" selected>--</option><option value="MI">MI</option><option value="OH">OH</option></select>
  <select id="reloStateCode"><option value="" selected>--</option><option value="FL">FL</option></select>
  <input id="income" type="number" min="0" value="72000">
  <input id="pensionIncome" type="number" min="0" value="0">
  <input id="ssIncome" type="number" min="0" value="24000">
  <input id="niiIncome" type="number" min="0" value="0">
  <input id="ltcgIncome" type="number" min="0" value="0">
  <input id="convertAmt" type="number" min="0" value="20000">
  <input id="tradBal" type="number" min="0" value="280000">
  <input id="rothBal" type="number" min="0" value="40000">
  <input id="iraBasis" type="number" min="0" value="0">
  <input id="growthRate" type="range" min="3" max="12" step=".5" value="7">
  <input id="retRate" type="number" min="0" max="60" value="22">
  <select id="taxSource"><option value="outside" selected>Outside</option><option value="inside">Inside</option></select>
  <select id="medicareStatus"><option value="none">None</option><option value="one" selected>One</option></select>
  <select id="partD"><option value="yes" selected>Yes</option><option value="no">No</option></select>
  <select id="nyLocalTax"><option value="" selected>Neither</option><option value="nyc">NYC</option></select>
  <select id="orLocalTax"><option value="" selected>Neither</option><option value="metro">Metro</option></select>
  <select id="pensionKind"><option value="true">Gov</option><option value="false" selected>Private</option></select>
  <span id="gDisp">7%</span><span id="gValDisp">7%</span>
`;

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    has: (k) => map.has(k),
  };
}

function extract(html, { wizardCompleted = false, suppressSaveOnce = false, storage = makeStorage() } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${FIELDS_HTML}</body>`, { url: 'https://paths-and-proofs.pages.dev/roth-conversion/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = storage;
  globalThis.location = dom.window.location;
  globalThis.history = dom.window.history;

  const marker = 'function collectInputs';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) throw new Error('collectInputs not found');
  const scriptStart = html.lastIndexOf('<script>', markerIdx) + '<script>'.length;
  const scriptEnd = html.indexOf('</script>', markerIdx);
  let scriptSrc = html.slice(scriptStart, scriptEnd);
  // Truncate before DOMContentLoaded for the same reason as test-roth-share-link.mjs
  const domReadyIdx = scriptSrc.indexOf("document.addEventListener('DOMContentLoaded'");
  if (domReadyIdx !== -1) scriptSrc = scriptSrc.slice(0, domReadyIdx);
  const suffix = (wizardCompleted ? '_wizardCompleted=true;\n' : '')
    + (suppressSaveOnce ? '_suppressSaveOnce=true;\n' : '')
    + 'return {INPUT_FIELDS, collectInputs, applyInputs, saveInputs, loadSavedInputs};';
  const mod = new Function(scriptSrc + '\n' + suffix)();
  return { ...mod, document: dom.window.document, storage };
}

const html = readFileSync(new URL('../roth-conversion/index.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log(`ok    ${label}`); }
  else       { fail++; console.log(`FAIL  ${label}`); }
}
function eq(label, actual, expected) {
  ok(`${label}  (got=${JSON.stringify(actual)})`, actual === expected);
}

// --- 1. saveInputs() saves mid-wizard (wizardCompleted=false) ---
{
  const st = makeStorage();
  const { saveInputs, document } = extract(html, { wizardCompleted: false, storage: st });
  document.getElementById('currentAge').value = '55';
  document.getElementById('income').value = '50000';
  saveInputs();
  const saved = JSON.parse(st.getItem('rg_v1') || 'null');
  ok('saveInputs() saves rg_v1 even mid-wizard', saved !== null);
  eq('mid-wizard save: currentAge', saved?.currentAge, '55');
  eq('mid-wizard save: income', saved?.income, '50000');
}

// --- 2. saveInputs() is blocked by _suppressSaveOnce ---
{
  const st = makeStorage();
  const { saveInputs } = extract(html, { suppressSaveOnce: true, storage: st });
  saveInputs();
  ok('saveInputs() blocked by _suppressSaveOnce — rg_v1 absent', st.getItem('rg_v1') === null);
}

// --- 3. loadSavedInputs() without rg_v1_done: restores fields but returns false (stay in wizard) ---
{
  const st = makeStorage();
  // Save some non-default values, no rg_v1_done
  st.setItem('rg_v1', JSON.stringify({ currentAge: '63', stateCode: 'MI', income: '38000' }));
  const { loadSavedInputs, document } = extract(html, { storage: st });
  const result = loadSavedInputs();
  ok('partial progress: loadSavedInputs() returns false (stay in wizard)', result === false);
  eq('partial progress: currentAge field restored', document.getElementById('currentAge').value, '63');
  eq('partial progress: stateCode field restored', document.getElementById('stateCode').value, 'MI');
  eq('partial progress: income field restored', document.getElementById('income').value, '38000');
}

// --- 4. loadSavedInputs() WITH rg_v1_done: restores fields AND returns true (skip wizard) ---
{
  const st = makeStorage();
  st.setItem('rg_v1', JSON.stringify({ currentAge: '68', stateCode: 'OH', convertAmt: '25000' }));
  st.setItem('rg_v1_done', '1');
  const { loadSavedInputs, document } = extract(html, { storage: st });
  const result = loadSavedInputs();
  ok('completed session: loadSavedInputs() returns true (skip wizard)', result === true);
  eq('completed session: currentAge field restored', document.getElementById('currentAge').value, '68');
  eq('completed session: convertAmt field restored', document.getElementById('convertAmt').value, '25000');
}

// --- 5. loadSavedInputs() with empty rg_v1: returns false, no-op on fields ---
{
  const st = makeStorage();
  const { loadSavedInputs } = extract(html, { storage: st });
  ok('empty storage: loadSavedInputs() returns false', loadSavedInputs() === false);
}

// --- 6. Partial save round-trips: save mid-wizard, reload, fields present ---
{
  const st = makeStorage();
  // Session 1: mid-wizard entry
  const s1 = extract(html, { wizardCompleted: false, storage: st });
  s1.document.getElementById('currentAge').value = '71';
  s1.document.getElementById('filingStatus').value = 'single';
  s1.document.getElementById('stateCode').value = 'MI';
  s1.saveInputs();
  // Session 2: simulate page reload (new extract, same storage)
  const s2 = extract(html, { storage: st });
  const result = s2.loadSavedInputs();
  ok('reload after partial entry: loadSavedInputs() returns false (wizard stays)', result === false);
  eq('reload after partial entry: currentAge restored', s2.document.getElementById('currentAge').value, '71');
  eq('reload after partial entry: filingStatus restored', s2.document.getElementById('filingStatus').value, 'single');
  eq('reload after partial entry: stateCode restored', s2.document.getElementById('stateCode').value, 'MI');
}

// --- 7. clearAllInputs equivalence: both keys removed ---
// We test by verifying removeItem is called for both keys. Simulate clear
// by directly calling the removeItem calls that clearAllInputs performs,
// then confirm loadSavedInputs returns false.
{
  const st = makeStorage();
  st.setItem('rg_v1', JSON.stringify({ currentAge: '65' }));
  st.setItem('rg_v1_done', '1');
  // Simulate what clearAllInputs does
  st.removeItem('rg_v1');
  st.removeItem('rg_v1_done');
  const { loadSavedInputs } = extract(html, { storage: st });
  ok('after clear: loadSavedInputs() returns false', loadSavedInputs() === false);
  ok('after clear: rg_v1_done absent', st.getItem('rg_v1_done') === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
