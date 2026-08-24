// relo-engine.mjs — Tier-1 income-tax computation from the taxRules schema.
// This is the proof that the schema is COMPUTABLE. Pure function, no I/O.
//
// computeStateIncomeTax(rules, status, income) -> { tax, breakdown }
//   status: "single" | "joint"
//   income: { ss, iraWithdrawal, pension, capGains, wages, age, spouseAge }
//   (all $ ; age/spouseAge for gates — spouseAge is OPTIONAL and only consulted for
//   joint returns on states with a genuinely per-spouse mechanic; omitting it is safe
//   and backward compatible — see the per-person cliffTypes below.)
//
// Retirement-income-exclusion math (tierCapFor/allowedExclusion/splitPooledExclusion
// and the whole ri/pooled dispatch below) moved to core/retirement-rules.js
// (resolveRetirementIncome) on 2026-08-24 — that logic used to be independently
// duplicated in roth-conversion/index.html's rixExcluded()/computeConversionCost(),
// which is exactly the kind of drift that produced a real, live, previously-untested
// bug (Roth's calculator silently ignored Colorado's sharesCapWithSS entirely — see
// the shared module's own header comment). federalTaxableSS moved there too (it was
// already a confirmed byte-identical port of Roth's calcTaxableSS before this).
import { resolveRetirementIncome, federalTaxableSS } from '../core/retirement-rules.js';

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
// qualAge: the age used to test a state's OWN age-gate on its SS exemption (RI is the
// first state confirmed to need one — see ssAgeGate below). Separate from `age`/
// `spouseAge` used elsewhere in this file for per-spouse-summed cliffs (ageTieredCap
// etc.) — this is a single all-or-nothing eligibility test, not a per-person amount to
// sum, so the caller passes in whichever single age value is appropriate (see call site).
function taxableSS(ssRule, ssBenefit, agiProxy, status, otherIncome, rawStatus, qualAge) {
  if (!ssRule.taxed || ssBenefit <= 0) return 0;
  if (ssRule.followsFederalFormula) return federalTaxableSS(ssBenefit, otherIncome, rawStatus);
  const maxTaxable = ssBenefit * (ssRule.maxTaxableFraction ?? 0.85);
  // RI: the SS exemption requires reaching Social Security full retirement age, a
  // SEPARATE gate from the AGI threshold below (confirmed via RI DOT's own Retirement
  // Income Guide, Section 3, Example #2: a 63/65-year-old joint-filing couple under the
  // AGI threshold was still denied the exemption because neither had reached FRA).
  // Below the gate, SS is fully taxable (up to maxTaxableFraction) regardless of AGI.
  if (ssRule.ssAgeGate != null && qualAge < ssRule.ssAgeGate) return maxTaxable;
  const exempt = ssRule.exemptBelowAGI[status];
  if (agiProxy <= exempt) return 0;
  if (!ssRule.phaseInAboveAGI) return maxTaxable; // hard threshold (CT-style: above => taxable)
  // Linear phase-in across a band (approximation of the state's worksheet).
  const start = ssRule.phaseInAboveAGI[status];
  const band = Math.max(1, exempt * 0.2); // representative phase-in width
  const frac = Math.min(1, Math.max(0, (agiProxy - start) / band));
  return maxTaxable * frac;
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
  // NM groups Head of Household with Married Filing Jointly for its SS exemption
  // threshold ($150k, not single's $100k) — confirmed via NM TRD's own published
  // filing-status table. hohMapsToJoint lets a state override the usual
  // single/mfs/hoh -> "single" mapping for this one lookup without changing tStatus
  // globally (unverified for this state's OTHER thresholds).
  const ssStatus = (status === "hoh" && rules.socialSecurity.hohMapsToJoint) ? "joint" : tStatus;
  // RI's guide states plainly, for the PENSION modification, that a joint return with
  // only one spouse at full retirement age gets a PARTIAL modification (that spouse's own
  // income only) — Section 3 (Social Security) doesn't repeat this per-spouse-partial
  // clause explicitly, only that its requirements are "similar to" the pension
  // modification's. Since no per-spouse SS-benefit split is modeled here, requiring the
  // YOUNGER spouse to also clear the gate is a conservative simplification BY ANALOGY
  // (same convention as EXAGE's ex:true-state age gate elsewhere in this project) — it may
  // understate the exemption for a couple where only the older spouse's own SS should
  // qualify, but hasn't been directly sourced as RI's real per-spouse SS rule.
  const ssQualAge = tStatus === "joint" ? Math.min(age, spouseAge ?? age) : age;
  // CO: SS and the pension/annuity subtraction share ONE combined age-tiered cap, resolved
  // together (alongside iraTaxable/penTaxable) by resolveRetirementIncome below, via its
  // ssTaxableOverride return value, rather than here. `let` since that override overwrites
  // this.
  let tSS = rules.socialSecurity.sharesRetirementCap
    ? 0
    : taxableSS(rules.socialSecurity, ss, agiProxy, ssStatus, agiProxy - ss, status, ssQualAge);

  // --- IRA / 401k / conversion withdrawal, and Pension ---
  // The whole retirement-income-exclusion dispatch (pooling, per-cliffType math, the
  // CO SS-sharing entanglement) lives in core/retirement-rules.js now — see that
  // module's own header comment. ssTaxableOverride is non-null only for CO; every
  // other state leaves tSS exactly as computed above.
  const { iraTaxable, penTaxable, ssTaxableOverride } = resolveRetirementIncome(rules, status, {
    age, spouseAge, ira: iraWithdrawal, pension, agiProxy, ss,
  });
  if (ssTaxableOverride != null) tSS = ssTaxableOverride;
  breakdown.iraTaxable = iraTaxable;
  breakdown.penTaxable = penTaxable;
  breakdown.taxableSS = tSS; // set once here since resolveRetirementIncome's ssTaxableOverride (CO) may overwrite tSS above

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
