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

  // OPTIONAL: state standard deduction, personal exemptions, age add-ons, the federal senior
  // deduction, the federal income tax subtraction, phase-outs and credits. States without this
  // key get none (PA, and the states with no income tax). Every key is optional, but
  // check-states-json.mjs (G8) rejects an unknown key or an empty block. Figures are each
  // state's latest published year (see SOURCES.md).
  standardDeduction: {
    // Subtracted from income before the brackets. All four statuses required. For states
    // that use the federal standard deduction (CO, ID, IA, MO, MT, ND, NM), the federal
    // amounts. A personal exemption with no phase-out of its own (or the same one) is folded
    // in here (MI, IL, IN, NJ, WV, MA, HI, MS, VA, KS, OK, RI, VT; CT, whose exemption is all
    // it has).
    deduction: { single: <num>, mfj: <num>, mfs: <num>, hoh: <num> },

    // Per person 65 or older: the filer, plus the spouse on a joint return (spouseAge, or the
    // filer's age when omitted). `married` applies to joint AND separate returns, as on the
    // federal return; `unmarried` to single and head of household.
    age65AddOn: { unmarried: <num>, married: <num> },

    // Phase-out of deduction + age65AddOn (PO, below): ME, SC, RI, IL, CT, AL, WI.
    phaseOut: PO,

    // A personal exemption kept apart from the deduction: perPerson (2 on a joint return)
    // with its own phase-out (ME, MD, OH: phaseOut applies to perPerson), plus hohExtra for
    // head of household (AL) and age65Extra per person 65+ (WI), never phased out.
    exemption: { perPerson: <num>, hohExtra: <num>, age65Extra: <num>, phaseOut: PO },

    // The federal enhanced deduction for seniors (IRC 151(d)(5)(C), 2025-2028): $6,000 per
    // person 65+, less 6% of federal AGI over $75,000 ($150,000 joint) off each person's
    // $6,000, none for married filing separately. Only for states whose taxable income starts
    // from federal taxable income or that adopted it: CO, ID, IA, MT, ND.
    federalSeniorDeduction: true,

    // Federal income tax subtracted from income (AL, MO, OR), from the engine's own estimate:
    // 2026 federal brackets, gains rates, standard deduction with the 65+ amount, and the
    // senior deduction (FEDERAL_2026, kept equal to the Roth tool's by a test). `share` is the
    // part that counts, by income (MO: 35% down to 0% by Missouri AGI); `cap` the most that
    // can be subtracted, which `capPhaseOut` shrinks (OR: $8,750, 80% to 0% from $125,000 of
    // federal AGI); `includesNIIT` counts the 3.8% net investment income tax (AL).
    // Default: all of it, no cap.
    federalTaxDeduction: { share: PO, cap: { single, mfj, mfs, hoh }, capPhaseOut: PO,
                           includesNIIT: true },

    // Credit off the bracket tax (not the separate capital gains tax), floored at $0:
    // perFiler each (2 on a joint return), hohExtra for head of household (AR, IA),
    // ageBonus per person at or over `age` (65; DE uses 60), all scaled by phaseOut (OR).
    exemptionCredit: { perFiler: <num>, hohExtra: <num>, ageBonus: { age: <num>, amount: <num> },
                       phaseOut: PO },

    // Other credits off the bracket tax, added together (with exemptionCredit) and floored at
    // $0 with it. Each may carry its own phaseOut, which (unlike a deduction's) may also test
    // "stateTaxableIncome" (OH: MAGI less exemptions) or "retirementIncome" (the IRA and pension
    // income left in state AGI).
    credits: [
      { type: "percentOfTax", basis, bands: {single|mfj|mfs|hoh: [ {over | atLeast, rate}, ... ]} },
          // a share of the bracket tax set by income; none below the first band (CT Table E)
      { type: "ofDeduction", rate, deduction: {single, mfj, mfs, hoh},
        age65AddOn: {unmarried, married}, phaseOut: PO },
          // rate x (deduction + the 65+ amount per person), then phased out (UT: 6% of the
          // federal standard deduction, less 1.3% of income over a base: a `rate` PO)
      { type: "flat", amount, per: "person" | "return", age, phaseOut: PO },
          // a set amount per person or per return; with `age`, per person that age or older,
          // or once per return if anyone is (OH: $20 an exemption; $50 senior credit)
      { type: "schedule", basis, bands: {single|mfj|mfs|hoh: [ {over | atLeast, amount}, ... ]},
        phaseOut: PO }
          // an amount looked up by income, rising (OH's retirement income credit table)
    ]
  } | null
}

// PO — what is left of an amount after an income phase-out. basis: "federalAGI" or
// "stateAGI" (income before deductions, after the state's own exclusions); credits also
// "stateTaxableIncome" and "retirementIncome".
//   { type: "linear", basis, start: {single, mfj, mfs, hoh}, width: {single, mfj, mfs, hoh} }
//       // falls in a straight line from start to zero at start + width (ME, SC)
//   { type: "bands", basis, bands: {single|mfj|mfs|hoh: [ {over | atLeast, factor | amount}, ... ]} }
//       // past a band's threshold (`over`: strictly above; `atLeast`: at or above) the amount
//       // becomes factor x itself, or the band's own amount; the last band passed wins (MD steps,
//       // RI's 20% steps, OH's exemption by income, OR's federal tax limit and MO's share, and
//       // cutoffs such as OR's credit and IL's exemption: one band with factor 0)
//   { type: "steps", basis, start, step, perStep, floor }       (each {single, mfj, mfs, hoh})
//       // less perStep for each step of income, or fraction of one, over start, down to floor
//       // (CT's exemption: $1,000 per $1,000; AL's standard deduction chart)
//   { type: "rate", basis, rules: {single|mfj|mfs|hoh: [ {start, rate, amount?}, ... ]} }
//       // less rate per dollar over start, down to zero; with several rules, the largest result,
//       // a rule with its own amount starting from that, never above the amount itself (WI's
//       // standard deduction, whose head-of-household formula meets the single one; UT's credit)
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
6. Apply `standardDeduction` (if present): `deduction[status]` plus `age65AddOn` per
   person 65+, through `phaseOut`; plus the exemption (`perPerson` per person through its
   own phase-out, plus its head-of-household and 65+ extras); plus the federal senior
   deduction where flagged; plus the federal income tax subtraction where present. Phase-outs
   test federal AGI or the state's own AGI (ordinary income before deductions, gains included).
7. Taxable income = ordinaryIncome less the deductions, floored at 0. For the stacked
   capital-gains treatment (HI, MT) deductions come off the other income first and any
   left over reduces the gains. Local taxes (NYC, OR Metro/Multnomah, MD and IN county)
   use this taxable income.
8. Run taxable income through `bracketsByStatus[status]` → income tax, then subtract the
   `exemptionCredit` and the `credits` (together floored at 0). They apply only to that
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
