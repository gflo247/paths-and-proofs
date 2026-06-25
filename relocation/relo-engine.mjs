// relo-engine.mjs — Tier-1 income-tax computation from the taxRules schema.
// This is the proof that the schema is COMPUTABLE. Pure function, no I/O.
//
// computeStateIncomeTax(rules, status, income) -> { tax, breakdown }
//   status: "single" | "joint"
//   income: { ss, iraWithdrawal, pension, capGains, wages, age }  (all $ ; age for gates)

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

// Allowed exclusion $ for retirement/pension income after cliff/phaseout + IRA-trap.
function allowedExclusion(excl, isIRA, agiProxy, status, cap) {
  if (!excl) return 0;
  if (isIRA && excl.excludesIRA) return 0;           // MD trap: IRA gets nothing
  if (excl.cliffType === "hard") {
    if (excl.cliffAGI && agiProxy > excl.cliffAGI[status]) return 0; // NJ: whole thing vanishes
    return cap;
  }
  if (excl.cliffType === "phaseout") {
    const full = excl.fullBelowAGI[status], zero = excl.zeroByAGI[status];
    if (agiProxy <= full) return cap;
    if (agiProxy >= zero) return 0;
    const frac = 1 - (agiProxy - full) / (zero - full);  // CT: linear ramp to zero
    return cap * frac;
  }
  return cap;
}

export function computeStateIncomeTax(rules, status, income) {
  const { ss = 0, iraWithdrawal = 0, pension = 0, capGains = 0, wages = 0, age = 67 } = income;
  // `status` is one of: single | mfj | mfs | hoh (four filing statuses, for brackets).
  // SS thresholds and exclusion cliffs are defined single-vs-married only, so map:
  // mfj -> "joint"; single/mfs/hoh -> "single" (MFS & HoH use single-level thresholds).
  const tStatus = status === 'mfj' ? 'joint' : 'single';
  const brackets = rules.bracketsByStatus[status] || rules.bracketsByStatus.single;
  const breakdown = {};

  // AGI proxy: the quantity states use for cliff/threshold tests. Full vector total
  // (a big IRA withdrawal can itself trip a cliff — we model that).
  const agiProxy = ss + iraWithdrawal + pension + capGains + wages;

  // --- Social Security ---
  const tSS = taxableSS(rules.socialSecurity, ss, agiProxy, tStatus);
  breakdown.taxableSS = tSS;

  // --- IRA / 401k / conversion withdrawal ---
  let iraTaxable = iraWithdrawal;
  const ri = rules.retirementIncome;
  if (ri.treatment === "exempt") iraTaxable = 0;
  else if (ri.treatment === "ageExempt") iraTaxable = (age >= (ri.ageGate ?? 0)) ? 0 : iraWithdrawal;
  else if (ri.treatment === "exclusion") {
    const gateOk = ri.ageGate == null || age >= ri.ageGate;
    const exAllowed = gateOk ? allowedExclusion(ri.exclusion, true, agiProxy, tStatus, tStatus === "joint" ? ri.exclusion.capJoint : ri.exclusion.capSingle) : 0;
    iraTaxable = Math.max(0, iraWithdrawal - exAllowed);
  } // "taxed" => unchanged
  breakdown.iraTaxable = iraTaxable;

  // --- Pension ---
  let penTaxable = pension;
  const pr = rules.pensionIncome.sameAs === "retirementIncome" ? rules.retirementIncome : rules.pensionIncome;
  if (pr.treatment === "exempt") penTaxable = 0;
  else if (pr.treatment === "ageExempt") penTaxable = (age >= (pr.ageGate ?? 0)) ? 0 : pension;
  else if (pr.treatment === "exclusion") {
    const gateOk = pr.ageGate == null || age >= pr.ageGate;
    const cap = tStatus === "joint" ? pr.exclusion.capJoint : pr.exclusion.capSingle;
    // Note: a real state shares ONE exclusion pool across IRA+pension; here pension uses its own
    // rule (MD: pension excludable, IRA not). For shared-pool states we model via sameAs.
    const exAllowed = gateOk ? allowedExclusion(pr.exclusion, false, agiProxy, tStatus, cap) : 0;
    penTaxable = Math.max(0, pension - exAllowed);
  }
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
