#!/usr/bin/env node
// test-relo-pension-kind.mjs — Relocation's "Pension type" select shows the answer the numbers
// use. The select is page-owned (custom: true), so an example that sets pensionKind changes the
// numbers but not the select unless the page copies compute()'s answer (pensionKindUI.value)
// back into it. Runs the page's own module script in jsdom, with the page's own markup, and
// clicks the example the way a person would.
//
// The "New York to Florida" example: married, both 70, Social Security $36,000 (exempt in New
// York), IRA $60,000, pension $30,000, gains $15,000. By hand from states.json:
//   Government: IRA $60,000 - $40,000 exclusion ($20,000 each) = $20,000, plus $15,000 gains
//     = $35,000, less the $16,050 standard deduction = $18,950: 3.9% x 17,150 = 668.85,
//     4.4% x 1,800 = 79.20; $748.05.
//   Private: pension and IRA share the $40,000: $50,000 + $15,000 - $16,050 = $48,950:
//     668.85 + 4.4% x 6,450 = 283.80 + 5.15% x 4,300 = 221.45 + 5.4% x 21,050 = 1,136.70;
//     $2,310.80.

import { JSDOM } from 'jsdom';
import * as d3 from 'd3';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const html = readFileSync(new URL('../relocation/index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), { url: 'https://paths-and-proofs.test/relocation/' });
const { window } = dom;
Object.assign(globalThis, {
  window, document: window.document, location: window.location, history: window.history,
  getComputedStyle: window.getComputedStyle, d3,
  // Reduced motion, as verify-all.mjs sets it: the chart skips its draw-in animation (jsdom has no SVG lengths).
  matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
});
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });

// window.RELO, as the page's generated data block sets it (gen-relo-data.mjs --check keeps the two equal).
const states = JSON.parse(readFileSync(new URL('../roth-conversion/states.json', import.meta.url), 'utf8'));
window.RELO = {};
for (const code of Object.keys(states).filter((k) => k !== '_schema')) {
  window.RELO[code] = { name: states[code].facts.name, taxRules: states[code].taxRules, taxContext: states[code].taxContext, localTax: states[code].localTax };
}

// The page's module script, with its relative imports pointed at the real files.
let src = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
for (const spec of ['../core/bootstrap.js', './relocation.js', '../core/share-link.js']) {
  if (!src.includes(`'${spec}'`)) throw new Error(`page script no longer imports ${spec}`);
  src = src.replace(`'${spec}'`, `'${new URL(spec, new URL('../relocation/', import.meta.url)).href}'`);
}
const dir = mkdtempSync(join(tmpdir(), 'relo-page-'));
try {
  writeFileSync(join(dir, 'page.mjs'), src);
  await import(pathToFileURL(join(dir, 'page.mjs')).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

let pass = 0, fail = 0;
function check(label, ok, detail = '') {
  if (ok) { pass++; console.log(`ok    ${label}`); }
  else { fail++; console.log(`FAIL  ${label}${detail ? `  (${detail})` : ''}`); }
}

const select = document.getElementById('pensionKind');
const field = document.getElementById('pensionKindField');
const newYork = () => (document.querySelector('[data-summary]').textContent.replace(/\s+/g, ' ')
  .match(/New York — state income tax per year ?(\$[\d,]+)/) || [])[1];
const example = (name) => [...document.querySelectorAll('#presets button')].find((b) => b.textContent === name).click();

// The page opens on the first example (California to Texas): no government-only state, so no question.
check('opening example: question hidden, select on the default (private)', field.style.display === 'none' && select.value === 'false', `${field.style.display} ${select.value}`);

example('New York to Florida');
check('"New York to Florida": the question shows', field.style.display === 'block', field.style.display);
check('"New York to Florida": New York $748, the government figure', newYork() === '$748', newYork());
check('"New York to Florida": the select shows the answer the numbers use (government)', select.value === 'true', select.value);

select.value = 'false';
select.dispatchEvent(new window.Event('change', { bubbles: true }));
check('answered private: New York $2,311', newYork() === '$2,311', newYork());
check('answered private: the select stays on private', select.value === 'false', select.value);

example('California to Texas');
example('New York to Florida');
check('the example again: back to government, $748, and the select follows', select.value === 'true' && newYork() === '$748', `${select.value} ${newYork()}`);

// The page's select offers the module's answers, worded the same, and starts on its default.
const mod = await import('../relocation/relocation.js');
const ctl = mod.inputs.find((c) => c.id === 'pensionKind');
const pageOpts = [...select.options].map((o) => [o.value, o.textContent]);
check('page select lists the module\'s answers, worded the same', JSON.stringify(pageOpts) === JSON.stringify(ctl.options.map((o) => [o.value, o.label])), JSON.stringify(pageOpts));
const startsOn = html.slice(html.indexOf('<select id="pensionKind"'), html.indexOf('</select>', html.indexOf('<select id="pensionKind"'))).match(/<option value="([^"]*)" selected>/)?.[1];
check('page select starts on the module default', startsOn === ctl.default, `${startsOn} vs ${ctl.default}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
