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
//   - Worker reduction (5/9, 5/12), spousal reduction (25/36, 5/12), and
//     survivor reduction: Code of Federal Regulations section 404.410
//     https://www.ssa.gov/OP_Home/cfr20/404/404-0410.htm
//   - Delayed retirement credits (8%/yr, stop at 70): CFR section 404.313
//     https://www.ssa.gov/OP_Home/cfr20/404/404-0313.htm
//   - Full retirement age 67 for those born 1960 or later:
//     https://www.ssa.gov/benefits/retirement/planner/1960-delay.html
//   - 50% spousal cap, no delayed credits on spousal benefits:
//     https://www.ssa.gov/benefits/retirement/planner/applying7.html

import { presentValueOfStream, findCrossover } from '../core/finance.js';

const CONSTANTS_YEAR = 2026;          // re-verify against ssa.gov each year
const FULL_RETIREMENT_AGE = 67;       // born 1960 or later

/**
 * A worker's own monthly benefit at a given claiming age, from their
 * full-retirement-age amount (the primary insurance amount).
 * Early reduction: 5/9 of 1% per month for the first 36 months, then 5/12 of
 * 1% per month beyond that. Delayed credit: 2/3 of 1% per month (8%/year),
 * stopping at age 70. Source: CFR 404.410(a) and CFR 404.313.
 */
function workerBenefit(primaryInsuranceAmount, claimAge) {
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
function spousalBenefit(partnerPrimaryInsuranceAmount, claimAge) {
  const unreduced = partnerPrimaryInsuranceAmount * 0.5;
  if (claimAge >= FULL_RETIREMENT_AGE) return unreduced;   // no credits past FRA
  const monthsEarly = Math.round((FULL_RETIREMENT_AGE - claimAge) * 12);
  const reduction =
    (Math.min(monthsEarly, 36) * (25 / 36) +
     Math.max(monthsEarly - 36, 0) * (5 / 12)) / 100;
  return unreduced * (1 - reduction);
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
    id: 'lifeHigh', type: 'slider',
    label: 'Higher earner: life expectancy',
    min: 70, max: 100, step: 1, default: 84, unit: 'years',
    help: 'A planning age for the higher earner. Marked on the chart \u2014 not a prediction.',
  },
  {
    id: 'lifeLow', type: 'slider',
    label: 'Lower earner: life expectancy',
    min: 70, max: 100, step: 1, default: 87, unit: 'years',
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
 * get the bigger of the two, never both). After the first death, the survivor
 * keeps the LARGER of the two benefits that were being paid, and the smaller one
 * stops. This survivor rule is what ties the higher earner\u2019s delay to the
 * second death. Spousal benefits require the higher earner to have already
 * filed, so the lower earner\u2019s spousal portion does not begin until then.
 */
function householdMonthly(values, highAlive, lowAlive, highCurrentAge, lowCurrentAge) {
  const highWorker = highCurrentAge >= values.claimHigh ? workerBenefit(values.piaHigh, values.claimHigh) : 0;
  const lowWorker  = lowCurrentAge  >= values.claimLow  ? workerBenefit(values.piaLow,  values.claimLow)  : 0;

  // Spousal top-up for the lower earner, gated on the higher earner having filed.
  const highHasFiled = highCurrentAge >= values.claimHigh;
  const lowSpousal = (lowCurrentAge >= values.claimLow && highHasFiled)
    ? spousalBenefit(values.piaHigh, values.claimLow)
    : 0;
  const lowOwn = Math.max(lowWorker, lowSpousal);   // larger of own vs spousal

  // The two benefit streams actually being paid right now.
  const highBenefit = highWorker;
  const lowBenefit = lowOwn;

  if (highAlive && lowAlive) return highBenefit + lowBenefit;
  if (highAlive && !lowAlive) return Math.max(highBenefit, lowBenefit);   // survivor keeps larger
  if (!highAlive && lowAlive) return Math.max(highBenefit, lowBenefit);   // survivor keeps larger
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
function planValueBySecondDeath(values, claimPlan, firstDeathAge, firstIsHigh) {
  const r = values.discountRate / 100;
  const grid = [];
  for (let a = AGE_START; a <= AGE_END + 1e-9; a += 1) grid.push(a);

  const firstDeathMonth = Math.round((firstDeathAge - AGE_START) * 12);
  const i = Math.pow(1 + r, 1 / 12) - 1;

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
        const ageNow = AGE_START + m / 12;
        // The first person to die is gone from firstDeathMonth onward; the
        // survivor lives until secondDeathAge (the loop bound).
        const hAlive = firstIsHigh ? m < firstDeathMonth : true;
        const lAlive = firstIsHigh ? true : m < firstDeathMonth;
        const monthly = householdMonthly(values, hAlive, lAlive, ageNow, ageNow);
        pv += i === 0 ? monthly : monthly / Math.pow(1 + i, m);
      }
      return { x: secondDeathAge, y: pv };
    });
}

export function compute(values) {
  // Two plans to compare: the higher earner DELAYS to 70 vs. the higher earner
  // claims EARLY at 62. Everything else (lower earner's plan, discount rate)
  // is held at the user's inputs, so the chart isolates the higher earner's
  // decision \u2014 the one the survivor rule makes pivotal.
  const planDelay = { ...values, claimHigh: 70 };
  const planEarly = { ...values, claimHigh: 62 };

  // Hold the first death at the EARLIER of the two life-expectancy planning
  // ages; vary the second death along the x-axis. By symmetry of the survivor
  // rule (survivor keeps the larger benefit either way), we model the higher
  // earner as the first death so the surviving lower earner inherits the
  // higher, delay-boosted benefit \u2014 the case that makes delay matter most.
  const firstDeathAge = Math.min(values.lifeHigh, values.lifeLow);

  const delayPoints = planValueBySecondDeath(planDelay, planDelay, firstDeathAge, true);
  const earlyPoints = planValueBySecondDeath(planEarly, planEarly, firstDeathAge, true);

  const seriesDelay = { name: 'Higher earner waits to 70', color: '#98c379', points: delayPoints };
  const seriesEarly = { name: 'Higher earner claims at 62', color: '#e06c75', points: earlyPoints };
  const series = [seriesEarly, seriesDelay];

  const breakeven = findCrossover(seriesEarly, seriesDelay);

  // findCrossover returns null in two opposite situations: delay wins at every
  // age, or delay never catches up. Disambiguate by comparing the two plans at
  // the far end of the grid, so the headline is never backwards.
  const lastDelay = seriesDelay.points[seriesDelay.points.length - 1]?.y ?? 0;
  const lastEarly = seriesEarly.points[seriesEarly.points.length - 1]?.y ?? 0;
  const delayWinsThroughout = breakeven === null && lastDelay >= lastEarly;
  const earlyWinsThroughout = breakeven === null && lastDelay < lastEarly;

  let headlineLabel, headlineValue;
  if (breakeven) {
    headlineLabel = 'Higher earner waiting to 70 pays off as long as one of you lives past';
    headlineValue = `age ${breakeven.toFixed(0)}`;
  } else if (delayWinsThroughout) {
    headlineLabel = 'Higher earner waiting to 70 pays off across every lifespan shown here';
    headlineValue = 'waiting wins';
  } else {
    headlineLabel = 'At this discount rate, claiming early pays off across every lifespan shown here';
    headlineValue = 'claiming early wins';
  }

  // Monthly figures for the summary cards.
  const highAt70 = workerBenefit(values.piaHigh, 70);
  const highAt62 = workerBenefit(values.piaHigh, 62);
  const lowOwn = workerBenefit(values.piaLow, values.claimLow);
  const lowSpousalAtClaim = spousalBenefit(values.piaHigh, values.claimLow);
  const lowGetsSpousal = lowSpousalAtClaim > lowOwn;

  const summary = [
    {
      label: 'Higher earner\u2019s monthly check if they wait to 70',
      value: `$${highAt70.toFixed(0)}`,
    },
    {
      label: 'Higher earner\u2019s monthly check if they claim at 62',
      value: `$${highAt62.toFixed(0)}`,
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
  // expectancies), since the x-axis is the survivor's age. This is a planning
  // age the user chose — a "you are roughly here" marker, not a prediction.
  const projectedSecondDeath = Math.max(values.lifeHigh, values.lifeLow);
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

  /** PV of a plan given explicit death ages for each person. */
  function planValue(plan, highDeathAge, lowDeathAge) {
    const lastAge = Math.max(highDeathAge, lowDeathAge);
    const months = Math.round((lastAge - AGE_START) * 12);
    const highDeathMonth = Math.round((highDeathAge - AGE_START) * 12);
    const lowDeathMonth = Math.round((lowDeathAge - AGE_START) * 12);
    let pv = 0;
    for (let m = 0; m < months; m++) {
      const ageNow = AGE_START + m / 12;
      const hAlive = m < highDeathMonth;
      const lAlive = m < lowDeathMonth;
      const monthly = householdMonthly(plan, hAlive, lAlive, ageNow, ageNow);
      pv += i === 0 ? monthly : monthly / Math.pow(1 + i, m);
    }
    return pv;
  }

  const ages = [];
  for (let a = 70; a <= AGE_END + 1e-9; a += stepYears) ages.push(a);

  const cells = [];
  for (const hd of ages) {
    for (const ld of ages) {
      const margin = planValue(planDelay, hd, ld) - planValue(planEarly, hd, ld);
      cells.push({ highDeath: hd, lowDeath: ld, margin });
    }
  }
  return { ages, cells };
}
