#!/usr/bin/env node
// test-life-engine.mjs — hand-derived checks for life-insurance/life-engine.mjs.
// Mirrors the style of test-medicare-engine.mjs.

import { mortgageBalanceAt, survivorSocialSecurity, scenarioByYear, fitPolicies } from '../life-insurance/life-engine.mjs';

let pass = 0, fail = 0;
function check(label, actual, expected, tolerance = 1) {
  const ok = typeof expected === 'number'
    ? Math.abs(actual - expected) <= tolerance
    : typeof expected === 'boolean'
    ? actual === expected
    : actual === expected;
  if (ok) { pass++; console.log(`ok    ${label}`); }
  else { fail++; console.log(`FAIL  ${label}  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`); }
}

// ── Mortgage ──
{
  check('mortgage: balance at 0 = input', mortgageBalanceAt(300000, 0.06, 30, 0), 300000);
  check('mortgage: balance at end = 0', mortgageBalanceAt(300000, 0.06, 30, 30), 0);
  check('mortgage: rate 0 → linear', mortgageBalanceAt(300000, 0, 30, 15), 150000);
  check('mortgage: rate 0 → linear at 10', mortgageBalanceAt(300000, 0, 30, 10), 200000);
  // Hand-computed: $300k at 6% over 30 years, after 10 years.
  // Monthly payment = 300000 * 0.005 / (1 - 1.005^-360) = 1798.65
  // Balance after 120 payments: 300000*1.005^120 - 1798.65*(1.005^120 - 1)/0.005
  // = 300000*1.81940 - 1798.65*163.879 = 545820 - 294733.7 ≈ 251086
  check('mortgage: hand-computed at 10 years', mortgageBalanceAt(300000, 0.06, 30, 10), 251086, 50);
  check('mortgage: negative t returns balance', mortgageBalanceAt(300000, 0.06, 30, -1), 300000);
  check('mortgage: zero balance', mortgageBalanceAt(0, 0.06, 30, 5), 0);
}

// ── Social Security ──
{
  // Basic: 2 children under 18, caregiver eligible.
  // individual = 1200*12 = 14400, FM = 2200*12 = 26400.
  // 3 beneficiaries * 14400 = 43200 > 26400, so each gets 26400/3 = 8800.
  // No earnings test (pay = 0).
  const r1 = survivorSocialSecurity(1200, 2200, 0, [4, 6]);
  check('SS: 2 kids + caregiver, no earnings test, total', r1.total, 26400);
  check('SS: caregiver paid', r1.caregiverPaid, 8800);
  check('SS: children total', r1.childrenTotal, 17600);

  // Children stop at 18: one child is 17, other is 19.
  const r2 = survivorSocialSecurity(1200, 2200, 0, [17, 19]);
  // 1 eligible child + caregiver (youngest = 17 >= 16, so no caregiver).
  // Actually youngest is 17, which is >= 16, so no caregiver.
  // 1 beneficiary * 14400 < 26400, so child gets 14400.
  check('SS: child at 17 still eligible', r2.childrenTotal, 14400);
  check('SS: no caregiver when youngest >= 16', r2.caregiverPaid, 0);

  // Child at 18: not eligible.
  const r3 = survivorSocialSecurity(1200, 2200, 0, [18, 20]);
  check('SS: children at 18+ not eligible', r3.total, 0);

  // Caregiver stops when youngest = 16.
  const r4 = survivorSocialSecurity(1200, 2200, 0, [10, 16]);
  // youngest = 10 < 16, so caregiver eligible.
  // 2 children + caregiver = 3 * 14400 = 43200 > 26400 → each 8800.
  check('SS: caregiver eligible when youngest < 16', r4.caregiverPaid, 8800);
  const r4b = survivorSocialSecurity(1200, 2200, 0, [16, 17]);
  // youngest = 16, NOT < 16, so no caregiver.
  check('SS: caregiver gone when youngest = 16', r4b.caregiverPaid, 0);

  // Family-max proration: 1 child, caregiver.
  // individual = 1200*12 = 14400, FM = 1500*12 = 18000.
  // 2 * 14400 = 28800 > 18000 → each gets 9000.
  const r5 = survivorSocialSecurity(1200, 1500, 0, [5]);
  check('SS: family-max proration, child', r5.childrenTotal, 9000);
  check('SS: family-max proration, caregiver', r5.caregiverPaid, 9000);

  // Partial earnings test: survivor earns $50,000.
  // Excess = 50000 - 24480 = 25520. Reduction = 25520/2 = 12760.
  // rawShare = 9000 (prorated). caregiverReduction = min(9000, 12760) = 9000.
  // Caregiver fully withheld.
  const r6 = survivorSocialSecurity(1200, 1500, 50000, [5]);
  check('SS: high-pay caregiver fully withheld', r6.caregiverFullyWithheld, true);
  check('SS: caregiver paid = 0 after full withhold', r6.caregiverPaid, 0);
  // Redistribution: child gets min(14400, 18000/1) = 14400.
  check('SS: child gets individual after caregiver off rolls', r6.childrenTotal, 14400);

  // Partial earnings test with moderate pay: survivor earns $30,000.
  // 2 children age 4,6 + caregiver. FM = 2200*12 = 26400, individual = 14400.
  // 3 * 14400 = 43200 > 26400 → rawShare = 8800 each.
  // Excess = 30000-24480 = 5520. Reduction = 2760.
  // caregiverPaid = 8800 - 2760 = 6040.
  // Children share FM - caregiverPaid = 26400 - 6040 = 20360.
  // Per child = min(14400, 20360/2) = 10180.
  // Total = 10180*2 + 6040 = 26400. Children's total stable despite parent pay.
  const r7 = survivorSocialSecurity(1200, 2200, 30000, [4, 6]);
  check('SS: partial earnings test, caregiver paid', r7.caregiverPaid, 6040);
  check('SS: partial earnings test, children total', r7.childrenTotal, 20360);
  check('SS: children total stable (family max preserved)', r7.total, 26400);
  check('SS: earnings test applied', r7.earningsTestApplied, true);

  // Full withholding, redistribution: 2 children, caregiver withheld.
  // survivor earns $80k. Excess = 80000-24480 = 55520. Reduction = 27760 > rawShare=8800.
  // Caregiver fully withheld. Children: min(14400, 26400/2) = 13200 each.
  const r8 = survivorSocialSecurity(1200, 2200, 80000, [4, 6]);
  check('SS: full withhold, child total', r8.childrenTotal, 26400);
  check('SS: full withhold, caregiver = 0', r8.caregiverPaid, 0);

  // No children.
  const r9 = survivorSocialSecurity(1200, 2200, 0, []);
  check('SS: no children, total = 0', r9.total, 0);

  // Children's benefits never reduced by parent's pay (verify r7 vs r1).
  check('SS: children benefit >= no-earnings-test children benefit', r7.childrenTotal >= r1.childrenTotal, true);
}

// ── scenarioByYear edges ──

function makeInputs(overrides = {}) {
  return {
    youAge: '35', spouseAge: '35',
    youGrossPay: '0', spouseGrossPay: '0',
    youRetirementSaving: '0', spouseRetirementSaving: '0',
    youSsPerChild: '0', youSsFamilyMax: '0',
    spouseSsPerChild: '0', spouseSsFamilyMax: '0',
    youExtraCare: '0', spouseExtraCare: '0',
    youTermCoverage: '0', youTermYearsLeft: '0',
    spouseTermCoverage: '0', spouseTermYearsLeft: '0',
    youEmployerCoverage: '0', spouseEmployerCoverage: '0',
    child1Age: '', child2Age: '', child3Age: '', child4Age: '',
    householdSpending: '60000', spendingContinues: '80',
    supportUntilAge: '22', supportYearsNoKids: '10',
    collegePerChild: '0', childcareUntilAge: '13',
    mortgageBalance: '0', mortgageRate: '0', mortgageYearsLeft: '0',
    otherDebts: '0', finalExpenses: '10000',
    savings: '0', collegeSavings: '0',
    discountRate: '0', inflation: '0',
    takeHomeShare: '100', retirementAge: '65',
    countEmployerCoverage: 'leave',
    ...overrides
  };
}

{
  // No children: uses supportYearsNoKids.
  const r = scenarioByYear(makeInputs({ householdSpending: '48000', spendingContinues: '100', supportYearsNoKids: '10', savings: '0' }), 'you');
  // With 0% discount: needs = 48000*10 + 10000 final = 490000, have = 0.
  // need(0) = 490000. need should be positive for t=0.
  check('edge: no children uses supportYearsNoKids', r[0].need > 0, true);
}

{
  // No mortgage: need doesn't include mortgage.
  const r = scenarioByYear(makeInputs({ mortgageBalance: '0' }), 'you');
  // Just final expenses since spending = 48000 at 80% = 38400 but pay = 0 for you.
  // Actually youGrossPay = 0, so if you die, survivor has 0 pay. Need includes spending.
  check('edge: no mortgage, still has other needs', r[0].needs >= 10000, true);
}

{
  // Stay-at-home survivor: pay = 0.
  const r = scenarioByYear(makeInputs({ youGrossPay: '80000', spouseGrossPay: '0', householdSpending: '48000', spendingContinues: '100', supportYearsNoKids: '5' }), 'you');
  // If "you" die, survivor (spouse) has $0 pay. Need = spending flows + final.
  check('edge: stay-at-home survivor has high need', r[0].need > 200000, true);
}

{
  // Zero need everywhere: survivor earns enough.
  const r = scenarioByYear(makeInputs({ youGrossPay: '0', spouseGrossPay: '200000', householdSpending: '48000', spendingContinues: '100', supportYearsNoKids: '5', savings: '100000' }), 'you');
  // You earn $0 so dying doesn't reduce income. Survivor earns $200k, take-home 100% = 200k.
  // Spending = 48000. Large surplus. need should be 0 at t=0.
  check('edge: zero need when survivor earns enough', r[0].need, 0);
}

{
  // Need zero today but positive later: existing policy covers early years.
  const r = scenarioByYear(makeInputs({
    youGrossPay: '100000', spouseGrossPay: '40000',
    householdSpending: '60000', spendingContinues: '100',
    supportYearsNoKids: '15', savings: '50000',
    youTermCoverage: '500000', youTermYearsLeft: '5',
    finalExpenses: '10000'
  }), 'you');
  // At t=0, have includes $500k term + $50k savings + surplus PV.
  // At t=5, term expires. The need should be higher later.
  const maxNeed = Math.max(...r.map(x => x.need));
  // Verify headline uses maxNeed, not need(0).
  check('edge: need can be 0 today but positive later', maxNeed > r[0].need, true);
}

{
  // Lost retirement saving past support window.
  const r1 = scenarioByYear(makeInputs({
    youAge: '35', youGrossPay: '80000', youRetirementSaving: '20000',
    spouseGrossPay: '80000', householdSpending: '60000', spendingContinues: '100',
    supportYearsNoKids: '5', savings: '0', finalExpenses: '0'
  }), 'you');
  const r2 = scenarioByYear(makeInputs({
    youAge: '35', youGrossPay: '80000', youRetirementSaving: '0',
    spouseGrossPay: '80000', householdSpending: '60000', spendingContinues: '100',
    supportYearsNoKids: '5', savings: '0', finalExpenses: '0'
  }), 'you');
  // With retirement saving: lost saving adds to need past support window.
  check('edge: lost retirement saving increases need', r1[0].need > r2[0].need, true);
}

{
  // maxNeed < MIN_FACE → small-need message.
  const r = scenarioByYear(makeInputs({
    youGrossPay: '60000', spouseGrossPay: '55000',
    householdSpending: '40000', spendingContinues: '100',
    supportYearsNoKids: '3', savings: '100000', finalExpenses: '5000'
  }), 'you');
  const needArr = r.map(x => x.need);
  const maxNeed = Math.max(...needArr);
  const lastNY = needArr.reduce((last, n, i) => n > 0 ? i : last, -1);
  const pol = fitPolicies(needArr, lastNY);
  check('edge: small need flagged when maxNeed < 100k', pol.smallNeed || maxNeed === 0, true);
}

// ── Policies ──
{
  // Hand-built curve: need starts high and drops.
  // t:  0   1   2   3   4   5   6   7   8   9   10  11..
  // n: 400k 380k 350k 300k 250k 200k 150k 100k 50k 0   0
  const needByYear = [400000, 380000, 350000, 300000, 250000, 200000, 150000, 100000, 50000, 0, 0];
  const lastNY = 8;
  const pol = fitPolicies(needByYear, lastNY);

  // Single policy: term >= 9, so 10-year. Face = roundFace(400000) = 400000.
  check('policy: single term = 10', pol.singlePolicy.term, 10);
  check('policy: single face = 400k', pol.singlePolicy.face, 400000);
  check('policy: single face is multiple of 25k', pol.singlePolicy.face % 25000, 0);
  check('policy: single face >= MIN_FACE', pol.singlePolicy.face >= 100000, true);
  check('policy: no tail uncovered', pol.singlePolicy.tailUncovered, false);

  // Ladder check: coverage >= need at every year.
  if (pol.ladder) {
    const { short, long } = pol.ladder;
    for (let t = 0; t <= lastNY; t++) {
      const coverage = (t < short.term ? short.face : 0) + (t < long.term ? long.face : 0);
      check(`policy: ladder covers year ${t}`, coverage >= needByYear[t], true);
    }
    check('policy: ladder faces are multiples of 25k', short.face % 25000 === 0 && long.face % 25000 === 0, true);
    check('policy: ladder saves >= 15% coverage-years', pol.ladder.savingsPct >= 0.15, true);
  }
}

{
  // Ladder suppressed when savings < 15%.
  // Flat need: 200k for 10 years. Single = 200k * 10 = 2M coverage-years.
  // No ladder pair can save 15% from a flat curve.
  const flat = Array(11).fill(200000);
  flat[10] = 0;
  const pol = fitPolicies(flat, 9);
  check('policy: ladder suppressed for flat curve', pol.ladder, null);
}

{
  // Need past 30 years: tail flagged.
  const long = Array(35).fill(100000);
  const pol = fitPolicies(long, 34);
  check('policy: tail uncovered when need past 30', pol.singlePolicy.tailUncovered, true);
  check('policy: single term capped at 30', pol.singlePolicy.term, 30);
}

{
  // Zero need everywhere.
  const pol = fitPolicies([0, 0, 0], -1);
  check('policy: zero need → no policy', pol.singlePolicy, null);
  check('policy: zero need → no ladder', pol.ladder, null);
  check('policy: maxNeed = 0', pol.maxNeed, 0);
}

// ── Symmetry ──
{
  const inputs = makeInputs({
    youAge: '40', spouseAge: '45',
    youGrossPay: '100000', spouseGrossPay: '60000',
    youRetirementSaving: '15000', spouseRetirementSaving: '8000',
    youSsPerChild: '1200', youSsFamilyMax: '2200',
    spouseSsPerChild: '800', spouseSsFamilyMax: '1500',
    youExtraCare: '10000', spouseExtraCare: '5000',
    youTermCoverage: '200000', youTermYearsLeft: '15',
    spouseTermCoverage: '100000', spouseTermYearsLeft: '10',
    child1Age: '4', child2Age: '8',
    mortgageBalance: '300000', mortgageRate: '6', mortgageYearsLeft: '25',
    savings: '80000', finalExpenses: '12000',
  });

  const rYou = scenarioByYear(inputs, 'you');
  const rSpouse = scenarioByYear(inputs, 'spouse');

  // Swap: create inputs with you/spouse swapped.
  const swapped = makeInputs({
    youAge: '45', spouseAge: '40',
    youGrossPay: '60000', spouseGrossPay: '100000',
    youRetirementSaving: '8000', spouseRetirementSaving: '15000',
    youSsPerChild: '800', youSsFamilyMax: '1500',
    spouseSsPerChild: '1200', spouseSsFamilyMax: '2200',
    youExtraCare: '5000', spouseExtraCare: '10000',
    youTermCoverage: '100000', youTermYearsLeft: '10',
    spouseTermCoverage: '200000', spouseTermYearsLeft: '15',
    child1Age: '4', child2Age: '8',
    mortgageBalance: '300000', mortgageRate: '6', mortgageYearsLeft: '25',
    savings: '80000', finalExpenses: '12000',
  });

  const rSwapYou = scenarioByYear(swapped, 'you');
  const rSwapSpouse = scenarioByYear(swapped, 'spouse');

  // rYou should match rSwapSpouse, and rSpouse should match rSwapYou.
  const len = Math.min(rYou.length, rSwapSpouse.length);
  let symOk = true;
  for (let i = 0; i < len; i++) {
    if (Math.abs(rYou[i].need - rSwapSpouse[i].need) > 1) { symOk = false; break; }
  }
  check('symmetry: swapping you/spouse swaps results (you→swap-spouse)', symOk, true);
  const len2 = Math.min(rSpouse.length, rSwapYou.length);
  let symOk2 = true;
  for (let i = 0; i < len2; i++) {
    if (Math.abs(rSpouse[i].need - rSwapYou[i].need) > 1) { symOk2 = false; break; }
  }
  check('symmetry: swapping you/spouse swaps results (spouse→swap-you)', symOk2, true);
}

// ── Present value at 0% discount ──
{
  const r = scenarioByYear(makeInputs({
    youGrossPay: '0', spouseGrossPay: '0',
    householdSpending: '12000', spendingContinues: '100',
    supportYearsNoKids: '5', savings: '0', finalExpenses: '0',
    discountRate: '0'
  }), 'you');
  // At 0% discount, needs(0) = 12000*5 = 60000 (plain sum).
  check('PV at 0% discount = plain sum', r[0].needs, 60000, 5);
}

// ── Every select default/preset value is a string ──
{
  // This checks the engine accepts string values for ages and numeric fields.
  const r = scenarioByYear(makeInputs({ child1Age: '4' }), 'you');
  check('string select values accepted', r.length > 0, true);
}

console.log(pass + fail === 0 ? '\nNo checks ran.' : `\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
