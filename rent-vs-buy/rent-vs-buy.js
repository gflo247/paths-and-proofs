// sites/rent-vs-buy.js
// Implements the engine contract. Compares net worth of buying vs renting at
// each horizon, asking "if you sold and left at year N, who is ahead?" The
// crossover is the breakeven horizon — how long you must stay for buying to win.
//
// Honest simplifications (stated on the page): constant rates, a 30-year fixed
// mortgage with no refinance, and no income-tax effects (most people take the
// standard deduction, so the mortgage-interest deduction rarely changes this).

import { findCrossover } from '../core/finance.js';

export const meta = {
  name: 'Rent vs buy',
  tagline: 'How long you would have to stay for buying to beat renting.',
};

export const inputs = [
  { id: 'price',       type: 'number', label: 'Home price',                       min: 50000, max: 2000000, step: 5000, default: 400000, unit: '$' },
  { id: 'downPct',     type: 'slider', label: 'Down payment',                     min: 0,  max: 50, step: 1,    default: 20, unit: '%' },
  { id: 'rate',        type: 'slider', label: 'Mortgage interest rate',           min: 1,  max: 12, step: 0.1,  default: 6.5, unit: '%' },
  { id: 'rent',        type: 'number', label: 'Monthly rent today',               min: 200, max: 15000, step: 50, default: 2200, unit: '$' },
  { id: 'rentGrowth',  type: 'slider', label: 'Rent increase per year',           min: 0,  max: 8, step: 0.5,   default: 3, unit: '%' },
  { id: 'appreciation',type: 'slider', label: 'Home appreciation per year',       min: 0,  max: 8, step: 0.5,   default: 4, unit: '%' },
  { id: 'invReturn',   type: 'slider', label: 'Investment return per year',       min: 0,  max: 12, step: 0.5,  default: 6, unit: '%' },
  { id: 'propTax',     type: 'slider', label: 'Property tax per year',            min: 0,  max: 3, step: 0.1,   default: 1.1, unit: '%' },
  { id: 'upkeep',      type: 'slider', label: 'Upkeep per year (maintenance, insurance, dues)', min: 0, max: 4, step: 0.1, default: 1.5, unit: '%' },
  { id: 'closingPct',  type: 'slider', label: 'Closing costs to buy',             min: 0,  max: 6, step: 0.5,   default: 3, unit: '%' },
  { id: 'sellPct',     type: 'slider', label: 'Costs to sell',                    min: 0,  max: 10, step: 0.5,  default: 6, unit: '%' },
];

export const presets = {
  'Typical metro':       { price: 400000, downPct: 20, rate: 6.5, rent: 2200, rentGrowth: 3, appreciation: 4, invReturn: 6, propTax: 1.1, upkeep: 1.5, closingPct: 3, sellPct: 6 },
  'Pricey market, renting cheap': { price: 700000, downPct: 20, rate: 6.5, rent: 2800, rentGrowth: 3, appreciation: 4, invReturn: 6, propTax: 1.1, upkeep: 1.5, closingPct: 3, sellPct: 6 },
};

export function compute(values) {
  const P = values.price;
  const downPayment = P * values.downPct / 100;
  const closingCost = P * values.closingPct / 100;
  const sell = values.sellPct / 100;
  const loan = P - downPayment;

  const im = values.rate / 100 / 12;                 // monthly mortgage rate
  const term = 360;                                  // 30-year fixed
  const payment = im === 0 ? loan / term : loan * im / (1 - Math.pow(1 + im, -term));

  const gHome = values.appreciation / 100;
  const gRent = values.rentGrowth / 100;
  const rInvM = Math.pow(1 + values.invReturn / 100, 1 / 12) - 1;
  const carry = (values.propTax + values.upkeep) / 100;  // yearly, as % of home value

  const years = 30;
  let balance = loan;
  let renterSide = downPayment + closingCost;        // renter invests what buying ties up
  let buyerSide = 0;                                 // buyer invests only if renting would cost more

  const buyPoints = [];
  const rentPoints = [];
  const snap = (y) => {
    const homeValue = P * Math.pow(1 + gHome, y);
    const buyNet = homeValue * (1 - sell) - balance + buyerSide;
    buyPoints.push({ x: y, y: buyNet });
    rentPoints.push({ x: y, y: renterSide });
  };
  snap(0);

  for (let m = 1; m <= years * 12; m++) {
    const yearIdx = Math.floor((m - 1) / 12);
    const homeValue = P * Math.pow(1 + gHome, (m - 1) / 12);

    const interest = balance * im;
    const principal = Math.min(payment - interest, balance);
    balance = Math.max(0, balance - principal);

    const buyerOut = (balance > 0 || principal > 0 ? payment : 0) + homeValue * carry / 12;
    const renterOut = values.rent * Math.pow(1 + gRent, yearIdx);

    renterSide *= (1 + rInvM);
    buyerSide *= (1 + rInvM);
    if (buyerOut > renterOut) renterSide += (buyerOut - renterOut);
    else buyerSide += (renterOut - buyerOut);

    if (m % 12 === 0) snap(m / 12);
  }

  const series = [
    { name: 'Buy', color: '#61afef', points: buyPoints },
    { name: 'Rent', color: '#e06c75', points: rentPoints },
  ];
  const breakeven = findCrossover(series[1], series[0]); // rent leads first, buy overtakes

  const summary = [
    { label: 'Monthly payment (principal and interest)', value: `$${Math.round(payment).toLocaleString()}` },
    { label: 'Upfront cash (down payment plus closing)', value: `$${Math.round(downPayment + closingCost).toLocaleString()}` },
    {
      label: 'Buying beats renting if you stay at least',
      value: breakeven != null ? `${breakeven} years` : 'longer than 30 years',
      primary: true,
    },
  ];

  return {
    summary,
    series,
    crossovers: [{ from: 1, to: 0, label: 'buying pulls ahead' }],
    xAxis: { label: 'Years you stay', format: (n) => n.toFixed(0) },
    yAxis: { label: 'Net worth if you leave then', format: (n) => `$${Math.round(n / 1000)}k` },
  };
}
