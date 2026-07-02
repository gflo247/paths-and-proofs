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

import { computeStateIncomeTax } from './relo-engine.mjs';
import { findCrossover } from '../core/finance.js';

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
  { id: 'socialSecurity', type: 'number', label: 'Social Security per year',      min: 0, max: 120000, step: 500,  default: 30000, unit: '$' },
  { id: 'iraWithdrawal',  type: 'number', label: 'IRA / 401(k) withdrawal per year', min: 0, max: 500000, step: 1000, default: 40000, unit: '$' },
  { id: 'pension',        type: 'number', label: 'Pension per year',             min: 0, max: 300000, step: 1000, default: 20000, unit: '$' },
  { id: 'capGains',       type: 'number', label: 'Capital gains per year',       min: 0, max: 500000, step: 1000, default: 10000, unit: '$' },
  { id: 'moveCost',       type: 'number', label: 'One-time cost to move',        min: 0, max: 200000, step: 1000, default: 15000, unit: '$',
    help: 'Everything the move itself costs — movers, travel, and any costs to sell one home and buy another.' },
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
  if (!s) return 0;
  return computeStateIncomeTax(s.taxRules, status, income).tax;
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

  const fromTax = stateTax(from, status, income);
  const toTax = stateTax(to, status, income);
  const annualSaving = fromTax - toTax; // positive => moving lowers your income tax
  const moveCost = values.moveCost;

  const fromName = RELO[from]?.name ?? from;
  const toName = RELO[to]?.name ?? to;

  // Two cumulative lines over the horizon:
  //   cost of moving  — flat at moveCost
  //   tax savings     — annualSaving * year (only meaningful if positive)
  const costPoints = [];
  const savingPoints = [];
  for (let y = 0; y <= HORIZON; y++) {
    costPoints.push({ x: y, y: moveCost });
    savingPoints.push({ x: y, y: Math.max(0, annualSaving) * y });
  }

  const series = [
    { name: 'Cost of moving', color: '#e06c75', points: costPoints },
    { name: 'Tax savings so far', color: '#61afef', points: savingPoints },
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

  // A plain note that keeps the tool honest when income tax is not the deciding factor.
  let note;
  if (annualSaving > 0 && annualSaving < 500) {
    note = `The income-tax difference here is small (${dollars(annualSaving)} a year). Property and sales tax, cost of living, and being near the people you care about will likely matter more than income tax for this move.`;
  } else if (annualSaving < 0) {
    note = `This move would cost you more in state income tax each year, so it never pays back on income tax alone. The context below and non-tax reasons are where a move like this has to earn its keep.`;
  } else {
    note = `This counts state income tax only. Weigh the property, sales, and estate tax below alongside it — for many retirees property tax is the larger number.`;
  }

  // Tier-2 context: disclosed side by side, never summed into the headline.
  const ctxFrom = RELO[from]?.taxContext;
  const ctxTo = RELO[to]?.taxContext;
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
  };
}
