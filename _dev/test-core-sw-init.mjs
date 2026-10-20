#!/usr/bin/env node
// Tests for core/sw-init.js's reload after a service-worker update.
//
// When a new worker takes over (controllerchange), the page may reload only if
// the person hasn't touched it. Once they've typed, clicked, or a share link has
// filled in values (input / change / pointerdown / keydown), the numbers exist
// only in the page and a reload would wipe them, even if the tab is hidden or
// the field loses focus.
//
// sw-init.js runs on import and polls with timers, so each case runs in its own
// process (`--case=N`) to keep one case's timers from reloading another's page.
//
// Run: node _dev/test-core-sw-init.mjs

import { JSDOM } from 'jsdom';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup({ controlled = true } = {}) {
  // pretendToBeVisual: jsdom otherwise reports document.hidden === true.
  const dom = new JSDOM('<!doctype html><body><input id="f"><h1>Title</h1></body>', { pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Event = dom.window.Event;
  const sw = new dom.window.EventTarget();
  sw.controller = controlled ? {} : null;      // an older worker already controls the page
  sw.register = () => new Promise(() => {});   // registration itself isn't under test
  Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: sw }, configurable: true });
  const state = { reloads: 0 };
  globalThis.location = { reload: () => { state.reloads++; } };
  await import('../core/sw-init.js');
  const field = document.getElementById('f');
  return {
    state, field,
    takeover: () => sw.dispatchEvent(new dom.window.Event('controllerchange')),
    hide: () => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new dom.window.Event('visibilitychange'));
    },
    type: (v) => { field.value = v; field.dispatchEvent(new dom.window.Event('input', { bubbles: true })); },
  };
}

// Each case returns [label, passed] pairs.
const CASES = [
  async () => { const t = await setup(); t.takeover();
    return [['untouched page reloads when the new worker takes over', t.state.reloads === 1]]; },
  async () => { const t = await setup({ controlled: false }); t.takeover();
    return [['first install does not reload', t.state.reloads === 0]]; },
  async () => { const t = await setup(); t.hide(); t.takeover();
    return [['untouched hidden tab reloads', t.state.reloads === 1]]; },
  async () => { const t = await setup(); t.field.focus(); t.type('3550'); t.field.blur();
    t.takeover(); await sleep(1200);
    return [['typed then left the field: no reload', t.state.reloads === 0]]; },
  async () => { const t = await setup(); t.field.focus(); t.type('3550');
    t.takeover(); t.hide(); await sleep(1200);
    return [['typed, then switched tabs: no reload', t.state.reloads === 0]]; },
  async () => { const t = await setup(); t.type('3550');   // what share-link.js does when it applies a link
    t.takeover();
    return [['values applied from a share link: no reload', t.state.reloads === 0]]; },
  async () => { const t = await setup();
    t.field.addEventListener('input', (e) => e.stopPropagation());   // a strict control holding back a keystroke
    t.field.focus(); t.type('19'); t.field.blur(); t.takeover();
    return [['keystroke stopped from bubbling still counts as touched', t.state.reloads === 0]]; },
  async () => { const t = await setup();
    t.field.dispatchEvent(new window.Event('pointerdown', { bubbles: true })); t.takeover();
    return [['a click or tap counts as touched', t.state.reloads === 0]]; },
  async () => { const t = await setup(); t.field.focus(); t.takeover();
    const held = t.state.reloads === 0;
    await sleep(1200);
    const stillHeld = t.state.reloads === 0;
    t.field.blur(); await sleep(1200);
    return [['focused field holds the reload', held && stillHeld],
            ['untouched field left: the held reload happens', t.state.reloads === 1]]; },
  async () => { const t = await setup(); t.field.focus(); t.takeover();
    t.type('1'); t.field.blur(); await sleep(1200);
    return [['typing while the reload waits cancels it', t.state.reloads === 0]]; },
];

const caseArg = process.argv.find((a) => a.startsWith('--case='));
if (caseArg) {
  const results = await CASES[Number(caseArg.slice(7))]();
  console.log(JSON.stringify(results));
  process.exit(0);
}

let passed = 0, failed = 0;
const self = fileURLToPath(import.meta.url);
for (let i = 0; i < CASES.length; i++) {
  const r = spawnSync(process.execPath, [self, `--case=${i}`], { encoding: 'utf8', timeout: 20000 });
  let results;
  try { results = JSON.parse(r.stdout.trim().split('\n').pop()); }
  catch { results = [[`case ${i} crashed: ${(r.stderr || '').split('\n')[0]}`, false]]; }
  for (const [label, ok] of results) {
    if (ok) { passed++; console.log('ok   ', label); }
    else    { failed++; console.error('FAIL ', label); }
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
