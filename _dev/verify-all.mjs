// verify-all.mjs — confirm the calculators run through the one shared core.
import { JSDOM } from 'jsdom';
import * as d3 from 'd3';
import { mount } from '../core/app.js';
import * as socialSecurity from '../social-security/social-security.js';
import * as rentVsBuy from '../rent-vs-buy/rent-vs-buy.js';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.matchMedia = () => ({ matches: true });
globalThis.d3 = d3;

let failures = 0;
const ok = (n, c, x = '') => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${x ? '  (' + x + ')' : ''}`); if (!c) failures++; };

function check(mod) {
  const root = document.createElement('div');
  root.innerHTML = '<div data-controls></div><div data-chart></div><div data-summary></div>';
  document.body.appendChild(root);
  mount(mod, root);
  const primary = root.querySelector('.summary-primary .summary-value')?.textContent;
  console.log(`\n--- ${mod.meta.name} ---`);
  ok('controls render', root.querySelectorAll('.control').length === mod.inputs.length);
  ok('chart renders', !!root.querySelector('svg'));
  ok('one line per series', root.querySelectorAll('path[stroke-width="2.5"]').length === mod.compute(Object.fromEntries(mod.inputs.map(c => [c.id, c.default]))).series.length);
  ok('headline result present', !!primary, primary);
}

[socialSecurity, rentVsBuy].forEach(check);
console.log(failures ? `\n${failures} failed` : '\nBoth calculators run on the shared core.');
process.exit(failures ? 1 : 0);
