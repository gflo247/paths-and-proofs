#!/usr/bin/env node
// gen-st-table.mjs — Build-time generator: states.json -> inline ST={...} in index.html
//
// WHY THIS EXISTS:
//   states.json is the canonical, primary-source-verified fact base for all 51
//   jurisdictions. The Roth tool's engine reads an inline `const ST={...}` table for
//   zero-network, fully-self-contained operation (privacy: nothing leaves the device).
//   Rather than hand-maintain that table in sync with states.json (drift-prone, which the
//   old guard could only DETECT after the fact), we GENERATE it from states.json. This
//   makes drift structurally impossible: the JSON is the source, the table is an artifact.
//
//   The generated `ST` entry shape is the roth-layer view the engine consumes:
//     KEY: {n, cr, ex, note}
//   (plus the leading blank '' placeholder the engine uses as its no-state default.)
//
// USAGE:
//   node _dev/gen-st-table.mjs            # rewrite index.html's ST block in place
//   node _dev/gen-st-table.mjs --check    # exit 1 if the file would change (CI drift check)
//
// The block is spliced between the exact markers `const ST={` and the matching ` };`.

import { readFileSync, writeFileSync } from 'node:fs';

const HTML = 'roth-conversion/index.html';
const JSON_PATH = 'roth-conversion/states.json';
const OPEN = 'const ST={';
const CLOSE = '};'; // the closing line of the block (no leading space; first `};` after OPEN)

// Single-quoted JS string literal: escape backslash first, then single quote.
// (Notes are author-controlled prose; newlines are not expected, but guard anyway.)
function jsStr(s) {
  return "'" + String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, ' ') + "'";
}

// A numeric literal matching the table's hand style: 0 stays 0, decimals drop the
// leading zero (0.05 -> .05) to mirror the original inline formatting.
function num(n) {
  if (n === 0) return '0';
  const s = String(n);
  return s.startsWith('0.') ? s.slice(1) : s;
}

function buildBlock(json) {
  const codes = Object.keys(json).filter((k) => k !== '_schema');
  const lines = [];
  lines.push(OPEN);
  // Leading blank placeholder: the engine's no-state default (ST['']).
  lines.push("  '': {n:'',cr:0,ex:false,note:''},");
  for (const code of codes) {
    const r = json[code].roth;
    if (!r) throw new Error(`states.json: ${code} has no roth block`);
    lines.push(
      `  ${code}: {n:${jsStr(json[code].facts?.name ?? '')},cr:${num(r.cr)},ex:${r.ex},note:${jsStr(r.note)}},`
    );
  }
  lines.push(CLOSE);
  return lines.join('\n');
}

// RETDED: a separate, sparse table — only states with a verified flat, non-phased-out
// retirement-income deduction (see states.json _schema.fields["roth.retDeduction"]) get
// an entry. Kept out of the ST block so the audited {n,cr,ex,note} shape and its strict
// parser (parse-states.mjs) never have to change as more states are added here over time.
const RD_OPEN = 'const RETDED={';
const RD_CLOSE = '};';

function buildRetDedBlock(json) {
  const codes = Object.keys(json).filter((k) => k !== '_schema');
  const lines = [];
  lines.push(RD_OPEN);
  for (const code of codes) {
    const rd = json[code].roth?.retDeduction;
    if (!rd) continue;
    lines.push(
      `  ${code}: {single:${num(rd.single)},mfj:${num(rd.mfj)},mfs:${num(rd.mfs)},hoh:${num(rd.hoh)}},`
    );
  }
  lines.push(RD_CLOSE);
  return lines.join('\n');
}

// EXAGE: a separate, sparse table — only ex:true states whose exemption is age-gated
// (see states.json _schema.fields["roth.exMinAge"]) get an entry. Absence means an
// ex:true state's exemption is unconditional.
const EA_OPEN = 'const EXAGE={';
const EA_CLOSE = '};';

function buildExAgeBlock(json) {
  const codes = Object.keys(json).filter((k) => k !== '_schema');
  const lines = [];
  lines.push(EA_OPEN);
  for (const code of codes) {
    const age = json[code].roth?.exMinAge;
    if (age === undefined) continue;
    lines.push(`  ${code}: ${num(age)},`);
  }
  lines.push(EA_CLOSE);
  return lines.join('\n');
}

// RIX: a third sparse table for states whose retirement-income deduction needs one of
// the richer shapes built for the relocation tool (age-tiered caps, stepped tables,
// per-spouse phase-outs, offset-stacked deductions) — genuinely different mechanics than
// RETDED's single flat cap, so kept in its own block rather than overloading RETDED's
// simple {single,mfj,mfs,hoh} shape. Sourced from the SAME canonical taxRules.retirementIncome
// data the relocation tool already consumes (see relocation/relo-engine.mjs) — one fact,
// two generated views, same as RETDED/EXAGE's relationship to states.json.
//
// Deliberately excludes Michigan (already covered by RETDED — untouched, don't duplicate
// the highest-scrutiny state's calculation across two mechanisms). West Virginia's
// Social-Security-netting question (its $8k/$16k modification shares one pool with SS)
// was resolved 2026-07-31 — netAgainstSS:true on its taxRules.retirementIncome.exclusion
// nets the SS benefit against the cap before it reaches this table, so it's included below
// alongside the other RIX-shape states rather than falling back to the flat-cr approximation.
// NY added 2026-08-24: states.json already had NY's taxRules.retirementIncome (flat
// $20,000 cap once 59.5+, "hard" cliffType, per NY Tax Law and tax.ny.gov) but it was
// never added to this allowlist, so NY silently fell back to the flat-cr approximation
// despite the site's own displayed note telling users about the exclusion — found live
// (a 62-year-old converting $15,000, entirely within the disclosed cap, was still charged
// NY tax on the full amount). Considered re-shaping to ageTieredCap/perPersonTiers (like
// WI) so a joint return sums each spouse's own $20k instead of sharing one flat $20k, but
// reverted: NY's pensionIncome is NOT pooled with retirementIncome in relo-engine.mjs
// (unlike every other ageTieredCap state), and relo-engine's non-pooled branch has no
// ageTieredCap support — that combination would have silently broken the Relocation
// tool's NY calculation. Kept the flat cap (same known per-spouse-approximation as
// LA/WV) rather than fix a shared-core gap as a side effect of a Roth-only fix.
// CO added 2026-08-24: the SAME bug class as NY, but worse — CO's retirementIncome had
// a "hard" cliffType with a flat $24,000 cap, when the real rule (per CO DOR's own
// Income Tax Topics guide) is genuinely age-tiered ($20,000 at 55-64, $24,000 at 65+).
// Reshaped to ageTieredCap/perPersonTiers (like GA/WI) rather than kept flat, because
// CO's pensionIncome IS pooled with retirementIncome (confirmed — unlike NY, this
// reshape doesn't hit the gap described above). CO was also missing from this allowlist
// entirely, so the Roth calculator applied ZERO shelter from this deduction despite the
// site's own note describing it in detail — worse than NY's bug, which at least applied
// the wrong (flat) cap; CO applied no cap at all.
// AR/DE/KY/OK added 2026-08-24, found while auditing LA's same-day fix for the same bug
// shape: each state's retirement-income exclusion is genuinely PER-PERSON (confirmed via
// each state's own DOR guidance — AR/DE/OK/KY all explicitly compute the cap separately
// per spouse and sum for a joint return), but none were in RETDED or this allowlist at
// all, so the Roth calculator applied ZERO shelter for any of them. Reshaped to
// ageTieredCap/perPersonTiers (same mechanism as GA/WI/CO/LA), confirmed each state's
// pensionIncome IS pooled with retirementIncome so the reshape is safe. Their capJoint
// values in states.json were ALSO wrong before this fix (flat, same as capSingle, instead
// of the real per-person-summed figure) — a live bug in the Relocation tool too, not just
// a Roth coverage gap.
// AL added 2026-08-24 as a SPECIAL CASE: same per-person $6,000 exclusion shape (AL DOR's
// own Schedule RS computes it separately in Part II/Part III for primary/spouse), but
// AL's pensionIncome is NOT pooled with retirementIncome — defined-benefit pensions are
// separately, unconditionally exempt (pensionIncome.treatment:"exempt"), and don't compete
// for the $6,000 IRA-only cap at all. Kept cliffType:"hard" (not reshaped to ageTieredCap,
// which the non-pooled Relocation branch doesn't support — same gap flagged in the NY
// comment above) and given a dedicated stateCode==='AL' branch in computeConversionCost
// that reads capSingle/capJoint from this table but applies them to the conversion alone,
// never pooling with pensionIncome. AL's capJoint was ALSO wrong (flat $6,000 instead of
// the real $12,000 for two 65+ spouses) — fixed in states.json for both tools.
export const RIX_STATES = ['GA', 'LA', 'SC', 'VA', 'WI', 'NM', 'CT', 'NJ', 'WV', 'NY', 'CO', 'AR', 'DE', 'KY', 'OK', 'AL'];
const RIX_OPEN = 'const RIX={';
const RIX_CLOSE = '};';

function buildRixBlock(json) {
  const lines = [];
  lines.push(RIX_OPEN);
  for (const code of RIX_STATES) {
    const ri = json[code]?.taxRules?.retirementIncome;
    if (!ri) throw new Error(`states.json: ${code} has no taxRules.retirementIncome for RIX`);
    lines.push(`  ${code}: ${JSON.stringify(ri)},`);
  }
  lines.push(RIX_CLOSE);
  return lines.join('\n');
}

function splice(html, block, open, close) {
  const start = html.indexOf(open);
  if (start === -1) throw new Error(`Could not find "${open}" in ${HTML}`);
  // Find the closing line that terminates the object, starting from open.
  const closeIdx = html.indexOf('\n' + close, start);
  if (closeIdx === -1) throw new Error(`Could not find closing "${close}" after "${open}" block`);
  const end = closeIdx + 1 + close.length; // include the close line
  return html.slice(0, start) + block + html.slice(end);
}

// Guarded so this file can also be `import`ed for RIX_STATES (e.g. by
// check-states-json.mjs's RIX-coverage guard) without triggering a regenerate/--check
// run as an unwanted side effect of the import.
if (import.meta.url === `file://${process.argv[1]}`) {

const json = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const html = readFileSync(HTML, 'utf8');
const block = buildBlock(json);
const rdBlock = buildRetDedBlock(json);
const eaBlock = buildExAgeBlock(json);
const rixBlock = buildRixBlock(json);
const withSt = splice(html, block, OPEN, CLOSE);
const withRd = splice(withSt, rdBlock, RD_OPEN, RD_CLOSE);
const withEa = splice(withRd, eaBlock, EA_OPEN, EA_CLOSE);
const next = splice(withEa, rixBlock, RIX_OPEN, RIX_CLOSE);

const isCheck = process.argv.includes('--check');
if (isCheck) {
  if (next !== html) {
    console.error('DRIFT: index.html ST table is out of sync with states.json.');
    console.error('Run `node _dev/gen-st-table.mjs` to regenerate (edit states.json, never the inline table).');
    process.exit(1);
  }
  console.log('ST table is in sync with states.json (no drift).');
} else {
  if (next === html) {
    console.log('ST table already current; no change written.');
  } else {
    writeFileSync(HTML, next);
    const n = Object.keys(json).filter((k) => k !== '_schema').length;
    console.log(`Regenerated ST table from states.json (${n} jurisdictions + blank placeholder).`);
  }
}

} // end entry-point guard
