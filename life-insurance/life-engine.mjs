// life-engine.mjs — pure computation for the life insurance need calculator.
// No DOM, no Date. All amounts are in today's dollars at yearly resolution.
// Export the four helpers so they can be tested standalone.

import { presentValueOfStream } from '../core/finance.js';

// ── Mortgage ──

/**
 * Return the remaining mortgage balance at year t, amortized on the nominal
 * rate and original term. Assumes standard fixed-rate amortization.
 */
export function mortgageBalanceAt(balance, annualRate, yearsLeft, t) {
  if (t <= 0) return balance;
  if (t >= yearsLeft) return 0;
  if (balance <= 0) return 0;
  if (annualRate <= 0) {
    // Linear payoff when rate is 0.
    return balance * (1 - t / yearsLeft);
  }
  const r = annualRate / 12;
  const n = yearsLeft * 12;
  const pmt = balance * r / (1 - Math.pow(1 + r, -n));
  const months = t * 12;
  // Remaining balance after `months` payments.
  return balance * Math.pow(1 + r, months) - pmt * (Math.pow(1 + r, months) - 1) / r;
}

// ── Social Security survivor benefits ──

/**
 * Compute total annual Social Security survivor benefits from the deceased's
 * record for one year, given the children's ages at that point.
 *
 * @param {number} ssPerChild  Monthly benefit per child (from the SS statement).
 * @param {number} ssFamilyMax Monthly total family maximum.
 * @param {number} survivorGrossPay Survivor's gross annual pay (for earnings test).
 * @param {number[]} childAges  Current ages of all children in this year.
 * @param {number} yearOffset  Unused; reserved for future use.
 * @returns {{total: number, caregiverPaid: number, childrenTotal: number,
 *            earningsTestApplied: boolean, caregiverFullyWithheld: boolean}}
 */
export function survivorSocialSecurity(ssPerChild, ssFamilyMax, survivorGrossPay, childAges, yearOffset = 0) {
  const individual = ssPerChild * 12;
  const FM = ssFamilyMax * 12;

  if (individual <= 0 || FM <= 0) {
    return { total: 0, caregiverPaid: 0, childrenTotal: 0,
             earningsTestApplied: false, caregiverFullyWithheld: false };
  }

  // Eligible children: under 18.
  const eligibleChildren = childAges.filter(a => a < 18).length;
  // Caregiver benefit: paid while the youngest child is under 16.
  const youngestAge = childAges.length > 0 ? Math.min(...childAges) : Infinity;
  const caregiverEligible = youngestAge < 16;

  const beneficiaries = eligibleChildren + (caregiverEligible ? 1 : 0);
  if (beneficiaries === 0) {
    return { total: 0, caregiverPaid: 0, childrenTotal: 0,
             earningsTestApplied: false, caregiverFullyWithheld: false };
  }

  // Prorate if total exceeds family max.
  const rawShare = beneficiaries * individual > FM
    ? FM / beneficiaries
    : individual;

  // Caregiver earnings test: reduce caregiver's share by excess earnings.
  // $24,480 is SSA's 2026 annual exempt amount for people below full retirement
  // age. Held constant in today's dollars.
  const EXEMPT = 24480;
  let caregiverReduction = 0;
  let earningsTestApplied = false;
  if (caregiverEligible) {
    const excess = Math.max(0, survivorGrossPay - EXEMPT);
    caregiverReduction = Math.min(rawShare, excess / 2);
    earningsTestApplied = caregiverReduction > 0;
  }

  const caregiverFullyWithheld = caregiverEligible && caregiverReduction >= rawShare;
  let caregiverPaid = caregiverEligible ? rawShare - caregiverReduction : 0;

  // Redistribution per POMS RS 02501.155.
  let childrenTotal;
  if (eligibleChildren === 0) {
    childrenTotal = 0;
  } else if (caregiverFullyWithheld) {
    // Caregiver fully withheld: treat as off the rolls, redistribute to children.
    const perChild = Math.min(individual, FM / eligibleChildren);
    childrenTotal = perChild * eligibleChildren;
    caregiverPaid = 0;
  } else if (earningsTestApplied && caregiverEligible) {
    // Partial withholding: children share FM - caregiverPaid, each capped at individual.
    const childPool = FM - caregiverPaid;
    const perChild = Math.min(individual, childPool / eligibleChildren);
    childrenTotal = perChild * eligibleChildren;
  } else {
    // No earnings test impact or no caregiver: children get rawShare each.
    childrenTotal = rawShare * eligibleChildren;
  }

  const total = childrenTotal + caregiverPaid;
  return { total, caregiverPaid, childrenTotal, earningsTestApplied, caregiverFullyWithheld };
}

// ── Scenario computation ──

/**
 * Compute the insurance need for each death year t = 0..40.
 *
 * @param {Object} inputs  All calculator inputs as a flat values object.
 * @param {'you'|'spouse'} deceased  Which person dies in this scenario.
 * @returns {{t: number, needs: number, have: number, need: number}[]}
 */
export function scenarioByYear(inputs, deceased) {
  const isYou = deceased === 'you';
  const prefix = isYou ? 'you' : 'spouse';
  const survPrefix = isYou ? 'spouse' : 'you';

  const deceasedAge = Number(inputs[prefix + 'Age']) || 35;
  const survivorAge = Number(inputs[survPrefix + 'Age']) || 35;
  const deceasedPay = Number(inputs[prefix + 'GrossPay']) || 0;
  const survivorPay = Number(inputs[survPrefix + 'GrossPay']) || 0;
  const deceasedRetSaving = Number(inputs[prefix + 'RetirementSaving']) || 0;
  const ssPerChild = Number(inputs[prefix + 'SsPerChild']) || 0;
  const ssFamilyMax = Number(inputs[prefix + 'SsFamilyMax']) || 0;
  const extraCare = Number(inputs[prefix + 'ExtraCare']) || 0;
  const termCoverage = Number(inputs[prefix + 'TermCoverage']) || 0;
  const termYearsLeft = Number(inputs[prefix + 'TermYearsLeft']) || 0;
  const employerCoverage = Number(inputs[prefix + 'EmployerCoverage']) || 0;
  const retirementAge = Number(inputs.retirementAge) || 65;

  const childAges = [];
  for (let i = 1; i <= 4; i++) {
    const v = inputs['child' + i + 'Age'];
    if (v !== '' && v !== undefined && v !== null) childAges.push(Number(v));
  }

  const spending = Number(inputs.householdSpending) || 0;
  const rawContinues = Number(inputs.spendingContinues);
  const spendingContinues = (Number.isFinite(rawContinues) ? rawContinues : 80) / 100;
  const supportUntilAge = Number(inputs.supportUntilAge) || 22;
  const supportYearsNoKids = Number(inputs.supportYearsNoKids) || 10;
  const childcareUntilAge = Number(inputs.childcareUntilAge) || 13;
  const rawDiscount = Number(inputs.discountRate);
  const discountRate = (Number.isFinite(rawDiscount) ? rawDiscount : 2) / 100;
  const rawInflation = Number(inputs.inflation);
  const inflation = (Number.isFinite(rawInflation) ? rawInflation : 2.5) / 100;
  const rawTakeHome = Number(inputs.takeHomeShare);
  const takeHomeShare = (Number.isFinite(rawTakeHome) ? rawTakeHome : 75) / 100;
  const countEmployer = inputs.countEmployerCoverage === 'count';
  const collegePerChild = Number(inputs.collegePerChild) || 0;

  const mortBalance = Number(inputs.mortgageBalance) || 0;
  const mortRate = (Number(inputs.mortgageRate) || 0) / 100;
  const mortYearsLeft = Number(inputs.mortgageYearsLeft) || 0;
  const otherDebts = Number(inputs.otherDebts) || 0;
  const finalExpenses = Number(inputs.finalExpenses) || 0;
  const savings = Number(inputs.savings) || 0;
  const collegeSavings = Number(inputs.collegeSavings) || 0;

  const hasChildren = childAges.length > 0;
  const youngestAge = hasChildren ? Math.min(...childAges) : Infinity;

  const MAX_T = 40;
  const results = [];

  for (let t = 0; t <= MAX_T; t++) {
    // Support window: years until youngest turns supportUntilAge (child case),
    // or until the survivor reaches retirement age (capped at user's stated
    // supportYearsNoKids). The cap at survivor retirement prevents the tool
    // from granting a fresh N-year window even when the survivor dies at 64.
    let supportEnd;
    if (hasChildren) {
      supportEnd = Math.max(0, supportUntilAge - youngestAge - t);
    } else {
      supportEnd = Math.min(supportYearsNoKids, Math.max(0, retirementAge - (survivorAge + t)));
    }

    // ── Yearly flows ──
    let needsPV = 0;
    let havePV = 0;

    for (let a = 0; a < supportEnd; a++) {
      // Ages of children in year (t + a) from now.
      const childAgesAtA = childAges.map(ca => ca + t + a);
      const youngestAtA = hasChildren ? Math.min(...childAgesAtA) : Infinity;

      let outflow = spending * spendingContinues;
      if (youngestAtA < childcareUntilAge) {
        outflow += extraCare;
      }

      // Lost retirement saving inside the support window. The deceased's
      // contributions stop entirely — this is not discretionary spending, so
      // spendingContinues does not apply.
      const deceasedAgeAtA = deceasedAge + t + a;
      if (deceasedAgeAtA < retirementAge) {
        outflow += deceasedRetSaving;
      }

      const ss = survivorSocialSecurity(ssPerChild, ssFamilyMax, survivorPay, childAgesAtA, 0);
      const inflow = survivorPay * takeHomeShare + ss.total;

      const net = outflow - inflow;
      const pv = presentValueOfStream(net / 12, a * 12, (a + 1) * 12, discountRate);
      if (net > 0) {
        needsPV += pv;
      } else {
        havePV += -pv; // surplus adds to have
      }
    }

    // Lost retirement saving PAST the support window (still matters until
    // the deceased would have reached retirementAge).
    const pastSupportStart = supportEnd;
    for (let a = pastSupportStart; a < MAX_T; a++) {
      const deceasedAgeAtA = deceasedAge + t + a;
      if (deceasedAgeAtA >= retirementAge) break;
      const lostSaving = deceasedRetSaving;
      if (lostSaving > 0) {
        needsPV += presentValueOfStream(lostSaving / 12, a * 12, (a + 1) * 12, discountRate);
      }
    }

    // ── One-time needs ──
    let oneTimeNeeds = finalExpenses + otherDebts;

    // Mortgage at t, in today's dollars.
    if (mortBalance > 0 && mortYearsLeft > 0) {
      const nominalBal = mortgageBalanceAt(mortBalance, mortRate, mortYearsLeft, t);
      oneTimeNeeds += nominalBal / Math.pow(1 + inflation, t);
    }

    // College: PV of remaining college years for each child. Kept separate
    // so collegeSavings only offsets these costs — 529 withdrawals for
    // non-education expenses carry a 10% penalty plus income tax, so they
    // can't be treated as fungible with general savings.
    let collegeNeeds = 0;
    if (collegePerChild > 0) {
      for (const ca of childAges) {
        const costPerYear = collegePerChild / 4;
        for (let yr = 18; yr <= 21; yr++) {
          const yearsFromT = yr - ca - t;
          if (yearsFromT < 0) continue;
          collegeNeeds += presentValueOfStream(costPerYear / 12, yearsFromT * 12, (yearsFromT + 1) * 12, discountRate);
        }
      }
    }
    oneTimeNeeds += collegeNeeds;

    // ── Have ──
    const collegeSavingsApplied = Math.min(collegeSavings, collegeNeeds);
    let haveTotal = savings + collegeSavingsApplied + havePV;

    // Deceased's individual term coverage.
    if (termCoverage > 0 && t < termYearsLeft) {
      haveTotal += termCoverage;
    }

    // Employer coverage.
    if (countEmployer && employerCoverage > 0) {
      haveTotal += employerCoverage;
    }

    const totalNeeds = needsPV + oneTimeNeeds;
    const need = Math.max(0, totalNeeds - haveTotal);
    results.push({ t, needs: totalNeeds, have: haveTotal, need });
  }

  // Trim: t <= min(40, max(30, lastNeedYear + 3)).
  const lastNeedYear = lastNeedYearOf(results);
  const trimTo = Math.min(MAX_T, Math.max(30, (lastNeedYear >= 0 ? lastNeedYear + 3 : 30)));
  return results.slice(0, trimTo + 1);
}

function lastNeedYearOf(results) {
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i].need > 0) return results[i].t;
  }
  return -1;
}

// ── Policy fitting ──

const TERMS = [10, 15, 20, 25, 30];
const MIN_FACE = 100000;
const FACE_ROUND = 25000;
const LADDER_MIN_SAVINGS = 0.15;

function roundFace(amt) {
  return Math.max(MIN_FACE, Math.ceil(amt / FACE_ROUND) * FACE_ROUND);
}

/**
 * Suggest one-policy and two-policy ladder options.
 *
 * @param {number[]} needByYear  need(t) for t = 0..N.
 * @param {number} lastNeedYear  Last t with need > 0, or -1 if none.
 * @returns {{
 *   maxNeed: number,
 *   singlePolicy: {term: number, face: number, tailUncovered: boolean} | null,
 *   ladder: {short: {term: number, face: number}, long: {term: number, face: number},
 *            coverageYearsSaved: number, savingsPct: number} | null,
 *   smallNeed: boolean
 * }}
 */
export function fitPolicies(needByYear, lastNeedYear) {
  const maxNeed = Math.max(0, ...needByYear);
  if (maxNeed <= 0 || lastNeedYear < 0) {
    return { maxNeed: 0, singlePolicy: null, ladder: null, smallNeed: false };
  }

  const smallNeed = maxNeed < MIN_FACE;
  const termNeeded = lastNeedYear + 1; // coverage must last through lastNeedYear

  // ── One policy ──
  let singleTerm = TERMS.find(t => t >= termNeeded) || 30;
  let tailUncovered = termNeeded > 30;
  if (tailUncovered) singleTerm = 30;

  // Face = rounded max need over that term.
  let singleMaxNeed = 0;
  for (let t = 0; t < Math.min(singleTerm, needByYear.length); t++) {
    if (needByYear[t] > singleMaxNeed) singleMaxNeed = needByYear[t];
  }
  const singleFace = roundFace(singleMaxNeed);
  const singleCoverageYears = singleFace * singleTerm;
  const singlePolicy = { term: singleTerm, face: singleFace, tailUncovered };

  // ── Two-policy ladder ──
  let bestLadder = null;
  let bestScore = Infinity;

  for (const ts of TERMS) {
    for (const tl of TERMS) {
      if (ts >= tl) continue;
      // Long policy must cover through lastNeedYear.
      if (tl < termNeeded && termNeeded <= 30) continue;
      // Same 30-year cap.
      if (tl < termNeeded && termNeeded > 30) {
        if (tl !== 30) continue;
      }

      // Long face = rounded max need over [ts, tl).
      let longMax = 0;
      for (let t = ts; t < Math.min(tl, needByYear.length); t++) {
        if (needByYear[t] > longMax) longMax = needByYear[t];
      }
      // Also need to cover through lastNeedYear if tl is capped.
      if (termNeeded > tl) {
        for (let t = tl; t < needByYear.length; t++) {
          if (needByYear[t] > longMax) longMax = needByYear[t];
        }
      }
      const longFace = roundFace(longMax);

      // Short face = rounded max(0, max need over [0, ts) - longFace).
      let shortMax = 0;
      for (let t = 0; t < Math.min(ts, needByYear.length); t++) {
        if (needByYear[t] > shortMax) shortMax = needByYear[t];
      }
      const shortRaw = Math.max(0, shortMax - longFace);
      if (shortRaw <= 0) continue; // no short policy needed
      const shortFace = roundFace(shortRaw);

      if (shortFace < MIN_FACE || longFace < MIN_FACE) continue;

      const score = shortFace * ts + longFace * tl;
      if (score < bestScore) {
        bestScore = score;
        bestLadder = {
          short: { term: ts, face: shortFace },
          long: { term: tl, face: longFace },
          coverageYearsSaved: singleCoverageYears - score,
          savingsPct: 1 - score / singleCoverageYears,
        };
      }
    }
  }

  // Only suggest the ladder if savings exceed the threshold.
  if (bestLadder && bestLadder.savingsPct < LADDER_MIN_SAVINGS) {
    bestLadder = null;
  }

  return { maxNeed, singlePolicy, ladder: bestLadder, smallNeed };
}
