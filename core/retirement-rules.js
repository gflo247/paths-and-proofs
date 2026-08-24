// core/retirement-rules.js — shared retirement-income-exclusion math for the Roth
// Conversion Calculator and the Relocation tool. Both read the SAME canonical
// taxRules.retirementIncome/pensionIncome shapes from roth-conversion/states.json
// (confirmed byte-identical JSON is fed to both via _dev/gen-st-table.mjs and
// _dev/gen-relo-data.mjs) but, before this module existed, independently re-implemented
// the EVALUATION of that data — six states in one 2026-08-24 session (CT, NM, MT, CO,
// RI, LA, then AL/AR/DE/KY/OK/WV/NY/MI) needed the same fix written twice, which is
// exactly the kind of drift this project's whole state-tax audit has been fighting.
// Extracted from relocation/relo-engine.mjs's computeStateIncomeTax(), which was the
// more complete of the two implementations (Roth's rixExcluded()/computeConversionCost()
// had several dedicated stateCode branches — CT, AL, NY — that bypassed its own
// rix-table dispatch entirely rather than sharing this logic).
//
// resolveRetirementIncome's `agiProxy` and `ss` parameters are ALWAYS caller-supplied,
// NEVER computed in here — Roth uses a precise, taxable-SS-derived AGI figure; the
// Relocation tool uses a cruder full-benefit-sum proxy. This is an intentional,
// documented precision difference between the two tools, not an oversight — collapsing
// it inside this module would silently change one tool's accuracy. Do not "fix" this.
//
// State-level Social Security taxability (the exemptBelowAGI/phaseInAboveAGI/
// followsFederalFormula/ssAgeGate machinery) stays OUT of this module and is NOT
// exported — the Roth calculator never models state-level SS taxability at all (only
// the federal SS torpedo zone), so there is no second caller for that logic. The one
// exception is Colorado, whose retirementIncome.exclusion.sharesCapWithSS genuinely
// entangles SS taxability with the pension/IRA cap — resolveRetirementIncome returns an
// `ssTaxableOverride` for that one case; every other state returns `null` and the
// caller computes its own SS taxability exactly as before.

// The real federal Social Security taxability formula (IRS Pub 915's "quick method"
// worksheet — combined income vs. the $25k/$34k single or $32k/$44k joint two-tier
// base/additional thresholds, MFS taxed at a flat 85% immediately). Confirmed
// byte-identical in both of this module's predecessors (roth-conversion/index.html's
// calcTaxableSS() and relocation/relo-engine.mjs's federalTaxableSS()) before this
// extraction — single source now.
export function federalTaxableSS(ssBenefit, otherIncome, rawStatus) {
  if (!ssBenefit || ssBenefit <= 0) return 0;
  if (rawStatus === "mfs") return ssBenefit * 0.85;
  const [lo, hi] = rawStatus === "mfj" ? [32000, 44000] : [25000, 34000]; // hoh uses single's thresholds, same as federal
  const pi = otherIncome + ssBenefit * 0.5;
  if (pi <= lo) return 0;
  if (pi <= hi) return Math.min(ssBenefit * 0.5, (pi - lo) * 0.5);
  const zone1 = Math.min(ssBenefit * 0.5, (hi - lo) * 0.5);
  return Math.min(ssBenefit * 0.85, zone1 + (pi - hi) * 0.85);
}

// Highest age-gated tier a person's own age clears, or 0 if none. Used to build a
// household cap by summing each spouse's INDEPENDENTLY-verified entitlement (GA, WI) —
// not by assuming a flat doubling, since a state's real joint figure isn't always 2x
// (WI's $48k joint tier only unlocks when BOTH spouses clear it, confirmed by WI DOR's
// own FAQ, not from any single spouse's own qualification).
function tierCapFor(tiers, personAge) {
  let cap = 0;
  for (const t of tiers) if (personAge >= t.minAge) cap = Math.max(cap, t.cap);
  return cap;
}

// Split a resolved household exclusion amount between IRA and pension proportionally —
// the final bracket tax only depends on the sum, so the split only affects the
// breakdown display, never the tax owed.
function splitPooledExclusion(totalEx, iraAmt, pensionAmt) {
  const combined = iraAmt + pensionAmt;
  const iraShare = combined > 0 ? iraAmt / combined : 0;
  return {
    iraTaxable: Math.max(0, iraAmt - totalEx * iraShare),
    penTaxable: Math.max(0, pensionAmt - totalEx * (1 - iraShare)),
  };
}

// Allowed exclusion $ for retirement/pension income after cliff/phaseout/step + IRA-trap.
// `actualAmount` is the real dollar amount being tested against this exclusion (which may
// be combined pension+IRA income for pooled states) — needed because some states (CT, NJ)
// exclude a PERCENTAGE OF ACTUAL INCOME in their upper tiers, not a percentage of a fixed
// dollar cap, so the result can't be derived from `cap` alone. Covers the cliffTypes with
// a single resolved `cap`; the per-spouse-aware types (ageTieredCap, steppedAmount,
// perSpousePhaseout) need both spouses' ages to resolve their cap in the first place, so
// resolveRetirementIncome handles those directly.
function allowedExclusion(excl, isIRA, agiProxy, status, cap, actualAmount) {
  if (!excl) return 0;
  if (isIRA && excl.excludesIRA) return 0;           // MD trap: IRA gets nothing
  if (excl.cliffType === "hard") {
    if (excl.cliffAGI && agiProxy > excl.cliffAGI[status]) return 0; // NJ: whole thing vanishes
    return Math.min(cap, actualAmount);
  }
  if (excl.cliffType === "phaseout") {
    // Not currently used by any state (CT migrated to steppedPercent, VA to
    // perSpousePhaseout) — kept correct rather than removed, in case a future state
    // fits this simpler shape. Cap the PHASED amount by actual income, not the other
    // way around: min(cap,actual)*frac and min(cap*frac,actual) diverge whenever
    // cap > actual and frac < 1 (found via the perSpousePhaseout parity test — the
    // same order mistake, caught before it could reach a live state's data).
    const full = excl.fullBelowAGI[status], zero = excl.zeroByAGI[status];
    let frac;
    if (agiProxy <= full) frac = 1;
    else if (agiProxy >= zero) frac = 0;
    else frac = 1 - (agiProxy - full) / (zero - full);
    return Math.min(cap * frac, actualAmount);
  }
  if (excl.cliffType === "steppedPercent") {
    // Tiered by AGI; each tier excludes a % of ACTUAL income, found by the tier whose
    // `upTo` is the first value actualAGI doesn't exceed (tiers list their INCLUSIVE upper
    // bound — e.g. CT's 100%-tier is {upTo:74999}, since $75,000 itself drops to the next
    // tier). Most states with this shape have no dollar cap at all (CT); NJ's lowest tier
    // is `capped:true`, meaning that tier alone still respects the flat dollar cap.
    const tiers = excl.steps[status];
    const tier = tiers.find((t) => t.upTo == null || agiProxy <= t.upTo) || tiers[tiers.length - 1];
    const excluded = actualAmount * tier.pct;
    return tier.capped ? Math.min(cap, excluded) : excluded;
  }
  return Math.min(cap, actualAmount);
}

// rules: the taxRules object for one state (reads rules.retirementIncome and
//   rules.pensionIncome itself — not passed as separate args).
// status: 'single'|'mfj'|'mfs'|'hoh' (tStatus derived internally: mfj -> 'joint',
//   everything else -> 'single', the same two-bucket mapping used throughout this
//   project — a documented, accepted simplification for states like NJ with a
//   genuinely distinct MFS figure).
// ira/pension: the actual dollar amounts competing for whatever exclusion applies.
// agiProxy/ss: ALWAYS caller-supplied — see the file header. `ss` is the gross annual
//   SS benefit (needed for netAgainstSS, which WV's own statute defines against the
//   real benefit "regardless of federal taxability," and for CO's sharesCapWithSS,
//   which independently derives the real federally-taxable portion internally).
// ssForThreshold: the SS figure to back OUT of agiProxy for thresholdExcludesSS states
//   (NJ, VA) — MUST match whatever SS figure is already baked INTO the caller's own
//   agiProxy, or the threshold test silently uses the wrong precision. Defaults to
//   `ss` (correct for Relocation, whose agiProxy sums the gross benefit) — Roth passes
//   its own precise taxable-SS figure here instead, since Roth's agiProxy is built from
//   that, not the gross benefit. Currently no state combines thresholdExcludesSS with
//   netAgainstSS/sharesCapWithSS (which both need the true gross `ss`), so this only
//   ever matters for one purpose per state today — kept as a separate parameter anyway
//   so a future state combining both wouldn't be silently wrong.
// otherIncomeForSS: income EXCLUDING Social Security entirely, for CO's own internal
//   federalTaxableSS recomputation (sharesCapWithSS). Defaults to `agiProxy - ss`,
//   which is exact for Relocation (its agiProxy is built by adding the raw ss benefit,
//   so subtracting it back out is lossless) — but WRONG for Roth, whose agiProxy is
//   built from a PRE-COMPUTED taxable-SS figure (ssBase/ssWith), not the raw benefit,
//   so `agiProxy - ss` doesn't recover the true non-SS income and can silently zero out
//   CO's SS subtraction in the federal formula's 50% phase-in zone (confirmed: at
//   $20,000 of true other income, the default derivation gives $0 instead of the
//   correct $2,500 — a 100% error). Roth passes its own precise `income+nii` here
//   instead — the same non-SS-income figure this tool already uses to derive
//   ssBase/ssWith for the federal SS torpedo calc (ltcg is excluded from both,
//   consistent with this tool's existing provisional-income convention).
// Returns { iraTaxable, penTaxable, ssTaxableOverride }. ssTaxableOverride is null for
// every state except when rules.retirementIncome.exclusion.sharesCapWithSS is true (CO
// today, the only state with this flag) — callers MUST check for a non-null override
// and substitute it for their own independently-computed SS taxability.
export function resolveRetirementIncome(rules, status, { age = 67, spouseAge, ira = 0, pension = 0, agiProxy, ss = 0, ssForThreshold = ss, otherIncomeForSS = agiProxy - ss }) {
  const tStatus = status === "mfj" ? "joint" : "single";
  const ri = rules.retirementIncome;
  const pooled = rules.pensionIncome.sameAs === "retirementIncome";
  const pr = pooled ? ri : rules.pensionIncome;

  let iraTaxable = ira;
  let penTaxable = pension;
  let ssTaxableOverride = null;

  if (pooled && ri.treatment === "exclusion" && ri.exclusion.cliffType === "ageTieredCap" && ri.exclusion.sharesCapWithSS) {
    // CO: Social Security and the pension/annuity subtraction are NOT two separate pools —
    // they share ONE age-tiered cap. Confirmed via CO DOR's own "Income Tax Topics: Social
    // Security, Pensions and Annuities" guide: "Any subtraction claimed for Social Security
    // benefits will reduce the subtraction an individual can claim for any other pension
    // and annuity income." At 65+, the ENTIRE federally-taxable SS amount is subtracted,
    // uncapped, and that reduces the room left in the cap for pension/IRA (floor $0). At
    // 55-64, the same uncapped treatment applies if household AGI is under a threshold;
    // above it, SS and pension/IRA together are limited to the single $20,000 cap (the
    // same cap that would otherwise apply to pension/IRA alone). Under 55, neither SS nor
    // pension/IRA gets any subtraction (the death-benefit carve-out for under-55 filers is
    // not modeled, consistent with this project's existing simplifications elsewhere).
    // No per-spouse SS/income split is available, so a joint return conservatively
    // requires BOTH spouses to individually clear the "full/uncapped" bar (same convention
    // as RI's full-retirement-age gate elsewhere in this project) before granting it to
    // the household — otherwise the household falls to the shared-$20k-cap branch.
    const ssr = rules.socialSecurity;
    const fullExemptThreshold = ssr.fullExemptBelowAGI[tStatus];
    const personFullyExempt = (personAge) => personAge >= 65 || (personAge >= 55 && agiProxy <= fullExemptThreshold);
    const householdFullyExempt = tStatus === "joint"
      ? personFullyExempt(age) && personFullyExempt(spouseAge ?? age)
      : personFullyExempt(age);
    const cap = tierCapFor(ri.exclusion.perPersonTiers, age)
      + (tStatus === "joint" ? tierCapFor(ri.exclusion.perPersonTiers, spouseAge ?? age) : 0);
    // CO's subtraction applies to SS "included in federal taxable income" (line 6b), i.e.
    // the real federally-taxable portion — not the gross benefit — so this uses the actual
    // federal worksheet rather than a caller's own AGI-proxy approximation.
    const ssIncludedFed = federalTaxableSS(ss, otherIncomeForSS, status);
    let ssSub, pensionRoom;
    if (householdFullyExempt) {
      ssSub = ssIncludedFed;
      pensionRoom = Math.max(0, cap - ssSub);
    } else {
      const combined = ssIncludedFed + ira + pension;
      const totalSub = Math.min(cap, combined);
      // No stated priority order between SS and pension/IRA when both compete for a
      // capped pool — split proportionally by each income type's own share, same
      // no-ordering-assumed convention as splitPooledExclusion below.
      const ssShare = combined > 0 ? ssIncludedFed / combined : 0;
      ssSub = totalSub * ssShare;
      pensionRoom = totalSub - ssSub;
    }
    ssTaxableOverride = Math.max(0, ssIncludedFed - ssSub);
    const pensionAndIraSub = Math.min(pensionRoom, ira + pension);
    ({ iraTaxable, penTaxable } = splitPooledExclusion(pensionAndIraSub, ira, pension));
  } else if (pooled && ri.treatment === "exclusion" && ri.exclusion.cliffType === "ageTieredCap") {
    // GA (two real age tiers) / WI (one tier, but still needs this — see tierCapFor):
    // each spouse's own cap is resolved from THEIR OWN age and summed for a joint
    // return. A converting spouse can only shelter against their own entitlement — a
    // non-converting spouse's unused tier doesn't transfer (confirmed: GA DOR practice) —
    // but with no per-spouse income split available, summing independently-verified
    // per-person amounts against the household's combined actual income is the best
    // available figure without assuming a flat (and sometimes wrong — see WI) 2x.
    let cap = tierCapFor(ri.exclusion.perPersonTiers, age)
      + (tStatus === "joint" ? tierCapFor(ri.exclusion.perPersonTiers, spouseAge ?? age) : 0);
    // WV: the $8k/$16k modification shares ONE statutory pool with Social Security —
    // net the SS BENEFIT itself against the per-person-summed cap (same netAgainstSS
    // mechanic as the flat-cap branch below).
    if (ri.exclusion.netAgainstSS) cap = Math.max(0, cap - ss);
    const totalEx = Math.min(cap, ira + pension);
    ({ iraTaxable, penTaxable } = splitPooledExclusion(totalEx, ira, pension));
  } else if (pooled && ri.treatment === "exclusion" && ri.exclusion.cliffType === "steppedAmount") {
    // NM: a dollar amount (not %), tiered by AGI, applied ×1 or ×2 by qualifying-spouse
    // count — confirmed via NM TRD's own worked examples ("$8,000 x 2" for two qualifying
    // spouses). The AGI bracket is resolved ONCE from combined household AGI; only the
    // resulting per-person dollar figure is then multiplied by how many spouses qualify.
    const excl = ri.exclusion;
    // NM groups Head of Household with Married Filing Jointly for THIS TABLE specifically
    // (confirmed via NM TRD's own Table 1 — HOH shares the wider joint thresholds, not
    // single's) — but an HOH filer still files alone, so the qualifyingCount check just
    // below stays keyed to the real tStatus (joint-return-ness), not this table lookup.
    const stepsStatus = (status === "hoh" && excl.hohMapsToJoint) ? "joint" : tStatus;
    const tiers = excl.steps[stepsStatus];
    const tier = tiers.find((t) => t.upTo == null || agiProxy <= t.upTo) || tiers[tiers.length - 1];
    const qualifies = (a) => excl.ageGate == null || a >= excl.ageGate;
    const qualifyingCount = excl.perQualifyingSpouse
      ? (qualifies(age) ? 1 : 0) + (tStatus === "joint" && qualifies(spouseAge ?? age) ? 1 : 0)
      : (qualifies(age) ? 1 : 0);
    const cap = tier.amt * qualifyingCount;
    const totalEx = Math.min(cap, ira + pension);
    ({ iraTaxable, penTaxable } = splitPooledExclusion(totalEx, ira, pension));
  } else if (pooled && ri.treatment === "exclusion" && ri.exclusion.cliffType === "perSpousePhaseout") {
    // VA: a per-person $12,000 age-65+ deduction (summed like ageTieredCap above), that
    // THEN phases out dollar-for-dollar above a threshold fixed by filing status (not by
    // qualifying-spouse count — confirmed: VA's own Form 760 worksheet uses one shared
    // $75,000 joint / $50,000 single test regardless of whether 1 or 2 spouses qualify).
    // Grandfather clause (unconditional for those born on/before 1/1/1939) deliberately
    // not modeled — small, shrinking population.
    const excl = ri.exclusion;
    const qualifyingCount = (age >= excl.ageGate ? 1 : 0)
      + (tStatus === "joint" && (spouseAge ?? age) >= excl.ageGate ? 1 : 0);
    const cap = excl.perPersonCap * qualifyingCount;
    const threshold = excl.thresholdAGI[tStatus];
    // VA's own threshold ("AFAGI") backs Social Security out entirely — same reasoning
    // as NJ's thresholdExcludesSS below.
    const thresholdProxy = excl.thresholdExcludesSS ? agiProxy - ssForThreshold : agiProxy;
    let totalEx = 0;
    if (cap > 0) {
      const zero = threshold + cap; // the phase-out band is exactly as wide as the cap (1:1 ramp)
      let frac;
      if (thresholdProxy <= threshold) frac = 1;
      else if (thresholdProxy >= zero) frac = 0;
      else frac = 1 - (thresholdProxy - threshold) / (zero - threshold);
      totalEx = cap * frac;
    }
    ({ iraTaxable, penTaxable } = splitPooledExclusion(totalEx, ira, pension));
  } else if (pooled && ri.treatment === "offsetStack") {
    // SC: two deductions sharing ONE combined per-person ceiling — an age-tiered
    // retirement-income deduction ($3k under 65 / $10k at 65+), plus a separate age-65+
    // deduction against ANY income, but that second piece is REDUCED by whatever the
    // first already used (confirmed via SC DOR's own worked examples: NOT additive to
    // $25k, capped at $15k total per qualifying person). Computed per spouse (each has
    // their own age and their own $15k pool) and summed for a joint return, same
    // per-person-summing rationale as ageTieredCap.
    const os = ri.offsetStack;
    const personShelter = (personAge, personShare) => {
      const tier1Cap = personAge >= os.tier1AgeGate ? os.tier1CapAtOrAbove : os.tier1CapBelow;
      const tier1 = Math.min(tier1Cap, personShare);
      const tier2 = personAge >= os.tier2AgeGate ? Math.max(0, os.tier2Ceiling - tier1) : 0;
      return Math.min(tier1 + tier2, personShare);
    };
    // No per-spouse income split is available, so — consistent with GA/WI above —
    // apply each spouse's own shelter formula to the FULL combined amount and sum,
    // rather than guessing a split; capped so a joint return never exceeds what two
    // people's $15,000 pools could shelter.
    const combined = ira + pension;
    const totalEx = tStatus === "joint"
      ? Math.min(personShelter(age, combined) + personShelter(spouseAge ?? age, combined), combined)
      : personShelter(age, combined);
    ({ iraTaxable, penTaxable } = splitPooledExclusion(totalEx, ira, pension));
  } else if (pooled && ri.treatment === "exclusion" && ri.exclusion.cliffType === "steppedPercent" && ri.exclusion.iraWeightPct != null) {
    // CT: IRA distributions enter the eligible base at a REDUCED weight relative to
    // pension/annuity income — confirmed via the official CT-1040 "Pension and Annuity
    // Worksheet": pension/annuity income counts at 100%, IRA distributions (other than
    // Roth — a Roth CONVERSION is an IRA distribution) count at only 75%, before the
    // AGI-tiered phase-out percentage even applies. True at EVERY tier, including the
    // "fully exempt" 100% tier below the AGI threshold. The AGI threshold TEST itself
    // still uses real, unweighted combined income (thresholdProxy below); only the
    // amount fed into the final phase-out multiplication is weighted. NJ also uses
    // steppedPercent but has no iraWeightPct (its own rule doesn't distinguish IRA from
    // pension/annuity), so it correctly falls through to the generic branch below.
    const excl = ri.exclusion;
    const thresholdProxy = excl.thresholdExcludesSS ? agiProxy - ssForThreshold : agiProxy;
    const tiers = excl.steps[tStatus];
    const tier = tiers.find((t) => t.upTo == null || thresholdProxy <= t.upTo) || tiers[tiers.length - 1];
    const weighted = ira * excl.iraWeightPct + pension;
    const totalEx = weighted * tier.pct;
    ({ iraTaxable, penTaxable } = splitPooledExclusion(totalEx, ira, pension));
  } else if (pooled && ri.treatment === "exclusion") {
    const gateOk = ri.ageGate == null || age >= ri.ageGate;
    let cap = tStatus === "joint" ? ri.exclusion.capJoint : ri.exclusion.capSingle;
    // WV: the $8k/$16k modification shares ONE statutory pool with Social Security
    // (and other pension exclusions) — net the SS BENEFIT itself against the cap,
    // not its taxable portion, since WV exempts SS from state tax regardless of
    // federal taxability (confirmed: W. Va. Code 11-21-12(c)(9)). No per-spouse SS
    // split is available (only combined household `ss`), so a joint return nets the
    // full household SS against the full household capJoint — a household-level
    // approximation, same spirit as how GA/WI/SC apply a per-person formula against
    // combined household income elsewhere when a true split isn't known.
    if (ri.exclusion.netAgainstSS) cap = Math.max(0, cap - ss);
    // NJ's threshold is its own "Total Income" line, which excludes Social Security
    // entirely — unlike every other state here, which thresholds off AGI (SS included).
    const thresholdProxy = ri.exclusion.thresholdExcludesSS ? agiProxy - ssForThreshold : agiProxy;
    if (gateOk && ri.exclusion.excludesIRA) {
      // MD-style trap even inside a nominally "shared" state: IRA gets nothing, so
      // there's nothing to pool — pension draws the full pool against its own amount.
      const penEx = allowedExclusion(ri.exclusion, false, thresholdProxy, tStatus, cap, pension);
      penTaxable = Math.max(0, pension - penEx);
    } else if (gateOk) {
      const combined = ira + pension;
      const totalEx = allowedExclusion(ri.exclusion, false, thresholdProxy, tStatus, cap, combined);
      const iraShare = combined > 0 ? ira / combined : 0;
      iraTaxable = Math.max(0, ira - totalEx * iraShare);
      penTaxable = Math.max(0, pension - totalEx * (1 - iraShare));
    }
    // else: age gate not met, both stay fully taxable (already the default above).
  } else {
    // Not pooled (or no exclusion at all) — IRA and pension have independent rules,
    // nothing to double-count, so compute each on its own.
    if (ri.treatment === "exempt") iraTaxable = 0;
    else if (ri.treatment === "ageExempt") iraTaxable = (age >= (ri.ageGate ?? 0)) ? 0 : ira;
    else if (ri.treatment === "exclusion" && ri.exclusion.cliffType === "ageTieredCap") {
      // NY/AL: pension is a SEPARATE, unconditionally exempt category, so the
      // per-person-summed cap applies only to IRA/conversion income. NY confirmed
      // per-individual ("capped at $20,000 per person, whether filing jointly or
      // separately... one spouse can't claim the other spouse's unused exclusion");
      // AL confirmed via its own Schedule RS (independent Parts II/III for
      // primary/spouse, summed in Part IV). This is the same per-person-summing
      // logic used by the pooled ageTieredCap branch above, applied to a non-pooled
      // state instead.
      const cap = tierCapFor(ri.exclusion.perPersonTiers, age)
        + (tStatus === "joint" ? tierCapFor(ri.exclusion.perPersonTiers, spouseAge ?? age) : 0);
      iraTaxable = Math.max(0, ira - Math.min(cap, ira));
    } else if (ri.treatment === "exclusion") {
      const gateOk = ri.ageGate == null || age >= ri.ageGate;
      const cap = tStatus === "joint" ? ri.exclusion.capJoint : ri.exclusion.capSingle;
      const exAllowed = gateOk ? allowedExclusion(ri.exclusion, true, agiProxy, tStatus, cap, ira) : 0;
      iraTaxable = Math.max(0, ira - exAllowed);
    } // "taxed" => unchanged

    if (pr.treatment === "exempt") penTaxable = 0;
    else if (pr.treatment === "ageExempt") penTaxable = (age >= (pr.ageGate ?? 0)) ? 0 : pension;
    else if (pr.treatment === "exclusion" && pr.exclusion.cliffType === "ageTieredCap") {
      const cap = tierCapFor(pr.exclusion.perPersonTiers, age)
        + (tStatus === "joint" ? tierCapFor(pr.exclusion.perPersonTiers, spouseAge ?? age) : 0);
      penTaxable = Math.max(0, pension - Math.min(cap, pension));
    } else if (pr.treatment === "exclusion") {
      const gateOk = pr.ageGate == null || age >= pr.ageGate;
      const cap = tStatus === "joint" ? pr.exclusion.capJoint : pr.exclusion.capSingle;
      const exAllowed = gateOk ? allowedExclusion(pr.exclusion, false, agiProxy, tStatus, cap, pension) : 0;
      penTaxable = Math.max(0, pension - exAllowed);
    }
  }

  return { iraTaxable, penTaxable, ssTaxableOverride };
}
