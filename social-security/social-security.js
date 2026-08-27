// social-security/social-security.js
// Implements CalculatorModule. Real math; constants update annually (stamped).
//
// This version models a COUPLE: two earners, two claim ages, and the survivor
// rule that makes the higher earner's delay decision matter for the SECOND
// death, not their own. It folds in spousal benefits (a low earner can draw up
// to 50% of the higher earner's full-retirement-age amount). It assumes a full
// retirement age of 67 (born 1960 or later).
//
// Every rule and constant below links to the specific government page that
// defines it, so any single number can be checked at its source:
//   - Worker reduction (5/9, 5/12): CFR 404.410(a)
//     https://www.ssa.gov/OP_Home/cfr20/404/404-0410.htm
//   - Spousal reduction (25/36, 5/12): CFR 404.410(b)
//   - Survivor reduction (0.285 of PIA, prorated by month down to age 60):
//     CFR 404.410(c)(1) -- a third, proportional formula, distinct from the
//     stepped worker/spousal ones above
//   - Delayed retirement credits (8%/yr, stop at 70): CFR section 404.313
//     https://www.ssa.gov/OP_Home/cfr20/404/404-0313.htm
//   - Full retirement age 67 for WORKER and SPOUSAL benefits, born 1960 or
//     later: https://www.ssa.gov/benefits/retirement/planner/1960-delay.html
//   - Full retirement age for SURVIVOR benefits is a separate, younger table:
//     66 years 8 months for the same 1960 birth cohort.
//     https://www.ssa.gov/survivor/full-retirement-age-survivor
//   - RIB-LIM (the widow(er) limit): a survivor's benefit floors at the
//     larger of the deceased's actual reduced benefit or 82.5% of their PIA,
//     whenever the deceased claimed before their own full retirement age.
//     SSA POMS GN 00615.320
//   - If the deceased died WITHOUT ever filing, RIB-LIM and the early-claim
//     reduction never apply at all -- the survivor's base is 100% of PIA
//     (death before the deceased's own full retirement age) or PIA plus
//     delayed credits actually earned by the death date (after): CFR 404.338(a)-(c)
//     https://www.ssa.gov/OP_Home/cfr20/404/404-0338.htm
//   - 50% spousal cap, no delayed credits on spousal benefits:
//     https://www.ssa.gov/benefits/retirement/planner/applying7.html

import { presentValueOfStream, findCrossover } from '../core/finance.js';

const CONSTANTS_YEAR = 2026;          // re-verify against ssa.gov each year
export const FULL_RETIREMENT_AGE = 67;       // worker/spousal FRA, born 1960 or later
export const SURVIVOR_FULL_RETIREMENT_AGE = 66 + 8 / 12;   // survivor FRA runs on its
                                                     // own, younger table --
                                                     // 66y8mo for the same
                                                     // 1960 birth cohort.
                                                     // Do not reuse
                                                     // FULL_RETIREMENT_AGE here.
export const SURVIVOR_MIN_CLAIM_AGE = 60;   // earliest age a widow(er) can claim
                                             // a survivor benefit at all (SSA
                                             // POMS GN 00615.100). survivorBenefit()
                                             // clamps its age-reduction formula at
                                             // 60 but does not itself gate
                                             // eligibility -- callers must check
                                             // this separately.

/**
 * A worker's own monthly benefit at a given claiming age, from their
 * full-retirement-age amount (the primary insurance amount).
 * Early reduction: 5/9 of 1% per month for the first 36 months, then 5/12 of
 * 1% per month beyond that. Delayed credit: 2/3 of 1% per month (8%/year),
 * stopping at age 70. Source: CFR 404.410(a) and CFR 404.313.
 */
export function workerBenefit(primaryInsuranceAmount, claimAge) {
  const age = Math.min(claimAge, 70);   // credits stop accruing at 70
  if (age <= FULL_RETIREMENT_AGE) {
    const monthsEarly = Math.round((FULL_RETIREMENT_AGE - age) * 12);
    const reduction =
      (Math.min(monthsEarly, 36) * (5 / 9) +
       Math.max(monthsEarly - 36, 0) * (5 / 12)) / 100;
    return primaryInsuranceAmount * (1 - reduction);
  }
  const monthsLate = Math.round((age - FULL_RETIREMENT_AGE) * 12);
  return primaryInsuranceAmount * (1 + monthsLate * (2 / 3) / 100);
}

/**
 * The spousal benefit a person can draw on their partner's record, at a given
 * claiming age. The unreduced amount is 50% of the partner's full-retirement-age
 * primary insurance amount. The early-claim reduction uses the SPOUSAL formula,
 * which differs from the worker formula: 25/36 of 1% per month for the first 36
 * months, then 5/12 of 1% per month beyond that. Spousal benefits earn NO
 * delayed retirement credits — they never exceed 50% of the partner's amount,
 * no matter how long claiming is delayed. Source: CFR 404.410(b).
 */
export function spousalBenefit(partnerPrimaryInsuranceAmount, claimAge) {
  const unreduced = partnerPrimaryInsuranceAmount * 0.5;
  if (claimAge >= FULL_RETIREMENT_AGE) return unreduced;   // no credits past FRA
  const monthsEarly = Math.round((FULL_RETIREMENT_AGE - claimAge) * 12);
  const reduction =
    (Math.min(monthsEarly, 36) * (25 / 36) +
     Math.max(monthsEarly - 36, 0) * (5 / 12)) / 100;
  return unreduced * (1 - reduction);
}

/**
 * A survivor's monthly benefit inherited from a deceased spouse's earnings
 * record, at the survivor's current age. The BASE amount depends on whether
 * the deceased ever actually filed for their own benefit before dying --
 * CFR 404.338(a)-(c) draws a hard line at the moment of filing:
 *
 *   A. The deceased filed before dying (deceasedDeathAge >= deceasedClaimAge --
 *      the default when deceasedDeathAge is omitted): RIB-LIM applies, SSA
 *      POMS GN 00615.320. The base is the LARGER of what the deceased was
 *      actually receiving (already reduced, if they claimed before their own
 *      full retirement age) or 82.5% of PIA. Applying this as an
 *      unconditional max() is deliberate, not a missing gate: if the deceased
 *      delayed past their own full retirement age, their actual benefit
 *      already exceeds 82.5% of PIA, so the max() is a no-op exactly when
 *      RIB-LIM shouldn't apply.
 *   B. The deceased died WITHOUT ever filing: CFR 404.338(c)'s early-claim
 *      reduction never triggers at all -- it only applies "if the insured
 *      chooses to receive old-age benefits before full retirement age," which
 *      requires having filed. RIB-LIM never applies either (nothing to floor
 *      against). The base is 100% of PIA if death came before the deceased's
 *      own full retirement age (no reduction, no delayed credits), or PIA
 *      plus whatever delayed retirement credits had actually accrued by the
 *      death date otherwise -- reusing workerBenefit()'s delayed-credit
 *      formula is correct here since that math doesn't care whether the age
 *      passed in was an intentional claim or a death date.
 *
 *   NOTE: this makes filing a genuine one-month cliff, not smoothing error --
 *   dying the month before a planned claim age can pay the survivor MORE than
 *   dying the month after, because filing itself is what the regulation uses
 *   to trigger the early-claim reduction. That is the actual shape of the law.
 *
 * On top of whichever base applies: the survivor's OWN age-based reduction,
 * CFR 404.410(c)(1) -- a third, proportional formula distinct from the
 * stepped worker/spousal ones above -- 0% at the survivor's own full
 * retirement age (a separate, younger table than worker/spousal FRA -- see
 * SURVIVOR_FULL_RETIREMENT_AGE), scaling linearly to 28.5% at the earliest
 * survivor-claiming age of 60. This reduction is orthogonal to whether the
 * deceased filed -- it always applies.
 */
export function survivorBenefit(deceasedPia, deceasedClaimAge, survivorCurrentAge, deceasedDeathAge = Infinity) {
  const hasFiled = deceasedDeathAge >= deceasedClaimAge;
  let base;
  if (hasFiled) {
    const deceasedActual = workerBenefit(deceasedPia, deceasedClaimAge);
    base = Math.max(deceasedActual, deceasedPia * 0.825);
  } else {
    base = deceasedDeathAge >= FULL_RETIREMENT_AGE
      ? workerBenefit(deceasedPia, Math.min(deceasedDeathAge, 70))
      : deceasedPia;
  }

  const age = Math.max(60, Math.min(survivorCurrentAge, SURVIVOR_FULL_RETIREMENT_AGE));
  const monthsEarly = Math.round((SURVIVOR_FULL_RETIREMENT_AGE - age) * 12);
  const monthsInWindow = Math.round((SURVIVOR_FULL_RETIREMENT_AGE - 60) * 12);
  const reduction = monthsInWindow > 0 ? (0.285 * monthsEarly) / monthsInWindow : 0;

  return base * (1 - reduction);
}

export const meta = {
  name: 'Social Security claiming age (couples)',
  tagline: 'When each of you should start, shown in plain numbers.',
};

export const inputs = [
  {
    id: 'piaHigh', type: 'number',
    label: 'Higher earner: full retirement age benefit (monthly)',
    min: 0, max: 6000, step: 50, default: 3000, unit: '$',
    help: 'The full-retirement-age estimate on the higher earner\u2019s Social Security statement.',
  },
  {
    id: 'claimHigh', type: 'slider',
    label: 'Higher earner: age they claim',
    min: 62, max: 70, step: 1, default: 70, unit: 'years',
    help: 'The age the higher earner starts benefits. Delaying raises the survivor benefit too.',
  },
  {
    id: 'piaLow', type: 'number',
    label: 'Lower earner: full retirement age benefit (monthly)',
    min: 0, max: 6000, step: 50, default: 1200, unit: '$',
    help: 'The lower earner\u2019s own estimate. If it is under half the higher earner\u2019s, a spousal top-up applies.',
  },
  {
    id: 'claimLow', type: 'slider',
    label: 'Lower earner: age they claim',
    min: 62, max: 70, step: 1, default: 62, unit: 'years',
    help: 'The age the lower earner starts benefits.',
  },
  {
    id: 'ageGap', type: 'slider',
    label: 'Age gap between you',
    min: -20, max: 20, step: 1, default: 0, unit: 'years',
    help: 'How many years older the higher earner is than the lower earner. Negative means the higher earner is younger. Leave at 0 if you’re close in age.',
  },
  {
    id: 'lifeHigh', type: 'slider',
    label: 'Higher earner: life expectancy',
    min: 60, max: 100, step: 1, default: 84, unit: 'years',
    help: 'A planning age for the higher earner. Marked on the chart \u2014 not a prediction.',
  },
  {
    id: 'lifeLow', type: 'slider',
    label: 'Lower earner: life expectancy',
    min: 60, max: 100, step: 1, default: 87, unit: 'years',
    help: 'A planning age for the lower earner. Marked on the chart \u2014 not a prediction.',
  },
  {
    id: 'discountRate', type: 'slider',
    label: 'Real discount rate',
    min: 0, max: 6, step: 0.5, default: 2, unit: '%',
    help: 'The real return you assume on benefits taken earlier. Higher makes claiming early look better.',
  },
];

export const presets = {
  'One earner, one not': { piaHigh: 3000, claimHigh: 70, piaLow: 800,  claimLow: 62, discountRate: 2 },
  'Both earned, uneven': { piaHigh: 3200, claimHigh: 70, piaLow: 1800, claimLow: 67, discountRate: 2 },
  'Close to equal':      { piaHigh: 2600, claimHigh: 67, piaLow: 2400, claimLow: 67, discountRate: 2 },
};

const AGE_START = 62;   // earliest either person can claim
const AGE_END = 100;    // chart horizon

/**
 * Household monthly income at a given calendar age of each person, for one
 * claiming plan. While both are alive, each person receives the LARGER of their
 * own worker benefit and their spousal benefit (the spousal top-up rule \u2014 you
 * get the bigger of the two, never both). This is symmetric under CFR
 * 404.410(b): EITHER spouse can draw a spousal benefit off the OTHER\u2019s
 * record, not just the lower earner off the higher earner\u2019s. It is usually
 * the lower earner\u2019s top-up that binds, but not always \u2014 e.g. the higher
 * earner claiming very early can reduce their own worker benefit below half
 * of the lower earner\u2019s full-retirement-age amount. Each side\u2019s spousal
 * benefit requires the OTHER person to have already filed.
 *
 * After the first death, the spousal relationship ends and a survivor
 * relationship replaces it: the survivor keeps the LARGER of their own worker
 * benefit and a survivor benefit inherited from the deceased\u2019s record (see
 * survivorBenefit \u2014 RIB-LIM-floored and reduced for the survivor\u2019s own age,
 * not simply whatever the deceased happened to be receiving). This survivor
 * rule is what ties the higher earner\u2019s delay decision to the second death.
 */
export function householdMonthly(values, highAlive, lowAlive, highCurrentAge, lowCurrentAge, highDeathAge = Infinity, lowDeathAge = Infinity) {
  const highWorker = highCurrentAge >= values.claimHigh ? workerBenefit(values.piaHigh, values.claimHigh) : 0;
  const lowWorker  = lowCurrentAge  >= values.claimLow  ? workerBenefit(values.piaLow,  values.claimLow)  : 0;

  const highHasFiled = highCurrentAge >= values.claimHigh;
  const lowHasFiled = lowCurrentAge >= values.claimLow;

  // Spousal top-up, gated on the OTHER person having filed. Symmetric: either
  // spouse can draw off the other's record.
  const lowSpousal = (lowCurrentAge >= values.claimLow && highHasFiled)
    ? spousalBenefit(values.piaHigh, values.claimLow)
    : 0;
  const highSpousal = (highCurrentAge >= values.claimHigh && lowHasFiled)
    ? spousalBenefit(values.piaLow, values.claimHigh)
    : 0;
  const lowOwn = Math.max(lowWorker, lowSpousal);     // larger of own vs spousal
  const highOwn = Math.max(highWorker, highSpousal);  // larger of own vs spousal

  // The two benefit streams actually being paid right now, while both live.
  const highBenefit = highOwn;
  const lowBenefit = lowOwn;

  if (highAlive && lowAlive) return highBenefit + lowBenefit;
  if (highAlive && !lowAlive) {
    // Low has died; the spousal relationship (and any highSpousal top-up drawn
    // off low's record) ends with it, replaced by a possible survivor benefit.
    // Compare high's OWN worker benefit against the inherited amount, not
    // highBenefit (which could still include a now-defunct spousal top-up).
    // A survivor under SURVIVOR_MIN_CLAIM_AGE isn't eligible for ANY survivor
    // benefit yet -- survivorBenefit()'s own age-reduction formula clamps up
    // to 60 rather than gating this, so callers must check it explicitly.
    const inherited = highCurrentAge >= SURVIVOR_MIN_CLAIM_AGE
      ? survivorBenefit(values.piaLow, values.claimLow, highCurrentAge, lowDeathAge)
      : 0;
    return Math.max(highWorker, inherited);
  }
  if (!highAlive && lowAlive) {
    // High has died; low survives and may inherit a survivor benefit off high's
    // record, subject to the same SURVIVOR_MIN_CLAIM_AGE eligibility floor.
    const inherited = lowCurrentAge >= SURVIVOR_MIN_CLAIM_AGE
      ? survivorBenefit(values.piaHigh, values.claimHigh, lowCurrentAge, highDeathAge)
      : 0;
    return Math.max(lowWorker, inherited);
  }
  return 0;
}

/**
 * Present value of a household plan, given the two death ages. Walks month by
 * month from age 62 to the later death, summing discounted household income.
 * The x-grid is the SECOND death \u2014 the age the money has to last to \u2014 because
 * the survivor rule means the household keeps paying until the second person
 * dies. We hold the first death at its life-expectancy planning age and vary
 * the second, so each curve answers: "if one of us lives to age X, what is the
 * plan worth?"
 */
function planValueBySecondDeath(values, firstDeathAge, firstIsHigh, ageGap) {
  const r = values.discountRate / 100;
  const grid = [];
  for (let a = AGE_START; a <= AGE_END + 1e-9; a += 1) grid.push(a);

  const firstDeathMonth = Math.round((firstDeathAge - AGE_START) * 12);
  const i = Math.pow(1 + r, 1 / 12) - 1;

  // The death age of whoever dies first, in THEIR OWN age-frame -- passed
  // into householdMonthly so survivorBenefit can tell whether they died
  // before or after their own claim age. The survivor's own eventual death
  // is the loop's upper bound (secondDeathAge), never reached inside this
  // loop, so Infinity for them is correct (unused -- they never hit the
  // "deceased" branch here). This equals values.lifeHigh only when the
  // firstIsHigh hypothesis agrees with which life expectancy is actually
  // smaller (lifeHighOnClock <= lifeLowOnClock); compute() tests BOTH
  // hypotheses unconditionally, so when a hypothesis disagrees with that,
  // highDeathAge is deliberately the hypothesis's own generic first-death
  // anchor (firstDeathAge, shifted into high's frame), not high's separately
  // -stated life expectancy -- consistent with firstDeathAge being a
  // role-agnostic anchor everywhere else in compute(). This is the
  // internally-consistent choice: the PV timeline and the filed/not-filed
  // determination must agree within one hypothesis, and this keeps them so.
  const highDeathAge = firstIsHigh ? firstDeathAge + ageGap : Infinity;
  const lowDeathAge = firstIsHigh ? Infinity : firstDeathAge;

  // The x-axis is the SECOND death \u2014 only defined at or after the first death.
  // For each second-death age, sum the FULL household timeline from age 62:
  // both-alive years first, then the survivor years. No leading zeros \u2014 the
  // curve begins at the first-death age, so the crossover reads cleanly.
  return grid
    .filter((secondDeathAge) => secondDeathAge >= firstDeathAge)
    .map((secondDeathAge) => {
      let pv = 0;
      const monthsTotal = Math.round((secondDeathAge - AGE_START) * 12);
      for (let m = 0; m < monthsTotal; m++) {
        // The clock is the LOWER earner's own age; the higher earner's own
        // age is offset by ageGap (positive = higher earner is older). At
        // ageGap=0 this collapses to the old shared-ageNow behavior exactly.
        const lowAge = AGE_START + m / 12;
        const highAge = lowAge + ageGap;
        // The first person to die is gone from firstDeathMonth onward; the
        // survivor lives until secondDeathAge (the loop bound).
        const hAlive = firstIsHigh ? m < firstDeathMonth : true;
        const lAlive = firstIsHigh ? true : m < firstDeathMonth;
        const monthly = householdMonthly(values, hAlive, lAlive, highAge, lowAge, highDeathAge, lowDeathAge);
        pv += i === 0 ? monthly : monthly / Math.pow(1 + i, m);
      }
      return { x: secondDeathAge, y: pv };
    });
}

/**
 * Classifies the delay-vs-early comparison for one death order into exactly
 * one of three outcomes. findCrossover returns null in two opposite
 * situations \u2014 delay wins at every age, or delay never catches up \u2014 so we
 * disambiguate by comparing the two plans at the far end of the grid.
 */
function classifyOutcome(delayPoints, earlyPoints) {
  const breakeven = findCrossover({ points: earlyPoints }, { points: delayPoints });
  if (breakeven !== null) return { type: 'breakeven', age: breakeven };
  const lastDelay = delayPoints[delayPoints.length - 1]?.y ?? 0;
  const lastEarly = earlyPoints[earlyPoints.length - 1]?.y ?? 0;
  return lastDelay >= lastEarly ? { type: 'delayWins' } : { type: 'earlyWins' };
}

/**
 * How conservative an outcome is, as a single comparable number \u2014 higher
 * means delay's payoff is less certain / requires living longer. earlyWins
 * ranks above every breakeven age (delay isn't shown to pay off at all);
 * delayWins ranks below every breakeven age (delay always wins, no waiting
 * required); a breakeven age ranks by that age itself, since a later
 * breakeven asks more of the survivor's lifespan before waiting pays off.
 */
function conservativenessScore(outcome) {
  if (outcome.type === 'earlyWins') return Infinity;
  if (outcome.type === 'delayWins') return -Infinity;
  return outcome.age;
}

export function compute(values) {
  // Two plans to compare: the higher earner DELAYS to 70 vs. the higher earner
  // claims EARLY at 62. Everything else (lower earner's plan, discount rate)
  // is held at the user's inputs, so the chart isolates the higher earner's
  // decision \u2014 the one the survivor rule makes pivotal.
  const planDelay = { ...values, claimHigh: 70 };
  const planEarly = { ...values, claimHigh: 62 };

  // Age gap between the two of you (positive = higher earner older). Life
  // expectancies stay in each person's OWN years (unchanged meaning); convert
  // to the shared (lower-earner) clock before comparing them. At ageGap=0
  // this is a no-op and every formula below collapses to its pre-feature form.
  const ageGap = values.ageGap || 0;
  const lifeHighOnClock = values.lifeHigh - ageGap;
  const lifeLowOnClock = values.lifeLow;

  // Hold the first death at the EARLIER of the two life-expectancy planning
  // ages (on the shared clock); vary the second death along the x-axis. Which
  // spouse actually dies first isn't something the user tells us, and the two
  // orderings do NOT give the same answer: RIB-LIM only floors an INHERITED
  // survivor benefit, never a survivor's own record, so which spouse's record
  // the survivor ends up on changes the number \u2014 confirmed by a live-imported
  // sweep of thousands of input combinations (2026-08-26 audit). Rather than
  // hardcode one order and hope it stays the more conservative one, compute
  // BOTH and show whichever is more conservative for THESE inputs. The number
  // shown is then true no matter which spouse actually goes first, not just
  // true in one assumed scenario. The heatmap below still shows the full
  // picture \u2014 both death orders varied independently \u2014 for anyone who wants it.
  const firstDeathAge = Math.min(lifeHighOnClock, lifeLowOnClock);

  function evaluateOrder(firstIsHigh) {
    let delayPoints = planValueBySecondDeath(planDelay, firstDeathAge, firstIsHigh, ageGap);
    let earlyPoints = planValueBySecondDeath(planEarly, firstDeathAge, firstIsHigh, ageGap);

    // Points are generated on the shared clock. The actual survivor in this
    // hypothesis is the low earner (firstIsHigh=true) or the high earner
    // (firstIsHigh=false) \u2014 shift x onto THAT person's own age before
    // classifying, so outcome.age comes out already in survivor-own-age
    // terms. At ageGap=0 this is always a no-op regardless of firstIsHigh.
    const survivorOffset = firstIsHigh ? 0 : ageGap;
    if (survivorOffset !== 0) {
      delayPoints = delayPoints.map((p) => ({ x: p.x + survivorOffset, y: p.y }));
      earlyPoints = earlyPoints.map((p) => ({ x: p.x + survivorOffset, y: p.y }));
    }
    return { delayPoints, earlyPoints, outcome: classifyOutcome(delayPoints, earlyPoints), firstIsHigh };
  }

  const highDiesFirst = evaluateOrder(true);
  const lowDiesFirst = evaluateOrder(false);
  const chosen = conservativenessScore(highDiesFirst.outcome) >= conservativenessScore(lowDiesFirst.outcome)
    ? highDiesFirst
    : lowDiesFirst;

  const seriesDelay = { name: 'Higher earner waits to 70', color: '#98c379', points: chosen.delayPoints };
  const seriesEarly = { name: 'Higher earner claims at 62', color: '#e06c75', points: chosen.earlyPoints };
  const series = [seriesEarly, seriesDelay];

  const outcome = chosen.outcome;

  let headlineLabel, headlineValue;
  if (outcome.type === 'breakeven') {
    headlineLabel = 'Higher earner waiting to 70 pays off as long as one of you lives past';
    headlineValue = `age ${outcome.age.toFixed(0)}`;
  } else if (outcome.type === 'delayWins') {
    headlineLabel = 'Higher earner waiting to 70 pays off across every lifespan shown here';
    headlineValue = 'waiting wins';
  } else {
    headlineLabel = 'At this discount rate, claiming early pays off across every lifespan shown here';
    headlineValue = 'claiming early wins';
  }

  // Monthly figures for the summary cards. Spousal top-up is symmetric (CFR
  // 404.410(b)) -- usually the lower earner's top-up binds, but the higher
  // earner claiming very early can also dip below half the lower earner's
  // full-retirement-age amount, so both sides check it the same way.
  const highOwn70 = workerBenefit(values.piaHigh, 70);
  const highOwn62 = workerBenefit(values.piaHigh, 62);
  const highSpousal70 = spousalBenefit(values.piaLow, 70);
  const highSpousal62 = spousalBenefit(values.piaLow, 62);
  const highGetsSpousal70 = highSpousal70 > highOwn70;
  const highGetsSpousal62 = highSpousal62 > highOwn62;

  const lowOwn = workerBenefit(values.piaLow, values.claimLow);
  const lowSpousalAtClaim = spousalBenefit(values.piaHigh, values.claimLow);
  const lowGetsSpousal = lowSpousalAtClaim > lowOwn;

  const summary = [
    {
      label: highGetsSpousal70
        ? 'Higher earner\u2019s monthly check if they wait to 70 (spousal top-up applies)'
        : 'Higher earner\u2019s monthly check if they wait to 70',
      value: `$${Math.max(highOwn70, highSpousal70).toFixed(0)}`,
    },
    {
      label: highGetsSpousal62
        ? 'Higher earner\u2019s monthly check if they claim at 62 (spousal top-up applies)'
        : 'Higher earner\u2019s monthly check if they claim at 62',
      value: `$${Math.max(highOwn62, highSpousal62).toFixed(0)}`,
    },
    {
      label: lowGetsSpousal
        ? 'Lower earner\u2019s monthly check (spousal top-up applies)'
        : 'Lower earner\u2019s monthly check (their own benefit is larger)',
      value: `$${Math.max(lowOwn, lowSpousalAtClaim).toFixed(0)}`,
    },
    {
      label: headlineLabel,
      value: headlineValue,
      primary: true,
    },
  ];

  // Anchor the abstract curve to the couple's own numbers: mark the age the
  // longer-living spouse is projected to reach (the later of the two life
  // expectancies, on the shared clock), translated onto whichever spouse's
  // own age the chart is currently tracking (the chosen order's survivor).
  // At ageGap=0 this is always Math.max(values.lifeHigh, values.lifeLow),
  // exactly as before, regardless of which order is chosen. This is a
  // planning age the user chose — a "you are roughly here" marker, not a
  // prediction. NOTE: at nonzero ageGap, the chosen order is picked purely
  // for financial conservativeness, independent of which life expectancy is
  // numerically larger — so in unusual cases this marker's age won't equal
  // either spouse's literal typed input for the specific person the axis is
  // tracking. It still marks the same later-of-your-two-lifespans anchor,
  // just expressed in whichever spouse's years the chart happens to use.
  const secondDeathOnClock = Math.max(lifeHighOnClock, lifeLowOnClock);
  const projectedSecondDeath = secondDeathOnClock + (chosen.firstIsHigh ? 0 : ageGap);
  const markers = [{
    x: projectedSecondDeath,
    label: `your planning age (${projectedSecondDeath})`,
    color: '#61afef',
  }];

  return {
    summary,
    series,
    crossovers: [{ from: 0, to: 1, label: 'waiting pulls ahead' }],
    markers,
    xAxis: { label: 'Age the longer-living spouse reaches', format: (n) => n.toFixed(0) },
    yAxis: { label: 'Household lifetime benefits (present value)', format: (n) => `$${Math.round(n / 1000)}k` },
  };
}

export const _meta = { constantsYear: CONSTANTS_YEAR };

/**
 * The full two-death surface, for the opt-in heatmap. For every pair of death
 * ages (higher earner, lower earner), compute the present value of the household
 * under the higher earner waiting to 70 versus claiming at 62, and return the
 * margin (delay minus early). Positive means waiting wins for that pair.
 *
 * Unlike the line chart \u2014 which fixes the first death and varies the second \u2014
 * this varies BOTH deaths independently, so it shows the case the line chart
 * omits: the lower earner dying first. Pure; no side effects.
 */
export function computeSurface(values, stepYears = 2) {
  const r = values.discountRate / 100;
  const i = Math.pow(1 + r, 1 / 12) - 1;
  const planDelay = { ...values, claimHigh: 70 };
  const planEarly = { ...values, claimHigh: 62 };

  /**
   * PV of a plan given explicit death ages for each person, each in that
   * person's OWN years (matching the main chart's lifeHigh/lifeLow meaning).
   * Converted to the shared (lower-earner) clock via ageGap before use, same
   * convention as planValueBySecondDeath. At ageGap=0 this is a no-op.
   */
  function planValue(plan, highDeathAge, lowDeathAge) {
    const ageGap = plan.ageGap || 0;
    const highDeathAgeOnClock = highDeathAge - ageGap;
    const lowDeathAgeOnClock = lowDeathAge;
    const lastAge = Math.max(highDeathAgeOnClock, lowDeathAgeOnClock);
    const months = Math.round((lastAge - AGE_START) * 12);
    const highDeathMonth = Math.round((highDeathAgeOnClock - AGE_START) * 12);
    const lowDeathMonth = Math.round((lowDeathAgeOnClock - AGE_START) * 12);
    let pv = 0;
    for (let m = 0; m < months; m++) {
      const lowAge = AGE_START + m / 12;
      const highAge = lowAge + ageGap;
      const hAlive = m < highDeathMonth;
      const lAlive = m < lowDeathMonth;
      const monthly = householdMonthly(plan, hAlive, lAlive, highAge, lowAge, highDeathAge, lowDeathAge);
      pv += i === 0 ? monthly : monthly / Math.pow(1 + i, m);
    }
    return pv;
  }

  const ages = [];
  for (let a = 60; a <= AGE_END + 1e-9; a += stepYears) ages.push(a);

  const cells = [];
  for (const hd of ages) {
    for (const ld of ages) {
      const margin = planValue(planDelay, hd, ld) - planValue(planEarly, hd, ld);
      cells.push({ highDeath: hd, lowDeath: ld, margin });
    }
  }
  return { ages, cells };
}
