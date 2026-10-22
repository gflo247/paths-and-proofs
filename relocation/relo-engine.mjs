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

// Taxable Social Security under a state's threshold/phase-out rule.
// Every Social Security-taxing state starts from FEDERAL adjusted gross income, which
// includes only the federally taxable part of the benefit (the IRS Pub 915 worksheet,
// federalTaxableSS) — not 85% of every benefit, and not the whole benefit. So both the
// amount a state can tax (`base`) and the income its thresholds are tested against
// (`fedAGI`) are the federal figures. Fixed 2026-10-21: this used to tax 85% of the
// benefit and test thresholds against income plus the WHOLE benefit, which overstated
// the tax for anyone below the federal 85% tier and tripped thresholds early.
// qualAge: the age used to test a state's OWN age-gate on its SS exemption (RI is the
// first state confirmed to need one — see ssAgeGate below). Separate from `age`/
// `spouseAge` used elsewhere in this file for per-spouse-summed cliffs (ageTieredCap
// etc.) — this is a single all-or-nothing eligibility test, not a per-person amount to
// sum, so the caller passes in whichever single age value is appropriate (see call site).
// flatRate: the state's single bracket rate, needed only by the credit-style phase-out
// (UT), which is defined in tax dollars rather than in income.
function taxableSS(ssRule, ssBenefit, otherIncome, bucket, rawStatus, qualAge, flatRate) {
  if (!ssRule.taxed || ssBenefit <= 0) return 0;
  const fedTaxable = federalTaxableSS(ssBenefit, otherIncome, rawStatus);
  if (ssRule.followsFederalFormula) return fedTaxable;
  // CT: never more than 25% of the benefit (maxTaxableFraction). For the others the
  // field is 0.85, which the federal figure never exceeds.
  const base = Math.min(fedTaxable, ssBenefit * (ssRule.maxTaxableFraction ?? 0.85));
  // RI: the SS exemption requires reaching Social Security full retirement age, a
  // SEPARATE gate from the AGI threshold below (confirmed via RI DOT's own Retirement
  // Income Guide, Section 3, Example #2: a 63/65-year-old joint-filing couple under the
  // AGI threshold was still denied the exemption because neither had reached FRA).
  // Below the gate, the federally taxable amount stays taxable regardless of AGI.
  if (ssRule.ssAgeGate != null && qualAge < ssRule.ssAgeGate) return base;
  const fedAGI = otherIncome + fedTaxable;
  const exempt = ssRule.exemptBelowAGI[bucket];
  if (fedAGI <= exempt) return 0;
  const po = ssRule.phaseOut;
  if (!po) return base; // hard threshold (CT, NM, RI: above it, the whole base is taxable)
  const excess = fedAGI - exempt;
  // VT (32 V.S.A. 5830e): the excluded share falls in a straight line to zero over the
  // next $10,000 of federal AGI.
  if (po.type === 'linear') return base * Math.min(1, excess / po.width);
  // MN (Minn. Stat. 290.0132 subd. 26(c)): the subtraction is "reduced by ten percent for
  // each $4,000 of adjusted gross income, or fraction thereof" over the threshold.
  if (po.type === 'stepped') return base * Math.min(1, Math.ceil(excess / po.step) * po.pctPerStep);
  // UT (Utah Code 59-10-1042): Social Security stays in income, offset by a credit of
  // (flat rate x that Social Security), reduced by $0.025 per dollar of modified AGI over
  // the threshold. For a flat-rate state that's the same as taxing only
  // perDollar x excess / rate of the benefit, up to the whole base.
  if (po.type === 'creditReduction') {
    if (!(flatRate > 0)) throw new Error('relo-engine: creditReduction Social Security phase-out needs a flat-rate state');
    return Math.min(base, (po.perDollar * excess) / flatRate);
  }
  throw new Error(`relo-engine: unknown socialSecurity.phaseOut.type "${po.type}"`);
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

  // Income other than Social Security, and FEDERAL adjusted gross income: the other income
  // plus only the federally taxable part of the benefit (IRS Pub 915 worksheet). Federal
  // AGI is what the states' own threshold tests use (CT, NM, RI, CO, MN, VT, UT); a big IRA
  // withdrawal can itself trip a cliff, and we model that. NJ and VA test income WITHOUT
  // Social Security (thresholdExcludesSS), which resolveRetirementIncome backs out using
  // ssForThreshold. Fixed 2026-10-21: this used to add the WHOLE benefit, overstating
  // federal AGI by the untaxed part and tripping thresholds early (the Roth tool already
  // passes a federal-AGI figure the same way).
  const otherIncome = iraWithdrawal + pension + capGains + wages;
  const fedTaxableSS = federalTaxableSS(ss, otherIncome, status);
  const fedAGI = otherIncome + fedTaxableSS;

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
  const flatRate = brackets.length === 1 ? brackets[0].rate : null;
  let tSS = rules.socialSecurity.sharesRetirementCap
    ? 0
    : taxableSS(rules.socialSecurity, ss, otherIncome, ssStatus, status, ssQualAge, flatRate);

  // --- IRA / 401k / conversion withdrawal, and Pension ---
  // The whole retirement-income-exclusion dispatch (pooling, per-cliffType math, the
  // CO SS-sharing entanglement) lives in core/retirement-rules.js now — see that
  // module's own header comment. ssTaxableOverride is non-null only for CO; every
  // other state leaves tSS exactly as computed above.
  const { iraTaxable, penTaxable, ssTaxableOverride } = resolveRetirementIncome(rules, status, {
    age, spouseAge, ira: iraWithdrawal, pension, agiProxy: fedAGI, ss,
    ssForThreshold: fedTaxableSS, otherIncomeForSS: otherIncome,
  });
  if (ssTaxableOverride != null) tSS = ssTaxableOverride;
  breakdown.iraTaxable = iraTaxable;
  breakdown.penTaxable = penTaxable;
  breakdown.taxableSS = tSS; // set once here since resolveRetirementIncome's ssTaxableOverride (CO) may overwrite tSS above

  // --- Capital gains ---
  // The capital gains input is long-term gains; every preferential rule below (the
  // percentage exclusions, AZ, VT, MT, HI) applies only to long-term gains.
  const nonCG = wages + iraTaxable + penTaxable + tSS;
  const cg = rules.capitalGains;
  let cgOrdinary = 0, cgSeparateTax = 0;
  if (cg.treatment === "ordinary") cgOrdinary = capGains;
  else if (cg.treatment === "excludedPct") {
    // sourceRestricted breaks (NM/CO/ID/LA/OK) apply ONLY to in-state real-estate/business
    // gains, NOT to a retiree's publicly-traded portfolio, so their percentage is not
    // applied. A flat minDeduction that covers ANY capital gain still is (NM: "100% of your
    // net capital gains, not to exceed $2,500", 2025 PIT-ADJ line 16; fixed 2026-10-21).
    const eligible = cg.maxGainEligible != null ? Math.min(capGains, cg.maxGainEligible) : capGains;
    let deduction = cg.sourceRestricted ? 0 : eligible * cg.exclusionPct;
    if (cg.minDeduction != null) deduction = Math.max(deduction, Math.min(cg.minDeduction, capGains));
    cgOrdinary = Math.max(0, capGains - deduction);
  }
  else if (cg.treatment === "separateTax") {
    const taxableCG = Math.max(0, capGains - cg.exemptBelow);
    cgSeparateTax = bracketTax(taxableCG, cg.ladder);
  }
  else if (cg.treatment === "stacked") {
    // Gains taxed on their own rate ladder, stacked on top of the rest of taxable income:
    // each dollar of gain is taxed at the ladder rate for the band it lands in once the
    // other income is counted first. MT (MCA 15-30-2103(2)): 3.0% / 4.1% on the same bands
    // as ordinary income. HI (HRS 235-51(f)): the regular rates, capped at 7.25%.
    const ladder = cg.ladderByStatus[status] || cg.ladderByStatus.single;
    cgSeparateTax = bracketTax(nonCG + capGains, ladder) - bracketTax(nonCG, ladder);
  }
  else throw new Error(`relo-engine: unknown capitalGains.treatment "${cg.treatment}"`);
  breakdown.cgOrdinary = cgOrdinary;
  breakdown.cgSeparateTax = cgSeparateTax;

  // --- Ordinary income → brackets ---
  const ordinary = nonCG + cgOrdinary;
  breakdown.ordinaryIncome = ordinary;
  const incomeTax = bracketTax(ordinary, brackets);
  breakdown.bracketTax = incomeTax;

  const tax = incomeTax + cgSeparateTax;
  return { tax: Math.round(tax), breakdown };
}

// Local (city/county) tax layered ON TOP of state tax — NY (NYC/Yonkers), OR
// (Metro/Multnomah), MD/IN (mandatory county tax). A sibling to
// computeStateIncomeTax, not a parameter on it: 47 states have no localTax at
// all, and the four that do need the SAME ordinary-income base and state-tax
// total computeStateIncomeTax already derived (breakdown.ordinaryIncome,
// stateTax), not a re-derivation of the exclusion math.
//
// local: RELO[code].localTax — undefined for states without one (safe no-op).
// localCode: '' | 'nyc' | 'yonkers' | 'metro' | 'multnomah' — the filer's
//   opt-in selection for NY/OR. Has no effect on MD/IN's county.rate, which
//   is mandatory and unconditional (no opt-out selector exists for it).
export function computeLocalTax(local, status, breakdown, stateTax, localCode) {
  if (!local) return 0;
  const base = breakdown.ordinaryIncome;
  let tax = 0;

  if (localCode === 'nyc' && local.nyc) {
    const brax = local.nyc.bracketsByStatus[status] || local.nyc.bracketsByStatus.single;
    tax += bracketTax(base, brax);
  } else if (localCode === 'yonkers' && local.yonkers) {
    // A flat surcharge on the filer's already-computed NY state tax
    // liability, mathematically exact (linear) rather than a separate
    // income-based calculation — NOT the ordinary-income base.
    tax += stateTax * local.yonkers.rate;
  }

  // Metro and Multnomah are NOT mutually exclusive — Multnomah is a SUBSET of
  // Metro's 3-county district, so a Multnomah filer owes BOTH, stacked.
  if ((localCode === 'metro' || localCode === 'multnomah') && local.metro) {
    const brax = local.metro.bracketsByStatus[status] || local.metro.bracketsByStatus.single;
    tax += bracketTax(base, brax);
  }
  if (localCode === 'multnomah' && local.multnomah) {
    const brax = local.multnomah.bracketsByStatus[status] || local.multnomah.bracketsByStatus.single;
    tax += bracketTax(base, brax);
  }

  // MD/IN: mandatory flat add-on for every resident — unconditional, ignores localCode.
  if (local.county) tax += base * local.county.rate;

  return Math.round(tax);
}
