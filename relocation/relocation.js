// relocation/relocation.js
// Compares your annual state income tax in two states for a retiree's income mix,
// then asks the honest decision question: given what a move costs, how many years
// of tax savings does it take to pay that move back? The crossover is the payback
// period — where cumulative tax savings overtake the one-time cost of moving.
//
// SCOPE (deliberate): the crossover is INCOME TAX ONLY, computed to the dollar from
// the primary-source-verified bracket data. Property tax, sales tax, and estate tax
// are shown as disclosed CONTEXT beside the result, never folded into the headline —
// they need per-household assumptions we can't verify, and folding unverifiable
// guesses into a "proof" would break what makes this trustworthy. When the annual
// difference is small, the tool says so plainly: income tax should not drive the
// decision, and the context beside it may matter more.

import { computeStateIncomeTax, computeLocalTax } from './relo-engine.mjs';
import { findCrossover } from '../core/finance.js';

// SSA 2023 Period Life Table — annual mortality rates per 1,000.
// Exact figures from ssa.gov/oact/STATS/table4c6.html (same source as roth-conversion).
const QX={
  male:{
    20:1.235,21:1.315,22:1.378,23:1.439,24:1.509,25:1.595,26:1.685,27:1.783,28:1.876,29:1.970,
    30:2.085,31:2.202,32:2.308,33:2.407,34:2.490,35:2.577,36:2.665,37:2.764,38:2.864,39:2.987,
    40:3.115,41:3.253,42:3.419,43:3.600,44:3.777,45:3.931,46:4.073,47:4.245,48:4.477,49:4.795,
    50:5.126,51:5.496,52:5.917,53:6.404,54:6.923,
    55:7.491,56:8.173,57:8.938,58:9.714,59:10.494,60:11.337,61:12.232,62:13.196,63:14.229,64:15.316,
    65:16.455,66:17.574,67:18.735,68:19.981,69:21.366,70:22.903,71:24.615,72:26.504,73:28.648,74:31.071,
    75:33.802,76:37.010,77:41.158,78:45.461,79:50.346,80:55.633,81:61.757,82:68.358,83:75.420,84:83.364,
    85:92.680,86:103.459,87:115.502,88:129.018,89:143.810,90:159.458,91:176.551,92:195.360,93:216.286,
    94:238.799,95:262.268,96:286.291,97:310.944,98:332.325,99:349.036,100:366.568},
  female:{
    20:0.441,21:0.476,22:0.513,23:0.546,24:0.582,25:0.609,26:0.641,27:0.683,28:0.740,29:0.808,
    30:0.878,31:0.947,32:1.018,33:1.089,34:1.154,35:1.209,36:1.263,37:1.347,38:1.438,39:1.533,
    40:1.643,41:1.742,42:1.845,43:1.954,44:2.075,45:2.187,46:2.306,47:2.438,48:2.595,49:2.791,
    50:3.030,51:3.288,52:3.554,53:3.847,54:4.172,
    55:4.532,56:4.923,57:5.365,58:5.815,59:6.333,60:6.923,61:7.555,62:8.220,63:8.881,64:9.514,
    65:10.188,66:10.880,67:11.659,68:12.543,69:13.581,70:14.769,71:16.153,72:17.705,73:19.495,74:21.533,
    75:23.846,76:26.458,77:29.700,78:33.135,79:36.982,80:41.183,81:45.959,82:51.282,83:57.262,84:64.107,
    85:71.752,86:80.490,87:90.566,88:102.204,89:115.178,90:129.176,91:144.229,92:160.353,93:177.635,
    94:196.502,95:216.846,96:238.750,97:261.359,98:283.899,99:306.491,100:329.680}
};
function survFrom(sex,from,to){let p=1;for(let a=from;a<Math.min(to,100);a++)p*=1-(QX[sex][a]??400)/1000;return p;}
function survJoint(sex1,age1,sex2,age2,to){
  const elapsed=to-age1;
  return 1-(1-survFrom(sex1,age1,to))*(1-survFrom(sex2,age2,age2+elapsed));
}

// RELO is inlined into index.html (generated from states.json). Read it off window
// so this module stays a pure ES import with no fetch (local-first, nothing leaves
// the device).
const RELO = (typeof window !== 'undefined' && window.RELO) || {};

const STATE_OPTIONS = Object.keys(RELO)
  .sort((a, b) => RELO[a].name.localeCompare(RELO[b].name))
  .map((code) => ({ value: code, label: RELO[code].name }));

const HORIZON = 20; // years shown on the payback chart

export const meta = {
  name: 'Relocation',
  tagline: 'How long a move takes to pay for itself on state income tax.',
};

export const inputs = [
  { id: 'fromState', type: 'select', label: 'Where you live now', options: STATE_OPTIONS, default: 'CA' },
  { id: 'toState',   type: 'select', label: 'Where you would move', options: STATE_OPTIONS, default: 'TX' },
  { id: 'status',    type: 'select', label: 'Filing status', default: 'mfj',
    options: [
      { value: 'single', label: 'Single' },
      { value: 'mfj',    label: 'Married filing jointly' },
      { value: 'mfs',    label: 'Married filing separately' },
      { value: 'hoh',    label: 'Head of household' },
    ] },
  { id: 'age',            type: 'number', label: 'Your age',                      min: 50, max: 100, step: 1,    default: 68 },
  { id: 'sex', type: 'select', label: 'Sex (for life expectancy)', default: 'female',
    options: [{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }] },
  { id: 'socialSecurity', type: 'number', label: 'Social Security per year',      min: 0, max: 120000, step: 500,  default: 30000, unit: '$' },
  { id: 'iraWithdrawal',  type: 'number', label: 'IRA / 401(k) withdrawal per year', min: 0, max: 500000, step: 1000, default: 40000, unit: '$' },
  { id: 'pension',        type: 'number', label: 'Pension per year',             min: 0, max: 300000, step: 1000, default: 20000, unit: '$' },
  { id: 'capGains',       type: 'number', label: 'Capital gains per year',       min: 0, max: 500000, step: 1000, default: 10000, unit: '$' },
  { id: 'moveCost',       type: 'number', label: 'One-time cost to move',        min: 0, max: 200000, step: 1000, default: 15000, unit: '$',
    help: 'Everything the move itself costs — movers, travel, and any costs to sell one home and buy another.' },
  { id: 'discountRate', type: 'slider', label: 'Discount rate (real return)',
    min: 0, max: 6, step: 0.5, default: 2, unit: '%',
    help: 'The annual real return you could earn on the money instead. At 0% all future dollars count equally. Try 2–3% for a conservative real-return assumption.' },
  // custom:true — the page renders and wires these itself (conditional
  // visibility based on fromState/toState; see relocation/index.html), not
  // core/controls.js. Still real inputs: seeded into values, included in
  // presets/compute like any other. Only NY and OR have an opt-in local-tax
  // selector — MD/IN's county tax is mandatory and unconditional, so it needs
  // no selector at all (see computeLocalTax).
  { id: 'fromLocalTax', type: 'select', custom: true, default: '',
    label: 'Local tax where you live now',
    options: [
      { value: '', label: 'None' },
      { value: 'nyc', label: 'New York City' },
      { value: 'yonkers', label: 'Yonkers, NY' },
      { value: 'metro', label: 'Portland Metro area (OR)' },
      { value: 'multnomah', label: 'Multnomah County, OR' },
    ] },
  { id: 'toLocalTax', type: 'select', custom: true, default: '',
    label: 'Local tax where you would move',
    options: [
      { value: '', label: 'None' },
      { value: 'nyc', label: 'New York City' },
      { value: 'yonkers', label: 'Yonkers, NY' },
      { value: 'metro', label: 'Portland Metro area (OR)' },
      { value: 'multnomah', label: 'Multnomah County, OR' },
    ] },
];

export const presets = {
  'California to Texas':      { fromState: 'CA', toState: 'TX', status: 'mfj', age: 68, socialSecurity: 30000, iraWithdrawal: 40000, pension: 20000, capGains: 10000, moveCost: 15000 },
  'New York to Florida':      { fromState: 'NY', toState: 'FL', status: 'mfj', age: 70, socialSecurity: 36000, iraWithdrawal: 60000, pension: 30000, capGains: 15000, moveCost: 20000 },
  'When moving costs more (NJ to PA)': { fromState: 'NJ', toState: 'PA', status: 'mfj', age: 66, socialSecurity: 30000, iraWithdrawal: 40000, pension: 20000, capGains: 10000, moveCost: 15000 },
};

const dollars = (n) => `$${Math.round(n).toLocaleString()}`;
const pct = (r) => `${(r * 100).toFixed(2)}%`;

function stateTax(code, status, income) {
  const s = RELO[code];
  if (!s) return { tax: 0, breakdown: {} };
  return computeStateIncomeTax(s.taxRules, status, income);
}

// NY and OR are the only states with an opt-in local-tax selector (MD/IN's
// county tax is mandatory, no selector). A stale selection left over from
// switching away from NY/OR must never leak into a different state's tax —
// gated here at the point of use, not by relying on the DOM control actually
// being cleared (the same safety net Roth's calc() relies on for its own
// nyLocalTax/orLocalTax selectors).
const LOCAL_TAX_STATES = new Set(['NY', 'OR']);
function localCodeFor(code, rawCode) {
  return LOCAL_TAX_STATES.has(code) ? rawCode : '';
}

export function compute(values) {
  const from = values.fromState;
  const to = values.toState;
  const status = values.status;
  const income = {
    ss: values.socialSecurity,
    iraWithdrawal: values.iraWithdrawal,
    pension: values.pension,
    capGains: values.capGains,
    age: values.age,
  };

  const fromResult = stateTax(from, status, income);
  const toResult = stateTax(to, status, income);
  const fromLocal = computeLocalTax(RELO[from]?.localTax, status, fromResult.breakdown, fromResult.tax, localCodeFor(from, values.fromLocalTax));
  const toLocal = computeLocalTax(RELO[to]?.localTax, status, toResult.breakdown, toResult.tax, localCodeFor(to, values.toLocalTax));
  const fromTax = fromResult.tax + fromLocal;
  const toTax = toResult.tax + toLocal;
  const annualSaving = fromTax - toTax; // positive => moving lowers your income tax
  const moveCost = values.moveCost;

  const fromName = RELO[from]?.name ?? from;
  const toName = RELO[to]?.name ?? to;

  // Two cumulative lines over the horizon:
  //   cost of moving  — flat at moveCost
  //   tax savings     — annualSaving * year (only meaningful if positive)
  const discountRate = values.discountRate ?? 2;
  const r = discountRate / 100;
  const costPoints = [];
  const savingPoints = [];
  for (let y = 0; y <= HORIZON; y++) {
    costPoints.push({ x: y, y: moveCost });
    const pv = r === 0
      ? Math.max(0, annualSaving) * y
      : Math.max(0, annualSaving) * (1 - Math.pow(1 + r, -y)) / r;
    savingPoints.push({ x: y, y: pv });
  }

  const savingsLabel = r > 0
    ? `Present value of tax savings (${discountRate}% discount)`
    : 'Tax savings so far';
  const series = [
    { name: 'Cost of moving', color: '#e06c75', points: costPoints },
    { name: savingsLabel, color: '#61afef', points: savingPoints },
  ];

  // Crossover: the year cumulative savings overtakes the move cost.
  const payback = annualSaving > 0 ? findCrossover(series[0], series[1]) : null;

  // Headline, written for the three honest cases.
  let headline;
  if (annualSaving < 0) {
    headline = {
      label: `Moving to ${toName} raises your state income tax`,
      value: `by ${dollars(-annualSaving)} a year`,
      primary: true,
    };
  } else if (annualSaving === 0) {
    headline = {
      label: `${fromName} and ${toName} tax this income the same`,
      value: 'no income-tax difference',
      primary: true,
    };
  } else if (payback != null) {
    headline = {
      label: `Moving to ${toName} pays for itself in`,
      value: `${payback} ${payback === 1 ? 'year' : 'years'}`,
      primary: true,
    };
  } else {
    headline = {
      label: 'On income tax alone, this move takes longer to pay back than',
      value: `${HORIZON} years`,
      primary: true,
    };
  }

  const summary = [
    { label: `${fromName} — state income tax per year`, value: dollars(fromTax) },
    { label: `${toName} — state income tax per year`, value: dollars(toTax) },
    headline,
  ];

  // Tier-2 context: disclosed side by side, never summed into the headline.
  // Defined before the note so property-tax rates are available for the callout.
  const ctxFrom = RELO[from]?.taxContext;
  const ctxTo = RELO[to]?.taxContext;

  // A plain note that keeps the tool honest when income tax is not the deciding factor.
  // Property-tax gap computed up front so it's available in all branches.
  const ptFrom = ctxFrom?.propertyTaxRateMedian;
  const ptTo = ctxTo?.propertyTaxRateMedian;
  const ptGap = ptFrom != null && ptTo != null ? ptTo - ptFrom : 0;

  let note;
  if (annualSaving > 0 && annualSaving < 500) {
    note = `The income-tax difference here is small (${dollars(annualSaving)} a year). Property and sales tax, cost of living, and being near the people you care about will likely matter more than income tax for this move.`;
  } else if (annualSaving < 0) {
    const ptAdvantage = ptGap <= -0.005
      ? ` ${toName}'s median property tax rate (${pct(ptTo)}) is lower than ${fromName}'s (${pct(ptFrom)}), which partially offsets that — see the full tax picture below.`
      : ' The context below and non-tax reasons are where a move like this has to earn its keep.';
    note = `This move would cost you more in state income tax each year, so it never pays back on income tax alone.${ptAdvantage}`;
  } else {
    let ptClause;
    if (Math.abs(ptGap) >= 0.005) {
      ptClause = ptGap > 0
        ? ` ${toName}'s median property tax rate (${pct(ptTo)}) is notably higher than ${fromName}'s (${pct(ptFrom)}) — that difference isn't in the payback number and is worth factoring into your real comparison. See the full tax picture below.`
        : ` ${toName}'s median property tax rate (${pct(ptTo)}) is lower than ${fromName}'s (${pct(ptFrom)}), which works in your favor beyond what the payback number shows. See the full tax picture below.`;
    } else {
      ptClause = ` Weigh the property, sales, and estate tax below alongside it — for many retirees property tax is the larger number.`;
    }
    note = `This counts state income tax only${r > 0 ? `, discounted at ${discountRate}% real return` : ''}.${ptClause}`;
  }

  // Append survival-probability sentence when there's a concrete payback year to reach.
  // Skip for small savings (annualSaving < 500): we've already told the user income tax
  // doesn't drive that decision, so survival context for the payback year would be confusing.
  if (payback != null && annualSaving >= 500) {
    const sex = values.sex ?? 'female';
    const targetAge = values.age + payback;
    const isMFJ = values.status === 'mfj';
    const survPct = Math.round(
      (isMFJ
        ? survJoint(sex, values.age, sex, values.age, targetAge)
        : survFrom(sex, values.age, targetAge)) * 100
    );
    const survStr = isMFJ
      ? `roughly ${survPct}% odds that at least one of you lives to see it (same-age assumption)`
      : `roughly ${survPct}% odds of living to see that payback`;
    note += ` SSA mortality tables give ${survStr}.`;
  }

  const context = {
    from: fromName,
    to: toName,
    rows: [
      {
        label: 'Sales tax (state base rate)',
        from: ctxFrom ? pct(ctxFrom.salesTaxRate) : '—',
        to: ctxTo ? pct(ctxTo.salesTaxRate) : '—',
      },
      {
        label: 'Property tax (median effective rate)',
        from: ctxFrom ? pct(ctxFrom.propertyTaxRateMedian) : '—',
        to: ctxTo ? pct(ctxTo.propertyTaxRateMedian) : '—',
      },
      {
        label: 'Estate or inheritance tax',
        from: ctxFrom ? (ctxFrom.estateTax.has ? 'Yes' : 'No') : '—',
        to: ctxTo ? (ctxTo.estateTax.has ? 'Yes' : 'No') : '—',
      },
    ],
  };

  return {
    summary,
    series,
    crossovers: payback != null ? [{ from: 0, to: 1, label: 'move pays for itself' }] : [],
    xAxis: { label: 'Years after you move', format: (n) => n.toFixed(0) },
    yAxis: { label: 'Dollars', format: (n) => `$${Math.round(n / 1000)}k` },
    note,
    context,
    // For the page's own local-tax selector visibility (see relocation/index.html)
    // — NOT part of the CalculatorModule contract, read directly off the result
    // by this page's script, same pattern as `note`/`context` above.
    localTaxUI: { from: { state: from }, to: { state: to } },
  };
}
