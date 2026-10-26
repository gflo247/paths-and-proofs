#!/usr/bin/env node
// test-life-breakdown.mjs — the life insurance page's extras panel, rendered in jsdom:
// the "if it happened today" breakdown adds up, the rule-of-thumb sentence points the
// right way, and the copy that depends on who died reads correctly for either person.

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div id="li-extras"></div></body>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const li = await import('../life-insurance/life-insurance.js');

let pass = 0, fail = 0;
function check(label, ok, detail = '') {
  if (ok) { pass++; console.log(`ok    ${label}`); }
  else { fail++; console.log(`FAIL  ${label}${detail ? `  (${detail})` : ''}`); }
}

const defaults = Object.fromEntries(li.inputs.map(c => [c.id, c.default]));
function render(over) {
  const v = { ...defaults, ...over };
  const r = li.compute(v);
  li.onResult(r);
  return { v, r, el: document.getElementById('li-extras') };
}
const paragraphs = (el) => [...el.querySelectorAll('p')].map(p => p.textContent);
const section = (el, title) => [...el.querySelectorAll('.li-section')].find(s => s.querySelector('h3')?.textContent === title);

// The breakdown as groups of { label, amount, total } split at each <hr>.
function breakdown(el) {
  const sec = section(el, 'Breakdown if it happened today');
  if (!sec) return null;
  const groups = [[]];
  for (const n of sec.children) {
    if (n.tagName === 'HR') groups.push([]);
    else if (n.tagName === 'P') {
      const m = n.textContent.match(/^(.*): \$([\d,]+)$/);
      groups[groups.length - 1].push(m
        ? { label: m[1], amount: Number(m[2].replace(/,/g, '')), total: !!n.querySelector('strong') }
        : { label: n.textContent, amount: NaN, total: false });
    }
  }
  return groups;
}
const sum = (lines) => lines.reduce((s, l) => s + l.amount, 0);

// A family with no Social Security, saving, coverage or discounting, so every amount
// below is a plain sum worked by hand.
const plain = {
  child1Age: '', child2Age: '', child3Age: '', child4Age: '',
  youSsPerChild: 0, youSsFamilyMax: 0, spouseSsPerChild: 0, spouseSsFamilyMax: 0,
  youRetirementSaving: 0, spouseRetirementSaving: 0, youExtraCare: 0, spouseExtraCare: 0,
  youTermCoverage: 0, youTermYearsLeft: 0, youEmployerCoverage: 0,
  spouseTermCoverage: 0, spouseTermYearsLeft: 0, spouseEmployerCoverage: 0,
  mortgageBalance: 0, mortgageRate: 0, mortgageYearsLeft: 0,
  otherDebts: 0, finalExpenses: 0, savings: 0, collegeSavings: 0, collegePerChild: 0,
  discountRate: 0, inflation: 0, spendingContinues: '100',
};

// ── Hand-worked breakdowns ──
{
  // Child 10, support to 22: 12 years. You die. Extra care 20,000 while the child is under
  // 13 (years 0-2). Out: 40,000 (+20,000 in years 0-2). In: your spouse's 60,000 x 75% =
  // 45,000. Years 0-2 short 15,000 each = 45,000; years 3-11 over by 5,000 each = 45,000.
  // Need: mortgage 100,000 + 45,000 = 145,000. Have: savings 20,000 + 45,000 = 65,000.
  // Gap 80,000.
  const { el } = render({
    ...plain, scenario: 'you', child1Age: '10', householdSpending: 40000, youExtraCare: 20000,
    spouseGrossPay: 60000, takeHomeShare: 75,
    mortgageBalance: 100000, mortgageRate: 0, mortgageYearsLeft: 10, savings: 20000,
  });
  const g = breakdown(el);
  const want = [
    [
      { label: 'Mortgage payoff', amount: 100000, total: false },
      { label: 'Costs not covered by your spouse\'s take-home pay and any Social Security, until your youngest turns 22 (present value)', amount: 45000, total: false },
      { label: 'What your family would need', amount: 145000, total: true },
    ],
    [
      { label: 'Savings', amount: 20000, total: false },
      { label: 'Your spouse\'s take-home pay and any Social Security left over after costs, until your youngest turns 22 (present value)', amount: 45000, total: false },
      { label: 'What they\'d already have', amount: 65000, total: true },
    ],
    [{ label: 'Gap if it happened today', amount: 80000, total: true }],
  ];
  check('hand: shortfall and surplus years itemized, lines add up to the gap',
    JSON.stringify(g) === JSON.stringify(want), JSON.stringify(g));
}
{
  // No children, both 50, 5 years of support. Out: 30,000 + your saving 8,000; in: your
  // spouse's 40,000 x 75% = 30,000: short 8,000 a year = 40,000. Your 8,000 a year then
  // stops for ages 55-64: 80,000. Funeral 10,000, debts 5,000. Need 135,000; have 25,000
  // savings; gap 110,000.
  const { el } = render({
    ...plain, scenario: 'you', youAge: 50, spouseAge: 50, householdSpending: 30000,
    supportYearsNoKids: 5, youRetirementSaving: 8000, spouseGrossPay: 40000, takeHomeShare: 75,
    finalExpenses: 10000, otherDebts: 5000, savings: 25000,
  });
  const g = breakdown(el);
  const want = [
    [
      { label: 'Funeral and estate', amount: 10000, total: false },
      { label: 'Other debts', amount: 5000, total: false },
      { label: 'Costs not covered by your spouse\'s take-home pay, for the next 5 years (present value)', amount: 40000, total: false },
      { label: 'Lost retirement saving after the first 5 years, until you would have turned 65 (present value)', amount: 80000, total: false },
      { label: 'What your family would need', amount: 135000, total: true },
    ],
    [
      { label: 'Savings', amount: 25000, total: false },
      { label: 'What they\'d already have', amount: 25000, total: true },
    ],
    [{ label: 'Gap if it happened today', amount: 110000, total: true }],
  ];
  check('hand: no children, lost saving after the window', JSON.stringify(g) === JSON.stringify(want), JSON.stringify(g));
}
{
  // College only, your spouse dies: child 18, 40,000 per child = 10,000 a year for ages
  // 18-21 = 40,000; 50,000 saved, counted up to the 40,000 cost. Gap 0.
  const { el } = render({
    ...plain, scenario: 'spouse', child1Age: '18', householdSpending: 0,
    youGrossPay: 0, spouseGrossPay: 0, collegePerChild: 40000, collegeSavings: 50000,
  });
  const g = breakdown(el);
  const want = [
    [
      { label: 'College costs (present value)', amount: 40000, total: false },
      { label: 'What your family would need', amount: 40000, total: true },
    ],
    [
      { label: 'College savings, counted up to the college cost ($50,000 saved)', amount: 40000, total: false },
      { label: 'What they\'d already have', amount: 40000, total: true },
    ],
    [{ label: 'Gap if it happened today', amount: 0, total: true }],
  ];
  check('hand: college savings counted up to the cost', JSON.stringify(g) === JSON.stringify(want), JSON.stringify(g));
}

{
  // Rounding has to move a dollar here: shortfall 28,738.45 + funeral 15,000 - surplus
  // 971.55 = gap 42,766.90, shown as $42,767, but the rounded lines give $42,766. The dollar
  // goes to the shortfall line, not to the college cost, which must still match the college
  // savings that cover it ($444,468 each).
  const { el } = render({ scenario: 'you', child1Age: '14', supportUntilAge: 16, childcareUntilAge: 15,
    youExtraCare: 30000, youSsPerChild: 0, youSsFamilyMax: 0, youRetirementSaving: 0,
    collegePerChild: 500000, collegeSavings: 1000000, householdSpending: 40000, spouseGrossPay: 44000,
    mortgageBalance: 0, mortgageYearsLeft: 0, savings: 0 });
  const [need, have, end] = breakdown(el);
  const amt = (lines, start) => lines.find(l => l.label.startsWith(start))?.amount;
  check('rounding: college cost and the savings covering it still match',
    amt(need, 'College costs') === 444468 && amt(have, 'College savings') === 444468, JSON.stringify([need, have]));
  check('rounding: the dollar moves to the shortfall line', amt(need, 'Costs not covered') === 28739 && end[0].amount === 42767
    && need.find(l => l.total).amount - have.find(l => l.total).amount === 42767, JSON.stringify([need, have, end]));
}

// ── Property grid: the breakdown adds up, and the rest of the copy holds ──
const grammar = [
  [/\b1 years\b/, '"1 years"'],
  [/\b(?:next|first) 1 year\b/, '"the next 1 year"'],
  [/\b1 (?:children|policies)\b/, 'plural after 1'],
  [/\byou (?:turns|leaves|earns|has|is|was|dies|makes)\b/i, '"you" with a third-person verb'],
  [/\byour spouse (?:turn|leave|earn|have|make)\b/, '"your spouse" with a plural verb'],
  [/\ba \d/, '"a" before a number'],
  [/NaN|undefined|Infinity|\$-|\$NaN/, 'bad number'],
  [/ {2}| ,|\.\.|,,/, 'spacing or punctuation'],
];
let cases = 0, failsAdd = 0, failsGap = 0, failsTyped = 0, failsTrue = 0, failsTiny = 0, failsPaired = 0, failsRule = 0;
let ladders = 0, failsLadder = 0;
const grammarHits = new Map();
const sample = {};
function grid() {
  const out = [];
  const kidSets = [[], ['4'], ['15', '17'], ['0', '3', '9'], ['17'], ['19'], ['21']];
  for (const scenario of ['you', 'spouse'])
  for (const kids of kidSets)
  for (const pays of [[95000, 65000], [110000, 0], [0, 80000], [60000, 60000]])
  for (const ss of [[0, 0], [1200, 2200]])
  for (const mort of [[0, 0], [380000, 29], [50000, 1], [200000, 0]])
  for (const college of [[0, 0], [80000, 30000], [40000, 500000]])
  for (const extras of ['none', 'term', 'employer-count', 'employer-leave'])
  for (const money of [[60000, 0], [3000000, 5000]]) {
    out.push({
      scenario,
      child1Age: kids[0] ?? '', child2Age: kids[1] ?? '', child3Age: kids[2] ?? '', child4Age: '',
      youGrossPay: pays[0], spouseGrossPay: pays[1],
      youSsPerChild: ss[0], youSsFamilyMax: ss[1], spouseSsPerChild: ss[0], spouseSsFamilyMax: ss[1],
      mortgageBalance: mort[0], mortgageYearsLeft: mort[1],
      collegePerChild: college[0], collegeSavings: college[1],
      youTermCoverage: extras === 'term' ? 250000 : 0, youTermYearsLeft: extras === 'term' ? 12 : 0,
      spouseTermCoverage: extras === 'term' ? 100000 : 0, spouseTermYearsLeft: extras === 'term' ? 5 : 0,
      youEmployerCoverage: extras.startsWith('employer') ? 190000 : 0,
      spouseEmployerCoverage: extras.startsWith('employer') ? 130000 : 0,
      countEmployerCoverage: extras === 'employer-count' ? 'count' : 'leave',
      savings: money[0], finalExpenses: money[1] ? 15000 : 15000, otherDebts: money[1],
      youAge: kids.length ? 35 : 61, spouseAge: kids.length ? 35 : 47,
    });
  }
  return out;
}
// Every combination with LIFE_GRID=all; otherwise a fixed, evenly spread sample, to keep
// npm run verify quick.
const all = grid();
let picked = all;
if (process.env.LIFE_GRID !== 'all') {
  let seed = 13;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  picked = all.map(c => [rnd(), c]).sort((a, b) => a[0] - b[0]).slice(0, 2500).map(([, c]) => c);
}
console.log(`grid: ${picked.length} of ${all.length} combinations, plus the presets`);
for (const over of [...picked, ...Object.values(li.presets).flatMap(p => [{ ...p, scenario: 'you' }, { ...p, scenario: 'spouse' }])]) {
  const { v, r, el } = render(over);
  cases++;
  const rows = r._extra.primary;
  const r0 = rows[0];
  const g = breakdown(el);
  const [need, have, end] = g;
  const needLines = need.filter(l => !l.total), haveLines = have.filter(l => !l.total);
  const needTotal = need.find(l => l.total)?.amount, haveTotal = have.find(l => l.total)?.amount;
  const gapLine = end.find(l => l.label === 'Gap if it happened today');

  // Each total is the sum of its lines; need minus have is the gap, the rounded engine gap.
  if (!(g.length === 3 && needTotal === sum(needLines) && haveTotal === sum(haveLines))) failsAdd++;
  const gapOk = r0.need > 0
    ? gapLine?.amount === Math.round(r0.need) && needTotal - haveTotal === gapLine.amount
    : gapLine?.amount === 0 && needTotal <= haveTotal;
  if (!gapOk) failsGap++;
  // Totals stay within a few dollars of the engine's, and every shown line is at least $1.
  if (!(Math.abs(needTotal - r0.needs) <= 3 && Math.abs(haveTotal - r0.have) <= 3)) failsTrue++;
  if ([...needLines, ...haveLines].some(l => !(l.amount >= 1))) failsTiny++;
  // Amounts typed in show exactly as entered.
  const amt = (lines, label) => lines.find(l => l.label === label)?.amount;
  const dec = v.scenario;
  const typed = [
    [needLines, 'Funeral and estate', Number(v.finalExpenses)],
    [needLines, 'Other debts', Number(v.otherDebts)],
    [needLines, 'Mortgage payoff', Number(v.mortgageYearsLeft) > 0 ? Number(v.mortgageBalance) : 0],
    [haveLines, 'Savings', Number(v.savings)],
    [haveLines, 'Existing term policy', Number(v[dec + 'TermYearsLeft']) > 0 ? Number(v[dec + 'TermCoverage']) : 0],
    [haveLines, 'Employer coverage (counted)', v.countEmployerCoverage === 'count' ? Number(v[dec + 'EmployerCoverage']) : 0],
  ];
  if (typed.some(([lines, label, x]) => (amt(lines, label) ?? 0) !== x)) failsTyped++;
  // College savings that cover the cost show the same amount as the cost.
  const col = needLines.find(l => l.label.startsWith('College costs'));
  const colSaved = haveLines.find(l => l.label.startsWith('College savings'));
  if (col && colSaved && Number(v.collegeSavings) >= r0.parts.college && col.amount !== colSaved.amount) failsPaired++;

  // Rule of thumb: "lower" or "higher" matches the comparison, and a higher result is not
  // explained by what lowers the need.
  const rule = section(el, 'How this compares to the rule of thumb');
  if (rule) {
    const t = rule.querySelector('p').textContent;
    const maxNeed = Math.max(0, ...rows.map(x => x.need));
    const ten = 10 * Number(v[dec + 'GrossPay']);
    const lower = Math.round(maxNeed) < ten, higher = Math.round(maxNeed) > ten;
    const ok = (lower ? /comes out lower, at /.test(t) : !/comes out lower/.test(t))
      && (higher ? /comes out higher, at /.test(t) && !/because Social Security|pay covers/.test(t) : !/comes out higher/.test(t));
    if (!ok) { failsRule++; sample.rule ??= t; }
  }

  // The ladder note gives only the reasons that apply: a mortgage that counts, and children.
  const ladder = paragraphs(el).find(p => p.startsWith('The ladder uses'));
  if (ladder) {
    ladders++;
    const kids = [v.child1Age, v.child2Age, v.child3Age, v.child4Age].some(a => a !== '' && a !== undefined && a !== null);
    const mortgage = Number(v.mortgageBalance) > 0 && Number(v.mortgageYearsLeft) > 0;
    if (/children age out/.test(ladder) !== kids || /mortgage shrinks/.test(ladder) !== mortgage) { failsLadder++; sample.ladder ??= ladder; }
  }

  // Grammar across everything the panel and the summary show.
  const text = [...paragraphs(el), ...r.summary.map(s => `${s.label}: ${s.value}`)].join('\n');
  for (const [re, what] of grammar) {
    const m = text.match(re);
    if (m && !grammarHits.has(what)) grammarHits.set(what, text.split('\n').find(line => re.test(line)));
  }
}
check(`grid: each total is the sum of its lines (${cases} cases)`, failsAdd === 0, `${failsAdd} cases`);
check('grid: need minus have is the gap, and the gap is the engine\'s, rounded', failsGap === 0, `${failsGap} cases`);
check('grid: totals within $3 of the engine\'s', failsTrue === 0, `${failsTrue} cases`);
check('grid: every line shown is at least $1', failsTiny === 0, `${failsTiny} cases`);
check('grid: amounts typed in show as entered', failsTyped === 0, `${failsTyped} cases`);
check('grid: college savings that cover the cost match it', failsPaired === 0, `${failsPaired} cases`);
check('grid: rule of thumb says lower or higher correctly', failsRule === 0, `${failsRule} cases; e.g. ${sample.rule}`);
check(`grid: ladder note gives only reasons that apply (${ladders} ladders)`, ladders > 0 && failsLadder === 0, `${failsLadder} cases; e.g. ${sample.ladder}`);
for (const [, what] of grammar) {
  check(`grid: no ${what}`, !grammarHits.has(what), grammarHits.get(what));
}

// ── Rule of thumb, worked by hand ──
{
  // Defaults, you die: 10 x 95,000 = 950,000. Social Security in year 0: one child (4) and
  // the caregiver at 1,200 a month = 14,400 each, 28,800 > the 26,400 family maximum, so
  // 13,200 each. Your spouse earns 65,000: (65,000 - 24,480) / 2 = 20,260 withheld, more
  // than 13,200, so the caregiver share is fully withheld and the child gets the full
  // 14,400. Your spouse's take-home: 65,000 x 75% = 48,750.
  const { el } = render({ scenario: 'you' });
  const t = section(el, 'How this compares to the rule of thumb').querySelector('p').textContent;
  const gap = breakdown(el)[2][0].amount;
  check('rule of thumb (lower): sentence', t === `A common rule of thumb says $950,000 (10 times pay). This comes out lower, at $${gap.toLocaleString()}, because Social Security would pay your family about $14,400 a year and your spouse's pay covers about $48,750 a year after taxes.`, t);
}
{
  // "One earner, two young kids", you die: 10 x 110,000 = 1,100,000, below the need, which
  // peaks today with the mortgage payoff, years of living costs, and lost saving.
  const { el } = render({ ...li.presets['One earner, two young kids'], scenario: 'you' });
  const t = section(el, 'How this compares to the rule of thumb').querySelector('p').textContent;
  const gap = breakdown(el)[2][0].amount;
  check('rule of thumb (higher): sentence', gap > 1100000 && t === `A common rule of thumb says $1,100,000 (10 times pay). This comes out higher, at $${gap.toLocaleString()}, because it adds up what your family would actually need, including the mortgage payoff, living costs until your youngest turns 22, and lost retirement saving, instead of using a multiple of pay.`, t);
}

// ── Copy that depends on who died ──
{
  // Your spouse dies: you're 35, the youngest is 4, so the caregiver benefit ends when
  // you're 35 + 12 = 47: 13 years to 60.
  const { el } = render({ scenario: 'spouse' });
  const ps = paragraphs(el);
  check('gap note: "until you turn 60"', ps.some(p => p === 'From when your youngest turns 16 until you turn 60, Social Security pays no survivor benefit to the parent. That gap lasts 13 years.'), ps.find(p => p.startsWith('From when')));
}
{
  // You die: your spouse is 40, the youngest 4: caregiver benefit ends at 52, 8 years to 60.
  const { el } = render({ scenario: 'you', spouseAge: 40 });
  check('gap note: 8 years', paragraphs(el).includes('From when your youngest turns 16 until your spouse turns 60, Social Security pays no survivor benefit to the parent. That gap lasts 8 years.'),
    paragraphs(el).find(p => p.startsWith('From when')));
  // Spouse 47: ends at 59, 1 year to 60.
  const { el: el2 } = render({ scenario: 'you', spouseAge: 47 });
  check('gap note: 1 year', paragraphs(el2).some(p => p.endsWith('That gap lasts 1 year.')), paragraphs(el2).find(p => p.startsWith('From when')));
}
{
  // Teenagers preset: youngest 15, so the caregiver benefit ends in 1 year and children's
  // benefits in 3.
  const { el } = render({ ...li.presets['Teenagers, nearly paid off'], scenario: 'you' });
  const ps = paragraphs(el);
  check('Social Security note: "in about 1 year"', ps.includes('The caregiver benefit would end when the youngest turns 16 (in about 1 year).'), ps.find(p => p.startsWith('The caregiver')));
  check('Social Security note: "about 3 years"', ps.includes('Children\'s benefits would be paid for about 3 years (until the youngest turns 18).'));
  // Youngest 17: one year of children's benefits.
  const { el: el17 } = render({ scenario: 'you', child1Age: '17' });
  check('Social Security note: "about 1 year"', paragraphs(el17).includes('Children\'s benefits would be paid for about 1 year (until the youngest turns 18).'),
    paragraphs(el17).find(p => p.startsWith('Children')));
  // Youngest 19: no child is under 18, so no survivor benefit and no Social Security note.
  const { el: el19 } = render({ scenario: 'you', child1Age: '19' });
  check('Social Security note: none once the youngest is 18 or older', !section(el19, 'Social Security survivor benefits'),
    paragraphs(el19).find(p => p.startsWith('Children')));
}
{
  // Employer coverage left out: the note names the right person, and is dropped when there's no need.
  const { el } = render({ scenario: 'spouse', spouseEmployerCoverage: 130000 });
  check('employer note: "when your spouse leaves the job"', paragraphs(el).some(p => p.startsWith('Counting the $130,000 of employer coverage') && p.endsWith('usually ends when your spouse leaves the job.')),
    paragraphs(el).find(p => p.startsWith('Counting')));
  const { el: el2 } = render({ scenario: 'you', youEmployerCoverage: 190000 });
  check('employer note: "when you leave the job"', paragraphs(el2).some(p => p.endsWith('usually ends when you leave the job.')));
  const { el: el3 } = render({ scenario: 'you', youEmployerCoverage: 190000, savings: 3000000 });
  check('employer note: none when there is no need to lower', !paragraphs(el3).some(p => p.startsWith('Counting')),
    paragraphs(el3).find(p => p.startsWith('Counting')));
}
{
  // Coverage ends after year 0: a mortgage with 1 year left is the only thing short.
  // Need today: 50,000 - 40,000 savings = 10,000; from year 1 the mortgage is gone.
  const { r } = render({ ...plain, scenario: 'you', householdSpending: 0, youGrossPay: 0, spouseGrossPay: 0,
    mortgageBalance: 50000, mortgageRate: 0, mortgageYearsLeft: 1, savings: 40000 });
  const s = r.summary.find(x => x.label === 'Coverage no longer needed after');
  check('summary: "in 1 year"', s?.value === 'age 36 (in 1 year)', s?.value);
}
{
  // No children and 0 years of living costs to cover: nothing but the funeral, 10,000.
  // (0 used to be read as the 10-year default: 10 x 50,000 more.)
  const { el } = render({ ...plain, scenario: 'you', householdSpending: 50000, supportYearsNoKids: 0,
    spouseGrossPay: 0, finalExpenses: 10000 });
  const g = breakdown(el);
  check('no children, 0 years of support: only the funeral', JSON.stringify(g) === JSON.stringify([
    [{ label: 'Funeral and estate', amount: 10000, total: false }, { label: 'What your family would need', amount: 10000, total: true }],
    [{ label: 'What they\'d already have', amount: 0, total: true }],
    [{ label: 'Gap if it happened today', amount: 10000, total: true }],
  ]), JSON.stringify(g));
}
{
  // One year of support: "for the next year", "after the first year".
  const { el } = render({ scenario: 'you', child1Age: '', supportYearsNoKids: 1 });
  const labels = breakdown(el)[0].map(l => l.label);
  check('one year of support reads "the next year"', labels.includes('Costs not covered by your spouse\'s take-home pay, for the next year (present value)')
    && labels.includes('Lost retirement saving after the first year, until you would have turned 65 (present value)'), JSON.stringify(labels));
}
{
  // Input labels for your spouse refer to your spouse's statement and employer.
  const label = (id) => li.inputs.find(c => c.id === id).label;
  check('label: spouse survivor benefit from your spouse\'s statement', label('spouseSsPerChild') === 'Your spouse: monthly survivor benefit per child, from your spouse\'s Social Security statement');
  check('label: spouse family maximum from your spouse\'s statement', label('spouseSsFamilyMax') === 'Your spouse: monthly total family maximum, from your spouse\'s Social Security statement');
  check('label: spouse term coverage', label('spouseTermCoverage') === 'Your spouse: individual term life coverage your spouse already has');
  check('label: spouse employer coverage', label('spouseEmployerCoverage') === 'Your spouse: life insurance through your spouse\'s employer');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
