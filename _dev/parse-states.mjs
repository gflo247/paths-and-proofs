// parse-states.mjs — read the live ST={...} tax table out of roth-conversion/index.html
// into structured objects. This is the single source of truth for what the deployed
// tool currently uses, and the reference the extraction guard checks states.json against.
//
// Exported: parseStatesFromHtml(htmlPath) -> { code: {n, cr, ex, note}, ... }
// Run directly to print a summary: node _dev/parse-states.mjs

import { readFileSync } from 'node:fs';

export function parseStatesFromHtml(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');

  // Isolate the ST={ ... }; block. We anchor on "const ST={" and take up to the
  // first line that is exactly "};" (the table close). This is deliberately strict.
  const start = html.indexOf('const ST={');
  if (start === -1) throw new Error('Could not find "const ST={" in HTML.');
  const after = html.slice(start);
  const endRel = after.search(/\n};/);
  if (endRel === -1) throw new Error('Could not find closing "};" for ST table.');
  const block = after.slice(0, endRel);

  // Each entry is one line: KEY:  {n:'...', cr:.05, ex:false, note:'...'},
  // KEY is a 2-letter code or the empty-string placeholder ''.
  const states = {};
  const lineRe = /^\s*(?:([A-Z]{2})|'')\s*:\s*\{n:'((?:[^'\\]|\\.)*)'\s*,\s*cr:\s*([0-9.]+)\s*,\s*ex:\s*(true|false)\s*,\s*note:'((?:[^'\\]|\\.)*)'\s*\}\s*,?\s*$/;

  for (const rawLine of block.split('\n')) {
    if (!rawLine.includes('{n:')) continue; // skip the "const ST={" opener and comments
    const m = rawLine.match(lineRe);
    if (!m) {
      throw new Error(`Unparseable ST entry line: ${rawLine.trim().slice(0, 80)}`);
    }
    const [, code, name, cr, ex, note] = m;
    const key = code ?? ''; // placeholder entry has empty key
    states[key] = {
      n: name.replace(/\\'/g, "'"),
      cr: parseFloat(cr),
      ex: ex === 'true',
      note: note.replace(/\\'/g, "'"),
    };
  }

  return states;
}

// CLI summary
if (import.meta.url === `file://${process.argv[1]}`) {
  const htmlPath = new URL('../roth-conversion/index.html', import.meta.url);
  const states = parseStatesFromHtml(htmlPath);
  const keys = Object.keys(states);
  const real = keys.filter((k) => k !== '');
  console.log(`Parsed ${keys.length} entries (${real.length} real + ${keys.length - real.length} placeholder).`);
  console.log(`ex:true count : ${real.filter((k) => states[k].ex).length}`);
  console.log(`ex:false count: ${real.filter((k) => !states[k].ex).length}`);
  // Spot-print a few that mattered in the audit.
  for (const k of ['AL', 'GA', 'NJ', 'HI', 'RI', 'MD']) {
    if (states[k]) console.log(`  ${k}: cr=${states[k].cr} ex=${states[k].ex} n=${states[k].n}`);
  }
}
