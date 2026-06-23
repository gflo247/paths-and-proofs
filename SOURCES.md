# Sources & verification checklist

Every regulatory constant used by the calculators, its value, and the
authoritative source that defines it. The point of this file is to make annual
re-verification a checklist rather than a re-discovery: each year, walk the
list, confirm each value against its source, and update the "last verified"
date.

**Last full verification:** June 2026, against tax year 2026 figures.

A note on what "verified" means here: items marked ✅ were checked against the
cited primary source (IRS, CMS, SSA, or CFR). Items marked ⚠️ are plausible but
were *not* exhaustively verified against each underlying source — they are the
softer spots to prioritize on the next pass.

---

## Social Security (`social-security/social-security.js`)

These are formula constants fixed in the Code of Federal Regulations, not
annually inflation-adjusted figures, so they change rarely (only by statute).

| Constant | Value | Source | Status |
|---|---|---|---|
| Full retirement age (born 1960+) | 67 | [SSA 1960-delay](https://www.ssa.gov/benefits/retirement/planner/1960-delay.html) | ✅ |
| Worker early reduction, first 36 mo | 5/9 of 1%/mo | [CFR 404.410](https://www.ssa.gov/OP_Home/cfr20/404/404-0410.htm) | ✅ |
| Worker early reduction, beyond 36 mo | 5/12 of 1%/mo | [CFR 404.410](https://www.ssa.gov/OP_Home/cfr20/404/404-0410.htm) | ✅ |
| Spousal early reduction, first 36 mo | 25/36 of 1%/mo | [CFR 404.410(b)](https://www.ssa.gov/OP_Home/cfr20/404/404-0410.htm) | ✅ |
| Spousal early reduction, beyond 36 mo | 5/12 of 1%/mo | [CFR 404.410(b)](https://www.ssa.gov/OP_Home/cfr20/404/404-0410.htm) | ✅ |
| Delayed retirement credit | 2/3 of 1%/mo (8%/yr), stops at 70 | [CFR 404.313](https://www.ssa.gov/OP_Home/cfr20/404/404-0313.htm) | ✅ |
| Spousal benefit cap | 50% of partner's FRA amount, no delayed credits | [SSA spousal](https://www.ssa.gov/benefits/retirement/planner/applying7.html) | ✅ |
| Survivor rule | survivor keeps the larger of the two benefits | [CFR 404.410](https://www.ssa.gov/OP_Home/cfr20/404/404-0410.htm) | ✅ |

**Scope note (honest limitation):** assumes FRA 67 (born 1960+); does not model
the earnings test, benefit taxation, or divorced-spouse benefits. The main chart
shows only the "higher earner dies first" case; the reverse appears in the
heatmap. All of this is stated in the on-page disclaimer.

---

## Roth conversion (`roth-conversion/index.html`) — tax year 2026

### Federal income tax — ✅ verified against IRS Rev. Proc. 2025-32

Bracket thresholds (top of each band; 37% applies above the 35% top):

| Filing | 10% | 12% | 22% | 24% | 32% | 35% |
|---|---|---|---|---|---|---|
| Single | 12,400 | 50,400 | 105,700 | 201,775 | 256,225 | 640,600 |
| MFJ | 24,800 | 100,800 | 211,400 | 403,550 | 512,450 | 768,700 |
| MFS | 12,400 | 50,400 | 105,700 | 201,775 | 256,225 | 384,350 |
| HOH | 17,700 | 67,450 | 105,700 | 201,775 | 256,225 | 640,600 |

Standard deduction: 16,100 single / 32,200 MFJ / 24,150 HOH / 16,100 MFS — ✅
Senior deduction (OBBBA, 2025–2028): $6,000/person, 6% phaseout above
$75k single / $150k MFJ — ✅
Source: [IRS Rev. Proc. 2025-32](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf) /
[IRS 2026 inflation adjustments](https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill)

> Fixed June 2026: four 32%/35% boundary thresholds were off by $25–$100 and
> two HOH values were off; corrected to match Rev. Proc. 2025-32 exactly.

### Social Security taxation — ✅ verified (thresholds are permanent, not indexed)

Provisional income = other income + 50% of SS. Thresholds $25k/$34k (single),
$32k/$44k (MFJ); two-zone 50% then 85% phase-in; MFS = 85% always.
Source: IRS Pub 915 / 26 U.S.C. §86.

### IRMAA (Medicare) — ✅ verified against CMS 2026 fact sheet

Standard Part B premium $202.90. Part B surcharge tiers:
284.10 / 405.80 / 527.50 / 649.30 / 689.90. Part D surcharges:
14.50 / 37.60 / 60.60 / 83.20 / 91.00.
Thresholds (single): 109k/137k/171k/205k/500k; (MFJ): 218k/274k/342k/410k/750k.
MFS compressed: ≤109k standard, <391k tier 3, else tier 5.
Source: [CMS 2026 Parts A&B fact sheet](https://www.cms.gov/newsroom/fact-sheets/2026-medicare-parts-b-premiums-deductibles)

### RMD divisors — ✅ verified against IRS Uniform Lifetime Table

Ages 73–100 spot-checked (73=26.5, 75=24.6, 80=20.2, 85=16.0, 90=12.2, 95=8.9,
100=6.4) — all match.
Source: [IRS Pub 590-B, Table III](https://www.irs.gov/publications/p590b)

### State income tax rates & retirement-income rules — ⚠️ NOT exhaustively verified

The 50-state table (`STATES`) holds each state's top marginal rate and an
exemption flag with a plain-language note. These were **not** verified
state-by-state against current law in the June 2026 pass. State rates change
annually and retirement-income treatment is full of per-state quirks. The tool
already shows "verify locally" notes on the tricky ones. **This is the softest
area and the first thing to verify on the next pass** — or to spot-check for the
user's own state when accuracy matters to them.

#### Michigan — ✅ fully verified June 2026

- **Rate: 4.25%** — confirmed against [MI Treasury, 2026 rate determination](https://www.michigan.gov/treasury/news/2026/04/15/state-individual-income-tax-rate-for-2026-tax-year-determined).
  Note: the 4.05% figure seen in some secondary sources was a **one-time 2023-only**
  rollback; the Court of Appeals ruled it temporary and the rate returned to
  4.25% in 2024 and remains 4.25% for 2026.
- **Retirement income:** the Lowering MI Costs Act (PA 4 of 2023) phase-in
  **completed for tax year 2026** — all retirees may deduct combined
  public/private retirement and pension income (including IRA withdrawals) up to
  ~$67,610 single / ~$135,220 joint, **regardless of birth year**. Source:
  [MI RAB 2026-1](https://www.michigan.gov/taxes/rep-legal/rab/2026-revenue-administrative-bulletins/revenue-administrative-bulletin-2026-1).
  > Fixed June 2026: the prior note said exemptions "vary by birth year" — that
  > described the pre-2026 tiered system the phase-in replaced. Updated to the
  > 2026 rules. A Roth conversion is taxable IRA income, so whether it fits under
  > the deduction cap depends on the filer's other retirement income.
- **Social Security:** not taxed by Michigan at any income or birth year. (The
  Social Security claiming tool models federal benefits only and applies no state
  tax, which is correct for Michigan.)

#### California — ✅ fully verified June 2026

- **Rate: 9.3% (representative).** California has nine progressive brackets
  1%–12.3%, plus a 1% surcharge on income over $1M (13.3% effective top). The
  tool stores a single rate per state; 9.3% is a defensible choice — it covers
  ~$73k–$371k single income, the widest bracket where most filers land. Source:
  [CA FTB 2025 tax rate schedules](https://www.ftb.ca.gov/) (via verified
  secondary sources citing the FTB schedules).
- **Retirement income: fully taxed (`ex:false` correct).** California has **no**
  general retirement-income exemption; IRA withdrawals and Roth-conversion income
  are taxed as ordinary income. (A narrow military-retirement exclusion of up to
  $20k exists for 2025–2029 below AGI limits — not relevant to a Roth tool.)
- **Social Security:** not taxed by California. (Correctly reflected — the SS
  claiming tool applies no state tax.)
  > Tightened June 2026: the prior note said "taxed at up to 13.3%," which could
  > imply 13.3% is a near-top bracket rate. Clarified that the bracket tops at
  > 12.3% and 13.3% is the >$1M surcharge, and that the tool uses the 9.3%
  > middle bracket.

#### Ohio — ✅ fully verified June 2026

- **Rate: 2.75% (corrected from 3.99%).** Ohio completed its flat-tax transition:
  for tax year 2026 it is a flat **2.75%** on income above $26,050 (0% below).
  The tool's prior 3.99% was two reforms stale (3.5% top through 2024, 3.125%
  transitional 2025, flat 2.75% in 2026). A Roth conversion lands in the 2.75%
  band. Source:
  [Ohio Dept. of Taxation](https://tax.ohio.gov/) / EY Tax News (flat tax
  effective 2026).
  > Fixed June 2026: rate 3.99% → 2.75%; note rewritten. The "retirement income
  > credits" the old note cited are real but tiny (≤$200 total) and barely affect
  > a conversion.
- **Retirement income: taxable (`ex:false` correct).** Ohio taxes IRA/401(k)
  withdrawals; only a small retirement-income credit applies.
- **Social Security:** fully exempt from Ohio tax — so Ohio is **not** in the
  eight-state SS-tax disclosure, and the SS tool (no state tax) is correct for
  Ohio.

#### Nevada — ✅ fully verified June 2026 (no change needed)

- **Rate: 0%, fully exempt (`cr:0, ex:true`) — confirmed correct.** Nevada has
  **no individual income tax**, a prohibition written into the **Nevada
  Constitution, Article 10, Section 1** — a stronger, more durable guarantee than
  a statute. IRA/401(k) withdrawals, Roth-conversion income, pensions, and Social
  Security are all untaxed at the state level. Source:
  [Nevada Dept. of Taxation](https://tax.nv.gov/) / NV Constitution Art. 10 §1.
- **Social Security:** not taxed (no income tax at all), so Nevada is correctly
  absent from the eight-state SS disclosure, and the SS tool is correct for Nevada.
- The tool's entry was already accurate — recorded here for completeness.

#### West Virginia — ✅ fully verified June 2026

- **Rate: ~4.86% (corrected from 5.12%).** WV is cutting income tax faster than
  any other state. The 5.12% reflected the 2023 cut (21.25% across-the-board,
  6.5%→5.12%); the WV Tax Division then enacted a **5% cut retroactive to Jan 1
  2026** (W. Va. Code §11-21-4j, effective June 12 2026), bringing the top rate to
  ~4.86%. Because of the ongoing trigger-based reductions, this rate is a moving
  target — re-verify each year. Source:
  [WV Tax Division — 2026 rate cut](https://tax.wv.gov/Individuals/Pages/PersonalIncomeTaxReductionBill.aspx).
  > Fixed June 2026: rate 5.12% → ~4.86%; note rewritten.
- **Retirement income: taxable (`ex:false` correct).** IRA/401(k)/Roth-conversion
  income is taxed; seniors 65+ get an $8,000 modification.
- **Social Security: now fully exempt (note corrected).** The prior note said
  "some Social Security exemption" — that described the phase-in. HB 4880's
  phase-out **completed in 2026**: SS is 100% exempt for all WV taxpayers
  regardless of income. Source:
  [WV Tax Division — SS modification](https://tax.wv.gov/Individuals/SeniorCitizens/Pages/SeniorCitizenSocialSecurityModification.aspx).
  So WV is correctly **not** in the eight-state SS disclosure, and the SS tool is
  correct for WV.

#### New York — ✅ fully verified June 2026

- **Rate: 6.25% (corrected from 10.9%).** NY has nine graduated brackets 4%–10.9%,
  but the **10.9% top only applies above $25 million** — far too high as the
  representative rate. The tool stores one rate per state; 6.25% (the
  $161,550–$323,200 band) better reflects where a meaningful conversion lands.
  Source: [NY Dept. of Taxation & Finance](https://www.tax.ny.gov/) tax rate
  schedules.
- **$20,000 private retirement exclusion (age 59½+): CONFIRMED CORRECT — not
  changed.** Bills S2571/A259 proposed raising this to $25k (2025)/$30k (2026)/etc.,
  and several secondary guides reported those figures as if enacted. They were
  **not enacted** — the official tax.ny.gov "Information for retired persons" page
  and all current tax-prep software (Drake, TaxSlayer, TurboTax) still apply
  **$20,000 for 2026**. The exclusion covers IRA/401(k) distributions, per person.
  > Verified June 2026: resisted a tempting "fix" to $30,000 — it would have been
  > wrong, based on an unenacted bill. Source: tax.ny.gov + JustAnswer (Mar 2026):
  > "current enacted law stands at $20,000."
- **Retirement income: taxable above the exclusion (`ex:false` correct).** IRA/
  conversion income is taxed; government pensions are fully exempt.
- **Social Security:** fully exempt — so NY is **not** in the eight-state SS
  disclosure, and the SS tool is correct for NY.
- **NYC city tax:** up to ~3.876% on residents — correctly noted.

#### Oregon — ✅ fully verified June 2026

- **Rate: 8.75% (refined from 9.9%).** Oregon's four brackets run 4.75%–9.9%, but
  the **8.75% bracket spans ~$10,200–$125,000** (single) and the 9.9% top kicks in
  at just $125,000 — a low threshold, so 8.75% is where most conversion income
  actually sits. 9.9% wasn't wrong, just slightly high for a typical conversion.
  Source: [Oregon DOR](https://www.oregon.gov/dor/) 2026 brackets.
- **Social Security: fully exempt — RESOLVED a source conflict.** The Oregon DOR
  states plainly: "Oregon doesn't tax Social Security or Railroad Retirement Board
  benefits." A few secondary calculators claimed Oregon taxes SS above
  $22,500/$45,000 — but that figure is the income limit for the **retirement-income
  credit**, which they misattributed to SS taxation. Oregon does NOT tax SS, so it
  is correctly **not** in the eight-state disclosure and the SS tool is right for
  Oregon. (Primary source beat the secondary calculators again.)
- **Retirement income: fully taxable (`ex:false` correct).** IRA/401(k)/conversion
  income taxed at full rates. The retirement-income credit is capped at low
  household income ($22,500 single / $45,000 joint), so it rarely helps a
  conversion — the note's "limited" framing is accurate.
- **No sales tax; Portland-area residents owe extra county/metro income tax** —
  noted for context.

#### Virginia — ✅ fully verified June 2026

- **Rate: 5.75% — CONFIRMED correct and representative (not changed).** Virginia's
  top 5.75% bracket starts at just **$17,000** (unchanged since 1990), so unlike
  NY/OR, essentially all conversion income is taxed at the top rate. 5.75% is
  exactly right — a good reminder the rate-representativeness check is per-state.
  Source: [VA Code §58.1-320](https://law.lis.virginia.gov/) / VA Dept. of Taxation.
- **$12,000 age deduction (65+): confirmed, note sharpened.** Phases out
  dollar-for-dollar above **$50,000 single / $75,000 joint** federal AGI. Critical
  Roth interaction: a conversion *raises AGI*, so a large one can erase the
  deduction entirely — added this to the note. (Those born on/before Jan 1 1939
  get it regardless of income, a legacy carve-out not worth tool space.)
- **Retirement income: taxable (`ex:false` correct).** IRA/conversion income taxed
  at 5.75%.
- **Social Security: fully exempt** — confirmed at
  [VA Tax — Subtractions](https://www.tax.virginia.gov/subtractions). So VA is
  **not** in the eight-state disclosure and the SS tool is correct for VA.
- Note: qualified *Roth* withdrawals don't raise AGI (preserving the age
  deduction), unlike the conversion itself — a genuine breakeven nuance.

#### New Jersey — ✅ fully verified June 2026 (most consequential fix)

- **`ex:true` → `ex:false` — this was the meaningful error.** The engine uses
  `ex:true` to set the state retirement-tax rate to **zero** (`stRetR = ex ? 0 :
  cr`), i.e. it assumed a NJ conversion is state-tax-free. But NJ's pension/
  retirement exclusion has a **hard income cliff**: full exclusion only if total
  income ≤ $100,000, partial $100k–$150k, and **zero above $150,000**. A Roth
  conversion is taxable IRA income that *counts toward* that threshold — so a
  sizable conversion (exactly what this tool models) can blow past the cliff and
  make the whole thing taxable. `ex:true` told users the conversion was free when
  it may trigger full taxation — backwards for the tool's core scenario. Now
  `ex:false`: the tool assumes the conversion is taxable and the note says when it
  may not be. Sources: [NJ Treasury — Retirement Income Exclusions](https://www.nj.gov/treasury/taxation/njit7.shtml),
  papolalaw.com (cliff mechanics).
- **Rate: 6.37% (corrected from 10.75%).** 10.75% is NJ's millionaire rate (above
  $1M). 6.37% is the $75k–$500k band where conversion income lands.
- **Social Security: fully exempt** (and excluded from the gross-income
  threshold calc) — so NJ is **not** in the eight-state disclosure and the SS tool
  is correct for NJ.
- Design note: erring toward "taxable" is the safe direction for a decision tool —
  over-stating potential cost beats falsely promising an exemption a conversion
  can destroy. The note tells the user exactly when the assumption may not apply.

#### Pennsylvania — ✅ fully verified June 2026

- **Rate: 3.07% flat — confirmed correct.** Stable since 2004; lowest flat rate in
  the country.
- **`ex:true` — CONFIRMED correct (the opposite of NJ).** PA genuinely exempts
  IRA/401(k)/pension distributions once you reach retirement age (59½ for IRAs),
  with **no income cliff**. Per the PA DOR, an IRA distribution is exempt "so long
  as the taxpayer is not required to pay a penalty for early withdrawal" — i.e.,
  at 59½+. So a Roth conversion at 59½+ is genuinely PA-tax-free. This is why
  `ex:true` is right here but was wrong for NJ: PA has a real, cliff-free
  exemption. Source: [PA DOR — Gross Compensation](https://www.pa.gov/agencies/revenue/forms-and-publications/pa-personal-income-tax-guide/gross-compensation).
- **Note sharpened** to add the 59½ condition: a conversion *before* 59½ could be
  taxed as an early distribution. (Also noted PA's up-front taxation of
  contributions — basis recovery means no double tax at withdrawal.)
- **The `ex:true` advice copy is correct for PA:** the engine warns that converting
  in a state that won't tax the eventual withdrawal means paying state tax now for
  no benefit — exactly the right insight for PA.
- **Social Security: fully exempt** — so PA is **not** in the eight-state
  disclosure and the SS tool is correct for PA.

#### Florida — ✅ fully verified June 2026 (no change needed)

- **Rate: 0%, fully exempt (`cr:0, ex:true`) — confirmed correct.** Florida has
  **no individual income tax** (prohibited by the Florida Constitution). IRA/401(k)
  withdrawals, Roth-conversion income, pensions, and Social Security are all
  untaxed. The old intangibles tax (stocks/bonds) was repealed years ago.
  Source: [Florida Dept. of Revenue](https://floridarevenue.com/) / FL Constitution.
- **Social Security:** not taxed (no income tax), so FL is correctly absent from
  the eight-state disclosure and the SS tool is correct for Florida.
- The tool's entry was already accurate. (Aside, outside tool scope: a large
  withdrawal creates no FL income tax but can affect local senior property-tax
  exemption eligibility.)

#### Texas — ✅ fully verified June 2026 (no change needed)

- **Rate: 0%, fully exempt (`cr:0, ex:true`) — confirmed correct.** No individual
  income tax, prohibited by **Texas Constitution Art. 8 §24-a** (strengthened by
  2019 Prop 4: needs a supermajority + statewide referendum to change). All
  retirement income — IRA/401(k)/conversion/pension/SS — untaxed.
  Source: [TX Constitution Art. 8 §24-a](https://statutes.capitol.texas.gov/).
- **Social Security:** not taxed, so TX is correctly absent from the disclosure
  and the SS tool is correct for Texas.
- The tool's entry was already accurate.

### ✅ Priority `ex:true` audit — all five completed June 2026

These five income-taxing states were flagged `ex:true` (tool assumed zero state tax
on the conversion). Audited against primary sources. **Two were actively wrong**
(Georgia, Alabama) — the same failure mode as New Jersey.

#### Illinois — ✅ `ex:true` CONFIRMED correct (cleanest of all)

- Rate 4.95% flat (constitutionally required single rate) — correct.
- The IL Dept. of Revenue explicitly lists "a traditional IRA converted to a Roth
  IRA" as exempt retirement income; the taxable portion of a conversion is
  subtracted on Schedule M. **No age requirement, no income cap, no cliff** — even
  cleaner than PA. So `ex:true` is right and a conversion is genuinely IL-tax-free.
  Note sharpened to say the conversion specifically is exempt. Source:
  [tax.illinois.gov Q&A](https://tax.illinois.gov/questionsandanswers/answer.99.html),
  Publication 120.

#### Mississippi — ✅ `ex:true` kept; rate fixed; age condition added

- **Rate fixed 4.7% → 4.4%** (2026; stepping down toward 3.75%).
- MS exempts retirement income **once plan retirement requirements are met
  (generally 59½)**. Per MS DOR, "early distributions are not considered
  retirement income and may be subject to tax." So a conversion at 59½+ is exempt
  (`ex:true` correct), but an early one is taxed. Added the age condition to the
  note. Source: [MS DOR FAQ](https://www.dor.ms.gov/individual/individual-income-tax-frequently-asked-questions),
  35 Miss. Code R. 3-02-07-104.

#### Georgia — ✅ `ex:true` → `ex:false` (WRONG flag, like NJ)

- Georgia does **not** fully exempt retirement income — it has a **capped
  exclusion**: $65,000/person at 65+, $35,000 at 62–64, and taxes the rest at its
  flat rate (~5.39% for 2026). A Roth conversion is large income that **exceeds the
  cap**, so the excess is taxable — `ex:true` falsely zeroed it. Flipped to
  `ex:false`; note explains the cap and that a small conversion fitting under the
  exclusion may not be taxable. Source:
  [GA DOR — Retirement Income Exclusion](https://dor.georgia.gov/retirement-income-exclusion).

#### Iowa — ✅ `ex:true` kept; rate fixed; age-55 condition added

- **Rate fixed 6% → ~3.9%** (stale; Iowa's 2023 reform flattened toward 3.9%).
- Iowa's 2023 reform fully exempts retirement income — **including Roth conversion
  income explicitly** — for residents **55+**. A conversion at 55+ is IA-tax-free
  (`ex:true` correct; 55 is a *lower*, friendlier threshold than the usual 59½);
  under 55 it's taxed. Added the age condition. Source:
  [Iowa DOR provisions](https://revenue.iowa.gov/taxes/tax-guidance/individual-income-tax/individual-income-tax-provisions),
  Iowa Code §422.7(31).

#### Alabama — ✅ `ex:true` → `ex:false` (WRONG flag, clearest error)

- The old note conflated two different things: AL exempts **defined-benefit
  pensions** (government/military/many private) and Social Security — but
  **traditional IRA and 401(k) distributions are FULLY TAXABLE** at up to 5%. A
  Roth conversion is IRA income, so AL taxes it (only a $6,000 exclusion at 65+).
  `ex:true` was backwards. Flipped to `ex:false`; rate 5% kept (top rate hits at
  just $3,000, so it's representative). Source:
  [AL DOR — Income Exempt](https://www.revenue.alabama.gov/individual-corporate/income-exempt-from-alabama-income-taxation/),
  LegalClarity (IRA taxability).

### Social Security state-tax disclosure — ✅ added & verified June 2026

The SS claiming tool deliberately does **not** model state tax (it would rarely
change which claiming age wins, and would couple the tools). Instead its
disclaimer now states the figures are before state tax and names the **eight
states that tax SS benefits in 2026**: Colorado, Connecticut, Minnesota, Montana,
New Mexico, Rhode Island, Utah, Vermont — all under income thresholds that exempt
many retirees. West Virginia completed its phase-out Jan 1 2026; Missouri,
Kansas, and Nebraska dropped it in 2024–2025. Verify this list annually.
Source: multiple current 2026 retirement-tax guides (24/7 Wall St., TaxShark).

#### Tennessee — ✅ fully verified June 2026 (no change needed)

- **`cr:0, ex:true` — confirmed correct.** No individual income tax; the Hall tax
  on interest/dividends was fully repealed Jan 1 2021. Constitutionally protected
  by **Amendment 3 (2014)**, which bars any tax on payroll or earned personal
  income. The TN DOR (HIT-18) confirms IRA/401(k) distributions are not subject to
  state tax. A Roth conversion is TN-tax-free. Source:
  [TN DOR HIT-18](https://revenue.support.tn.gov/hc/en-us/articles/360057371832).
- Note left as "No income tax." — already accurate; entry unchanged.

#### Washington — ✅ verified June 2026 (note updated for the 2028 income tax)

- **`cr:0, ex:true` — correct for now.** No tax on ordinary income, and the 7%
  long-term capital-gains tax **explicitly exempts retirement accounts** (IRA,
  401(k), Roth) — so an IRA distribution or Roth conversion is untaxed today.
- **⚠️ Forward-looking change: ESSB 6346 creates a 9.9% income tax on household
  income above $1 million, effective Jan 1 2028.** It starts from federal AGI with
  **no retirement-income carve-out**, so traditional IRA distributions and Roth
  conversion amounts count toward the $1M threshold. The vast majority of retirees
  are far below $1M and owe nothing, so `ex:true` stays the right default — but a
  very large conversion in 2028+ could be partly taxed. Added a note so the entry
  isn't silently stale when 2028 arrives; **revisit before tax year 2028**.
  Source: [WA ESSB 6346 analysis](https://www.thestartuplawblog.com/washington-state-income-tax/),
  WA DOR capital gains.

#### New Hampshire — ✅ fully verified June 2026

- **`cr:0, ex:true` — confirmed correct.** NH's Interest & Dividends Tax (its only
  individual income tax) was **repealed effective Jan 1 2025** per the NH DOR
  (TIR 2025-001) — and that tax never applied to IRA/conversion income anyway
  (only to interest and dividends). So nothing NH levies reaches a conversion.
  Note ("interest/dividend tax ended 2025") is accurate. Source:
  [NH DRA repeal notice](https://www.revenue.nh.gov/news-and-media/repeal-nh-interest-and-dividends-tax-now-effect).
- For the record (no tool impact): bills to reinstate an I&D tax with a higher
  $20k threshold (e.g. HB 503-FN) have been floated but **not enacted**, and even
  if passed would tax interest/dividends, not conversions. No action needed.

#### Alaska / South Dakota / Wyoming — ✅ verified June 2026 (no change needed)

- **All three `cr:0, ex:true` — confirmed correct.** None levies an individual
  income tax; IRA/401(k)/conversion income, pensions, and Social Security are all
  untaxed. None has any wrinkle reaching conversion income (no WA-style capital
  gains or future income tax). All correctly absent from the eight-state SS
  disclosure. Source: multiple current 2026 retirement-tax guides + Tax Foundation
  2026 State Tax Competitiveness Index.
- For context (no tool impact): AK has no state sales tax and pays the Permanent
  Fund Dividend; WY and SD are favored by high-net-worth retirees for the zero
  income tax.

### ✅ No-income-tax `ex:true` states — all nine now verified

NV, FL, TX, TN, WA, AK, NH, SD, WY — every no-income-tax state has been audited and
confirmed `ex:true`-correct. WA carries the only caveat (2028 income tax on
household income above $1M; note added, revisit before TY2028). All others are
constitutionally or structurally fixed.

### ✅ High-rate `ex:false` audits — top bracket misused as representative

The NY/Oregon pattern: an entry stored a state's *top* marginal rate, which only
applies to very high incomes, overstating tax for a typical conversion. Highest-
impact remaining `ex:false` fixes.

#### Minnesota — ✅ rate fixed June 2026

- **Rate 9.85% → 7.85%.** MN's 2026 brackets are 5.35/6.80/7.85/9.85%; the 9.85%
  top only starts near $193k single / $305k joint. A typical conversion lands in
  the 7.85% band; effective rates for most filers are 6–7%, not 9.85%. Source:
  [MN DOR brackets](https://www.revenue.state.mn.us/minnesota-income-tax-rates-and-brackets).
- `ex:false` correct — no broad retirement exclusion; IRA/conversion fully taxed.
- Note adds a real interaction: a conversion raises income and can **shrink MN's
  Social Security subtraction**, pulling more benefits into MN tax. (MN is on the
  eight-state SS disclosure — consistent.)

#### Hawaii — ✅ rate fixed June 2026 (largest overstatement corrected)

- **Rate 11% → 8%.** 11% is the top of *twelve* brackets, only above $200k single
  / $400k joint. A 2024 reform (Act 46 / GAP II) widened brackets toward lower
  rates, phasing through 2031; effective rate is ~7.1% at $75k, ~9.5% at $300k. A
  typical conversion lands near 8%. Source:
  [HI DOR / Act 46](https://files.hawaii.gov/tax/forms/2024/n11ins.pdf).
- `ex:false` correct, with a key distinction now in the note: Hawaii **fully
  exempts pensions (employer-funded) and Social Security**, but traditional IRA/
  401(k) income — and thus a Roth conversion — **is fully taxable** (HRS
  §235-7(a)(3) covers pensions/SS, not IRAs). Prevents a pension-holder from
  assuming the conversion is also exempt.

#### Washington D.C. — ✅ rate fixed June 2026

- **Rate 10.75% → 8.5%.** 10.75% is DC's top bracket, only above $1M. The 8.5%
  band covers ~$60k–$250k where most conversion income lands; effective rate at
  $100k is ~6.9%. Source:
  [DC Office of Tax & Revenue](https://otr.cfo.dc.gov/) / 2026 brackets.
- `ex:false` correct — pensions, 401(k), and IRA all taxable; no retirement
  exclusion. SS exempt.

#### Connecticut — ✅ rate fixed + cliff documented June 2026 (NJ-style structure)

- **Rate 6.99% → 5.5%.** 6.99% is the top of seven brackets; ~5.5% is
  representative for a conversion.
- **`ex:false` kept — and it's correct for the NJ reason.** For 2026 CT fully
  exempts IRA/401(k)/pension income, but **only under an AGI cliff** ($75k single /
  $100k joint for full exemption, phasing to zero at $100k / $150k). The IRA
  exemption just completed its phase-in (50%→75%→100% for 2026). A Roth conversion
  raises AGI and a sizable one **blows past the cliff**, making it taxable — same
  structure as New Jersey, so assuming taxable is right; note says when a small
  conversion may stay exempt. Source:
  [CT OLR 2025-R-0152](https://www.cga.ct.gov/2025/rpt/pdf/2025-R-0152.pdf),
  [CT DRS](https://portal.ct.gov/DRS).
- **CT taxes Social Security** above the same thresholds — consistent with its
  place on the eight-state SS disclosure list.

#### Vermont — ✅ rate fixed June 2026

- **Rate 8.75% → 6.6%.** 8.75% is the top of four brackets, only above ~$230k
  single / ~$280k joint; a typical conversion lands in the 6.6% band. Source:
  [VT Dept. of Taxes](https://tax.vermont.gov/) 2026 brackets.
- `ex:false` correct — no broad retirement exclusion (only a small $10k deduction
  for certain pension/government income, not IRA conversions). Note adds the SS
  interaction: a conversion can push past VT's SS-exemption thresholds ($65k joint
  / $55k single). VT is on the eight-state SS disclosure list — consistent.

#### Wisconsin — ✅ rate fixed + new Act 15 subtraction added June 2026

- **Rate 7.65% → 5.3%.** 7.65% top only above ~$315k single / ~$420k joint; most
  retirees and conversions land in the 5.3% band.
- **New for 2025 (Act 15):** taxpayers 67+ can subtract up to **$24,000 ($48,000
  joint)** of qualifying retirement income — and the WI DOR (Pub. 126) confirms
  this includes IRA distributions, so part of a conversion may be sheltered. Added
  to note. `ex:false` stays correct (capped subtraction, not full exemption; the
  conversion is taxable beyond it). SS fully exempt. Source:
  [WI DOR Pub. 126](https://www.revenue.wi.gov/DOR%20Publications/pb126.pdf).

#### Maine — ✅ rate fixed + note CORRECTED June 2026 (was misleading)

- **Rate 7.15% → 6.75%.** Per Maine Revenue Services 2026 schedules, 7.15% starts
  at $64,850 single (a low threshold), but a typical conversion lands in the 6.75%
  band. Source:
  [Maine Revenue Services 2026 rates](https://www.maine.gov/revenue/taxes/income-estate-tax/individual-income-tax-1040me).
- **Note was actively wrong for this tool.** The old note said a "$35,000 pension
  deduction" applies — but Maine's Pension Income Deduction **specifically excludes
  Roth conversions** (confirmed: conversions, 457(f), and early-penalty
  distributions don't qualify). So the deduction does NOT shelter a conversion; the
  old note implied it might. Corrected to state conversions are fully taxable with
  no shelter. `ex:false` correct. SS exempt.

### ✅ Mid-rate `ex:false` audits — SS-list states (June 2026)

Five states from the remaining `ex:false` list, four of them on the eight-state SS
disclosure list (NM, MT, RI; NE and KS recently dropped SS tax). Pattern: mild
top-bracket overstatements plus several stale rates from recent reforms, plus two
IRA-specific deduction traps (RI, like ME).

#### New Mexico — ✅ rate fixed June 2026

- **Rate 5.9% → 4.9%.** 5.9% (HB 252 restructure) only applies above $210k single /
  $315k joint; a typical conversion lands near 4.9%. Source:
  [NM Taxation & Revenue](https://www.tax.newmexico.gov/), HB 252.
- `ex:false` correct; $8,000 retirement deduction (65+) is AGI-limited under
  $100k/$150k. Note adds that a conversion can blow past that limit AND past the
  same $100k/$150k threshold where NM starts taxing Social Security. On SS list.

#### Montana — ✅ rate fixed June 2026

- **Rate 5.9% → 5.65%** (HB337: 5.65% for 2026, 5.4% in 2027). Two brackets; 5.65%
  starts at just ~$20,500 single / ~$41,000 joint, so most conversion income is at
  5.65%. Source: [MT DOR HB337](https://revenue.mt.gov/news/recent-news/HB-337).
- `ex:false` correct. Note updated: MT **repealed its broader pension/IRA deduction**
  for 2025, leaving only a ~$5,500 qualified-retirement-income deduction; MT taxes
  SS on the federal formula (on SS list). No sales tax.

#### Nebraska — ✅ rate fixed + SS note corrected June 2026

- **Rate 5.84% → 4.55%** (LB 754: 4.55% for 2026, 3.99% in 2027). Top bracket
  starts ~$29k single, so a typical conversion is near the top rate. Source:
  [NE Legislature §77-2715.03](https://www.nebraskalegislature.gov/laws/statutes.php?statute=77-2715.03),
  [Gov. Pillen / LB 754](https://governor.nebraska.gov/gov-pillens-historic-income-tax-cuts-effective-january).
- **Note corrected:** old note said "partial Social Security exemption" — NE
  **fully exempts SS as of 2025** (no threshold). IRA/conversion fully taxable.

#### Rhode Island — ✅ rate fixed + IRA-exclusion trap documented June 2026

- **Rate 5.99% → 4.75%.** 5.99% only starts near $176k; a typical conversion lands
  in the 4.75% band.
- **Note corrected (Maine-style trap).** RI's up-to-$50,000 retirement-income
  modification covers 401(k)/403(b)/pension/annuity income but **the RI Division of
  Taxation's retirement guide explicitly excludes ALL IRAs** ("No income from a
  traditional IRA, Roth IRA, SEP-IRA... qualifies"). So a Roth conversion gets no
  shelter and is fully taxable; the old "some exemptions apply" note implied
  otherwise. RI also taxes SS above ~$107k/$133.75k (on SS list). Source:
  [RI Div. of Taxation Retirement Income Guide](https://tax.ri.gov/sites/g/files/xkgbur541/files/2026-02/PUB_2026-01_Retirement_Income_Guide.pdf).

#### Kansas — ✅ rate fixed + SS note updated June 2026

- **Rate 5.7% → 5.58%** (2024 two-bracket reform; top rate starts ~$23k single, so
  a typical conversion is near it). Source:
  [KS DOR Notice 24-08](https://www.ksrevenue.gov/), KS legalclarity summary.
- `ex:false` correct — private IRA/401(k) fully taxable (KPERS, federal, military
  pensions exempt). **KS fully exempted SS starting 2024** (SB 1), so despite older
  listings, a conversion no longer pulls SS into tax for most. Note updated.

### ✅ Graduated / exclusion `ex:false` audits (June 2026)

Remaining graduated-rate and exclusion-based states. Pattern: some stale
top-rates-as-representative, several recent reforms, and — most importantly — a
clear split between states whose retirement exclusion INCLUDES IRA/conversion
income and those that EXCLUDE IRAs (the trap family). All edited via the
line-targeted `set-state.mjs` helper (see Tooling note below).

#### Missouri — ✅ rate confirmed, note corrected June 2026

- **4.7% confirmed representative.** Graduated 0%/2%–4.7% (Mo. Rev. Stat. §143.011);
  top rate starts at only ~$9,200 taxable, so a conversion is effectively at 4.7%.
- Note corrected: old text said "public pension exclusion," but the IRA-relevant
  break is the **$6,000 private-pension exclusion**, income-limited to under $25k
  single / $32k joint MAGI — a meaningful conversion rarely qualifies. SS fully
  exempt (62+). Source: [MO DOR Pension FAQ](https://dor.mo.gov/faq/taxation/individual/pension.html).
- Full brackets: 0% <$1,313; 2%/2.5%/3%/3.5%/4%/4.5%/4.7% in ~$1,313 steps; 4.7% >$9,191.

#### Delaware — ✅ rate fixed June 2026

- **Rate 6.6% → 5.55%.** Graduated 2.2%–6.6%; 6.6% only at $60k+, so a typical
  conversion is in the 5.55% band ($25k–$60k). Source:
  [DE Division of Revenue PIT FAQ](https://revenue.delaware.gov/frequently-asked-questions/personal-income-tax-faqs/).
- `ex:false` correct. $12,500 exclusion (60+) covers combined pension+IRA but is a
  small cap; **early distributions (1099-R code 1, pre-59½) do NOT qualify** (DE
  Div. of Revenue / PIT instructions). SS exempt; no sales tax.
- Full brackets: 0% <$2,000; 2.2%/3.9%/4.8%/5.2%/5.55% to $60k; 6.6% >$60k.

#### Maryland — ✅ rate noted, IRA-exclusion trap corrected June 2026

- **5.75% kept representative** (new 2025 brackets 6.25%/6.5% only hit very high
  income), but note now flags those new top brackets AND the mandatory **county
  tax (2.25%–3.2%)** that the state-only figure omits.
- **IRA-exclusion trap (like ME, RI).** Maryland's ~$36k pension exclusion (65+)
  covers 401(k)/403(b)/pension but **explicitly excludes all IRAs** — a conversion
  gets no shelter. Sources confirm emphatically (RCS planning; SmartAsset). SS
  exempt. Source: [MD Comptroller](https://www.marylandtaxes.gov/).
- Full brackets: 2%/3%/4%/4.75%/5%/5.25%/5.5%/5.75% to $250k; 6.25%/6.5% above; + county.

#### Oklahoma — ✅ rate fixed June 2026

- **Rate 4.75% → 4.5%** (2026 restructure to ~4 brackets; 4.5% top starts ~$7,200–
  $13,550, so it's representative). Source:
  [OK Tax Commission](https://oklahoma.gov/tax/helpcenter/income-tax.html).
- `ex:false`; the $10,000 exclusion (65+) **does include IRA income** (IRC §408 per
  OTC) but is a small cap a conversion exceeds. SS fully exempt.
- Full brackets (2026): 0%/0.25%/2.75%/4.5%; top above ~$7,200 (single).

#### South Carolina — ✅ rate fixed, conversion-friendly structure documented June 2026

- **Rate 6.3% → 5.2%** (H.4216 reform from 7%; two brackets 1.99%/5.21% for 2026,
  with further cuts triggered by revenue growth). Source:
  [SC DOR / LegalClarity H.4216 summary](https://dor.sc.gov/).
- Notably conversion-FRIENDLY: the retirement deduction **includes traditional
  IRAs**, and a separate $15,000 age-65+ deduction (against any income) **can
  absorb conversion income** — RCS guide flags post-65 as a favorable conversion
  window, and explicitly contrasts this with Maryland's IRA exclusion. SS exempt.
- Full brackets (2026): 1.99% to $30k; 5.21% above.

#### Arkansas — ✅ rate confirmed, "verify locally" hedge resolved June 2026

- **3.9% confirmed** (AR DFA, down from 4.4%; top rate at low income ~$25,700).
  Removed the old note's "verify locally" hedge with primary sources.
- $6,000 retirement exemption **covers traditional IRA but only at 59½+** (early
  distributions disqualified); AR DFA confirms a Roth conversion is taxable in the
  conversion year. SS exempt below $100k AGI (generous threshold — AR is not on the
  eight-state SS list). Source:
  [AR DFA Subject 206](https://www.arkansas.gov/dfa/income_tax/documents/206-PensionsandAnnuities.pdf).
- Full brackets: 0% to ~$5,500, graduated to 3.9% >~$25,700 (separate flatter
  schedule for net income >$94,700).

### ✅ Flat-tax `ex:false` audits (June 2026)

Flat-rate states carry no top-bracket-overstatement risk, but several had stale
rates from 2025–26 cuts. Rates cross-checked against the Tax Foundation 2026 State
Income Tax Rates report and state sources.

- **Idaho** — **5.695% → 5.3%** (HB40, 2025, retroactive). SS exempt. Flat.
- **Kentucky** — **4% → 3.5%** (Jan 1 2026 revenue trigger). SS exempt; modest
  retirement exclusion. Flat.
- **North Carolina** — **4.5% → 3.99%** (final phasedown step Jan 1 2026; heading to
  2.99% by 2028). SS exempt. Flat.
- **Indiana** — **3.05% → 2.95%** (Jan 1 2026; → ~2.9% in 2027). SS exempt; some
  counties add local income tax. Flat.
- **Utah** — **4.65% → 4.5%** (recently cut). On the eight-state SS list (taxes SS
  with a phased credit); small retirement credit phases out with income. Flat.
  Cross-checked against SS disclosure — consistent.
- **Colorado** — **4.4% confirmed.** Pension/annuity subtraction ($20k at 55–64,
  $24k at 65+) covers IRA/conversion income but **excludes pre-59½ early
  distributions** (CO DOR, primary source). Fully exempts SS at 65+ (on SS list;
  consistent). TABOR can reduce the effective rate. Source:
  [CO DOR pension/annuity topics](https://tax.colorado.gov/income-tax-topics-social-security-pensions-and-annuities).
- **Massachusetts** — **5% confirmed**, no retirement exclusion (IRA/401(k) fully
  taxed). Note adds the **4% surtax above $1M** — a very large conversion could
  trip it. SS exempt.
- **North Dakota** — **2.5% top confirmed** (0% bottom bracket; among the lowest
  conversion taxes anywhere). SS exempt.
- **Arizona** — **2.5% flat confirmed** (lowest flat rate nationally). SS exempt.

### ✅ AUDIT COMPLETE — all 54 entries primary-sourced (June 2026)

Every entry in the `STATES` table has been verified against a state Department of
Revenue or equivalent primary source. Error archetypes found and fixed across the
full audit: wrong `ex:true` flags hiding tax (NJ, GA, AL); top-bracket rates used
as representative (NY, OR, MN, HI, DC, VT, WI, ME, NM, DC, others); cliff
structures behind vague notes (NJ, CT); and conversion-specific deduction errors —
the IRA-exclusion trap family (ME, RI, MD exclude IRAs) vs. IRA-inclusive states
(OK, SC, AR, CO include IRAs, usually capped/age-gated).

### Tooling — `set-state.mjs` (June 2026)

To eliminate the recurring silent-deletion bug (a malformed long find-and-replace
collapsing an adjacent entry — hit CA, OH, GA, RI), state edits now go through
`_dev/set-state.mjs`, which replaces a single entry by key on its own line. It
aborts the write unless: exactly one line matches the key, the replacement is a
well-formed single `KEY: {…},` line, the total entry count is unchanged (54), and
the resulting inline scripts still parse (catching an unescaped apostrophe in a
note before it ships). A `--file` mode reads the replacement line from a file to
avoid shell-quoting mangling. The grep-and-count check remains as a backstop.

### Mortality / life-expectancy tables — ⚠️ internal-consistency only

The `QX` arrays (SSA period life table) and the survival-probability logic were
checked for internal consistency and sensible behavior, **not** traced value-by-
value against the published SSA table. Lower stakes (they drive a "how long might
you live" estimate the user can override), but noted for completeness.

---

## Edge-input robustness — ✅ verified June 2026

Both calculator compute functions were stress-tested against degenerate inputs
(zeros, identical values, extreme rates, inverted earners, huge values): no
NaN, no Infinity, no exceptions. The UI controls also bound inputs to sane
ranges.

---

## Annual re-verification checklist (do each tax year)

1. **Federal brackets + standard deduction** → new IRS Rev. Proc. (issued each fall for the next year).
2. **Senior deduction** → confirm still in effect (OBBBA provision runs 2025–2028) and the amount/phaseout.
3. **IRMAA** → new CMS "Medicare Parts A & B Premiums and Deductibles" fact sheet (issued each fall).
4. **RMD divisors** → only change if the IRS revises the Uniform Lifetime Table (rare).
5. **Social Security** → reduction formulas are statutory (rarely change); confirm FRA assumption still fits the audience.
6. **State rates** → the big annual chore; verify against a current source, prioritizing high-population states.
7. Update **"Last full verification"** date at the top of this file.
