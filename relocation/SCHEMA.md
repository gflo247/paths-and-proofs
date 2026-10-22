# Relocation tax-data schema (`taxRules` + `taxContext`)

Status: **DRAFT — proving on stress-test states before rollout to all 51.**

This document defines the additive schema extension that powers the Relocation tool's
state-vs-state total-burden comparison. It extends each `facts` entry in
`roth-conversion/states.json` with two new sibling objects. It disturbs nothing existing:
the Roth tool keeps reading `facts.brackets` / `facts.roth`; these are new keys.

## Design principles (decided before encoding)

1. **Two tiers, kept structurally separate so code can't conflate them.**
   - **Tier 1 — `taxRules`**: state INCOME tax, computed precisely into the headline
     breakeven. Address-independent, fact-based, by filing status.
   - **Tier 2 — `taxContext`**: sales tax rate, median property tax rate, estate-tax flag.
     Disclosed as context; optionally turned into dollar ESTIMATES from user inputs;
     NEVER folded into the precise headline. When a Tier 2 input is skipped, the tool
     still shows direction + rough magnitude from the rate alone (informative floor).

2. **Income is a VECTOR, not a scalar.** A retiree has a mix: Social Security, IRA/401(k)
   withdrawals (incl. conversions), employer pension, capital gains, and possibly wages.
   Each STATE treats each COMPONENT differently (e.g. MD taxes IRA but exempts pension;
   WA taxes nothing but capital gains). So `taxRules` maps income-source → treatment.

3. **Stop lines (not modeled; disclosed in-UI):** county/municipal/city income taxes,
   sub-state property variation beyond the state median, vehicle/excise/registration
   taxes, editorial "tax-friendliness" scores. Transparency about these omissions is a
   feature, not an apology.

## `taxRules` (Tier 1 — computed)

```
taxRules: {
  bracketsByStatus: {
    single: [ {rate, upTo}, ... ],   // upTo:null on the open-ended top bracket
    mfj:    [ {rate, upTo}, ... ],    // married filing jointly (NOT just single x2 — per state)
    mfs:    [ {rate, upTo}, ... ],    // married filing separately (often == single, or mfj/2)
    hoh:    [ {rate, upTo}, ... ]     // head of household (varies: ==single, ==mfj, or own table)
  },
  // ENGINE NOTE: brackets use the 4-way status. SS thresholds & exclusion cliffs are
  // defined single-vs-married only, so the engine maps mfj->joint, single/mfs/hoh->single
  // for those threshold lookups (MFS & HoH use single-level phase-out thresholds).

  socialSecurity:
    { taxed: false }                                  // FL, NJ, MD, PA, WA, AR, ...
    | { taxed: true,
        // What a state can tax is the federally taxable part of the benefit (IRS Pub 915
        // worksheet), and its thresholds test FEDERAL AGI (other income + that part).
        // Exempt at or below the threshold; above it, taxable per phaseOut.
        exemptBelowAGI: { single: <num>, joint: <num> },
        hohMapsToJoint: <bool>,                        // CT, NM, UT: HoH uses the joint threshold
        phaseOut: null                                  // hard threshold (CT, NM, RI)
          | { type: "linear", width: <num> }            // VT: straight line over $10,000
          | { type: "stepped", step: <num>, pctPerStep: <0..1> }  // MN: 10% per $4,000 or fraction
          | { type: "creditReduction", perDollar: <num> },        // UT: credit less $0.025/$; flat-rate states only
        // Cap on the taxable share of the benefit (CT 0.25); 0.85 elsewhere, which the
        // federal figure never exceeds.
        maxTaxableFraction: <0..1>,
        ssAgeGate: <num>                                // RI: exemption needs full retirement age
      }
    | { taxed: true, followsFederalFormula: true }      // MT
    | { taxed: true, sharesRetirementCap: true, ... }   // CO (resolved in core/retirement-rules.js),

  // IRA / 401(k) / Roth-conversion WITHDRAWAL income.
  retirementIncome: {
    treatment: "taxed"                                 // MN: fully taxed, no break
              | "exempt"                                // (state fully exempts retirement income)
              | "ageExempt"                             // PA: exempt at/after an age gate
              | "exclusion",                            // NJ, CT: capped exclusion w/ cliff
    ageGate: <num> | null,                              // PA 59.5, NJ 62; null if none
    exclusion: null | {
      capSingle: <num>, capJoint: <num>,                // max $ of retirement income excludable
      // Cliff mechanics — the part that prose can't compute:
      cliffType: "hard" | "phaseout",
      // hard (NJ): if AGI > cliffAGI, the WHOLE exclusion vanishes.
      cliffAGI: { single: <num>, joint: <num> } | null,
      // phaseout (CT): exclusion ramps from full (at/under fullBelowAGI) to zero (at zeroByAGI).
      fullBelowAGI: { single: <num>, joint: <num> } | null,
      zeroByAGI:    { single: <num>, joint: <num> } | null,
      // The IRA-exclusion TRAP (MD, ME, RI): the exclusion exists but does NOT apply to
      // IRA/conversion income (only to qualified employer-plan/pension income).
      excludesIRA: <bool>                               // MD true
    }
  },

  // Employer PENSION income, treated separately from IRA (states differ — MD is the case).
  // Shape mirrors retirementIncome; often the exclusion DOES apply here even when excludesIRA.
  pensionIncome: { treatment, ageGate, exclusion } | { sameAs: "retirementIncome" },

  // Capital gains. Default "ordinary" = flows through bracketsByStatus (most states).
  capitalGains:
      { treatment: "ordinary" }                         // ~33 states + (0 in no-tax states)
    | { treatment: "excludedPct",                       // WI 0.30, SC 0.44, AR 0.50
        exclusionPct: <0..1>,
        // Optional refinements (NM-style deductions need these):
        minDeduction: <num> | null,                     // "greater of $X or pct" floor
        maxGainEligible: <num> | null,                  // pct applies only up to this gain
        // CRITICAL for a RELOCATION tool modeling PORTFOLIO gains:
        sourceRestricted: <bool>                         // true => break applies ONLY to in-state
      }                                                  // real-estate/business gains, NOT to
                                                         // publicly-traded securities. For a
                                                         // retiree's brokerage gains, the engine
                                                         // treats a sourceRestricted break as NOT
                                                         // applying (ordinary), and the UI discloses
                                                         // it. NM/CO/ID/LA/OK are source-restricted.
    | { treatment: "separateTax",                        // WA: own excise, ignores brackets
        exemptBelow: <num>,                              // WA 278000
        ladder: [ {rate, upTo}, ... ] }                  // WA 7% to 1M, 9.9% above
    | { treatment: "stacked",                            // MT 3.0%/4.1%, HI capped at 7.25%
        ladderByStatus: { single|mfj|mfs|hoh: [ {rate, upTo}, ... ] } }
                                                         // gains taxed on their own ladder,
                                                         // positioned on top of other income

  // OPTIONAL: state standard deduction, personal exemption, age-65 add-on, exemption credit.
  // States without this key get no deduction (status quo). The three sub-keys are all optional
  // but at least one must be present when the top-level key exists.
  standardDeduction: {
    // Deduction from income (subtracted BEFORE brackets). At least `single` must be present;
    // others default to `single` if absent. For states that conform to the federal standard
    // deduction (CO, ID, MT, ND, etc.), encode the federal amounts here.
    // For states where "personal exemption" acts as a deduction from income (MI, IL, IN, etc.),
    // combine the standard deduction and personal exemption into one amount here.
    deduction: {
      single: <num>, mfj: <num>, mfs: <num>, hoh: <num>,
      // Optional income-based phase-out (not currently used by any encoded state):
      phaseout: { threshold: <num>, rate: <0..1> } | null
    } | null,

    // Additional deduction per qualifying filer aged 65+. For MFJ, multiplied by the count
    // of 65+ spouses (0, 1, or 2); for other statuses, applied once if the filer is 65+.
    // `joint` is the per-person amount for MFJ; `single` for all other statuses.
    age65AddOn: { single: <num>, joint: <num> } | null,

    // Credit subtracted from TAX (not income) AFTER bracket computation. Floors at $0.
    // Applied only to incomeTax, NOT to cgSeparateTax. `perFiler` is per filing person
    // (MFJ gets 2x); `age65Bonus` is an additional credit per filer aged 65+.
    exemptionCredit: { perFiler: <num>, age65Bonus: <num> | null } | null
  } | null
}
```

### Worked semantics (how the engine computes one state's income tax)

Given a filing status and an income vector {ss, iraWithdrawal, pension, capGains, wages}:

1. Start `ordinaryIncome = wages + iraWithdrawal (if taxable per rules) + pension (if taxable)
   + taxableSS + capGains (unless capGains has its own treatment)`.
2. Apply `socialSecurity` rule → `taxableSS` (from the federally taxable part of the
   benefit, thresholds tested on federal AGI).
3. Apply `retirementIncome` rule to `iraWithdrawal`:
   - "taxed" → fully in. "ageExempt" & age≥gate → out. "exclusion" → subtract the
     allowed exclusion (after cliff/phaseout math; and only if NOT excludesIRA).
4. Apply `pensionIncome` similarly to `pension`.
5. Apply `capitalGains`:
   - "ordinary" → capGains added to ordinaryIncome.
   - "excludedPct" → (1 - pct) × capGains added to ordinaryIncome.
   - "separateTax" → capGains taxed on its OWN ladder (above exemptBelow), NOT in brackets;
     and excluded from ordinaryIncome entirely.
   - "stacked" → capGains taxed on its own ladder, each dollar at the rate for the band it
     lands in once the other income is counted first; excluded from ordinaryIncome.
6. Apply `standardDeduction` (if present):
   - Subtract `deduction[status]` (or `deduction.single` as fallback) from ordinaryIncome,
     flooring at 0. If `deduction.phaseout` exists, the base deduction is reduced by
     `rate × max(0, nonCG - threshold)` before subtracting (nonCG = pre-deduction
     non-capital-gains income).
   - Add `age65AddOn`: for MFJ, `joint × (count of spouses aged 65+)`; otherwise
     `single × (age >= 65 ? 1 : 0)`.
   - The deduction is also used by the stacked capital-gains treatment (HI, MT), which
     needs the post-deduction taxable base to position gains correctly.
7. Run the post-deduction ordinaryIncome through `bracketsByStatus[status]` → income tax.
8. Subtract `exemptionCredit` from income tax (flooring at 0). The credit is
   `perFiler × filerCount + age65Bonus × (count of 65+ filers)`. It applies only to
   income tax, NOT to cgSeparateTax.
9. Add any separateTax / stacked cap-gains tax. Result = state income tax (Tier 1).

Note: cliff/phaseout tests use federal AGI — the income vector with only the federally
taxable part of Social Security (NJ and VA back Social Security out entirely, via
thresholdExcludesSS) — which is why a large IRA withdrawal can itself trip NJ's cliff; the
tool models that interaction rather than hand-waving it.

## `taxContext` (Tier 2 — disclosed, optionally estimated, never in headline)

```
taxContext: {
  salesTaxRate: <num>,            // state rate (state-level; local add-ons NOT modeled)
  salesTaxNote: <str> | null,     // e.g. "groceries exempt", "no state sales tax"
  propertyTaxRateMedian: <num>,   // median EFFECTIVE rate on home value (varies by locality!)
  estateTax: { has: <bool>, kind: "estate"|"inheritance"|null, exemption: <num>|null, note }
}
```

Engine for Tier 2 is deliberately simple and always disclosed:
- If user enters home value → `propertyTaxRateMedian × value` shown as an ESTIMATE with a
  "varies by locality" caveat. If skipped → show the rate, the direction it favors, and a
  representative-home estimate, clearly labeled illustrative.
- If user enters taxable spending → `salesTaxRate × spending` as an ESTIMATE. If skipped →
  show the rate and a representative-spending illustration.
- Estate tax is a FLAG with exemption, never an annual line.

## Stress-test set (encode + build engine against these BEFORE rollout)

| State | Stresses |
|-------|----------|
| NJ | retirementIncome exclusion, **hard cliff**, age gate 62; SS untaxed |
| CT | retirementIncome exclusion, **phaseout cliff**; SS taxed w/ threshold |
| MD | **excludesIRA trap** (pension exempt, IRA taxed); county tax (Tier-2 note) |
| MN | retirement fully **taxed**; SS taxed w/ phase-out threshold |
| PA | **ageExempt** retirement (flat bracket) |
| WA | no income tax BUT **separateTax capital gains** (the outlier) |
| WI | **excludedPct capital gains** (0.30) |
| FL | trivial baseline (no income tax, nothing taxed) |

If one structure expresses all eight computably and the engine returns sane burdens,
the shape is proven and we roll it to the remaining 43 states.
