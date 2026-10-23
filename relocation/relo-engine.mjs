// relo-engine.mjs — Tier-1 income-tax computation from the taxRules schema.
// This is the proof that the schema is COMPUTABLE. Pure function, no I/O.
//
// computeStateIncomeTax(rules, status, income) -> { tax, breakdown }
//   status: "single" | "mfj" | "mfs" | "hoh"
//   income: { ss, iraWithdrawal, pension, capGains, wages, age, spouseAge }
//   (all $ ; age/spouseAge for gates — spouseAge is OPTIONAL and only consulted for
//   joint returns; when omitted the spouse is taken to be the filer's age, the
//   page's same-age assumption — see the per-person cliffTypes and the age-65
//   deduction counts below.)
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

// --- Deductions, exemptions and credits (taxRules.standardDeduction) ---
// The federal enhanced deduction for seniors (IRC 151(d)(5)(C), tax years 2025-2028; IRS
// Schedule 1-A Part V): $6,000 for each person 65 or older, less 6% of modified AGI over
// $75,000 ($150,000 joint). The reduction is figured once for the return and each qualifying
// spouse gets the reduced amount; married filing separately can't claim it. It is part of
// federal taxable income, so it reaches only the states that start from federal taxable
// income or adopted it (federalSeniorDeduction: true).
const SENIOR_DEDUCTION = { perPerson: 6000, rate: 0.06, startJoint: 150000, startOther: 75000 };

// `aged`: the number of people on the return 65 or older (the filer, plus the spouse on a joint
// return).
function seniorDeductionAmount(status, fedAGI, aged) {
  if (status === 'mfs') return 0;
  const s = SENIOR_DEDUCTION;
  const excess = Math.max(0, fedAGI - (status === 'mfj' ? s.startJoint : s.startOther));
  return Math.max(0, s.perPerson - s.rate * excess) * aged;
}

// Federal income tax, for the states that subtract some or all of it (AL, MO, OR —
// federalTaxDeduction). 2026 figures (IRS Rev. Proc. 2025-32), the same ones the Roth tool uses;
// _dev/test-relo-federal-tax.mjs fails if the two drift apart. AL's and MO's own figures are for
// 2025, whose federal tax runs a little higher, so their subtraction can come out a little low and
// the state tax a little high, never the reverse. Figured on this engine's income vector:
// ordinary brackets on income less the standard deduction (with the extra amount at 65, IRC
// 63(f)) and the senior deduction, long-term gains stacked on top at 0/15/20% (the federal
// capital gains worksheet). No credits, and not the other taxes some states also count (the 10%
// additional tax on early IRA withdrawals, for one), which errs the same way.
export const FEDERAL_2026 = {
  brackets: {
    single: [{ rate: 0.10, upTo: 12400 }, { rate: 0.12, upTo: 50400 }, { rate: 0.22, upTo: 105700 }, { rate: 0.24, upTo: 201775 }, { rate: 0.32, upTo: 256225 }, { rate: 0.35, upTo: 640600 }, { rate: 0.37, upTo: null }],
    mfj: [{ rate: 0.10, upTo: 24800 }, { rate: 0.12, upTo: 100800 }, { rate: 0.22, upTo: 211400 }, { rate: 0.24, upTo: 403550 }, { rate: 0.32, upTo: 512450 }, { rate: 0.35, upTo: 768700 }, { rate: 0.37, upTo: null }],
    mfs: [{ rate: 0.10, upTo: 12400 }, { rate: 0.12, upTo: 50400 }, { rate: 0.22, upTo: 105700 }, { rate: 0.24, upTo: 201775 }, { rate: 0.32, upTo: 256225 }, { rate: 0.35, upTo: 384350 }, { rate: 0.37, upTo: null }],
    hoh: [{ rate: 0.10, upTo: 17700 }, { rate: 0.12, upTo: 67450 }, { rate: 0.22, upTo: 105700 }, { rate: 0.24, upTo: 201750 }, { rate: 0.32, upTo: 256200 }, { rate: 0.35, upTo: 640600 }, { rate: 0.37, upTo: null }],
  },
  gains: {
    single: [{ rate: 0, upTo: 49450 }, { rate: 0.15, upTo: 545500 }, { rate: 0.20, upTo: null }],
    mfj: [{ rate: 0, upTo: 98900 }, { rate: 0.15, upTo: 613700 }, { rate: 0.20, upTo: null }],
    mfs: [{ rate: 0, upTo: 49450 }, { rate: 0.15, upTo: 306850 }, { rate: 0.20, upTo: null }],
    hoh: [{ rate: 0, upTo: 66200 }, { rate: 0.15, upTo: 579600 }, { rate: 0.20, upTo: null }],
  },
  standardDeduction: { single: 16100, mfj: 32200, mfs: 16100, hoh: 24150 },
  age65AddOn: { unmarried: 2050, married: 1650 }, // per person 65+, IRC 63(f)
  // Net investment income tax (IRC 1411): 3.8% of investment income (here, the gains) over these
  // modified AGI amounts, which are set in the statute and not indexed. Only AL counts it.
  niit: { rate: 0.038, threshold: { single: 200000, mfj: 250000, mfs: 125000, hoh: 200000 } },
};

function estimateFederalTax(status, { fedAGI, capGains, aged }) {
  const F = FEDERAL_2026;
  const married = status === 'mfj' || status === 'mfs';
  const deductions = F.standardDeduction[status] + (married ? F.age65AddOn.married : F.age65AddOn.unmarried) * aged
    + seniorDeductionAmount(status, fedAGI, aged);
  const ordinaryTaxable = Math.max(0, fedAGI - capGains - deductions);
  const taxable = Math.max(0, fedAGI - deductions); // the gains are the slice above ordinaryTaxable
  const gains = F.gains[status];
  return {
    incomeTax: bracketTax(ordinaryTaxable, F.brackets[status]) + bracketTax(taxable, gains) - bracketTax(ordinaryTaxable, gains),
    niit: F.niit.rate * Math.min(capGains, Math.max(0, fedAGI - F.niit.threshold[status])),
  };
}

// A band's threshold: `atLeast` (the income is at or above it) or `over` (strictly above it),
// whichever the form's own table uses.
const bandPassed = (band, income) => (band.atLeast != null ? income >= band.atLeast : income > band.over);

// What is left of `amount` after an income-based phase-out (no `po`: all of it).
//   linear: falls in a straight line from `start` to zero at `start + width` (ME, SC).
//   bands:  past a band's threshold the amount becomes `factor` times itself, or the band's own
//           `amount`; the last band passed wins (MD's exemption steps, RI's 20% steps, OH's
//           exemption by income, OR's federal tax limit, and cutoffs such as OR's credit and
//           IL's exemption).
//   steps:  less `perStep` for each `step` of income, or fraction of one, over `start`, down to
//           `floor` (CT's exemption; AL's standard deduction chart).
//   rate:   less `rate` per dollar of income over `start`, down to zero. With several rules for a
//           status, the largest result, a rule with its own `amount` starting from that (WI's
//           head-of-household deduction meets the single one and then follows it).
function applyPhaseOut(po, status, income, amount) {
  if (!po) return amount;
  if (po.type === 'linear') {
    const excess = income - po.start[status];
    return excess <= 0 ? amount : amount * (1 - Math.min(1, excess / po.width[status]));
  }
  if (po.type === 'bands') {
    let out = amount;
    for (const b of po.bands[status]) if (bandPassed(b, income)) out = b.amount != null ? b.amount : amount * b.factor;
    return out;
  }
  if (po.type === 'steps') {
    const excess = income - po.start[status];
    if (excess <= 0) return amount;
    return Math.max(po.floor ? po.floor[status] : 0, amount - po.perStep[status] * Math.ceil(excess / po.step[status]));
  }
  if (po.type === 'rate') {
    const left = po.rules[status].map((r) => (r.amount ?? amount) - r.rate * Math.max(0, income - r.start));
    return Math.min(amount, Math.max(0, ...left));
  }
  throw new Error(`relo-engine: unknown standardDeduction phase-out type "${po.type}"`);
}

// The value (`rate` or `amount`) of the last band an income has passed; 0 below the first.
function bandValue(bands, income, key) {
  let value = 0;
  for (const b of bands) if (bandPassed(b, income)) value = b[key];
  return value;
}

// Who on the return counts: `age` is the filer's; on a joint return the spouse counts too, at
// `spouseAge ?? age` (the same-age default the rest of this engine and the page use).
function household(status, age, spouseAge) {
  const spAge = spouseAge ?? age;
  return {
    people: status === 'mfj' ? 2 : 1,
    married: status === 'mfj' || status === 'mfs',
    agedCount: (minAge) => (age >= minAge ? 1 : 0) + (status === 'mfj' && spAge >= minAge ? 1 : 0),
  };
}

// The income a phase-out or credit is tested against. stateAGI is ordinary income before
// deductions (the state's own AGI); fedAGI is federal AGI. Credits may also test the state's
// taxable income (OH: "MAGI less exemptions") and retirement income (OH's retirement credit
// table: the IRA and pension income left in state AGI).
function basisValue(basis, values) {
  const v = values[basis];
  if (v == null) throw new Error(`relo-engine: basis "${basis}" isn't available here`);
  return v;
}

// Returns { deductible, seniorDeduction, federalTax, federalTaxDeduction }: the amount subtracted
// from income before the brackets, and within it the federal senior deduction and the
// federal-tax subtraction (with the federal tax estimate it came from; 0 for states without one).
function resolveDeductions(sd, status, { age, spouseAge, fedAGI, stateAGI, capGains }) {
  const out = { deductible: 0, seniorDeduction: 0, federalTax: 0, federalTaxDeduction: 0 };
  if (!sd) return out;
  const { people, married, agedCount } = household(status, age, spouseAge);
  const phase = (po, amount) => (po ? applyPhaseOut(po, status, basisValue(po.basis, { federalAGI: fedAGI, stateAGI }), amount) : amount);

  // Standard deduction (with any personal exemptions folded in) plus the age-65 add-on, which
  // shares its phase-out. Married filing separately gets the married add-on, as on the
  // federal return.
  let base = sd.deduction ? sd.deduction[status] : 0;
  if (sd.age65AddOn) base += (married ? sd.age65AddOn.married : sd.age65AddOn.unmarried) * agedCount(65);
  base = phase(sd.phaseOut, base);

  // A personal exemption kept apart from the deduction: its own phase-out per person (ME, MD,
  // OH), an extra amount for head of household (AL) or per person 65+ (WI), never phased out.
  let exemption = 0;
  const ex = sd.exemption;
  if (ex) {
    exemption = phase(ex.phaseOut, ex.perPerson) * people
      + (status === 'hoh' ? (ex.hohExtra ?? 0) : 0) + (ex.age65Extra ?? 0) * agedCount(65);
  }

  const senior = sd.federalSeniorDeduction ? seniorDeductionAmount(status, fedAGI, agedCount(65)) : 0;

  // Federal income tax subtracted (AL, MO, OR): the `share` of the federal tax that counts (MO's
  // percentage by Missouri AGI), up to a `cap` that `capPhaseOut` shrinks (OR's by federal AGI).
  const f = sd.federalTaxDeduction;
  if (f) {
    const t = estimateFederalTax(status, { fedAGI, capGains, aged: agedCount(65) });
    out.federalTax = t.incomeTax + (f.includesNIIT ? t.niit : 0);
    out.federalTaxDeduction = phase(f.share, out.federalTax);
    if (f.cap) out.federalTaxDeduction = Math.min(out.federalTaxDeduction, phase(f.capPhaseOut, f.cap[status]));
  }
  out.deductible = base + exemption + senior + out.federalTaxDeduction;
  out.seniorDeduction = senior;
  return out;
}

// Returns { exemptionCredit, credits }: what comes off the bracket tax, from the
// `exemptionCredit` block and from the `credits` list. Nonrefundable: the caller floors the tax
// at zero.
function resolveCredits(sd, status, { age, spouseAge, fedAGI, stateAGI, taxableIncome, incomeTax, retirementIncome }) {
  const out = { exemptionCredit: 0, credits: 0 };
  if (!sd) return out;
  const { people, married, agedCount } = household(status, age, spouseAge);
  const values = { federalAGI: fedAGI, stateAGI, stateTaxableIncome: taxableIncome, retirementIncome };
  const phase = (po, amount) => (po ? applyPhaseOut(po, status, basisValue(po.basis, values), amount) : amount);

  // Per filer, an extra one for head of household (AR, IA), and an age bonus per person at the
  // state's age (65; DE uses 60).
  const ec = sd.exemptionCredit;
  if (ec) {
    let credit = (ec.perFiler ?? 0) * people + (status === 'hoh' ? (ec.hohExtra ?? 0) : 0);
    if (ec.ageBonus) credit += ec.ageBonus.amount * agedCount(ec.ageBonus.age);
    out.exemptionCredit = phase(ec.phaseOut, credit);
  }

  for (const c of sd.credits ?? []) {
    let amount;
    if (c.type === 'percentOfTax') {
      // CT's personal tax credit: a percentage of the tax, set by income.
      amount = incomeTax * bandValue(c.bands[status], basisValue(c.basis, values), 'rate');
    } else if (c.type === 'ofDeduction') {
      // UT's taxpayer credit: a rate times a deduction amount (the federal standard deduction,
      // with its extra amount per person 65+), then phased out.
      amount = c.rate * (c.deduction[status]
        + (c.age65AddOn ? (married ? c.age65AddOn.married : c.age65AddOn.unmarried) * agedCount(65) : 0));
    } else if (c.type === 'flat') {
      // A set amount per person, or once per return; with `age`, only when someone qualifies.
      const count = c.per === 'person' ? (c.age != null ? agedCount(c.age) : people) : (c.age == null || agedCount(c.age) > 0 ? 1 : 0);
      amount = c.amount * count;
    } else if (c.type === 'schedule') {
      // An amount looked up by income (OH's retirement income credit table).
      amount = bandValue(c.bands[status], basisValue(c.basis, values), 'amount');
    } else {
      throw new Error(`relo-engine: unknown credit type "${c.type}"`);
    }
    out.credits += phase(c.phaseOut, amount);
  }
  return out;
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
  // percentage exclusions, AZ, VT, MT, HI) applies only to long-term gains. The stacked
  // treatment (MT, HI) is figured after the deductions below, which it depends on.
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
  else if (cg.treatment !== "stacked") throw new Error(`relo-engine: unknown capitalGains.treatment "${cg.treatment}"`);

  // --- Deductions, exemptions and credits ---
  // Ordinary income before deductions is the state's own AGI here (gains included for the
  // stacked states, whose gains are part of AGI and only taxed at their own rates).
  const ordinary = nonCG + cgOrdinary;
  const stateAGI = ordinary + (cg.treatment === "stacked" ? capGains : 0);
  const sd = rules.standardDeduction;
  const { deductible, seniorDeduction, federalTax, federalTaxDeduction } = resolveDeductions(sd, status,
    { age, spouseAge, fedAGI, stateAGI, capGains });
  breakdown.deductible = deductible;
  breakdown.seniorDeduction = seniorDeduction;
  breakdown.federalTax = federalTax;
  breakdown.federalTaxDeduction = federalTaxDeduction;

  if (cg.treatment === "stacked") {
    // Gains taxed on their own rate ladder, stacked on top of the rest of taxable income:
    // each dollar of gain is taxed at the ladder rate for the band it lands in once the
    // other income is counted first. Deductions come off the other income first; any left
    // over reduces the gains (as on the federal capital gains worksheet).
    // MT (MCA 15-30-2103(2)): 3.0% / 4.1% on the same bands as ordinary income.
    // HI (HRS 235-51(f)): the regular rates, capped at 7.25%.
    const ladder = cg.ladderByStatus[status] || cg.ladderByStatus.single;
    const taxableBase = Math.max(0, nonCG - deductible);
    const taxableGain = Math.max(0, capGains - Math.max(0, deductible - nonCG));
    cgSeparateTax = bracketTax(taxableBase + taxableGain, ladder) - bracketTax(taxableBase, ladder);
  }
  breakdown.cgOrdinary = cgOrdinary;
  breakdown.cgSeparateTax = cgSeparateTax;

  // --- Ordinary income → brackets, then credits ---
  breakdown.ordinaryIncome = ordinary;
  const taxableIncome = Math.max(0, ordinary - deductible);
  breakdown.taxableIncome = taxableIncome;
  const incomeTax = bracketTax(taxableIncome, brackets);
  breakdown.bracketTax = incomeTax;
  const { exemptionCredit, credits } = resolveCredits(sd, status, { age, spouseAge, fedAGI, stateAGI,
    taxableIncome, incomeTax, retirementIncome: iraTaxable + penTaxable });
  breakdown.exemptionCredit = exemptionCredit;
  breakdown.credits = credits;

  // Credits are nonrefundable: they can take the bracket tax to zero, not below.
  const tax = Math.max(0, incomeTax - exemptionCredit - credits) + cgSeparateTax;
  return { tax: Math.round(tax), breakdown };
}

// Local (city/county) tax layered ON TOP of state tax — NY (NYC/Yonkers), OR
// (Metro/Multnomah), MD/IN (mandatory county tax). A sibling to
// computeStateIncomeTax, not a parameter on it: 47 states have no localTax at
// all, and the four that do need the SAME base and state-tax total
// computeStateIncomeTax already derived (breakdown.taxableIncome, stateTax), not a
// re-derivation of the exclusion math. Every one of these is levied on the state's
// taxable income, after its deductions and exemptions: NYC on New York taxable
// income, Metro and Multnomah on Oregon taxable income, Maryland's county tax on
// Maryland taxable net income, Indiana's on Indiana AGI less exemptions. (Fixed
// 2026-10-22: this used ordinary income before the deductions.)
//
// local: RELO[code].localTax — undefined for states without one (safe no-op).
// localCode: '' | 'nyc' | 'yonkers' | 'metro' | 'multnomah' — the filer's
//   opt-in selection for NY/OR. Has no effect on MD/IN's county.rate, which
//   is mandatory and unconditional (no opt-out selector exists for it).
export function computeLocalTax(local, status, breakdown, stateTax, localCode) {
  if (!local) return 0;
  const base = breakdown.taxableIncome;
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
