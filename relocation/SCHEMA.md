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
    joint:  [ {rate, upTo}, ... ]    // MFJ thresholds (NOT just single x2 — encoded per state)
  },

  socialSecurity:
    { taxed: false }                                  // FL, NJ, MD, PA, WA, ...
    | { taxed: true,
        // SS is taxable, but exempt below an AGI threshold, phasing in above.
        exemptBelowAGI: { single: <num>, joint: <num> },
        phaseInAboveAGI: { single: <num>, joint: <num> } | null,
        // What fraction of SS benefits becomes taxable once fully phased in (state rule).
        // Most SS-taxing states cap inclusion at the federal 0.85; some differ.
        maxTaxableFraction: <0..1>                     // CT, MN, ...
      },

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
    | { treatment: "excludedPct", exclusionPct: <0..1> } // WI 0.30 (then ordinary on remainder)
    | { treatment: "separateTax",                        // WA: own excise, ignores brackets
        exemptBelow: <num>,                              // WA 278000
        ladder: [ {rate, upTo}, ... ] }                  // WA 7% to 1M, 9.9% above
}
```

### Worked semantics (how the engine computes one state's income tax)

Given a filing status and an income vector {ss, iraWithdrawal, pension, capGains, wages}:

1. Start `ordinaryIncome = wages + iraWithdrawal (if taxable per rules) + pension (if taxable)
   + taxableSS + capGains (unless capGains has its own treatment)`.
2. Apply `socialSecurity` rule → `taxableSS`.
3. Apply `retirementIncome` rule to `iraWithdrawal`:
   - "taxed" → fully in. "ageExempt" & age≥gate → out. "exclusion" → subtract the
     allowed exclusion (after cliff/phaseout math; and only if NOT excludesIRA).
4. Apply `pensionIncome` similarly to `pension`.
5. Apply `capitalGains`:
   - "ordinary" → capGains added to ordinaryIncome.
   - "excludedPct" → (1 - pct) × capGains added to ordinaryIncome.
   - "separateTax" → capGains taxed on its OWN ladder (above exemptBelow), NOT in brackets;
     and excluded from ordinaryIncome entirely.
6. Run `ordinaryIncome` through `bracketsByStatus[status]` → income tax.
7. Add any separateTax cap-gains tax. Result = state income tax (Tier 1).

Note: cliff/phaseout tests use AGI ≈ the full income vector total (the same quantity the
state uses), which is why a large IRA withdrawal can itself trip NJ's cliff — the tool
models that interaction rather than hand-waving it.

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
