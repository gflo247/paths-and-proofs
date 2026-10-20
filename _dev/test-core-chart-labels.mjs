#!/usr/bin/env node
// Tests for core/chart.js label placement.
//
// Crossover and marker labels are centered on their vertical line, and the axis
// title on the plot. Near an edge, a centered label runs past the chart and gets
// cut off (Life Insurance's "no longer needs insurance", Medicare on phones). Each
// label must stay inside its bounds, sliding only as far as it has to.
//
// jsdom can't measure text, so getComputedTextLength is stubbed at 7px a character.
//
// Run: node _dev/test-core-chart-labels.mjs

import { JSDOM } from 'jsdom';
import * as d3 from 'd3';

const dom = new JSDOM('<!doctype html><body><div id="c"></div></body>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.matchMedia = () => ({ matches: true });   // reduced motion: skip line animation
globalThis.d3 = d3;
const CHAR = 7;
dom.window.SVGElement.prototype.getComputedTextLength = function () { return this.textContent.length * CHAR; };

const { drawChart } = await import('../core/chart.js');

let passed = 0, failed = 0;
function ok(label, cond, extra = '') {
  if (cond) { passed++; console.log('ok   ', label); }
  else      { failed++; console.error('FAIL ', label, extra); }
}

// 0..100 on x. A is flat at 50, B rises 0..~52.6, so they cross at x = 95.
const xs = Array.from({ length: 101 }, (_, i) => i);
const result = {
  series: [
    { name: 'A', points: xs.map((x) => ({ x, y: 50 })) },
    { name: 'B', points: xs.map((x) => ({ x, y: x * 50 / 95 })) },
  ],
  xAxis: { label: 'An axis title long enough to run past the right edge when centered on the plot area', format: (n) => String(Math.round(n)) },
  yAxis: { label: 'Cost', format: (n) => String(Math.round(n)) },
  crossovers: [{ from: 0, to: 1, label: 'no longer needs insurance' }],
  markers: [{ x: 98, label: 'mortgage paid off' }, { x: 2, label: 'youngest turns 18' }, { x: 50, label: 'centered marker' }],
};
const container = document.getElementById('c');
drawChart(result, container);

const svg = container.querySelector('svg');
const width = +svg.getAttribute('width');
const innerW = width - 60 - 16;   // core/chart.js MARGIN.left / MARGIN.right
function extent(t) {
  const x = +t.getAttribute('x'), len = t.textContent.length * CHAR;
  const a = t.getAttribute('text-anchor') || 'start';
  return a === 'middle' ? [x - len / 2, x + len / 2] : a === 'end' ? [x - len, x] : [x, x + len];
}
const texts = [...svg.querySelectorAll('g > text')];
const find = (s) => texts.find((t) => t.textContent.includes(s));
const inside = (t, lo, hi) => { const [l, r] = extent(t); return l >= lo - 0.01 && r <= hi + 0.01; };

const cross = find('no longer needs insurance');
ok('crossover label near the right edge stays inside the plot', inside(cross, 0, innerW), JSON.stringify(extent(cross)));
ok('crossover label still covers its line', (() => { const [l, r] = extent(cross); const px = innerW * 0.95; return l <= px && px <= r; })());
ok('marker label near the right edge stays inside the plot', inside(find('mortgage paid off'), 0, innerW), JSON.stringify(extent(find('mortgage paid off'))));
ok('marker label near the left edge stays inside the plot', inside(find('youngest turns 18'), 0, innerW), JSON.stringify(extent(find('youngest turns 18'))));
const mid = find('centered marker');
ok('a label that fits stays centered on its line', mid.getAttribute('text-anchor') === 'middle' && Math.abs(+mid.getAttribute('x') - innerW * 0.5) < 0.01);
ok('axis title stays inside the chart', inside(find('An axis title'), -60, innerW + 16), JSON.stringify(extent(find('An axis title'))));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
