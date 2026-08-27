// medicare-engine.mjs — pure computation for the Medigap-vs-Medicare-Advantage breakeven.
// Reads one state's entry from medicare/states.json. Pure function, no I/O — testable
// standalone, same discipline as relocation/relo-engine.mjs.
//
// computeMedigapBreakeven(stateRules, inputs) -> { ...result }
//   stateRules: one state's entry from states.json (e.g. states["MI"]), or null/undefined
//     if no state selected yet — the function still returns a usable result with
//     ratingContext/guaranteedIssueContext marked "unknown" rather than throwing.
//   inputs: {
//     medigapMonthlyPremium,      // the user's REAL quote. This tool never guesses this
//                                 // number — no primary source exists for actual Medigap
//                                 // premiums (insurer-set, vary by company/age/state).
//     partDMonthlyPremium,        // OPTIONAL, defaults to 0. Medigap doesn't include drug
//                                 // coverage — a real comparison needs the user's own
//                                 // standalone Part D quote, same "supply your real number"
//                                 // pattern as the Medigap premium itself. Deliberately NOT
//                                 // asked on the Advantage side: the vast majority of
//                                 // Medicare Advantage enrollees are in MAPD plans that
//                                 // already bundle drug coverage into the premium/OOP figures
//                                 // being compared — see partDNotIncluded below for the caveat
//                                 // this default produces.
//     advantageMonthlyPremium,    // OPTIONAL, defaults to 0 (the common case)
//     advantageOOPMax,            // OPTIONAL, defaults to the 2026 CMS in-network ceiling
//     coinsuranceRate,            // OPTIONAL, defaults to 0.20 (Medicare Part B's standard
//                                 // coinsurance share) — see the constant below for why
//     partBDeductible,            // OPTIONAL, defaults to the 2026 figure
//   }
//
// The core idea: Medigap's annual cost is effectively FLAT regardless of how much care
// gets used — premium plus the small Part B deductible, then near-total coverage. That
// predictability is the entire point of the insurance. Medicare Advantage's cost GROWS
// with utilization up to its out-of-pocket cap, then flatlines too, just at a much higher
// ceiling. So the real breakeven isn't a year or an age — it's a DOLLAR AMOUNT OF MEDICAL
// CARE USED IN A YEAR, above which Medigap's flat cost undercuts Advantage's accumulating
// one. See _dev/medicare-research-2026-08.md and the 2026-08-20 conversation that scoped
// this design for the full reasoning.

// 2026 CMS national figures — PRIMARY-sourced, see _dev/medicare-research-2026-08.md
// section 1 for the full citation trail.
// Part B deductible: CMS Federal Register notice CMS-8091-N, "Medicare Program; Medicare
// Part B Monthly Actuarial Rates, Premium Rates, and Annual Deductible Beginning January 1,
// 2026" — https://public-inspection.federalregister.gov/2025-20251.pdf — quoted directly:
// "The Part B deductible for 2026 is $283.00 for all Part B beneficiaries."
export const DEFAULT_ADVANTAGE_OOP_MAX = 9250; // in-network ceiling; combined in+out-of-network is $13,900
// ^ CMS's own "Final Contract Year (CY) 2026 Standards for Part C Benefits, Bid Review and
// Evaluation" memorandum (April 16, 2025), Table 3 "FINAL CY 2026 PART C MOOP LIMITS BY PLAN
// TYPE" — https://mabenefitsmailbox.lmi.org/MABenefitsMailbox/S3Browser/GetFile?path=Final+CY+2026+Part+C+Bid+Review+Memorandum+and+Appendix-4-15-25.pdf
// (CMS's official MA-plan mailbox distribution system, run by contractor LMI — not cms.gov's
// own domain, but the genuine primary document, not a secondary summary of it).
export const DEFAULT_PART_B_DEDUCTIBLE = 283;
export const DEFAULT_COINSURANCE_RATE = 0.20;
// ^ Medicare Part B's standard coinsurance is 20% of the Medicare-approved amount for most
// services — a well-established federal baseline. Real Medicare Advantage plans use a mix
// of flat copays and coinsurance that varies by service and by specific plan, so this is a
// simplified blended proxy, not plan-specific precision. Disclose this approximation to the
// user rather than presenting the breakeven as more exact than the underlying data allows —
// same posture Roth takes with its own disclosed approximations (e.g. state conversion
// rates as "effective approximations").

export function computeMedigapBreakeven(stateRules, inputs) {
  const {
    medigapMonthlyPremium,
    partDMonthlyPremium = 0,
    advantageMonthlyPremium = 0,
    advantageOOPMax = DEFAULT_ADVANTAGE_OOP_MAX,
    coinsuranceRate = DEFAULT_COINSURANCE_RATE,
    partBDeductible = DEFAULT_PART_B_DEDUCTIBLE,
  } = inputs;

  const medigapAnnualPremium = medigapMonthlyPremium * 12;
  const partDAnnualPremium = partDMonthlyPremium * 12;
  const advantageAnnualPremium = advantageMonthlyPremium * 12;

  // Medigap's total annual cost, effectively flat above the Part B deductible — this
  // tool does not model the smaller plan-letter-specific gaps (e.g. Plan N's office-visit
  // copays); see the benefit-grid reference data in states.json for that level of detail.
  // Includes the standalone Part D premium, since Medigap itself carries no drug coverage.
  const medigapAnnualCost = medigapAnnualPremium + partDAnnualPremium + partBDeductible;

  // What Advantage's accumulated cost-sharing has to reach before Medigap's flat cost
  // becomes the cheaper path.
  const premiumDifferential = medigapAnnualCost - advantageAnnualPremium;

  let breakevenUtilization = null;
  let medigapEverWins;

  if (premiumDifferential <= 0) {
    // Medigap's flat cost is at or below Advantage's premium alone, before any care is
    // used at all — an edge case (e.g. an unusually cheap Medigap quote in a favorable
    // rating state against a $0 Advantage plan), but the math should still hold up.
    breakevenUtilization = 0;
    medigapEverWins = true;
  } else if (coinsuranceRate <= 0) {
    // Guard against Infinity: a 0% coinsurance rate would mean Advantage cost-shares
    // nothing ever, so no utilization level makes Medigap the cheaper choice. Treat the
    // same as the "never wins" branch below rather than dividing by zero — Infinity
    // silently becomes null through JSON.stringify, which would corrupt this value
    // anywhere it's serialized (an API response, localStorage) without visibly erroring.
    medigapEverWins = false;
  } else if (premiumDifferential < advantageOOPMax) {
    // A real crossover exists within a normal year's utilization range.
    breakevenUtilization = premiumDifferential / coinsuranceRate;
    medigapEverWins = true;
  } else {
    // Even maxing out Advantage's out-of-pocket ceiling costs less than Medigap's flat
    // cost this year — on pure this-year math, Medigap does not win at these premiums, no
    // matter how much care gets used. (Doesn't mean Medigap is the wrong choice — see
    // ratingContext/guaranteedIssueContext for the multi-year and switching-risk picture
    // this single-year number can't capture.)
    medigapEverWins = false;
  }

  return {
    medigapAnnualCost,
    partDAnnualPremium,
    partDNotIncluded: partDMonthlyPremium === 0,
    // ^ true whenever the caller left Part D at its $0 default — could mean the person
    // genuinely doesn't need drug coverage, or could mean they just didn't enter it. Not
    // enough information here to tell the difference, so surface it as a caveat to check
    // rather than silently assume $0 is correct; the UI layer should prompt for this
    // explicitly rather than treat a blank field as "no drug costs."
    advantageAnnualPremium,
    advantageAnnualCostAtOOPMax: advantageAnnualPremium + advantageOOPMax,
    premiumDifferential,
    breakevenUtilization,
    medigapEverWins,
    ratingContext: describeRating(stateRules?.rating),
    guaranteedIssueContext: describeGuaranteedIssue(stateRules?.guaranteedIssuePeriods),
  };
}

const RATING_TRAJECTORY = {
  community: "flat — this state requires your Medigap premium to stay the same regardless of your age",
  issueAgeMandated: "locked at your enrollment age — this state requires issue-age pricing, so your premium won't rise just because you get older",
  attainedAgeBanned: "likely flat or age-locked, but insurer-dependent — this state bans attained-age pricing, leaving issue-age or community pricing up to the insurer",
  noMandate: "likely rising with age — no state law restricts the pricing method here, and attained-age pricing (premiums that climb every year) is the most common market practice",
  unverified: "unknown — this state's rating method could not be verified from a primary source",
};

function describeRating(rating) {
  if (!rating) {
    return { method: "unknown", trajectory: "unknown — no state selected yet" };
  }
  return {
    method: rating.method,
    trajectory: RATING_TRAJECTORY[rating.method] || "unknown",
    disabilitySplit: !!rating.disabilitySplit,
    citation: rating.citation || null,
    confidence: rating.confidence || null,
  };
}

function describeGuaranteedIssue(periods) {
  if (!periods || periods.length === 0) {
    return {
      hasProtection: false,
      summary: "No state-specific guaranteed-issue right found beyond the one-time federal window at initial enrollment. Once that window closes, switching plans can mean medical underwriting.",
    };
  }
  return {
    hasProtection: true,
    periods: periods.map((p) => ({
      trigger: p.trigger,
      windowAnchor: p.windowAnchor || null,
      windowDays: p.windowDays,
      insurerScope: p.insurerScope,
      benefitLevel: p.benefitLevel,
      appliesTo: p.appliesTo,
      restrictions: p.restrictions || null,
      notYetEffective: !!p.notYetEffective,
      effectiveDate: p.effectiveDate || null,
      confidence: p.confidence || null,
    })),
  };
}
