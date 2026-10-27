// check-states-json.mjs — the extraction guard.
//
// Proves that states.json is a faithful, lossless restructuring of the audited
// ST table in roth-conversion/index.html. Run by `npm run verify` so a drift can
// never pass the harness. Exits non-zero (and prints what diverged) on any mismatch.
//
// Checks:
//   1. The HTML table parses to exactly 50 states + DC (51 real entries).
//   2. states.json has exactly the same 51 state codes — none missing, none extra.
//   3. For every state, the roth block (cr, ex, note) in states.json is byte-for-byte
//      identical to the parsed HTML. This is the anti-drift guarantee.
//   4. Every state has a facts.name that matches the HTML name.
//
// It does NOT check the facts brackets against anything (those are new data with no
// HTML counterpart); their correctness is a separate, source-based review.

import { readFileSync } from 'node:fs';
import { parseStatesFromHtml } from './parse-states.mjs';

const htmlPath = new URL('../roth-conversion/index.html', import.meta.url);
const jsonPath = new URL('../roth-conversion/states.json', import.meta.url);

const fail = (msg) => { console.error(`STATES-JSON GUARD FAILED: ${msg}`); process.exit(1); };

// Reusable bracket-sanity: ordering, rate range, final-null shape. Returns array of
// problem strings (empty = valid). `label` identifies which schedule for error messages.
const bracketProblems = (arr, code, label) => {
  const out = [];
  if (!Array.isArray(arr) || arr.length === 0) {
    out.push(`${code}: ${label} must be a non-empty array`);
    return out;
  }
  let prevUpTo = -Infinity;
  arr.forEach((row, i) => {
    if (typeof row.rate !== 'number' || row.rate < 0 || row.rate > 0.15) {
      out.push(`${code}: ${label}[${i}] rate ${row.rate} out of range 0-0.15`);
    }
    const isLast = i === arr.length - 1;
    if (isLast) {
      if (row.upTo !== null) out.push(`${code}: ${label} final bracket upTo must be null`);
    } else if (typeof row.upTo !== 'number') {
      out.push(`${code}: ${label}[${i}] upTo must be a number`);
    } else if (row.upTo <= prevUpTo) {
      out.push(`${code}: ${label}[${i}] upTo ${row.upTo} not strictly ascending`);
    } else {
      prevUpTo = row.upTo;
    }
  });
  return out;
};

// --- 1. Parse the live HTML table ---
let parsed;
try { parsed = parseStatesFromHtml(htmlPath); }
catch (e) { fail(`could not parse HTML table: ${e.message}`); }

const htmlCodes = Object.keys(parsed).filter((k) => k !== '').sort();
if (htmlCodes.length !== 51) {
  fail(`HTML table has ${htmlCodes.length} real entries; expected 51 (50 states + DC).`);
}

// --- 2. Load states.json and compare the code sets ---
let json;
try { json = JSON.parse(readFileSync(jsonPath, 'utf8')); }
catch (e) { fail(`could not read/parse states.json: ${e.message}`); }

const jsonCodes = Object.keys(json).filter((k) => k !== '_schema').sort();
const missing = htmlCodes.filter((c) => !jsonCodes.includes(c));
const extra = jsonCodes.filter((c) => !htmlCodes.includes(c));
if (missing.length) fail(`states.json is missing: ${missing.join(', ')}`);
if (extra.length) fail(`states.json has unexpected codes: ${extra.join(', ')}`);

// --- 3 & 4. Per-state field-level comparison ---
const diffs = [];
for (const code of htmlCodes) {
  const h = parsed[code];
  const j = json[code];
  if (!j.roth) { diffs.push(`${code}: missing roth block`); continue; }
  if (!j.facts || j.facts.name !== h.n) {
    diffs.push(`${code}: facts.name "${j.facts?.name}" != HTML "${h.n}"`);
  }
  if (j.roth.cr !== h.cr) diffs.push(`${code}: cr ${j.roth.cr} != HTML ${h.cr}`);
  if (j.roth.ex !== h.ex) diffs.push(`${code}: ex ${j.roth.ex} != HTML ${h.ex}`);
  if (j.roth.note !== h.note) diffs.push(`${code}: note differs from HTML`);

  // --- Bracket sanity (only for states whose brackets have been transcribed) ---
  // These are internal-consistency checks; they CANNOT verify a threshold was copied
  // correctly from the source (no external reference), but they catch transposition,
  // bad ordering, out-of-range rates, malformed entries, and — importantly — a roth.cr
  // that doesn't correspond to any bracket (the two layers silently disagreeing).
  const b = j.facts?.brackets;
  if (b !== undefined) {
    if (!Array.isArray(b) || b.length === 0) {
      diffs.push(`${code}: facts.brackets must be a non-empty array when present`);
    } else {
      let prevUpTo = -Infinity;
      const rates = [];
      b.forEach((row, i) => {
        if (typeof row.rate !== 'number' || row.rate < 0 || row.rate > 0.15) {
          diffs.push(`${code}: bracket[${i}] rate ${row.rate} out of range 0-0.15`);
        }
        rates.push(row.rate);
        // upTo is a number for all but the final (open-ended) bracket, which uses null.
        const isLast = i === b.length - 1;
        if (isLast) {
          if (row.upTo !== null) diffs.push(`${code}: final bracket upTo must be null (open-ended)`);
        } else {
          if (typeof row.upTo !== 'number') {
            diffs.push(`${code}: bracket[${i}] upTo must be a number`);
          } else if (row.upTo <= prevUpTo) {
            diffs.push(`${code}: bracket[${i}] upTo ${row.upTo} not strictly ascending`);
          } else {
            prevUpTo = row.upTo;
          }
        }
      });
      // Cross-layer: the representative roth.cr should be one of the bracket rates,
      // so the interpretation layer can't drift from the facts it's meant to derive from.
      if (rates.length && !rates.some((r) => Math.abs(r - j.roth.cr) < 1e-9)) {
        diffs.push(`${code}: roth.cr ${j.roth.cr} is not among facts.brackets rates [${rates.join(', ')}]`);
      }
    }
  }
}

// --- 5. Relocation layer (G1-G4) — only runs once taxRules is present (post-merge). ---
// Pre-merge these are no-ops, so the guard stays green throughout the transition.
let reloStates = 0;
for (const code of htmlCodes) {
  const j = json[code];
  if (!j.taxRules) continue; // not yet merged — skip
  reloStates++;
  const tr = j.taxRules;

  // G1 — structure: all four filing-status schedules present and internally valid.
  const bbs = tr.bracketsByStatus;
  if (!bbs || typeof bbs !== 'object') {
    diffs.push(`${code}: taxRules.bracketsByStatus missing`);
  } else {
    for (const status of ['single', 'mfj', 'mfs', 'hoh']) {
      if (!(status in bbs)) {
        diffs.push(`${code}: bracketsByStatus.${status} missing`);
      } else {
        diffs.push(...bracketProblems(bbs[status], code, `bracketsByStatus.${status}`));
      }
    }
  }

  // G2 — THE INVARIANT: facts.brackets must deep-equal bracketsByStatus.single.
  // facts.brackets is the human-readable copy; both tools compute from
  // bracketsByStatus, so the two must never diverge.
  if (bbs && bbs.single) {
    if (JSON.stringify(j.facts.brackets) !== JSON.stringify(bbs.single)) {
      diffs.push(`${code}: facts.brackets != bracketsByStatus.single (invariant broken)`);
    }
  }

  // G3 — taxContext presence/type (light — not value verification).
  const tc = j.taxContext;
  if (!tc || typeof tc !== 'object') {
    diffs.push(`${code}: taxContext missing`);
  } else {
    if (typeof tc.salesTaxRate !== 'number') diffs.push(`${code}: taxContext.salesTaxRate must be a number`);
    if (typeof tc.propertyTaxRateMedian !== 'number') diffs.push(`${code}: taxContext.propertyTaxRateMedian must be a number`);
    if (!tc.estateTax || typeof tc.estateTax.has !== 'boolean') diffs.push(`${code}: taxContext.estateTax.has must be a boolean`);
  }

  // G4 — status sanity: mfj thresholds never NARROWER than single (mfj >= single at each
  // index). Catches a stale/swapped status. Equality allowed (flat/no-tax states).
  // ONLY meaningful when the two schedules share the same structure (same length) — some
  // states (e.g. NJ: single=7 brackets, mfj=8) have genuinely different-shaped schedules,
  // where a positional index comparison is meaningless. Skip the check in that case.
  if (bbs && Array.isArray(bbs.single) && Array.isArray(bbs.mfj) &&
      bbs.single.length === bbs.mfj.length && j.facts.incomeTax !== false) {
    for (let i = 0; i < bbs.single.length - 1; i++) { // skip final open-ended bracket
      const s = bbs.single[i].upTo, m = bbs.mfj[i].upTo;
      if (typeof s === 'number' && typeof m === 'number' && m < s) {
        diffs.push(`${code}: bracketsByStatus.mfj[${i}] upTo ${m} < single ${s} (mfj should not be narrower)`);
      }
    }
  }
}

// --- 6. Roth conversion rules vs the state engine (G5) ---
// Rewritten 2026-10-25 (fix-pack 12). The Roth tool now figures state tax with the
// Relocation engine from taxRules, so the old guard (every real exclusion had to be on a
// hand-kept RIX/RETDED allowlist or the Roth tool silently ignored it) is moot: every state
// goes through the engine. What can still drift is the Roth layer's own conversion rules
// against the engine's data, so they must agree:
//  - roth.ex:true means IRA withdrawals are exempt, at least from some age: taxRules must say
//    exempt or ageExempt (the engine's retirement rate is then 0 where the page says so), and
//    roth.exMinAge, when set, must equal that age gate.
//  - roth.ex:false states must not be exempt in taxRules (the page would call a taxed
//    conversion of exempt income a cost it isn't).
//  - roth.retDeduction (Michigan) caps, shown in the state breakdown, must equal the
//    engine's exclusion caps; conversionAgeGate must be a plausible age.
//  - roth.conversionAsOtherIncome must be true when present.
for (const code of htmlCodes) {
  const r = json[code]?.roth;
  const ri = json[code]?.taxRules?.retirementIncome;
  if (!r || !ri) continue;
  if (r.ex === true) {
    if (!['exempt', 'ageExempt'].includes(ri.treatment)) {
      diffs.push(`${code}: roth.ex is true but taxRules.retirementIncome.treatment is "${ri.treatment}" (need exempt or ageExempt)`);
    }
    if (r.exMinAge != null && ri.ageGate !== r.exMinAge) {
      diffs.push(`${code}: roth.exMinAge ${r.exMinAge} differs from taxRules.retirementIncome.ageGate ${ri.ageGate}`);
    }
  } else if (ri.treatment === 'exempt') {
    diffs.push(`${code}: taxRules exempts retirement income but roth.ex is false`);
  }
  if (r.retDeduction) {
    const rd = r.retDeduction, ex = ri.exclusion;
    const ok = ri.treatment === 'exclusion' && ex && ex.capSingle === rd.single && ex.capJoint === rd.mfj
      && rd.mfs === rd.single && rd.hoh === rd.single;
    if (!ok) diffs.push(`${code}: roth.retDeduction caps ${JSON.stringify(rd)} differ from taxRules.retirementIncome.exclusion caps (${ex?.capSingle} / ${ex?.capJoint})`);
    if (rd.conversionAgeGate != null && !(rd.conversionAgeGate >= 50 && rd.conversionAgeGate <= 75)) {
      diffs.push(`${code}: roth.retDeduction.conversionAgeGate ${rd.conversionAgeGate} is not a plausible age`);
    }
  }
  if ('conversionAsOtherIncome' in r && r.conversionAsOtherIncome !== true) {
    diffs.push(`${code}: roth.conversionAsOtherIncome must be true when present (omit it otherwise)`);
  }
}

// --- 7. Local-tax shape guard (G6) ---
// Added 2026-08-25 for NY (NYC/Yonkers), extended 2026-08-25 for OR (Metro/
// Multnomah). Every state's localTax is hand-authored JSON, so a typo here (a gap in
// the bracket ladder, a missing filing status, an implausible rate) would silently
// corrupt every affected conversion's tax — catch it at build time instead of live.
// Moved 2026-08-27 from roth.localTax to a top-level localTax key, shared by both
// Roth (gen-st-table.mjs) and Relocation (gen-relo-data.mjs) — previously nested
// under roth, invisible to Relocation's data generator entirely.
//
// checkBracketLadder validates ONE {rate,upTo}[] tier list: strictly ascending,
// gapless, null-terminated, each rate a plausible decimal. The leading tier of a
// threshold-gated tax (Metro SHS, Multnomah PFA — flat-above-a-threshold, modeled
// as an ordinary bracket ladder with a deliberate rate:0 first tier so it can reuse
// the same generic bracketTax() walker NYC uses) is the ONE place rate:0 is valid
// and expected — allowLeadingZero exists specifically for that shape. NYC's own
// ladder has no zero-rate tier (it taxes from dollar one), so callers for NY pass
// allowLeadingZero:false and get the original, stricter check unchanged.
function checkBracketLadder(label, tiers, { allowLeadingZero = false } = {}) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    diffs.push(`${label} is missing or empty`);
    return;
  }
  let lo = 0;
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const isLast = i === tiers.length - 1;
    const rateOk = typeof t.rate === 'number' && t.rate < 1
      && (allowLeadingZero && i === 0 ? t.rate >= 0 : t.rate > 0);
    if (!rateOk) {
      diffs.push(`${label}[${i}].rate is not a plausible decimal rate: ${t.rate}`);
    }
    if (isLast) {
      if (t.upTo !== null) diffs.push(`${label}: final tier must have upTo:null (open-ended)`);
    } else {
      if (typeof t.upTo !== 'number' || t.upTo <= lo) {
        diffs.push(`${label}[${i}].upTo must strictly ascend from the prior tier (gapless, no overlap): got ${t.upTo}, prior floor ${lo}`);
      }
      lo = t.upTo;
    }
  }
}

const LOCAL_TAX_STATUSES = ['single', 'mfj', 'mfs', 'hoh'];

{
  // NY: NYC (graduated from dollar one, no zero-rate tier) + Yonkers (a flat
  // surcharge on state tax, not a bracket ladder at all).
  const lt = json.NY?.localTax;
  if (lt) {
    const brax = lt.nyc?.bracketsByStatus;
    if (!brax) {
      diffs.push('NY.localTax.nyc.bracketsByStatus is missing');
    } else {
      for (const status of LOCAL_TAX_STATUSES) {
        checkBracketLadder(`NY.localTax.nyc.bracketsByStatus.${status}`, brax[status]);
      }
    }
    if (typeof lt.yonkers?.rate !== 'number' || lt.yonkers.rate <= 0 || lt.yonkers.rate >= 1) {
      diffs.push(`NY.localTax.yonkers.rate is not a plausible decimal rate (0,1): ${lt.yonkers?.rate}`);
    }
  }
  if (json.NY?.roth?.localTax) {
    diffs.push('NY.roth.localTax is deprecated (moved to top-level localTax) — remove the stale copy');
  }
}

{
  // OR: Metro SHS + Multnomah PFA, both threshold-gated (flat/stepped above a
  // dollar threshold), modeled with a deliberate rate:0 leading tier -- see
  // checkBracketLadder's own comment for why that's valid here specifically.
  const lt = json.OR?.localTax;
  if (lt) {
    for (const key of ['metro', 'multnomah']) {
      const brax = lt[key]?.bracketsByStatus;
      if (!brax) {
        diffs.push(`OR.localTax.${key}.bracketsByStatus is missing`);
        continue;
      }
      for (const status of LOCAL_TAX_STATUSES) {
        checkBracketLadder(`OR.localTax.${key}.bracketsByStatus.${status}`, brax[status], { allowLeadingZero: true });
      }
    }
  }
  if (json.OR?.roth?.localTax) {
    diffs.push('OR.roth.localTax is deprecated (moved to top-level localTax) — remove the stale copy');
  }
}

{
  // MD/IN: a single flat, mandatory county rate (not a bracket ladder) — every
  // resident pays it, no wizard selector. Both tools read this same field through the
  // engine (relocation/relo-engine.mjs).
  for (const code of ['MD', 'IN']) {
    const rate = json[code]?.localTax?.county?.rate;
    if (rate != null && (typeof rate !== 'number' || rate <= 0 || rate >= 1)) {
      diffs.push(`${code}.localTax.county.rate is not a plausible decimal rate (0,1): ${rate}`);
    }
  }
}

// --- 8. Social Security and capital gains rule shapes (G7) ---
// Added 2026-10-21. relocation/relo-engine.mjs throws on a Social Security phase-out
// type or a capital gains treatment it doesn't know (a silent fallback would quietly
// drop income), so catch a typo or an unsupported shape here, at build time, rather
// than as a broken Relocation page.
for (const code of htmlCodes) {
  const tr = json[code]?.taxRules;
  if (!tr) continue;
  const ss = tr.socialSecurity;
  if (!ss || typeof ss.taxed !== 'boolean') {
    diffs.push(`${code}: taxRules.socialSecurity.taxed must be a boolean`);
  } else if (ss.taxed && !ss.sharesRetirementCap && !ss.followsFederalFormula) {
    const ex = ss.exemptBelowAGI;
    if (!ex || typeof ex.single !== 'number' || typeof ex.joint !== 'number') {
      diffs.push(`${code}: socialSecurity.exemptBelowAGI needs numeric single and joint thresholds`);
    }
    if ('phaseInAboveAGI' in ss) {
      diffs.push(`${code}: socialSecurity.phaseInAboveAGI is no longer read by the engine — describe the phase-out with socialSecurity.phaseOut`);
    }
    const po = ss.phaseOut;
    if (po != null) {
      if (po.type === 'linear') {
        if (!(po.width > 0)) diffs.push(`${code}: socialSecurity.phaseOut (linear) needs a positive width`);
      } else if (po.type === 'stepped') {
        if (!(po.step > 0) || !(po.pctPerStep > 0 && po.pctPerStep <= 1)) diffs.push(`${code}: socialSecurity.phaseOut (stepped) needs step > 0 and 0 < pctPerStep <= 1`);
      } else if (po.type === 'creditReduction') {
        if (!(po.perDollar > 0)) diffs.push(`${code}: socialSecurity.phaseOut (creditReduction) needs perDollar > 0`);
        const flat = ['single', 'mfj', 'mfs', 'hoh'].every((s) => tr.bracketsByStatus?.[s]?.length === 1);
        if (!flat) diffs.push(`${code}: socialSecurity.phaseOut (creditReduction) is only defined for a flat-rate state`);
      } else {
        diffs.push(`${code}: socialSecurity.phaseOut.type "${po.type}" is not one the engine knows (linear | stepped | creditReduction)`);
      }
    }
  }

  const cg = tr.capitalGains;
  const t = cg?.treatment;
  if (t === 'ordinary') {
    // nothing else to check
  } else if (t === 'excludedPct') {
    if (!(cg.exclusionPct >= 0 && cg.exclusionPct <= 1)) diffs.push(`${code}: capitalGains.exclusionPct must be between 0 and 1`);
    if (cg.minDeduction != null && !(cg.minDeduction >= 0)) diffs.push(`${code}: capitalGains.minDeduction must be >= 0 when present`);
    if (cg.maxGainEligible != null && !(cg.maxGainEligible > 0)) diffs.push(`${code}: capitalGains.maxGainEligible must be > 0 when present`);
    if (cg.sourceRestricted != null && typeof cg.sourceRestricted !== 'boolean') diffs.push(`${code}: capitalGains.sourceRestricted must be a boolean when present`);
  } else if (t === 'separateTax') {
    if (!(cg.exemptBelow >= 0)) diffs.push(`${code}: capitalGains.exemptBelow must be >= 0`);
    checkBracketLadder(`${code}.taxRules.capitalGains.ladder`, cg.ladder);
  } else if (t === 'stacked') {
    for (const status of LOCAL_TAX_STATUSES) {
      checkBracketLadder(`${code}.taxRules.capitalGains.ladderByStatus.${status}`, cg.ladderByStatus?.[status]);
    }
  } else {
    diffs.push(`${code}: capitalGains.treatment "${t}" is not one the engine knows (ordinary | excludedPct | separateTax | stacked)`);
  }
}

// --- 9. Standard deduction shape guard (G8) ---
// Added 2026-10-21; rewritten 2026-10-22 for the phase-outs, separate exemptions, the
// federal senior deduction and the credit extras; extended 2026-10-22 (fix-pack 11) for the
// steps and rate phase-outs, amount bands, the federal tax subtraction and the credits list.
// Validates the optional taxRules.standardDeduction field strictly: every key must be one the
// engine reads (a misspelled key would otherwise be silently ignored and the deduction
// dropped), amounts by filing status need all four statuses, and each phase-out and credit
// must be a shape relo-engine.mjs knows (it throws on any other).
const SD_KEYS = ['deduction', 'age65AddOn', 'phaseOut', 'exemption', 'federalSeniorDeduction',
  'federalTaxDeduction', 'exemptionCredit', 'credits'];
const DEDUCTION_BASES = ['federalAGI', 'stateAGI'];
// Credits are figured after the brackets, so they may also test the state's taxable income and
// the retirement income left in state AGI (OH).
const CREDIT_BASES = [...DEDUCTION_BASES, 'stateTaxableIncome', 'retirementIncome'];
const isAmount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isShare = (v) => isAmount(v) && v <= 1;
function checkKeys(where, obj, allowed) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) diffs.push(`${where}: unknown key "${k}" (allowed: ${allowed.join(', ')})`);
}
function checkByStatus(where, obj, test, what) {
  if (!obj || typeof obj !== 'object') { diffs.push(`${where} must be an object by filing status`); return; }
  checkKeys(where, obj, LOCAL_TAX_STATUSES);
  for (const s of LOCAL_TAX_STATUSES) if (!test(obj[s])) diffs.push(`${where}.${s} must be ${what}`);
}
// A band list: thresholds `over` or `atLeast` (exactly one per band), strictly rising, each band
// with exactly one value key from `valueKeys`; `trend` 'falling' or 'rising' for the values.
function isBandList(list, valueKeys, valueTest, trend) {
  if (!Array.isArray(list) || list.length === 0) return false;
  let prevAt = -Infinity, prevValue = null;
  for (const b of list) {
    if (!b || typeof b !== 'object') return false;
    const thresholds = ['over', 'atLeast'].filter((k) => k in b);
    const values = valueKeys.filter((k) => k in b);
    if (thresholds.length !== 1 || values.length !== 1 || Object.keys(b).length !== 2) return false;
    const at = b[thresholds[0]], value = b[values[0]];
    if (!isAmount(at) || !valueTest(value) || at <= prevAt) return false;
    // amount and factor bands can't be compared to each other
    if (prevValue !== null && prevValue.key === values[0]
      && (trend === 'falling' ? value > prevValue.v : value < prevValue.v)) return false;
    prevAt = at; prevValue = { key: values[0], v: value };
  }
  return true;
}
function checkPhaseOut(where, po, bases = DEDUCTION_BASES) {
  if (!po || typeof po !== 'object') { diffs.push(`${where} must be an object`); return; }
  if (!bases.includes(po.basis)) diffs.push(`${where}.basis must be one of ${bases.join(', ')}`);
  if (po.type === 'linear') {
    checkKeys(where, po, ['type', 'basis', 'start', 'width']);
    checkByStatus(`${where}.start`, po.start, isAmount, 'a non-negative number');
    checkByStatus(`${where}.width`, po.width, (v) => isAmount(v) && v > 0, 'a positive number');
  } else if (po.type === 'bands') {
    checkKeys(where, po, ['type', 'basis', 'bands']);
    checkByStatus(`${where}.bands`, po.bands,
      (list) => isBandList(list, ['factor', 'amount'], (v) => isAmount(v), 'falling')
        && list.every((b) => !('factor' in b) || isShare(b.factor)),
      'a non-empty list of {over | atLeast, factor in [0, 1] | amount} with rising thresholds and falling values');
  } else if (po.type === 'steps') {
    checkKeys(where, po, ['type', 'basis', 'start', 'step', 'perStep', 'floor']);
    checkByStatus(`${where}.start`, po.start, isAmount, 'a non-negative number');
    checkByStatus(`${where}.step`, po.step, (v) => isAmount(v) && v > 0, 'a positive number');
    checkByStatus(`${where}.perStep`, po.perStep, (v) => isAmount(v) && v > 0, 'a positive number');
    if ('floor' in po) checkByStatus(`${where}.floor`, po.floor, isAmount, 'a non-negative number');
  } else if (po.type === 'rate') {
    checkKeys(where, po, ['type', 'basis', 'rules']);
    checkByStatus(`${where}.rules`, po.rules, (list) => Array.isArray(list) && list.length > 0
      && list.every((r) => r && isAmount(r.start) && r.rate > 0 && r.rate <= 1 && (!('amount' in r) || isAmount(r.amount))
        && Object.keys(r).every((k) => ['start', 'rate', 'amount'].includes(k))),
      'a non-empty list of {start, rate in (0, 1], amount?}');
  } else {
    diffs.push(`${where}.type "${po.type}" is not one the engine knows (linear | bands | steps | rate)`);
  }
}
function checkAgeAddOn(where, a) {
  if (!a || typeof a !== 'object') { diffs.push(`${where} must be an object`); return; }
  checkKeys(where, a, ['unmarried', 'married']);
  if (!isAmount(a.unmarried) || !isAmount(a.married)) diffs.push(`${where} needs non-negative unmarried and married amounts`);
}
function checkCredit(where, c) {
  if (!c || typeof c !== 'object') { diffs.push(`${where} must be an object`); return; }
  if (c.type === 'percentOfTax') {
    checkKeys(where, c, ['type', 'basis', 'bands']);
    if (!CREDIT_BASES.includes(c.basis)) diffs.push(`${where}.basis must be one of ${CREDIT_BASES.join(', ')}`);
    checkByStatus(`${where}.bands`, c.bands, (list) => isBandList(list, ['rate'], isShare, 'falling'),
      'a non-empty list of {over | atLeast, rate in [0, 1]} with rising thresholds and falling rates');
  } else if (c.type === 'ofDeduction') {
    checkKeys(where, c, ['type', 'rate', 'deduction', 'age65AddOn', 'phaseOut']);
    if (!(c.rate > 0 && c.rate <= 1)) diffs.push(`${where}.rate must be in (0, 1]`);
    checkByStatus(`${where}.deduction`, c.deduction, isAmount, 'a non-negative number');
    if ('age65AddOn' in c) checkAgeAddOn(`${where}.age65AddOn`, c.age65AddOn);
  } else if (c.type === 'flat') {
    checkKeys(where, c, ['type', 'amount', 'per', 'age', 'phaseOut']);
    if (!isAmount(c.amount)) diffs.push(`${where}.amount must be a non-negative number`);
    if (!['person', 'return'].includes(c.per)) diffs.push(`${where}.per must be "person" or "return"`);
    if ('age' in c && !(c.age >= 50 && c.age <= 100)) diffs.push(`${where}.age must be between 50 and 100`);
  } else if (c.type === 'schedule') {
    checkKeys(where, c, ['type', 'basis', 'bands', 'phaseOut']);
    if (!CREDIT_BASES.includes(c.basis)) diffs.push(`${where}.basis must be one of ${CREDIT_BASES.join(', ')}`);
    checkByStatus(`${where}.bands`, c.bands, (list) => isBandList(list, ['amount'], isAmount, 'rising'),
      'a non-empty list of {over | atLeast, amount} with rising thresholds and amounts');
  } else {
    diffs.push(`${where}.type "${c.type}" is not one the engine knows (percentOfTax | ofDeduction | flat | schedule)`);
    return;
  }
  if ('phaseOut' in c) checkPhaseOut(`${where}.phaseOut`, c.phaseOut, CREDIT_BASES);
}
for (const code of htmlCodes) {
  const sd = json[code]?.taxRules?.standardDeduction;
  if (sd == null) continue; // optional: states without it get no deduction
  const at = `${code}: standardDeduction`;
  if (typeof sd !== 'object') { diffs.push(`${at} must be an object`); continue; }
  checkKeys(at, sd, SD_KEYS);
  if (!SD_KEYS.some((k) => k in sd)) diffs.push(`${at} is empty`);
  if ('deduction' in sd) checkByStatus(`${at}.deduction`, sd.deduction, isAmount, 'a non-negative number');
  if ('age65AddOn' in sd) checkAgeAddOn(`${at}.age65AddOn`, sd.age65AddOn);
  if ('phaseOut' in sd) checkPhaseOut(`${at}.phaseOut`, sd.phaseOut);
  if ('exemption' in sd) {
    const e = sd.exemption;
    if (!e || typeof e !== 'object') diffs.push(`${at}.exemption must be an object`);
    else {
      checkKeys(`${at}.exemption`, e, ['perPerson', 'hohExtra', 'age65Extra', 'phaseOut']);
      if (!isAmount(e.perPerson)) diffs.push(`${at}.exemption.perPerson must be a non-negative number`);
      for (const k of ['hohExtra', 'age65Extra']) if (k in e && !isAmount(e[k])) diffs.push(`${at}.exemption.${k} must be a non-negative number`);
      if ('phaseOut' in e) checkPhaseOut(`${at}.exemption.phaseOut`, e.phaseOut);
    }
  }
  if ('federalSeniorDeduction' in sd && sd.federalSeniorDeduction !== true) {
    diffs.push(`${at}.federalSeniorDeduction must be true when present (omit it otherwise)`);
  }
  if ('federalTaxDeduction' in sd) {
    const f = sd.federalTaxDeduction;
    if (!f || typeof f !== 'object') diffs.push(`${at}.federalTaxDeduction must be an object`);
    else {
      checkKeys(`${at}.federalTaxDeduction`, f, ['cap', 'capPhaseOut', 'share', 'includesNIIT']);
      if ('cap' in f) checkByStatus(`${at}.federalTaxDeduction.cap`, f.cap, isAmount, 'a non-negative number');
      if ('capPhaseOut' in f) {
        if (!('cap' in f)) diffs.push(`${at}.federalTaxDeduction.capPhaseOut needs a cap`);
        checkPhaseOut(`${at}.federalTaxDeduction.capPhaseOut`, f.capPhaseOut);
      }
      if ('share' in f) checkPhaseOut(`${at}.federalTaxDeduction.share`, f.share);
      if ('includesNIIT' in f && f.includesNIIT !== true) diffs.push(`${at}.federalTaxDeduction.includesNIIT must be true when present (omit it otherwise)`);
    }
  }
  if ('credits' in sd) {
    if (!Array.isArray(sd.credits) || sd.credits.length === 0) diffs.push(`${at}.credits must be a non-empty list`);
    else sd.credits.forEach((c, i) => checkCredit(`${at}.credits[${i}]`, c));
  }
  if ('exemptionCredit' in sd) {
    const c = sd.exemptionCredit;
    if (!c || typeof c !== 'object') diffs.push(`${at}.exemptionCredit must be an object`);
    else {
      checkKeys(`${at}.exemptionCredit`, c, ['perFiler', 'hohExtra', 'ageBonus', 'phaseOut']);
      if (!isAmount(c.perFiler)) diffs.push(`${at}.exemptionCredit.perFiler must be a non-negative number`);
      if ('hohExtra' in c && !isAmount(c.hohExtra)) diffs.push(`${at}.exemptionCredit.hohExtra must be a non-negative number`);
      if ('ageBonus' in c) {
        const b = c.ageBonus;
        if (!b || typeof b !== 'object' || !isAmount(b.amount) || !(b.age >= 50 && b.age <= 100)
          || !Object.keys(b).every((k) => k === 'age' || k === 'amount')) {
          diffs.push(`${at}.exemptionCredit.ageBonus must be {age, amount} with an age between 50 and 100`);
        }
      }
      if ('phaseOut' in c) checkPhaseOut(`${at}.exemptionCredit.phaseOut`, c.phaseOut);
    }
  }
}

// --- 10a. Government-only pension and IRA age-gate consistency (G10) ---
// pensionIncome.governmentOnly requires treatment:"exempt" (not sameAs) — it's only meaningful
// as a standalone exempt entry, not as a pointer to retirementIncome rules.
// retirementIncome.exclusion.iraAgeGate must equal roth.retDeduction.conversionAgeGate when
// both are present: the two fields encode the same statutory rule for two different callers
// (Relocation via iraAgeGate, Roth via conversionAgeGate) and must stay in sync.
for (const code of htmlCodes) {
  const st = json[code];
  const pi = st?.taxRules?.pensionIncome;
  if (pi?.governmentOnly) {
    if (pi.sameAs) diffs.push(`${code}: pensionIncome.governmentOnly=true but sameAs is also set (G10)`);
    if (pi.treatment !== 'exempt') diffs.push(`${code}: pensionIncome.governmentOnly=true but treatment is "${pi.treatment}", expected "exempt" (G10)`);
  }
  const riGate = st?.taxRules?.retirementIncome?.exclusion?.iraAgeGate;
  const rdGate = st?.roth?.retDeduction?.conversionAgeGate;
  if ((riGate != null) !== (rdGate != null)) {
    diffs.push(`${code}: iraAgeGate (${riGate ?? 'absent'}) and conversionAgeGate (${rdGate ?? 'absent'}) must both be present or both absent (G10)`);
  } else if (riGate != null && riGate !== rdGate) {
    diffs.push(`${code}: taxRules.retirementIncome.exclusion.iraAgeGate (${riGate}) !== roth.retDeduction.conversionAgeGate (${rdGate}) — must match (G10)`);
  }
}

// --- 10. Notes state the rule, not this calculator's history (G9) ---
// Added 2026-10-26 (fix-pack 13). roth.note is shown to anyone who picks the state, and
// remarks about what an earlier version of this calculator did ("previously applied none of
// this exclusion", "now fixed") only raise doubts. That history belongs in git.
const HISTORY = /\b(?:previously (?:applied|modeled|used|treated|showed|had)|now fixed|this (?:calculator|tool) (?:now|previously|used to)|(?:calculator|tool) now (?:applies|models|uses))\b/i;
for (const code of htmlCodes) {
  const m = (json[code]?.roth?.note || '').match(HISTORY);
  if (m) diffs.push(`${code}: roth.note reads as change history ("${m[0]}"); state the rule instead (G9)`);
}

if (diffs.length) {
  fail(`${diffs.length} field mismatch(es):\n  ` + diffs.join('\n  '));
}

const reloNote = reloStates ? `, relocation taxRules validated on ${reloStates} states (G1-G4, G7-G8)` : '';
console.log(`states.json guard OK: 51 states (50 + DC), roth blocks match HTML exactly, notes state rules not history (G9)${reloNote}.`);
