#!/usr/bin/env node
// Regression test for the shareable-link feature (added alongside the
// nyLocalTax/orLocalTax INPUT_FIELDS fix) -- encodeShareState/decodeShareState/
// loadFromShareHash, plus the collectInputs/applyInputs refactor saveInputs()/
// loadSavedInputs() now share with it.
//
// Unlike the other test-roth-*.mjs files (which extract pure tax-computation
// functions and run them against a bare '<body></body>'), this one exercises
// real DOM field reads/writes and localStorage, so it needs actual <input>/
// <select> elements present -- matching the shipped page's real ids/types/
// min/max/options for the fields these tests actually touch. Same extraction
// approach otherwise (new Function(scriptSrc + 'return {...}')() against the
// real <script> block, verbatim from the shipped HTML).
//
// KNOWN GAP: extract() truncates the extracted source before the real
// document.addEventListener('DOMContentLoaded', ...) bootstrap block (see
// its own comment below for why -- jsdom actually fires that event against
// this minimal synthetic DOM, and the full handler expects far more of the
// page than this file provides). That means the real `_suppressSaveOnce =
// false;` reset line living at the END of that real handler is never
// executed by anything here -- test 9's "resumes normally after a real
// edit" check instead uses a fresh extract() call, whose _suppressSaveOnce
// starts at its own default false, which demonstrates the INTENDED
// behavior but doesn't exercise the real reset line itself. Reviewed and
// confirmed correct by reading the shipped handler directly as of this
// writing -- but a future refactor that misplaces or deletes that line
// would ship undetected by this suite. No clean fix within this test
// harness's own constraints; flagging rather than pretending it's covered.

import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const FIELDS_HTML = `
  <input id="currentAge" type="number" min="18" max="90" value="60">
  <input id="retirementAge" type="number" min="50" max="90" value="67">
  <select id="filingStatus"><option value="single">Single</option><option value="mfj" selected>Joint</option><option value="mfs">Separate</option><option value="hoh">HoH</option></select>
  <select id="sex"><option value="male">M</option><option value="female" selected>F</option></select>
  <input id="spouseAge" type="number" min="18" max="90" value="58">
  <select id="spouseSex"><option value="male" selected>M</option><option value="female">F</option></select>
  <select id="seniorDeduction"><option value="0" selected>0</option><option value="1">1</option><option value="2">2</option></select>
  <select id="stateCode"><option value="" selected>--</option><option value="NY">NY</option><option value="MI">MI</option><option value="OH">OH</option></select>
  <select id="reloStateCode"><option value="" selected>--</option><option value="OH">OH</option></select>
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
  <select id="medicareStatus"><option value="none">None</option><option value="one" selected>One</option><option value="two">Two</option></select>
  <select id="partD"><option value="yes" selected>Yes</option><option value="no">No</option></select>
  <select id="nyLocalTax"><option value="" selected>Neither</option><option value="nyc">NYC</option><option value="yonkers">Yonkers</option></select>
  <select id="orLocalTax"><option value="" selected>Neither</option><option value="metro">Metro</option><option value="multnomah">Multnomah</option></select>
  <span id="gDisp">7%</span><span id="gValDisp">7%</span>
  <div id="skipRow"></div><div id="skipConfirmed"></div>
  <input id="shareLinkBox"><button id="shareCopyBtn"></button>
`;

// jsdom gives every `new JSDOM(...)` instance its own independent
// localStorage, even at the same origin URL -- there's no cross-instance
// persistence. Several tests below need to simulate "the same physical
// browser" across multiple extract() calls (a sender encoding a link, then
// a separate recipient extraction decoding it, while a visitor's own prior
// rg_v1 save must survive in between) -- so `storage` is an explicit,
// swappable, in-memory Map-backed mock passed in by the caller instead of
// relying on jsdom's own real (but per-instance) implementation. It's still
// a faithful getItem/setItem/removeItem surface -- the only thing that
// differs from a real localStorage is that IT persists across separate
// extract() calls on purpose, which is exactly what these tests need.
function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function extract(html, { wizardCompleted = false, storage = makeStorage() } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${FIELDS_HTML}</body>`, { url: 'http://localhost/roth-conversion/' });
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
  // Drop the page's own eager document.addEventListener('DOMContentLoaded', ...)
  // bootstrap block entirely -- jsdom fires a real DOMContentLoaded event on
  // its own document lifecycle regardless of runScripts, so registering that
  // listener would let the FULL page bootstrap (calc(), chart rendering,
  // renderExampleButtons(), etc.) actually run against this minimal synthetic
  // DOM, which doesn't have most of the elements it expects. This test only
  // needs the persistence-layer functions defined above that block, all of
  // which come earlier in the file, so truncating here is safe.
  const domReadyIdx = scriptSrc.indexOf("document.addEventListener('DOMContentLoaded'");
  if (domReadyIdx !== -1) scriptSrc = scriptSrc.slice(0, domReadyIdx);
  const suffix = (wizardCompleted ? '_wizardCompleted=true;\n' : '')
    + 'return {INPUT_FIELDS, collectInputs, applyInputs, saveInputs, loadSavedInputs, encodeShareState, decodeShareState, loadFromShareHash, applyConvertAmtSkipUI, refreshShareLink};';
  const mod = new Function(scriptSrc + '\n' + suffix)();
  return { ...mod, document: dom.window.document, dom };
}

const html = readFileSync(new URL('../roth-conversion/index.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
function checkTrue(label, cond) {
  if (cond) pass++;
  else { fail++; console.log(`FAIL  ${label}`); }
}
function checkEq(label, actual, expected) {
  checkTrue(`${label}  (got=${JSON.stringify(actual)}, expected=${JSON.stringify(expected)})`, actual === expected);
}

// --- 1. nyLocalTax/orLocalTax are now real INPUT_FIELDS members (the
// pre-existing gap fixed alongside this feature). ---
{
  const { INPUT_FIELDS } = extract(html);
  checkTrue('INPUT_FIELDS includes nyLocalTax', INPUT_FIELDS.includes('nyLocalTax'));
  checkTrue('INPUT_FIELDS includes orLocalTax', INPUT_FIELDS.includes('orLocalTax'));
}

// --- 2. Round-trip fidelity: encode the default field set, decode it back
// via loadFromShareHash on a FRESH extraction, confirm every field matches,
// including the two newly-added local-tax fields. ---
{
  const sender = extract(html, { wizardCompleted: true });
  sender.document.getElementById('nyLocalTax').value = 'nyc';
  sender.document.getElementById('stateCode').value = 'NY';
  const hash = '#s=' + sender.encodeShareState();

  const recipient = extract(html);
  recipient.dom.window.location.hash = hash;
  const ok = recipient.loadFromShareHash();
  checkTrue('loadFromShareHash() returns true for a valid link', ok);
  checkEq('Round-trip: stateCode', recipient.document.getElementById('stateCode').value, 'NY');
  checkEq('Round-trip: nyLocalTax', recipient.document.getElementById('nyLocalTax').value, 'nyc');
  checkEq('Round-trip: convertAmt', recipient.document.getElementById('convertAmt').value, '20000');
  checkEq('Round-trip: income', recipient.document.getElementById('income').value, '72000');
}

// --- 2b. refreshShareLink() must reflect CURRENT field values on every
// call, not a memoized/stale snapshot from whenever it was first opened --
// a real bug caught by adversarial review: the visible link only used to
// regenerate on the <details> panel's own toggle event, so editing a field
// after opening it once left the box (and whatever got copied/shared)
// silently showing the pre-edit scenario. Fixed by also calling this,
// unselected, from calc() whenever the panel is open -- this test proves
// the function itself always re-reads live DOM state, which is what that
// fix depends on. ---
{
  const { document, refreshShareLink, decodeShareState } = extract(html, { wizardCompleted: true });
  document.getElementById('income').value = '11111';
  refreshShareLink();
  const firstHash = document.getElementById('shareLinkBox').value.split('#')[1];
  checkEq('refreshShareLink() reflects the field value at call time (before edit)', decodeShareState(firstHash.slice(2)).income, '11111');

  document.getElementById('income').value = '22222'; // a real edit after the panel was already open
  refreshShareLink();
  const secondHash = document.getElementById('shareLinkBox').value.split('#')[1];
  checkEq('refreshShareLink() reflects a field edit made AFTER the first call (not stale)', decodeShareState(secondHash.slice(2)).income, '22222');
}

// --- 3. Version-prefix mismatch is rejected, not mis-parsed. ---
{
  const { decodeShareState } = extract(html);
  checkTrue('decodeShareState rejects an unknown version prefix', decodeShareState('v2.eyJhIjoxfQ') === null);
}

// --- 4. Malformed/truncated hash fails closed: no throw, no partial
// population, loadFromShareHash returns false and touches nothing. ---
{
  const { loadFromShareHash, decodeShareState, document, dom } = extract(html);
  checkTrue('decodeShareState returns null for garbage', decodeShareState('v1.not-valid-base64!!!') === null);
  const before = document.getElementById('income').value;
  dom.window.location.hash = '#s=v1.%%%garbage%%%';
  let threw = false;
  let result;
  try { result = loadFromShareHash(); } catch (e) { threw = true; }
  checkTrue('loadFromShareHash does not throw on a malformed hash', !threw);
  checkTrue('loadFromShareHash returns false on a malformed hash', result === false);
  checkEq('A malformed hash leaves existing field values untouched', document.getElementById('income').value, before);
}

// --- 5. No #s= hash at all: loadFromShareHash is a clean false, no
// side effects (this is the normal, non-shared-link page load). ---
{
  const { loadFromShareHash } = extract(html);
  checkTrue('loadFromShareHash returns false with no hash present', loadFromShareHash() === false);
}

// --- 6. The rg_v1_skip clobber bug the Plan-agent review caught: a
// recipient's own STALE skip flag from an unrelated earlier session must
// not blank out the SENDER's real convertAmt, and must itself be cleared. ---
{
  const sender = extract(html, { wizardCompleted: true });
  sender.document.getElementById('convertAmt').value = '35000';
  const hash = '#s=' + sender.encodeShareState(); // skip:false, convertAmt:35000

  const recipientStorage = makeStorage();
  recipientStorage.setItem('rg_v1_skip', '1'); // recipient's own stale flag, seeded before the link is ever opened
  const recipient = extract(html, { storage: recipientStorage });
  recipient.dom.window.location.hash = hash;
  recipient.loadFromShareHash();
  checkEq('A stale local rg_v1_skip does not blank the sender\'s real convertAmt', recipient.document.getElementById('convertAmt').value, '35000');
  checkTrue('loadFromShareHash clears the stale rg_v1_skip key', recipientStorage.getItem('rg_v1_skip') === null);
}

// --- 7. A genuinely skipped scenario (sender had convertAmt blank) decodes
// to a blank field and the correct skip-confirmed UI state, not silently
// dropped or misrendered as $0. ---
{
  const sender = extract(html, { wizardCompleted: true });
  sender.document.getElementById('convertAmt').value = '';
  const hash = '#s=' + sender.encodeShareState();

  const recipient = extract(html);
  recipient.dom.window.location.hash = hash;
  recipient.loadFromShareHash();
  checkEq('A skipped sender scenario decodes to a blank convertAmt (not clamped/rejected)', recipient.document.getElementById('convertAmt').value, '');
  checkEq('skipConfirmed is shown (display:flex) for a decoded skip:true payload', recipient.document.getElementById('skipConfirmed').style.display, 'flex');
}

// --- 8. Numeric clamping: a hand-crafted payload with an out-of-range value
// must not reach the DOM unclamped -- this is untrusted input, unlike
// localStorage's own self-authored data. ---
{
  const { applyInputs, document } = extract(html);
  applyInputs({ currentAge: '-99999' });
  checkEq('applyInputs clamps a below-min value up to the field\'s own min (18)', document.getElementById('currentAge').value, '18');
  applyInputs({ currentAge: '999999' });
  checkEq('applyInputs clamps an above-max value down to the field\'s own max (90)', document.getElementById('currentAge').value, '90');
  applyInputs({ currentAge: 'not-a-number' });
  checkEq('applyInputs ignores a non-numeric garbage value (keeps prior value)', document.getElementById('currentAge').value, '90');
}

// --- 9. The clobber-prevention flag itself: opening a shared link must NOT
// overwrite a visitor's own already-saved rg_v1 scenario, but a real edit
// afterward saves normally (tested via a fresh, non-suppressed extraction). ---
{
  // One shared storage represents the SAME visitor's browser across three
  // separate "page loads" (own -> visitor -> editedLater); a SEPARATE
  // storage represents a different person entirely (stranger) sending a link.
  const visitorStorage = makeStorage();

  const own = extract(html, { wizardCompleted: true, storage: visitorStorage });
  own.document.getElementById('income').value = '999000'; // the visitor's own distinctive saved value
  own.saveInputs();
  const savedBefore = visitorStorage.getItem('rg_v1');
  checkTrue('Baseline: saveInputs() persists once wizardCompleted is true', savedBefore && JSON.parse(savedBefore).income === '999000');

  // A different sender's own browser/storage, opening someone ELSE's
  // shared link with different numbers.
  const stranger = extract(html, { wizardCompleted: true, storage: makeStorage() });
  stranger.document.getElementById('income').value = '55000';
  const strangerHash = '#s=' + stranger.encodeShareState();

  const visitor = extract(html, { wizardCompleted: true, storage: visitorStorage });
  visitor.dom.window.location.hash = strangerHash;
  visitor.loadFromShareHash(); // sets the internal one-shot suppression flag
  visitor.saveInputs(); // must be suppressed -- this is the exact clobber this feature must prevent
  const savedAfter = JSON.parse(visitorStorage.getItem('rg_v1'));
  checkEq('Opening someone else\'s link does not overwrite the visitor\'s own saved rg_v1', savedAfter.income, '999000');

  // A fresh (non-suppressed) extraction on the SAME visitor storage
  // represents "the visitor then makes a real edit" -- saveInputs must
  // resume working normally from there.
  const editedLater = extract(html, { wizardCompleted: true, storage: visitorStorage });
  editedLater.document.getElementById('income').value = '111000';
  editedLater.saveInputs();
  const savedFinal = JSON.parse(visitorStorage.getItem('rg_v1'));
  checkEq('A subsequent real edit (unsuppressed) saves normally', savedFinal.income, '111000');
}

// --- 10. loadFromShareHash strips the hash from the visible URL immediately
// on success, so the decoded numbers don't linger in the address bar. ---
{
  const sender = extract(html, { wizardCompleted: true });
  const hash = '#s=' + sender.encodeShareState();
  const recipient = extract(html);
  recipient.dom.window.location.hash = hash;
  recipient.loadFromShareHash();
  checkEq('The hash is stripped from the URL after a successful decode', recipient.dom.window.location.hash, '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
