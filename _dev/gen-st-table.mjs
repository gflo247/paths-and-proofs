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
    // conversionAgeGate: optional, only present for a state whose deduction applies
    // to ordinary pension/IRA income at any age but gates a Roth CONVERSION
    // specifically behind an age floor (MI: confirmed via MI Treasury's own FAQ —
    // "the rollover distribution... qualifies for the pension subtraction... if the
    // individual is at least 59 1/2 years of age when the rollover occurs"). Absence
    // means the deduction applies to a conversion unconditionally, same as before.
    const gate = rd.conversionAgeGate != null ? `,conversionAgeGate:${num(rd.conversionAgeGate)}` : '';
    lines.push(
      `  ${code}: {single:${num(rd.single)},mfj:${num(rd.mfj)},mfs:${num(rd.mfs)},hoh:${num(rd.hoh)}${gate}},`
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
// NY tax on the full amount). Originally kept as a flat cap rather than reshaping to
// ageTieredCap/perPersonTiers, because NY's pensionIncome is NOT pooled with
// retirementIncome in relo-engine.mjs (unlike every other ageTieredCap state at the
// time), and relo-engine's non-pooled branch had no ageTieredCap support.
// NY reshaped to ageTieredCap 2026-08-24 (later same day): the flat cap turned out to
// have its OWN live bug — gated only on the primary filer's own age, so a joint return
// where just the spouse qualified got ZERO shelter, and where just the primary
// qualified, wrongly got the FULL $20,000 (should be $20k per person, $40k combined,
// confirmed: "one spouse can't claim the other spouse's unused exclusion"). Fixed by
// building ageTieredCap support into relo-engine.mjs's NON-POOLED branch (the missing
// piece flagged above) and giving Roth a dedicated stateCode==='NY' branch (shared with
// AL below) that applies the per-person-summed cap to the conversion alone, since
// pensionIncome still doesn't compete for it.
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
// for the $6,000 IRA-only cap at all. Initially kept cliffType:"hard" (the non-pooled
// Relocation branch didn't support ageTieredCap yet) with a dedicated stateCode==='AL'
// Roth branch applying the flat cap to the conversion alone.
// AL reshaped to ageTieredCap 2026-08-24 (later same day), same fix and same reason as NY
// above: the flat cap gated only on the primary filer's own age, so a mixed-age joint
// return got the wrong shelter either way (zero if the qualifying spouse wasn't the
// primary, or the full two-person amount if only the primary qualified). Now shares the
// same stateCode==='AL' || stateCode==='NY' branch in Roth (see roth-conversion/index.html),
// applying a per-person-summed ageTieredCap to the conversion alone in both cases.
// WV reshaped to ageTieredCap 2026-08-24, same reason: its $8k/$16k netAgainstSS cap was
// also flat and gated on the primary filer's own age only. Unlike AL/NY, WV's pensionIncome
// IS pooled, so this was a pure reclassification into the existing pooled ageTieredCap
// branch — but that branch had no netAgainstSS handling yet (only the flat-cap branch did),
// so netAgainstSS support was added to both engines' ageTieredCap branches too.
export const RIX_STATES = ['GA', 'LA', 'SC', 'VA', 'WI', 'NM', 'CT', 'NJ', 'WV', 'NY', 'CO', 'AR', 'DE', 'KY', 'OK', 'AL'];
const RIX_OPEN = 'const RIX={';
const RIX_CLOSE = '};';

// Shape changed 2026-08-24: each entry used to be JUST the retirementIncome object
// (all rixExcluded() ever needed). Now emits the fuller {retirementIncome,
// pensionIncome, socialSecurity} triple, because core/retirement-rules.js's shared
// resolveRetirementIncome() — which computeConversionCost() now calls directly,
// replacing rixExcluded() and the dedicated CT/AL/NY branches — needs
// pensionIncome.sameAs to resolve pooling and (for CO only) socialSecurity's
// sharesCapWithSS-adjacent fields. Relocation already has this full shape via its own
// taxRules; Roth's RIX table didn't, since rixExcluded() never needed it.
function buildRixBlock(json) {
  const lines = [];
  lines.push(RIX_OPEN);
  for (const code of RIX_STATES) {
    const tr = json[code]?.taxRules;
    if (!tr?.retirementIncome) throw new Error(`states.json: ${code} has no taxRules.retirementIncome for RIX`);
    const entry = { retirementIncome: tr.retirementIncome, pensionIncome: tr.pensionIncome, socialSecurity: tr.socialSecurity };
    lines.push(`  ${code}: ${JSON.stringify(entry)},`);
  }
  lines.push(RIX_CLOSE);
  return lines.join('\n');
}

// NYCTAX: a fourth sparse table — New York City's and Yonkers' local income tax
// (see states.json _schema.fields["localTax"]). Different in KIND from
// RETDED/EXAGE/RIX (a city tax layered ON TOP of state tax, not a deduction/
// exemption/exclusion) and different from Maryland/Indiana's flat, unconditional
// county tax (inline literal constants inside computeConversionCost's
// stateCode==='MD'/'IN' branches, since every resident of those states pays it):
// NYC's schedule is a genuinely graduated 4-tier ladder per filing status (too much
// to inline as a literal), and — critically — NYC/Yonkers only apply to residents of
// those two SPECIFIC jurisdictions, not every NY resident, so this is opt-in via a
// wizard selector rather than baked unconditionally into roth.cr the way MD/IN are.
// NY-only as of 2026-08-25 (the largest verified US local tax reaching retirement
// income; most other states' local taxes are wage-only or don't reach retirement
// income at all — see the 2026-08-25 audit notes).
const NYC_OPEN = 'const NYCTAX={';
const NYC_CLOSE = '};';

function buildNycTaxBlock(json) {
  const lt = json.NY?.localTax;
  if (!lt?.nyc || !lt?.yonkers) throw new Error('states.json: NY has no localTax.{nyc,yonkers} for NYCTAX');
  const lines = [];
  lines.push(NYC_OPEN);
  lines.push(`  nyc: ${JSON.stringify(lt.nyc.bracketsByStatus)},`);
  lines.push(`  yonkersRate: ${num(lt.yonkers.rate)},`);
  lines.push(NYC_CLOSE);
  return lines.join('\n');
}

// ORTAX: a fifth sparse table — Portland Metro's Supportive Housing Services tax and
// Multnomah County's Preschool For All tax (see states.json _schema.fields
// ["localTax"]). A separate table from NYCTAX rather than a rename/merge into
// a state-neutral shape — pure addition, zero risk to the already-shipped and
// twice-adversarially-reviewed NYC/Yonkers code, and matches this file's own
// precedent of one sparse table per genuinely different shape (RETDED/EXAGE/RIX are
// already 3 separate tables, not one unified one). Genuinely different from NY's
// shape in one important way: Metro and Multnomah are NOT mutually exclusive (NYC
// vs Yonkers are) — Multnomah County is a SUBSET of Metro's 3-county district, so a
// Multnomah resident owes BOTH taxes stacked, while a Washington/Clackamas County
// resident inside Metro owes only Metro's. Both tables are ordinary {rate,upTo}
// ladders with a deliberate rate:0 leading tier below their threshold — the
// mechanism that lets a flat-above-a-threshold tax reuse the same generic
// bracketTax() walker NYC uses, rather than needing new bracket-walking logic.
const OR_OPEN = 'const ORTAX={';
const OR_CLOSE = '};';

function buildOrTaxBlock(json) {
  const lt = json.OR?.localTax;
  if (!lt?.metro || !lt?.multnomah) throw new Error('states.json: OR has no localTax.{metro,multnomah} for ORTAX');
  const lines = [];
  lines.push(OR_OPEN);
  lines.push(`  metro: ${JSON.stringify(lt.metro.bracketsByStatus)},`);
  lines.push(`  multnomah: ${JSON.stringify(lt.multnomah.bracketsByStatus)},`);
  lines.push(OR_CLOSE);
  return lines.join('\n');
}

// COUNTYTAX: a sixth sparse table — Maryland's and Indiana's MANDATORY, unconditional
// county income tax (see states.json _schema.fields["localTax"]). Genuinely different
// shape from NYCTAX/ORTAX: a single flat rate per state (localTax.county.rate), not a
// bracket ladder, and every resident of MD/IN pays it (no wizard selector, unlike NY/
// OR's opt-in localTax). Previously these two rates existed ONLY as hardcoded JS
// literals (MD_COUNTY_RATE, IN_COUNTY_RATE) inside computeConversionCost, with zero
// guard coverage — states.json now has the real, guard-validated source of truth, and
// this table lets Roth read from it instead of hand-maintained magic numbers. Uses the
// SAME multi-line-placeholder convention as NYCTAX/ORTAX above (never a one-liner) —
// splice()'s "\n};" search would otherwise silently match a later, unrelated block.
const CT_OPEN = 'const COUNTYTAX={';
const CT_CLOSE = '};';

function buildCountyTaxBlock(json) {
  const lines = [CT_OPEN];
  for (const code of ['MD', 'IN']) {
    const rate = json[code]?.localTax?.county?.rate;
    if (rate == null) throw new Error(`states.json: ${code} has no localTax.county.rate for COUNTYTAX`);
    lines.push(`  ${code}: ${num(rate)},`);
  }
  lines.push(CT_CLOSE);
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
const nycBlock = buildNycTaxBlock(json);
const orBlock = buildOrTaxBlock(json);
const ctBlock = buildCountyTaxBlock(json);
const withSt = splice(html, block, OPEN, CLOSE);
const withRd = splice(withSt, rdBlock, RD_OPEN, RD_CLOSE);
const withEa = splice(withRd, eaBlock, EA_OPEN, EA_CLOSE);
const withRix = splice(withEa, rixBlock, RIX_OPEN, RIX_CLOSE);
const withNyc = splice(withRix, nycBlock, NYC_OPEN, NYC_CLOSE);
const withOr = splice(withNyc, orBlock, OR_OPEN, OR_CLOSE);
const next = splice(withOr, ctBlock, CT_OPEN, CT_CLOSE);

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
