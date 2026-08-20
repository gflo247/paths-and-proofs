// medicare/medicare.js
// Should you pick Medigap or Medicare Advantage? The crossover here isn't an age or a
// year — Medigap's annual cost is effectively FLAT (premium plus the small Part B
// deductible, then near-total coverage), while Medicare Advantage's cost GROWS with how
// much care you use, up to its out-of-pocket cap. So the honest question is: how much
// medical care would you need to use in a year before Medigap's flat cost undercuts
// Advantage's accumulating one?
//
// SCOPE (deliberate, matching relocation.js's own disclosed-scope pattern): this tool
// never guesses your premiums — no primary source exists for actual Medigap or Advantage
// dollar figures, they're insurer-set and vary by company/age/state. You supply your own
// real quotes; the tool's job is correctly modeling the STATE RULES that shape how that
// premium behaves over time (does it rise with age? is it locked?) and what switching
// rights exist if you pick one path and want to move to the other later — shown as
// disclosed context beside the headline, never folded into it, since those risks can't be
// reduced to a single dollar figure the way the this-year breakeven can.

import { computeMedigapBreakeven, DEFAULT_ADVANTAGE_OOP_MAX, DEFAULT_COINSURANCE_RATE } from './medicare-engine.mjs';

// STATES is inlined into index.html (generated from medicare/states.json), read off
// window so this module stays a pure ES import with no fetch — nothing leaves the device.
const STATES = (typeof window !== 'undefined' && window.MEDICARE_STATES) || {};

const STATE_OPTIONS = Object.keys(STATES)
  .filter((k) => k !== '_schema')
  .sort((a, b) => (STATES[a].name || a).localeCompare(STATES[b].name || b))
  .map((code) => ({ value: code, label: STATES[code].name || code }));

const CHART_POINTS = 60; // resolution of the utilization axis

export const meta = {
  name: 'Medicare: Medigap vs. Medicare Advantage',
  tagline: 'How much care you would need to use before Medigap pays for itself.',
};

export const inputs = [
  { id: 'stateCode', type: 'select', label: 'Your state', options: STATE_OPTIONS, default: 'OH',
    help: 'Doesn’t change the numbers above — it changes how your premium is likely to move over time and your rights to switch plans later, both shown below. Make sure this is set to where you actually live, not left on the example.' },
  { id: 'medigapMonthlyPremium', type: 'number', label: 'Your Medigap quote (monthly)', min: 0, max: 1000, step: 5, default: 180, unit: '$',
    help: 'Your own real quote — no state or national average exists worth trusting here.' },
  { id: 'partDMonthlyPremium', type: 'number', label: 'Standalone Part D drug plan (monthly, optional)', min: 0, max: 300, step: 5, default: 0, unit: '$',
    help: 'Medigap carries no drug coverage of its own. Leave at $0 only if you genuinely do not need one.' },
  { id: 'advantageMonthlyPremium', type: 'number', label: 'Medicare Advantage plan premium (monthly)', min: 0, max: 400, step: 5, default: 0, unit: '$',
    help: 'Often $0 — most Advantage plans charge no separate premium.' },
  { id: 'advantageOOPMax', type: 'number', label: 'That plan’s out-of-pocket maximum (yearly)', min: 1000, max: 13900, step: 250, default: DEFAULT_ADVANTAGE_OOP_MAX, unit: '$',
    help: 'Check your specific plan’s summary of benefits — many run lower than the federal ceiling.' },
];

export const presets = {
  'Typical Plan G quote, $0 Advantage plan': { stateCode: 'OH', medigapMonthlyPremium: 180, partDMonthlyPremium: 45, advantageMonthlyPremium: 0, advantageOOPMax: DEFAULT_ADVANTAGE_OOP_MAX },
  'Community-rated state (New York)': { stateCode: 'NY', medigapMonthlyPremium: 260, partDMonthlyPremium: 40, advantageMonthlyPremium: 0, advantageOOPMax: DEFAULT_ADVANTAGE_OOP_MAX },
  'Low-premium Advantage plan with a lower cap': { stateCode: 'FL', medigapMonthlyPremium: 150, partDMonthlyPremium: 35, advantageMonthlyPremium: 20, advantageOOPMax: 4500 },
};

const dollars = (n) => `$${Math.round(n).toLocaleString()}`;

export function compute(values) {
  const stateRules = STATES[values.stateCode];
  const result = computeMedigapBreakeven(stateRules, {
    medigapMonthlyPremium: values.medigapMonthlyPremium,
    partDMonthlyPremium: values.partDMonthlyPremium,
    advantageMonthlyPremium: values.advantageMonthlyPremium,
    advantageOOPMax: values.advantageOOPMax,
  });

  const stateName = stateRules?.name || values.stateCode;

  // Utilization axis: wide enough to show both lines flatten out, whether or not a
  // crossover exists within this state's numbers.
  const axisMax = Math.max(values.advantageOOPMax, result.breakevenUtilization ?? 0) * 1.35;
  const medigapPoints = [];
  const advantagePoints = [];
  for (let i = 0; i <= CHART_POINTS; i++) {
    const u = (axisMax / CHART_POINTS) * i;
    medigapPoints.push({ x: u, y: result.medigapAnnualCost });
    advantagePoints.push({ x: u, y: result.advantageAnnualPremium + Math.min(u * DEFAULT_COINSURANCE_RATE, values.advantageOOPMax) });
  }

  const series = [
    { name: 'Medigap (flat)', color: '#61afef', points: medigapPoints },
    { name: 'Medicare Advantage (grows with use)', color: '#e06c75', points: advantagePoints },
  ];

  // The headline is framed in OOP dollars (what you'd actually pay), deliberately NOT
  // the utilization-axis figure the chart plots (what care costs at Medicare's allowed
  // rates, typically much larger than anyone's real out-of-pocket spending). Putting
  // premiumDifferential — the same units as the Advantage OOP-cap card right above it —
  // in the headline avoids two dollar figures that look comparable but aren't; the
  // Medicare-allowed-charges framing still appears, but only as supporting detail in the
  // note below, explicitly bridged to this number rather than presented on its own.
  let headline;
  if (result.breakevenUtilization === 0) {
    headline = { label: 'Medigap costs less than Advantage', value: 'even before any care is used', primary: true };
  } else if (result.medigapEverWins) {
    headline = { label: 'Medigap pays for itself once your own Advantage costs would pass', value: dollars(result.premiumDifferential), primary: true };
  } else {
    headline = { label: 'At these premiums, Advantage stays cheaper', value: 'even maxing out its yearly cap', primary: true };
  }

  const summary = [
    { label: 'Medigap — your flat annual cost', value: dollars(result.medigapAnnualCost) },
    { label: 'Advantage — annual cost at its out-of-pocket cap', value: dollars(result.advantageAnnualCostAtOOPMax) },
    headline,
  ];

  let note;
  if (result.partDNotIncluded) {
    note = 'You left the Part D field at $0 — if you actually need drug coverage and plan to pair Medigap with a standalone Part D plan, add that premium above; leaving it out understates Medigap’s real cost. The state context below still matters for your premium over time and your switching rights.';
  } else if (!result.medigapEverWins) {
    note = `On this-year math alone, Medicare Advantage is the cheaper choice at these premiums in ${stateName} no matter how much care gets used. The state context below still matters for what happens if you want to switch later.`;
  } else if (result.breakevenUtilization > 0) {
    note = `That happens once you've used about ${dollars(result.breakevenUtilization)} of covered care in a year, at Medicare's allowed rates — the cost of the care itself, not what you'd pay out of pocket. This is a this-year snapshot, not a prediction of your actual medical spending — the state context below covers how your Medigap premium is likely to change over time, and what rights you’d have to switch later.`;
  } else {
    note = 'This is a this-year snapshot, not a prediction of your actual medical spending — the state context below covers how your Medigap premium is likely to change over time, and what rights you’d have to switch later.';
  }

  return {
    summary,
    series,
    // from: 0 (Medigap, flat and initially higher) -> to: 1 (Advantage, rising from a low
    // start) — matches relocation.js's own from:flat/to:rising convention exactly; core's
    // findCrossover walks series[from] vs series[to] looking for `to` to catch up to `from`.
    crossovers: result.medigapEverWins && result.breakevenUtilization > 0
      ? [{ from: 0, to: 1, label: 'Medigap becomes cheaper' }]
      : [],
    xAxis: { label: 'Medical care used in a year (Medicare-allowed charges)', format: (n) => `$${Math.round(n / 1000)}k` },
    yAxis: { label: 'Your annual cost', format: (n) => `$${Math.round(n / 1000)}k` },
    note,
    context: { stateName, rating: result.ratingContext, guaranteedIssue: result.guaranteedIssueContext },
  };
}
