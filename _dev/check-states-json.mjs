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
import { RIX_STATES } from './gen-st-table.mjs';

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
  // This is the load-bearing guarantee: the Roth tool reads facts.brackets, relocation
  // reads bracketsByStatus; if they ever diverge, that is a data-integrity bug.
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

// --- 6. RIX/RETDED coverage guard (G5) ---
// Found live 2026-08-24, twice: a state can have fully correct, verified
// taxRules.retirementIncome data in states.json and still be SILENTLY unshelterd in the
// Roth calculator, because RIX_STATES (gen-st-table.mjs) or roth.retDeduction (RETDED)
// is a hand-maintained allowlist that's easy to forget updating (NY, CO, AR, DE, KY, OK
// all had this exact gap this session — some missing entirely, some with a wrong capJoint
// value too). This guard makes that omission a build failure instead of a silent runtime
// bug: any state whose retirementIncome data implies a REAL, appliable exclusion (a
// genuine "exclusion" or "offsetStack" treatment, not already self-excluded via
// excludesIRA:true, whose flat-cr/no-exclusion fallback would be WRONG rather than a
// coincidentally-correct simplification) must be covered by RETDED, RIX_STATES, or a
// documented Roth-side dedicated stateCode branch.
for (const code of htmlCodes) {
  const ri = json[code]?.taxRules?.retirementIncome;
  if (!ri) continue; // taxRules not yet merged for this state — skip, same as G1-G4
  const needsCoverage = ri.treatment === 'offsetStack'
    || (ri.treatment === 'exclusion' && ri.exclusion && !ri.exclusion.excludesIRA);
  if (!needsCoverage) continue;
  const covered = RIX_STATES.includes(code) || !!json[code]?.roth?.retDeduction;
  if (!covered) {
    diffs.push(`${code}: taxRules.retirementIncome implies a real exclusion the Roth calculator would silently apply as $0 (not in RETDED, not in RIX_STATES) — add to one, or add a documented dedicated stateCode branch and extend this guard's exception list`);
  }
}

// --- 7. Local-tax shape guard (G6) ---
// Added 2026-08-25 for NY (NYC/Yonkers), extended 2026-08-25 for OR (Metro/
// Multnomah). Every state's localTax is hand-authored JSON (unlike the RIX/
// RETDED tables above, which are derived from taxRules), so a typo here (a gap in
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
  // resident pays it, no wizard selector. Both Roth (COUNTYTAX, via
  // gen-st-table.mjs) and Relocation (computeLocalTax) read this same field.
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
// Added 2026-10-21. Validates the optional taxRules.standardDeduction field: the
// deduction sub-object must have numeric values per filing status (at least single);
// age65AddOn must have numeric single and joint; exemptionCredit must have numeric
// perFiler and optional age65Bonus. Catches typos and structural mismatches at build
// time rather than as silently-wrong tax computations.
for (const code of htmlCodes) {
  const sd = json[code]?.taxRules?.standardDeduction;
  if (!sd) continue; // field is optional — states without it are fine

  // deduction: must have at least single, all values numeric
  if (sd.deduction) {
    if (typeof sd.deduction !== 'object') {
      diffs.push(`${code}: standardDeduction.deduction must be an object`);
    } else {
      if (typeof sd.deduction.single !== 'number' || sd.deduction.single < 0) {
        diffs.push(`${code}: standardDeduction.deduction.single must be a non-negative number`);
      }
      for (const s of ['mfj', 'mfs', 'hoh']) {
        if (s in sd.deduction && typeof sd.deduction[s] !== 'number') {
          diffs.push(`${code}: standardDeduction.deduction.${s} must be a number when present`);
        }
      }
      // phaseout sub-object
      if (sd.deduction.phaseout) {
        const po = sd.deduction.phaseout;
        if (typeof po.threshold !== 'number' || po.threshold < 0) {
          diffs.push(`${code}: standardDeduction.deduction.phaseout.threshold must be a non-negative number`);
        }
        if (typeof po.rate !== 'number' || po.rate <= 0 || po.rate > 1) {
          diffs.push(`${code}: standardDeduction.deduction.phaseout.rate must be in (0, 1]`);
        }
      }
    }
  }

  // age65AddOn: single and joint must be numeric
  if (sd.age65AddOn) {
    if (typeof sd.age65AddOn !== 'object') {
      diffs.push(`${code}: standardDeduction.age65AddOn must be an object`);
    } else {
      if (typeof sd.age65AddOn.single !== 'number' || sd.age65AddOn.single < 0) {
        diffs.push(`${code}: standardDeduction.age65AddOn.single must be a non-negative number`);
      }
      if (typeof sd.age65AddOn.joint !== 'number' || sd.age65AddOn.joint < 0) {
        diffs.push(`${code}: standardDeduction.age65AddOn.joint must be a non-negative number`);
      }
    }
  }

  // exemptionCredit: perFiler must be numeric, age65Bonus optional
  if (sd.exemptionCredit) {
    if (typeof sd.exemptionCredit !== 'object') {
      diffs.push(`${code}: standardDeduction.exemptionCredit must be an object`);
    } else {
      if (typeof sd.exemptionCredit.perFiler !== 'number' || sd.exemptionCredit.perFiler < 0) {
        diffs.push(`${code}: standardDeduction.exemptionCredit.perFiler must be a non-negative number`);
      }
      if ('age65Bonus' in sd.exemptionCredit) {
        if (typeof sd.exemptionCredit.age65Bonus !== 'number' || sd.exemptionCredit.age65Bonus < 0) {
          diffs.push(`${code}: standardDeduction.exemptionCredit.age65Bonus must be a non-negative number when present`);
        }
      }
    }
  }

  // At least one of deduction, age65AddOn, or exemptionCredit must be present
  if (!sd.deduction && !sd.age65AddOn && !sd.exemptionCredit) {
    diffs.push(`${code}: standardDeduction exists but has no deduction, age65AddOn, or exemptionCredit — empty entry`);
  }
}

if (diffs.length) {
  fail(`${diffs.length} field mismatch(es):\n  ` + diffs.join('\n  '));
}

const reloNote = reloStates ? `, relocation taxRules validated on ${reloStates} states (G1-G4, G7-G8)` : '';
console.log(`states.json guard OK: 51 states (50 + DC), roth blocks match HTML exactly${reloNote}.`);
