#!/usr/bin/env node
// Keeps sw.js's PRECACHE complete and valid, so the tools keep working offline
// and the service worker keeps installing:
//   1. Every PRECACHE entry exists. One missing file makes cache.addAll()
//      reject, and then the service worker never installs or updates.
//   2. Every same-origin file a page loads is in PRECACHE: <script src>,
//      stylesheet links, module imports (static and dynamic, followed through
//      every imported file) and CSS url()/@import. Without them, a cached page
//      opens offline with no calculator.
//
// Run: node _dev/check-precache.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const block = sw.match(/const PRECACHE = \[([\s\S]*?)\];/);
if (!block) { console.error('FAIL  could not find the PRECACHE array in sw.js'); process.exit(1); }
const precache = [...block[1].replace(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
const pages = precache.filter((p) => p.endsWith('/') || p.endsWith('.html'));

const fileOf = (p) => path.join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
// Strip comments so a usage example in a comment isn't read as an import.
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let failed = 0;
const fail = (msg) => { failed++; console.error('FAIL ', msg); };

for (const p of precache) if (!fs.existsSync(fileOf(p))) fail(`PRECACHE lists ${p}, which doesn't exist (cache.addAll() would reject and the service worker would never install)`);

const needed = new Map();   // path -> the file that loads it
function visit(urlPath, from) {
  if (needed.has(urlPath)) return;
  needed.set(urlPath, from);
  const f = fileOf(urlPath);
  if (!fs.existsSync(f)) { fail(`${from} loads ${urlPath}, which doesn't exist`); return; }
  const text = fs.readFileSync(f, 'utf8');
  const refs = [];
  if (f.endsWith('.html')) {
    for (const m of text.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) refs.push(m[1]);
    for (const m of text.matchAll(/<link\b[^>]*>/g)) {
      const href = m[0].match(/\bhref="([^"]+)"/);
      if (href && /\brel="(?:stylesheet|preload|modulepreload|icon)"/.test(m[0])) refs.push(href[1]);
    }
    for (const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
      for (const i of stripJs(m[1]).matchAll(/\bimport\s*(?:[^'"()]*?\bfrom\s*)?\(?\s*['"]([^'"]+)['"]/g)) refs.push(i[1]);
    }
  } else if (/\.m?js$/.test(f)) {
    for (const i of stripJs(text).matchAll(/\b(?:import|export)\s*(?:[^'"()]*?\bfrom\s*)?\(?\s*['"]([^'"]+)['"]/g)) refs.push(i[1]);
  } else if (f.endsWith('.css')) {
    const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const u of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) refs.push(u[1]);
    for (const u of css.matchAll(/@import\s+['"]([^'"]+)['"]/g)) refs.push(u[1]);
  }
  for (const r of refs) {
    if (/^(?:[a-z]+:|\/\/|#)/i.test(r)) continue;   // other origins, data: URIs, fragments
    visit(new URL(r, 'https://site' + urlPath).pathname, urlPath);
  }
}
for (const p of pages) visit(p, `${p} (page)`);

const listed = new Set(precache);
for (const [p, from] of needed) if (!listed.has(p)) fail(`${from} loads ${p}, but PRECACHE doesn't list it (that page would break offline)`);

if (!failed) console.log(`ok    PRECACHE: all ${precache.length} entries exist and cover every file the ${pages.length} pages load (${needed.size} files)`);
console.log(`\n${failed ? 0 : 2} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
