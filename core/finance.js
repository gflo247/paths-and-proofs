// core/finance.js
// Generic money math. No domain knowledge — usable by every calculator.

/** Convert an annual real rate to its equivalent monthly rate. */
export function realMonthlyRate(annualReal) {
  return Math.pow(1 + annualReal, 1 / 12) - 1;
}

/**
 * Present value of a constant monthly payment, referenced to month 0.
 * Pays in [startMonth, endMonth). Real dollars in, real rate in.
 */
export function presentValueOfStream(monthlyAmount, startMonth, endMonth, annualRate) {
  const i = realMonthlyRate(annualRate);
  let pv = 0;
  for (let m = startMonth; m < endMonth; m++) {
    pv += i === 0 ? monthlyAmount : monthlyAmount / Math.pow(1 + i, m);
  }
  return pv;
}

/**
 * First x at which series B overtakes series A, where A leads first.
 * Ignores any opening stretch where the two are tied (e.g. both zero before
 * either has begun paying). Returns null if B never genuinely catches A.
 */
export function findCrossover(seriesA, seriesB) {
  let aHasLed = false;
  for (let k = 0; k < seriesA.points.length; k++) {
    const a = seriesA.points[k].y;
    const b = seriesB.points[k].y;
    if (a > b) aHasLed = true;
    else if (aHasLed && b >= a) return seriesA.points[k].x;
  }
  return null;
}
