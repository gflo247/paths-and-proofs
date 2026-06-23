#!/usr/bin/env node
// set-state.mjs — safely replace ONE state entry in the Roth tool's STATES table.
//
// Why this exists: editing entries via a long find-and-replace on a 176KB file
// has repeatedly collapsed an adjacent entry when the call was malformed, silently
// dropping a state (the table still parses, so the loss is invisible). This script
// targets a single line by its state key, so there is no multi-line span that can
// collapse, and it refuses to write unless exactly one line matches and the total
// entry count is unchanged.
//
// Usage:
//   node _dev/set-state.mjs CO "  CO:  {n:'Colorado',     cr:.044, ex:false, note:'...'},"
//
// The second argument is the FULL replacement line (including leading spaces and
// trailing comma). The script:
//   1. finds the single line beginning with the key (e.g. "  CO:")
//   2. confirms exactly one such line exists
//   3. replaces it in place
//   4. confirms the entry count is identical before and after
//   5. writes only if all checks pass; otherwise aborts with no change

import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../roth-conversion/index.html', import.meta.url);

// Two input modes:
//   node _dev/set-state.mjs <KEY> "<full replacement line>"        (inline)
//   node _dev/set-state.mjs <KEY> --file <path-to-line.txt>        (from file)
// The --file mode bypasses shell quoting entirely, so apostrophes, $ and other
// shell-special characters in the note can't be mangled before the script sees them.
const [, , key, arg3, arg4] = process.argv;

let replacement;
if (arg3 === '--file') {
  if (!key || !arg4) {
    console.error('Usage: node _dev/set-state.mjs <KEY> --file <path>');
    process.exit(1);
  }
  // Read the line from file; strip a single trailing newline if present.
  replacement = readFileSync(arg4, 'utf8').replace(/\n$/, '');
} else {
  replacement = arg3;
  if (!key || !replacement) {
    console.error('Usage: node _dev/set-state.mjs <KEY> "<full replacement line>"');
    console.error('   or: node _dev/set-state.mjs <KEY> --file <path>');
    process.exit(1);
  }
}

// A file may contain more than one line by mistake; the replacement must be one line.
if (replacement.includes('\n')) {
  console.error('ABORT: replacement must be a single line. No change written.');
  process.exit(1);
}

const countEntries = (s) => (s.match(/ex:true|ex:false/g) || []).length;

const original = readFileSync(FILE, 'utf8');
const before = countEntries(original);

const lines = original.split('\n');
// Match lines like "  CO:  {n:'Colorado', ...}," — key at start after whitespace.
const keyRe = new RegExp(`^\\s*${key}:\\s*\\{`);
const matches = lines.filter((l) => keyRe.test(l));

if (matches.length === 0) {
  console.error(`ABORT: no line found for key ${key}. No change written.`);
  process.exit(1);
}
if (matches.length > 1) {
  console.error(`ABORT: ${matches.length} lines match key ${key}; expected exactly 1. No change written.`);
  process.exit(1);
}

// Sanity-check the replacement line itself before swapping it in.
if (!keyRe.test(replacement)) {
  console.error(`ABORT: replacement line does not start with "${key}: {". No change written.`);
  process.exit(1);
}
if (!/\},?\s*$/.test(replacement)) {
  console.error('ABORT: replacement line does not end with "}," — likely malformed. No change written.');
  process.exit(1);
}
if (!/ex:(true|false)/.test(replacement)) {
  console.error('ABORT: replacement line has no ex:true/ex:false flag. No change written.');
  process.exit(1);
}

const updated = lines.map((l) => (keyRe.test(l) ? replacement : l)).join('\n');
const after = countEntries(updated);

if (after !== before) {
  console.error(`ABORT: entry count changed ${before} -> ${after}. No change written.`);
  process.exit(1);
}

// Final guard: make sure the edited file's inline <script> blocks still parse.
// A common failure is an unescaped apostrophe in the note (the note lives inside a
// single-quoted JS string, so a literal ' terminates it early). Catch that here,
// before writing, rather than discovering it later.
const scripts = [...updated.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
for (const body of scripts) {
  try {
    // new Function throws on a syntax error without executing the body.
    new Function(body);
  } catch (e) {
    console.error(`ABORT: edit would break script parsing (${e.message}).`);
    console.error('Hint: an apostrophe inside the note must be escaped as \\\'. No change written.');
    process.exit(1);
  }
}

writeFileSync(FILE, updated);
console.log(`OK: ${key} updated. Entry count steady at ${after}.`);
