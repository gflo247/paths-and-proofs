// relo-engine.mjs — Tier-1 income-tax computation from the taxRules schema.
// This is the proof that the schema is COMPUTABLE. Pure function, no I/O.
//
// computeStateIncomeTax(rules, status, income) -> { tax, breakdown }
//   status: "single" | "joint"
//   income: { ss, iraWithdrawal, pension, capGains, wages, age, spouseAge }
//   (all $ ; age/spouseAge for gates — spouseAge is OPTIONAL and only consulted for
//   joint returns on states with a genuinely per-spouse mechanic; omitting it is safe
//   and backward compatible — see the per-person cliffTypes below.)

function bracketTax(amount, brackets) {
  if (amount <= 0) return 0;
  let tax = 0, lo = 0;
  for (const b of brackets) {
    const hi = b.upTo == null ? Infinity : b.upTo;
    if (amount > lo) {
      const slice = Math.min(amount, hi) - lo;
      if (slice > 0) tax += slice * b.rate;
    }
    lo = hi;
    if (amount <= hi) break;
  }
  return tax;
}

// Taxable Social Security under a state's threshold/phase-in rule.
function taxableSS(ssRule, ssBenefit, agiProxy, status) {
  if (!ssRule.taxed || ssBenefit <= 0) return 0;
  const exempt = ssRule.exemptBelowAGI[status];
  if (agiProxy <= exempt) return 0;
  const maxTaxable = ssBenefit * (ssRule.maxTaxableFraction ?? 0.85);
  if (!ssRule.phaseInAboveAGI) return maxTaxable; // hard threshold (CT-style: above => taxable)
  // Linear phase-in across a band (approximation of the state's worksheet).
  const start = ssRule.phaseInAboveAGI[status];
  const band = Math.max(1, exempt * 0.2); // representative phase-in width
  const frac = Math.min(1, Math.max(0, (agiProxy - start) / band));
  return maxTaxable * frac;
}

// Highest age-gated tier a person's own age clears, or 0 if none. Used to build a
// household cap by summing each spouse's INDEPENDENTLY-verified entitlement (GA, WI) —
// not by assuming a flat doubling, since a state's real joint figure isn't always 2x
// (and for WI specifically, doubling unconditionally would be wrong: the $48k joint tier
// only unlocks when BOTH spouses clear it, confirmed by WI DOR's own FAQ, not from any
// single spouse's own qualification).
function tierCapFor(tiers, personAge) {
  let cap = 0;
  for (const t of tiers) if (personAge >= t.minAge) cap = Math.max(cap, t.cap);
  return cap;
}

// Split a resolved household exclusion amount between IRA and pension proportionally —
// same reasoning as the pooling fix in computeStateIncomeTax: the final bracket tax only
// depends on the sum, so the split only affects the breakdown display.
function splitPooledExclusion(totalEx, iraWithdrawal, pension) {
  const combined = iraWithdrawal + pension;
  const iraShare = combined > 0 ? iraWithdrawal / combined : 0;
  return {
    iraTaxable: Math.max(0, iraWithdrawal - totalEx * iraShare),
    penTaxable: Math.max(0, pension - totalEx * (1 - iraShare)),
  };
}

// Allowed exclusion $ for retirement/pension income after cliff/phaseout/step + IRA-trap.
// `actualAmount` is the real dollar amount being tested against this exclusion (which may
// be combined pension+IRA income for pooled states — see computeStateIncomeTax) — needed
// because some states (CT, NJ) exclude a PERCENTAGE OF ACTUAL INCOME in their upper tiers,
// not a percentage of a fixed dollar cap, so the result can't be derived from `cap` alone.
// Covers the cliffTypes with a single resolved `cap`; the per-spouse-aware types
// (ageTieredCap, steppedAmount, perSpousePhaseout) need both spouses' ages to resolve
// their cap in the first place, so computeStateIncomeTax handles those directly.
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

export function computeStateIncomeTax(rules, status, income) {
  const { ss = 0, iraWithdrawal = 0, pension = 0, capGains = 0, wages = 0, age = 67, spouseAge } = income;
  // `status` is one of: single | mfj | mfs | hoh (four filing statuses, for brackets).
  // SS thresholds and exclusion cliffs are defined single-vs-married only, so map:
  // mfj -> "joint"; single/mfs/hoh -> "single" (MFS & HoH use single-level thresholds).
  // Known gap: a few states (e.g. NJ) have a genuinely different MFS figure ($50k vs.
  // $75k single) that this two-bucket mapping can't represent — MFS filers there get the
  // single-bucket number, which is more generous than their real cap. Disclosed, not fixed,
  // since it's consistent with how MFS/HOH already collapse to "single" everywhere else here.
  const tStatus = status === 'mfj' ? 'joint' : 'single';
  const brackets = rules.bracketsByStatus[status] || rules.bracketsByStatus.single;
  const breakdown = {};

  // AGI proxy: the quantity states use for cliff/threshold tests. Full vector total
  // (a big IRA withdrawal can itself trip a cliff — we model that).
  const agiProxy = ss + iraWithdrawal + pension + capGains + wages;

  // --- Social Security ---
  const tSS = taxableSS(rules.socialSecurity, ss, agiProxy, tStatus);
  breakdown.taxableSS = tSS;

  // --- IRA / 401k / conversion withdrawal, and Pension ---
  // Most states share ONE exclusion pool across both income types (pensionIncome.sameAs
  // === "retirementIncome"): calling allowedExclusion separately for each with the SAME
  // full cap double-grants it when both are present (a $65,987 Michigan cap would shelter
  // up to $131,974 — a real, live bug, confirmed reachable via the relocation tool's own
  // default inputs, which set both iraWithdrawal and pension). Fix: compute the exclusion
  // ONCE against their combined actual income and split the result proportionally — the
  // final bracket tax only depends on iraTaxable+penTaxable's SUM, so the split only
  // affects the breakdown display, never the tax owed. States with genuinely separate
  // pension and IRA rules (e.g. Maryland: pension excludable, IRA is not) are unaffected —
  // those two rule objects are already distinct, so there's nothing to pool.
  const ri = rules.retirementIncome;
  const pooled = rules.pensionIncome.sameAs === "retirementIncome";
  const pr = pooled ? ri : rules.pensionIncome;

  let iraTaxable = iraWithdrawal;
  let penTaxable = pension;

  if (pooled && ri.treatment === "exclusion" && ri.exclusion.cliffType === "ageTieredCap") {
    // GA (two real age tiers) / WI (one tier, but still needs this — see tierCapFor):
    // each spouse's own cap is resolved from THEIR OWN age and summed for a joint
    // return. A converting spouse can only shelter against their own entitlement — a
    // non-converting spouse's unused tier doesn't transfer (confirmed: GA DOR practice) —
    // but since the engine has no per-spouse income split, summing independently-
    // verified per-person amounts against the household's combined actual income is the
    // best available figure without assuming a flat (and sometimes wrong — see WI) 2x.
    const cap = tierCapFor(ri.exclusion.perPersonTiers, age)
      + (tStatus === "joint" ? tierCapFor(ri.exclusion.perPersonTiers, spouseAge ?? age) : 0);
    const totalEx = Math.min(cap, iraWithdrawal + pension);
    ({ iraTaxable, penTaxable } = splitPooledExclusion(totalEx, iraWithdrawal, pension));
  } else if (pooled && ri.treatment === "exclusion" && ri.exclusion.cliffType === "steppedAmount") {
    // NM: a dollar amount (not %), tiered by AGI, applied ×1 or ×2 by qualifying-spouse
    // count — confirmed via NM TRD's own worked examples ("$8,000 x 2" for two qualifying
    // spouses). The AGI bracket is resolved ONCE from combined household AGI; only the
    // resulting per-person dollar figure is then multiplied by how many spouses qualify.
    const excl = ri.exclusion;
    const tiers = excl.steps[tStatus];
    const tier = tiers.find((t) => t.upTo == null || agiProxy <= t.upTo) || tiers[tiers.length - 1];
    const qualifies = (a) => excl.ageGate == null || a >= excl.ageGate;
    const qualifyingCount = excl.perQualifyingSpouse
      ? (qualifies(age) ? 1 : 0) + (tStatus === "joint" && qualifies(spouseAge ?? age) ? 1 : 0)
      : (qualifies(age) ? 1 : 0);
    const cap = tier.amt * qualifyingCount;
    const totalEx = Math.min(cap, iraWithdrawal + pension);
    ({ iraTaxable, penTaxable } = splitPooledExclusion(totalEx, iraWithdrawal, pension));
  } else if (pooled && ri.treatment === "exclusion" && ri.exclusion.cliffType === "perSpousePhaseout") {
    // VA: a per-person $12,000 age-65+ deduction (summed like ageTieredCap above), that
    // THEN phases out dollar-for-dollar above a threshold fixed by filing status (not by
    // qualifying-spouse count — confirmed: VA's own Form 760 worksheet uses one shared
    // $75,000 joint / $50,000 single test regardless of whether 1 or 2 spouses qualify).
    // Grandfather clause (unconditional for those born on/before 1/1/1939, ~87+ in 2026)
    // deliberately not modeled — that population is small and shrinking (VA's own
    // characterization), and modeling it per-spouse would add real complexity for a
    // vanishing edge case.
    const excl = ri.exclusion;
    const qualifyingCount = (age >= excl.ageGate ? 1 : 0)
      + (tStatus === "joint" && (spouseAge ?? age) >= excl.ageGate ? 1 : 0);
    const cap = excl.perPersonCap * qualifyingCount;
    const threshold = excl.thresholdAGI[tStatus];
    // VA's own threshold ("AFAGI") backs Social Security out entirely — same reasoning
    // as NJ's thresholdExcludesSS above.
    const thresholdProxy = excl.thresholdExcludesSS ? agiProxy - ss : agiProxy;
    let totalEx = 0;
    if (cap > 0) {
      const zero = threshold + cap; // the phase-out band is exactly as wide as the cap (1:1 ramp)
      let frac;
      if (thresholdProxy <= threshold) frac = 1;
      else if (thresholdProxy >= zero) frac = 0;
      else frac = 1 - (thresholdProxy - threshold) / (zero - threshold);
      totalEx = cap * frac;
    }
    ({ iraTaxable, penTaxable } = splitPooledExclusion(totalEx, iraWithdrawal, pension));
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
    const combined = iraWithdrawal + pension;
    const totalEx = tStatus === "joint"
      ? Math.min(personShelter(age, combined) + personShelter(spouseAge ?? age, combined), combined)
      : personShelter(age, combined);
    ({ iraTaxable, penTaxable } = splitPooledExclusion(totalEx, iraWithdrawal, pension));
  } else if (pooled && ri.treatment === "exclusion" && ri.exclusion.cliffType === "steppedPercent" && ri.exclusion.iraWeightPct != null) {
    // CT: IRA distributions enter the eligible base at a REDUCED weight relative to
    // pension/annuity income — confirmed via the official CT-1040 "Pension and Annuity
    // Worksheet": pension/annuity income counts at 100%, IRA distributions (other than
    // Roth — a Roth CONVERSION is an IRA distribution) count at only 75%, before the
    // AGI-tiered phase-out percentage even applies. This is true at EVERY tier, including
    // the "fully exempt" 100% tier below the AGI threshold — an IRA distribution never
    // gets more than 75% sheltered in CT, no matter how low AGI is. The AGI threshold
    // TEST itself still uses real, unweighted combined income (thresholdProxy below);
    // only the amount fed into the final phase-out multiplication is weighted. NJ also
    // uses steppedPercent but has no iraWeightPct (its own rule doesn't distinguish IRA
    // from pension/annuity), so it correctly falls through to the generic branch below.
    const excl = ri.exclusion;
    const thresholdProxy = excl.thresholdExcludesSS ? agiProxy - ss : agiProxy;
    const tiers = excl.steps[tStatus];
    const tier = tiers.find((t) => t.upTo == null || thresholdProxy <= t.upTo) || tiers[tiers.length - 1];
    const weighted = iraWithdrawal * excl.iraWeightPct + pension;
    const totalEx = weighted * tier.pct;
    ({ iraTaxable, penTaxable } = splitPooledExclusion(totalEx, iraWithdrawal, pension));
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
    // combined household income elsewhere in this file when a true split isn't known.
    if (ri.exclusion.netAgainstSS) cap = Math.max(0, cap - ss);
    // NJ's threshold is its own "Total Income" line, which excludes Social Security
    // entirely — unlike every other state here, which thresholds off AGI (SS included).
    const thresholdProxy = ri.exclusion.thresholdExcludesSS ? agiProxy - ss : agiProxy;
    if (gateOk && ri.exclusion.excludesIRA) {
      // MD-style trap even inside a nominally "shared" state: IRA gets nothing, so
      // there's nothing to pool — pension draws the full pool against its own amount.
      const penEx = allowedExclusion(ri.exclusion, false, thresholdProxy, tStatus, cap, pension);
      penTaxable = Math.max(0, pension - penEx);
    } else if (gateOk) {
      const combined = iraWithdrawal + pension;
      const totalEx = allowedExclusion(ri.exclusion, false, thresholdProxy, tStatus, cap, combined);
      const iraShare = combined > 0 ? iraWithdrawal / combined : 0;
      iraTaxable = Math.max(0, iraWithdrawal - totalEx * iraShare);
      penTaxable = Math.max(0, pension - totalEx * (1 - iraShare));
    }
    // else: age gate not met, both stay fully taxable (already the default above).
  } else {
    // Not pooled (or no exclusion at all) — IRA and pension have independent rules,
    // nothing to double-count, so compute each on its own as before.
    if (ri.treatment === "exempt") iraTaxable = 0;
    else if (ri.treatment === "ageExempt") iraTaxable = (age >= (ri.ageGate ?? 0)) ? 0 : iraWithdrawal;
    else if (ri.treatment === "exclusion") {
      const gateOk = ri.ageGate == null || age >= ri.ageGate;
      const cap = tStatus === "joint" ? ri.exclusion.capJoint : ri.exclusion.capSingle;
      const exAllowed = gateOk ? allowedExclusion(ri.exclusion, true, agiProxy, tStatus, cap, iraWithdrawal) : 0;
      iraTaxable = Math.max(0, iraWithdrawal - exAllowed);
    } // "taxed" => unchanged

    if (pr.treatment === "exempt") penTaxable = 0;
    else if (pr.treatment === "ageExempt") penTaxable = (age >= (pr.ageGate ?? 0)) ? 0 : pension;
    else if (pr.treatment === "exclusion") {
      const gateOk = pr.ageGate == null || age >= pr.ageGate;
      const cap = tStatus === "joint" ? pr.exclusion.capJoint : pr.exclusion.capSingle;
      const exAllowed = gateOk ? allowedExclusion(pr.exclusion, false, agiProxy, tStatus, cap, pension) : 0;
      penTaxable = Math.max(0, pension - exAllowed);
    }
  }
  breakdown.iraTaxable = iraTaxable;
  breakdown.penTaxable = penTaxable;

  // --- Capital gains ---
  const cg = rules.capitalGains;
  let cgOrdinary = 0, cgSeparateTax = 0;
  if (cg.treatment === "ordinary") cgOrdinary = capGains;
  else if (cg.treatment === "excludedPct") {
    // sourceRestricted breaks (NM/CO/ID/LA/OK) apply ONLY to in-state real-estate/business
    // gains, NOT to a retiree's publicly-traded portfolio. For this tool's use case we treat
    // them as fully ordinary (the realistic outcome) and disclose the nuance in the UI.
    if (cg.sourceRestricted) {
      cgOrdinary = capGains;
    } else {
      const eligible = cg.maxGainEligible != null ? Math.min(capGains, cg.maxGainEligible) : capGains;
      let deduction = eligible * cg.exclusionPct;
      if (cg.minDeduction != null) deduction = Math.max(deduction, Math.min(cg.minDeduction, capGains));
      cgOrdinary = Math.max(0, capGains - deduction);
    }
  }
  else if (cg.treatment === "separateTax") {
    const taxableCG = Math.max(0, capGains - cg.exemptBelow);
    cgSeparateTax = bracketTax(taxableCG, cg.ladder);
  }
  breakdown.cgOrdinary = cgOrdinary;
  breakdown.cgSeparateTax = cgSeparateTax;

  // --- Ordinary income → brackets ---
  const ordinary = wages + iraTaxable + penTaxable + tSS + cgOrdinary;
  breakdown.ordinaryIncome = ordinary;
  const incomeTax = bracketTax(ordinary, brackets);
  breakdown.bracketTax = incomeTax;

  const tax = incomeTax + cgSeparateTax;
  return { tax: Math.round(tax), breakdown };
}
