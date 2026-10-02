// life-insurance/life-insurance.js
// Should a two-parent household buy term life insurance, and if so, how much and
// for how long? The breakeven is the age past which the family would be fine
// without new coverage. The gap between what the family needs and what it already
// has is the insurance amount. A two-policy ladder can fit the declining curve
// better than one flat policy when the savings are significant enough.

import { scenarioByYear, fitPolicies, survivorSocialSecurity } from './life-engine.mjs';

export const meta = {
  name: 'Life insurance: how much, and for how long',
  tagline: 'What your family would need if one of you died, and when they would no longer need it.',
};

// Age options for child selects: '' (no child) + '0'..'21'.
const childAgeOptions = [
  { value: '', label: '(no child)' },
  ...Array.from({ length: 22 }, (_, i) => ({ value: String(i), label: String(i) })),
];

// Percentage options for several fields.
const pctOptions = (vals) => vals.map(v => ({ value: String(v), label: `${v}%` }));

export const groups = [
  { id: 'family', label: 'Your family', open: true },
  { id: 'you', label: 'You' },
  { id: 'spouse', label: 'Your spouse' },
  { id: 'home', label: 'Home, debts, and savings' },
  { id: 'assumptions', label: 'Assumptions' },
  { id: 'quotes', label: 'Compare quotes' },
];

export const inputs = [
  // Top-level (no group)
  { id: 'scenario', type: 'select', label: 'Show the plan if this person died',
    options: [{ value: 'you', label: 'You' }, { value: 'spouse', label: 'Your spouse' }],
    default: 'you' },

  // ── Your family ──
  { id: 'child1Age', type: 'select', label: 'Child 1\'s age (leave blank for no child)',
    options: childAgeOptions, default: '4', group: 'family' },
  { id: 'child2Age', type: 'select', label: 'Child 2\'s age (leave blank for no child)',
    options: childAgeOptions, default: '', group: 'family' },
  { id: 'child3Age', type: 'select', label: 'Child 3\'s age (leave blank for no child)',
    options: childAgeOptions, default: '', group: 'family' },
  { id: 'child4Age', type: 'select', label: 'Child 4\'s age (leave blank for no child)',
    options: childAgeOptions, default: '', group: 'family' },
  { id: 'householdSpending', type: 'number', label: 'Yearly household spending today, not counting the mortgage',
    min: 0, max: 500000, step: 1000, default: 72000, unit: '$', group: 'family',
    help: 'Everything the household spends in a year except the mortgage and retirement saving, which have their own fields.' },
  { id: 'spendingContinues', type: 'select', label: 'Share of that spending that would continue after a death',
    options: pctOptions([60, 65, 70, 75, 80, 85, 90, 95, 100]), default: '80', group: 'family' },
  { id: 'supportUntilAge', type: 'number', label: 'Cover living costs until the youngest child turns',
    min: 16, max: 26, step: 1, default: 22, unit: 'years', group: 'family' },
  { id: 'collegePerChild', type: 'number', label: 'College to set aside per child, total, in today\'s dollars ($0 to skip)',
    min: 0, max: 500000, step: 5000, default: 0, unit: '$', group: 'family' },

  // ── You ──
  { id: 'youAge', type: 'number', label: 'You: age',
    min: 18, max: 70, step: 1, default: 35, group: 'you' },
  { id: 'youGrossPay', type: 'number', label: 'You: yearly pay before taxes',
    min: 0, max: 500000, step: 1000, default: 95000, unit: '$', group: 'you' },
  { id: 'youRetirementSaving', type: 'number', label: 'You: yearly retirement saving, including any employer match',
    min: 0, max: 100000, step: 500, default: 10000, unit: '$', group: 'you',
    help: 'If you died, these contributions stop. The plan replaces them so the survivor\'s retirement doesn\'t quietly take the hit.' },
  { id: 'youSsPerChild', type: 'number', label: 'You: monthly survivor benefit per child, from your Social Security statement',
    min: 0, max: 5000, step: 50, default: 1200, unit: '$', group: 'you',
    help: 'The statement\'s Survivors section lists "Your child" and "Your spouse who is caring for your child" (normally the same amount), and "Total family benefits cannot be more than". Find it at ssa.gov/myaccount. Use $0 if the person has little work history.' },
  { id: 'youSsFamilyMax', type: 'number', label: 'You: monthly total family maximum, from your Social Security statement',
    min: 0, max: 10000, step: 50, default: 2200, unit: '$', group: 'you' },
  { id: 'youExtraCare', type: 'number', label: 'You: extra yearly cost for childcare and help at home if you died',
    min: 0, max: 100000, step: 1000, default: 15000, unit: '$', group: 'you' },
  { id: 'youTermCoverage', type: 'number', label: 'You: individual term life coverage you already own',
    min: 0, max: 5000000, step: 25000, default: 0, unit: '$', group: 'you' },
  { id: 'youTermYearsLeft', type: 'number', label: 'You: years left on that term policy',
    min: 0, max: 30, step: 1, default: 0, group: 'you' },
  { id: 'youEmployerCoverage', type: 'number', label: 'You: life insurance through your employer',
    min: 0, max: 2000000, step: 25000, default: 0, unit: '$', group: 'you',
    help: 'Employer coverage usually ends when you leave the job, which is why it\'s left out by default.' },

  // ── Your spouse ──
  { id: 'spouseAge', type: 'number', label: 'Your spouse: age',
    min: 18, max: 70, step: 1, default: 35, group: 'spouse' },
  { id: 'spouseGrossPay', type: 'number', label: 'Your spouse: yearly pay before taxes',
    min: 0, max: 500000, step: 1000, default: 65000, unit: '$', group: 'spouse' },
  { id: 'spouseRetirementSaving', type: 'number', label: 'Your spouse: yearly retirement saving, including any employer match',
    min: 0, max: 100000, step: 500, default: 6000, unit: '$', group: 'spouse' },
  { id: 'spouseSsPerChild', type: 'number', label: 'Your spouse: monthly survivor benefit per child, from your Social Security statement',
    min: 0, max: 5000, step: 50, default: 800, unit: '$', group: 'spouse',
    help: 'Use $0 if the person has little work history.' },
  { id: 'spouseSsFamilyMax', type: 'number', label: 'Your spouse: monthly total family maximum, from your Social Security statement',
    min: 0, max: 10000, step: 50, default: 1500, unit: '$', group: 'spouse' },
  { id: 'spouseExtraCare', type: 'number', label: 'Your spouse: extra yearly cost for childcare and help at home if your spouse died',
    min: 0, max: 100000, step: 1000, default: 15000, unit: '$', group: 'spouse' },
  { id: 'spouseTermCoverage', type: 'number', label: 'Your spouse: individual term life coverage you already own',
    min: 0, max: 5000000, step: 25000, default: 0, unit: '$', group: 'spouse' },
  { id: 'spouseTermYearsLeft', type: 'number', label: 'Your spouse: years left on that term policy',
    min: 0, max: 30, step: 1, default: 0, group: 'spouse' },
  { id: 'spouseEmployerCoverage', type: 'number', label: 'Your spouse: life insurance through your employer',
    min: 0, max: 2000000, step: 25000, default: 0, unit: '$', group: 'spouse' },

  // ── Home, debts, and savings ──
  { id: 'mortgageBalance', type: 'number', label: 'Mortgage balance',
    min: 0, max: 2000000, step: 5000, default: 380000, unit: '$', group: 'home' },
  { id: 'mortgageRate', type: 'number', label: 'Mortgage interest rate',
    min: 0, max: 15, step: 0.1, default: 6.5, unit: '%', group: 'home' },
  { id: 'mortgageYearsLeft', type: 'number', label: 'Mortgage years left',
    min: 0, max: 30, step: 1, default: 29, group: 'home' },
  { id: 'otherDebts', type: 'number', label: 'Other debts you\'d want paid off',
    min: 0, max: 500000, step: 1000, default: 0, unit: '$', group: 'home' },
  { id: 'finalExpenses', type: 'number', label: 'Funeral and settling the estate',
    min: 0, max: 100000, step: 1000, default: 15000, unit: '$', group: 'home',
    help: 'The National Funeral Directors Association (NFDA) reports a median funeral cost around $8,000. The rest covers estate settlement, which varies widely.' },
  { id: 'savings', type: 'number', label: 'Savings and investments the family could use (leave out retirement accounts)',
    min: 0, max: 5000000, step: 5000, default: 60000, unit: '$', group: 'home' },
  { id: 'collegeSavings', type: 'number', label: 'Already saved for college, such as 529 plans',
    min: 0, max: 1000000, step: 5000, default: 0, unit: '$', group: 'home' },

  // ── Assumptions ──
  { id: 'discountRate', type: 'number', label: 'Discount rate (inflation-adjusted growth rate of savings)',
    min: 0, max: 6, step: 0.5, default: 2, unit: '%', group: 'assumptions',
    help: 'An inflation-adjusted rate for valuing future costs in today\'s dollars. 2% is roughly the historical real return on safe investments.' },
  { id: 'inflation', type: 'number', label: 'Inflation (used to convert future mortgage balances to today\'s dollars)',
    min: 0, max: 8, step: 0.5, default: 2.5, unit: '%', group: 'assumptions' },
  { id: 'takeHomeShare', type: 'number', label: 'Share of pay left after taxes and paycheck deductions',
    min: 40, max: 100, step: 5, default: 75, unit: '%', group: 'assumptions',
    help: 'After taxes and paycheck deductions, including retirement contributions.' },
  { id: 'childcareUntilAge', type: 'number', label: 'Extra childcare cost lasts until the youngest turns',
    min: 5, max: 18, step: 1, default: 13, group: 'assumptions' },
  { id: 'supportYearsNoKids', type: 'number', label: 'If no children: years of living costs to cover',
    min: 0, max: 30, step: 1, default: 10, group: 'assumptions' },
  { id: 'retirementAge', type: 'number', label: 'Age each of you would stop saving for retirement',
    min: 55, max: 75, step: 1, default: 65, group: 'assumptions' },
  { id: 'countEmployerCoverage', type: 'select', label: 'Employer coverage',
    options: [{ value: 'leave', label: 'Leave it out' }, { value: 'count', label: 'Count it' }],
    default: 'leave', group: 'assumptions',
    help: 'Employer coverage usually ends when you leave the job, which is why it\'s left out by default.' },

  // ── Compare quotes ──
  { id: 'quoteSingle', type: 'number', label: 'Yearly premium quote: one-policy option',
    min: 0, max: 20000, step: 50, default: 0, unit: '$', group: 'quotes' },
  { id: 'quoteLadderShort', type: 'number', label: 'Yearly premium quote: ladder shorter policy',
    min: 0, max: 20000, step: 50, default: 0, unit: '$', group: 'quotes' },
  { id: 'quoteLadderLong', type: 'number', label: 'Yearly premium quote: ladder longer policy',
    min: 0, max: 20000, step: 50, default: 0, unit: '$', group: 'quotes' },
];

export const presets = {
  'Two earners, preschooler': {
    scenario: 'you',
    child1Age: '4', child2Age: '', child3Age: '', child4Age: '',
    householdSpending: 72000, spendingContinues: '80', supportUntilAge: 22, collegePerChild: 0,
    youAge: 35, youGrossPay: 95000, youRetirementSaving: 10000,
    youSsPerChild: 1200, youSsFamilyMax: 2200, youExtraCare: 15000,
    youTermCoverage: 0, youTermYearsLeft: 0, youEmployerCoverage: 0,
    spouseAge: 35, spouseGrossPay: 65000, spouseRetirementSaving: 6000,
    spouseSsPerChild: 800, spouseSsFamilyMax: 1500, spouseExtraCare: 15000,
    spouseTermCoverage: 0, spouseTermYearsLeft: 0, spouseEmployerCoverage: 0,
    mortgageBalance: 380000, mortgageRate: 6.5, mortgageYearsLeft: 29,
    otherDebts: 0, finalExpenses: 15000, savings: 60000, collegeSavings: 0,
    discountRate: 2, inflation: 2.5, takeHomeShare: 75, childcareUntilAge: 13,
    supportYearsNoKids: 10, retirementAge: 65, countEmployerCoverage: 'leave',
    quoteSingle: 0, quoteLadderShort: 0, quoteLadderLong: 0,
  },
  'One earner, two young kids': {
    scenario: 'you',
    child1Age: '3', child2Age: '6', child3Age: '', child4Age: '',
    householdSpending: 68000, spendingContinues: '80', supportUntilAge: 22, collegePerChild: 0,
    youAge: 38, youGrossPay: 110000, youRetirementSaving: 15000,
    youSsPerChild: 1400, youSsFamilyMax: 2500, youExtraCare: 5000,
    youTermCoverage: 0, youTermYearsLeft: 0, youEmployerCoverage: 0,
    spouseAge: 36, spouseGrossPay: 0, spouseRetirementSaving: 0,
    spouseSsPerChild: 0, spouseSsFamilyMax: 0, spouseExtraCare: 40000,
    spouseTermCoverage: 0, spouseTermYearsLeft: 0, spouseEmployerCoverage: 0,
    mortgageBalance: 320000, mortgageRate: 6, mortgageYearsLeft: 27,
    otherDebts: 0, finalExpenses: 15000, savings: 40000, collegeSavings: 0,
    discountRate: 2, inflation: 2.5, takeHomeShare: 75, childcareUntilAge: 13,
    supportYearsNoKids: 10, retirementAge: 65, countEmployerCoverage: 'leave',
    quoteSingle: 0, quoteLadderShort: 0, quoteLadderLong: 0,
  },
  'Teenagers, nearly paid off': {
    scenario: 'you',
    child1Age: '15', child2Age: '17', child3Age: '', child4Age: '',
    householdSpending: 65000, spendingContinues: '80', supportUntilAge: 22, collegePerChild: 0,
    youAge: 52, youGrossPay: 90000, youRetirementSaving: 12000,
    youSsPerChild: 1100, youSsFamilyMax: 2000, youExtraCare: 5000,
    youTermCoverage: 0, youTermYearsLeft: 0, youEmployerCoverage: 0,
    spouseAge: 50, spouseGrossPay: 80000, spouseRetirementSaving: 10000,
    spouseSsPerChild: 1100, spouseSsFamilyMax: 2000, spouseExtraCare: 5000,
    spouseTermCoverage: 0, spouseTermYearsLeft: 0, spouseEmployerCoverage: 0,
    mortgageBalance: 55000, mortgageRate: 5, mortgageYearsLeft: 4,
    otherDebts: 0, finalExpenses: 15000, savings: 280000, collegeSavings: 0,
    discountRate: 2, inflation: 2.5, takeHomeShare: 75, childcareUntilAge: 13,
    supportYearsNoKids: 10, retirementAge: 65, countEmployerCoverage: 'leave',
    quoteSingle: 0, quoteLadderShort: 0, quoteLadderLong: 0,
  },
};

const dollars = (n) => `$${Math.round(n).toLocaleString()}`;
const dollarsK = (n) => {
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return dollars(n);
};

export function compute(values) {
  const scenario = values.scenario || 'you';
  const resultYou = scenarioByYear(values, 'you');
  const resultSpouse = scenarioByYear(values, 'spouse');

  const primary = scenario === 'you' ? resultYou : resultSpouse;
  const secondary = scenario === 'you' ? resultSpouse : resultYou;

  const needArr = primary.map(r => r.need);
  const maxNeed = Math.max(0, ...needArr);
  const lastNeedYear = needArr.reduce((last, n, i) => n > 0 ? i : last, -1);

  const needArr2 = secondary.map(r => r.need);
  const maxNeed2 = Math.max(0, ...needArr2);

  const pol = fitPolicies(needArr, lastNeedYear);

  const decPrefix = scenario === 'you' ? 'you' : 'spouse';
  const decAge = Number(values[decPrefix + 'Age']) || 35;

  // ── Series ──
  const needsPoints = primary.map(r => ({ x: decAge + r.t, y: r.needs }));
  const havePoints = primary.map(r => ({ x: decAge + r.t, y: r.have }));

  const series = [
    { name: 'What your family would need', color: '#e06c75', curve: 'step', points: needsPoints },
    { name: 'What they\'d already have', color: '#61afef', curve: 'step', points: havePoints },
  ];

  // Series 2: with suggested coverage, if need exists.
  if (maxNeed > 0 && pol.singlePolicy) {
    const bestPol = pol.ladder || { short: null, long: pol.singlePolicy };
    const coveragePoints = primary.map(r => {
      let coverage = r.have;
      if (pol.ladder) {
        if (r.t < pol.ladder.short.term) coverage += pol.ladder.short.face;
        if (r.t < pol.ladder.long.term) coverage += pol.ladder.long.face;
      } else {
        if (r.t < pol.singlePolicy.term) coverage += pol.singlePolicy.face;
      }
      return { x: decAge + r.t, y: coverage };
    });
    series.push({ name: 'With suggested policies', color: '#98c379', curve: 'step', points: coveragePoints });
  }

  // ── Crossovers ──
  // The crossover is when "have" catches "needs", i.e. the family no longer needs coverage.
  // Only draw it if the need forms one continuous stretch starting at or before the crossover.
  let crossovers = [];
  let crossoverMarker = null;
  if (lastNeedYear >= 0) {
    // Check if need is continuous from 0 (or from the start).
    let firstNeedYear = needArr.findIndex(n => n > 0);
    let continuous = true;
    for (let t = firstNeedYear; t <= lastNeedYear; t++) {
      if (needArr[t] <= 0) { continuous = false; break; }
    }
    if (continuous && firstNeedYear === 0) {
      crossovers = [{ from: 0, to: 1, label: 'no longer needs insurance' }];
    } else {
      crossoverMarker = { x: decAge + lastNeedYear + 1, label: 'no longer needs insurance' };
    }
  }

  // ── Markers ──
  const markers = [];
  const childAges = [];
  for (let i = 1; i <= 4; i++) {
    const v = values['child' + i + 'Age'];
    if (v !== '' && v !== undefined && v !== null) childAges.push(Number(v));
  }
  if (childAges.length > 0) {
    const youngest = Math.min(...childAges);
    const turns18 = decAge + (18 - youngest);
    if (turns18 > decAge && turns18 <= decAge + 40) {
      markers.push({ x: turns18, label: 'youngest turns 18' });
    }
  }

  const mortYearsLeft = Number(values.mortgageYearsLeft) || 0;
  const mortBalance = Number(values.mortgageBalance) || 0;
  if (mortBalance > 0 && mortYearsLeft > 0) {
    const paidOff = decAge + mortYearsLeft;
    if (paidOff > decAge && paidOff <= decAge + 40) {
      markers.push({ x: paidOff, label: 'mortgage paid off' });
    }
  }
  if (crossoverMarker) markers.push(crossoverMarker);

  // ── Summary ──
  const roundedMax = Math.ceil(maxNeed / 25000) * 25000;
  const roundedMax2 = Math.ceil(maxNeed2 / 25000) * 25000;

  const youLabel = scenario === 'you' ? 'you' : 'your spouse';
  const spouseLabel = scenario === 'you' ? 'your spouse' : 'you';

  let headline;
  if (maxNeed <= 0) {
    headline = { label: `If ${youLabel} died`, value: 'No added coverage needed on these numbers', primary: true };
  } else {
    headline = { label: `If ${youLabel} died, the most your family would be short in any year`, value: dollars(roundedMax), primary: true };
  }

  const summary = [headline];

  // Secondary scenario.
  if (maxNeed2 <= 0) {
    summary.push({ label: `If ${spouseLabel} died`, value: 'No added coverage needed' });
  } else {
    summary.push({ label: `If ${spouseLabel} died, the most your family would be short`, value: dollars(roundedMax2) });
  }

  // Coverage duration.
  if (lastNeedYear >= 0) {
    const ageAtEnd = decAge + lastNeedYear + 1;
    summary.push({ label: 'Coverage no longer needed after', value: `age ${ageAtEnd} (in ${lastNeedYear + 1} years)` });
  } else {
    summary.push({ label: 'Coverage no longer needed after', value: 'Not needed within the next 40 years' });
  }

  // Suggested policies.
  if (pol.ladder) {
    summary.push({ label: 'Suggested',
      value: `${dollars(pol.ladder.long.face)} for ${pol.ladder.long.term} years + ${dollars(pol.ladder.short.face)} for ${pol.ladder.short.term} years` });
  } else if (pol.singlePolicy) {
    summary.push({ label: 'Suggested', value: `${dollars(pol.singlePolicy.face)} for ${pol.singlePolicy.term} years` });
  }
  if (pol.singlePolicy && pol.ladder) {
    summary.push({ label: 'One-policy option', value: `${dollars(pol.singlePolicy.face)} for ${pol.singlePolicy.term} years` });
  }

  return {
    summary,
    series,
    crossovers,
    markers,
    xAxis: { label: `${scenario === 'you' ? 'Your' : 'Your spouse\'s'} age at death`, format: (n) => String(Math.round(n)) },
    yAxis: { label: 'Today\'s dollars', format: (n) => dollarsK(n) },
    // Extra data for onResult.
    _extra: {
      scenario,
      primary,
      secondary,
      pol,
      maxNeed,
      maxNeed2,
      lastNeedYear,
      values,
      childAges,
      decAge,
    },
  };
}

// ── onResult: populate the extras panel ──

export function onResult(result) {
  const el = document.getElementById('li-extras');
  if (!el) return;
  el.innerHTML = '';

  const extra = result._extra;
  if (!extra) return;

  const { scenario, primary, pol, maxNeed, values, childAges, decAge, lastNeedYear } = extra;
  const decPrefix = scenario === 'you' ? 'you' : 'spouse';
  const survPrefix = scenario === 'you' ? 'spouse' : 'you';

  // ── Breakdown at t=0 ──
  if (primary.length > 0) {
    const r0 = primary[0];
    const section = document.createElement('div');
    section.className = 'li-section';

    const h = document.createElement('h3');
    h.textContent = 'Breakdown if it happened today';
    section.appendChild(h);

    const items = [];
    const finalExpenses = Number(values.finalExpenses) || 0;
    const otherDebts = Number(values.otherDebts) || 0;
    const mortBalance = Number(values.mortgageBalance) || 0;
    const savings = Number(values.savings) || 0;
    const collegeSavings = Number(values.collegeSavings) || 0;
    const termCoverage = Number(values[decPrefix + 'TermCoverage']) || 0;
    const termYearsLeft = Number(values[decPrefix + 'TermYearsLeft']) || 0;
    const employerCoverage = Number(values[decPrefix + 'EmployerCoverage']) || 0;
    const countEmployer = values.countEmployerCoverage === 'count';

    if (finalExpenses > 0) items.push(`Funeral and estate: ${dollars(finalExpenses)}`);
    if (otherDebts > 0) items.push(`Other debts: ${dollars(otherDebts)}`);
    if (mortBalance > 0) items.push(`Mortgage payoff: ${dollars(mortBalance)}`);
    items.push(`Present value of spending shortfalls: ${dollars(Math.max(0, r0.needs - finalExpenses - otherDebts - mortBalance))}`);

    items.push('');
    if (savings > 0) items.push(`Savings: ${dollars(savings)}`);
    if (collegeSavings > 0) items.push(`College savings: ${dollars(collegeSavings)}`);
    if (termCoverage > 0 && termYearsLeft > 0) items.push(`Existing term policy: ${dollars(termCoverage)}`);
    if (countEmployer && employerCoverage > 0) items.push(`Employer coverage (counted): ${dollars(employerCoverage)}`);

    items.push('');
    items.push(`Gap if it happened today: ${dollars(r0.need)}`);
    if (maxNeed > r0.need) items.push(`Peak gap (in a later year): ${dollars(maxNeed)}`);

    items.forEach(text => {
      if (text === '') {
        section.appendChild(document.createElement('hr'));
      } else {
        const p = document.createElement('p');
        p.textContent = text;
        section.appendChild(p);
      }
    });
    el.appendChild(section);
  }

  // ── Social Security note ──
  if (childAges.length > 0) {
    const ssPerChild = Number(values[decPrefix + 'SsPerChild']) || 0;
    const ssFamilyMax = Number(values[decPrefix + 'SsFamilyMax']) || 0;
    const survivorPay = Number(values[survPrefix + 'GrossPay']) || 0;

    if (ssPerChild > 0) {
      const section = document.createElement('div');
      section.className = 'li-section';
      const h = document.createElement('h3');
      h.textContent = 'Social Security survivor benefits';
      section.appendChild(h);

      const youngest = Math.min(...childAges);
      const ssYears = Math.max(0, 18 - youngest);
      const caregiverEnd = Math.max(0, 16 - youngest);

      const notes = [];
      notes.push(`Children's benefits would be paid for about ${ssYears} years (until the youngest turns 18).`);
      if (caregiverEnd > 0) {
        notes.push(`The caregiver benefit would end when the youngest turns 16 (in about ${caregiverEnd} years).`);
      }

      const ss0 = survivorSocialSecurity(ssPerChild, ssFamilyMax, survivorPay, childAges);
      if (ss0.earningsTestApplied) {
        notes.push(`The earnings test reduces the caregiver's benefit because the survivor earns more than $24,480 a year. The Social Security Administration (SSA) withholds whole months; this tool uses a yearly approximation.`);
      }

      // Gap-years note.
      if (youngest < 16) {
        const survAge = Number(values[survPrefix + 'Age']) || 35;
        const caregiverEndsAge = survAge + (16 - youngest);
        if (caregiverEndsAge < 60) {
          notes.push(`From when your youngest turns 16 until ${scenario === 'you' ? 'your spouse' : 'you'} turns 60, Social Security pays no survivor benefit to the parent. That is a ${60 - caregiverEndsAge}-year gap.`);
        }
      }

      notes.forEach(text => {
        const p = document.createElement('p');
        p.textContent = text;
        section.appendChild(p);
      });
      el.appendChild(section);
    }
  }

  // ── Employer coverage note ──
  const employerCoverage = Number(values[decPrefix + 'EmployerCoverage']) || 0;
  if (employerCoverage > 0 && values.countEmployerCoverage !== 'count') {
    const section = document.createElement('div');
    section.className = 'li-section';
    // Compute what the need would be with employer counted.
    const altValues = { ...values, countEmployerCoverage: 'count' };
    const altResult = scenarioByYear(altValues, scenario);
    const altMax = Math.max(0, ...altResult.map(r => r.need));
    const p = document.createElement('p');
    p.textContent = `Counting the ${dollars(employerCoverage)} of employer coverage would lower the peak need to ${dollars(altMax)}, but employer coverage usually ends when you leave the job.`;
    section.appendChild(p);
    el.appendChild(section);
  }

  // ── Small-need message ──
  if (pol.smallNeed && maxNeed > 0) {
    const section = document.createElement('div');
    section.className = 'li-section';
    const p = document.createElement('p');
    p.textContent = `Your family would be short at most ${dollars(maxNeed)} — less than the smallest policy most insurers sell ($100,000). Savings or employer coverage may cover it.`;
    section.appendChild(p);
    el.appendChild(section);
  }

  // ── Quote comparison ──
  const quoteSingle = Number(values.quoteSingle) || 0;
  const quoteLadderShort = Number(values.quoteLadderShort) || 0;
  const quoteLadderLong = Number(values.quoteLadderLong) || 0;
  if (quoteSingle > 0 || quoteLadderShort > 0 || quoteLadderLong > 0) {
    const section = document.createElement('div');
    section.className = 'li-section';
    const h = document.createElement('h3');
    h.textContent = 'Quote comparison';
    section.appendChild(h);

    if (pol.singlePolicy && quoteSingle > 0) {
      const totalSingle = quoteSingle * pol.singlePolicy.term;
      const p = document.createElement('p');
      p.textContent = `One policy: ${dollars(quoteSingle)}/year for ${pol.singlePolicy.term} years = ${dollars(totalSingle)} total you'd pay over the term.`;
      section.appendChild(p);
    }
    if (pol.ladder && (quoteLadderShort > 0 || quoteLadderLong > 0)) {
      const totalShort = quoteLadderShort * pol.ladder.short.term;
      const totalLong = quoteLadderLong * pol.ladder.long.term;
      const totalLadder = totalShort + totalLong;
      const p = document.createElement('p');
      p.textContent = `Ladder: ${dollars(quoteLadderShort)}/year for ${pol.ladder.short.term} years + ${dollars(quoteLadderLong)}/year for ${pol.ladder.long.term} years = ${dollars(totalLadder)} total.`;
      section.appendChild(p);
      if (quoteSingle > 0 && pol.singlePolicy) {
        const diff = (quoteSingle * pol.singlePolicy.term) - totalLadder;
        const p2 = document.createElement('p');
        p2.textContent = diff > 0
          ? `The ladder saves ${dollars(diff)} in total premiums.`
          : `The ladder costs ${dollars(-diff)} more in total premiums.`;
        section.appendChild(p2);
      }
    }
    el.appendChild(section);
  }

  // ── Ladder context ──
  if (pol.ladder) {
    const section = document.createElement('div');
    section.className = 'li-section';
    const p = document.createElement('p');
    p.textContent = `The ladder uses ${Math.round(pol.ladder.savingsPct * 100)}% less coverage than a single policy because your family's need drops over time as the mortgage shrinks and the children age out. Each extra policy carries its own application and fee, so the ladder only appears here when the coverage savings are meaningful (at least 15%).`;
    section.appendChild(p);
    el.appendChild(section);
  }

  // ── Rule-of-thumb comparison ──
  if (maxNeed > 0) {
    const decPay = Number(values[decPrefix + 'GrossPay']) || 0;
    if (decPay > 0) {
      const ruleOfThumb = decPay * 10;
      const section = document.createElement('div');
      section.className = 'li-section';
      const h = document.createElement('h3');
      h.textContent = 'How this compares to the rule of thumb';
      section.appendChild(h);

      const survPay = Number(values[survPrefix + 'GrossPay']) || 0;
      const ssPerChild = Number(values[decPrefix + 'SsPerChild']) || 0;
      const ssFamilyMax = Number(values[decPrefix + 'SsFamilyMax']) || 0;
      const ss0 = survivorSocialSecurity(ssPerChild, ssFamilyMax, survPay, childAges);

      const p = document.createElement('p');
      let text = `A common rule of thumb says ${dollars(ruleOfThumb)} (10 times pay). This comes out at ${dollars(maxNeed)} instead`;
      if (ss0.total > 0 || survPay > 0) {
        text += ` because`;
        const parts = [];
        if (ss0.total > 0) parts.push(`Social Security would pay your family about ${dollars(ss0.total)} a year`);
        if (survPay > 0) parts.push(`${scenario === 'you' ? 'your spouse\'s' : 'your'} pay covers about ${dollars(survPay * ((Number(values.takeHomeShare) || 75) / 100))} a year after taxes`);
        text += ' ' + parts.join(' and ');
      }
      text += '.';
      p.textContent = text;
      section.appendChild(p);
      el.appendChild(section);
    }
  }

  // ── Savings-held-constant disclosure ──
  {
    const section = document.createElement('div');
    section.className = 'li-section';
    const p = document.createElement('p');
    p.className = 'li-disclosure';
    p.textContent = 'Savings are held at today\'s level for every death year. This is conservative, since real savings would likely grow.';
    section.appendChild(p);
    el.appendChild(section);
  }
}
