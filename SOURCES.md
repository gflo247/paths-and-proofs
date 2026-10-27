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

## Social Security: Couples (`social-security-couples/social-security.js`)

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
| Own + spousal benefit together (dual entitlement) | own benefit plus the spousal excess (half the partner's PIA minus own PIA), not the larger of the two; the excess is reduced only for months of spousal entitlement before FRA, counted from when the spousal benefit starts (once the partner has filed) | [CFR 404.411(d)](https://www.ssa.gov/OP_Home/cfr20/404/404-0411.htm), [CFR 404.407(a)](https://www.ssa.gov/OP_Home/cfr20/404/404-0407.htm), [POMS RS 00615.020](https://secure.ssa.gov/POMS.NSF/LNX/0300615020) (Method C) | ✅ |
| Delayed credits under dual entitlement | left out of the combined amount; they count only if they lift the own benefit above it, so at or after FRA the check is the larger of the own benefit and the full spousal amount | [POMS RS 00615.694](https://secure.ssa.gov/POMS.NSF/LNX/0300615694) (worked example: $400 own + $300 excess = $700) | ✅ |
| Survivor full retirement age (born 1960) | 66 years 8 months — a separate, younger table than worker/spousal FRA | [POMS RS 00615.301](https://secure.ssa.gov/POMS.NSF/LNX/0300615301) B.2 chart ("1/2/60 - 1/1/61: 66 + 8"; the whole table matches `survivorFraFromBirthYear()`); earlier corroborated via [ssa.tools](https://ssa.tools/guides/survivor-benefits) and [Adara Wealth](https://www.adarawealth.com/blog/critical-ages-on-the-social-security-benefits-timeline) when ssa.gov wasn't reachable | ✅ |
| Survivor's own age-based reduction | 0% at survivor FRA, scaling linearly to 28.5% at age 60; set by the months of entitlement before FRA, so fixed when the survivor benefit starts | [CFR 404.410(c)(1)](https://www.ssa.gov/OP_Home/cfr20/404/404-0410.htm) — exact formula quoted: months of entitlement prior to FRA × 0.285, divided by months from age 60 to FRA; [POMS RS 00615.301](https://secure.ssa.gov/POMS.NSF/LNX/0300615301) B.1.c ("entitled beginning 7/2002 ... RF is 37") | ✅ |
| When the survivor benefit starts | at the death (or 60), or at survivor FRA for the full amount, whichever is worth more for the lifespan; a survivor with no benefit of their own who was getting spouse's benefits (age 62 to FRA) is converted at the death with no application, while one with their own retirement benefit must elect a reduced survivor benefit or is paid in full at FRA | [POMS RS 00207.005](https://secure.ssa.gov/POMS.NSF/LNX/0300207005) C | ✅ |
| RIB-LIM (widow/widower limit) | when the deceased claimed before their own FRA, a cap applied after the survivor's own age reduction: the survivor gets the smaller of their age-reduced benefit and the larger of the deceased's actual reduced benefit or 82.5% of PIA | [CFR 404.338(c)](https://www.ssa.gov/OP_Home/cfr20/404/404-0338.htm), [POMS RS 00615.320](https://secure.ssa.gov/POMS.NSF/LNX/0300615320) A.3 ("applies when the WIB after ... reduction for age is more than BOTH") | ✅ |

Survivor rule fixed 2026-08-26 (commits b7e5b11, 68e59eb/167831c) — the tool
previously just kept `Math.max(highBenefit, lowBenefit)` with no RIB-LIM or
age-reduction applied at all, despite an old header comment claiming CFR
404.410 governed "survivor reduction." See `roth-ss-survivor-benefit-fix.md`.

Dual-entitlement rule fixed 2026-10-21 — while both spouses were alive, the
tool paid each the larger of their own benefit and the spousal benefit, with
the spousal reduction keyed to the lower earner's own claim age. SSA pays the
own benefit plus the spousal excess, reduced only for months it is paid before
FRA, counted from when the spousal benefit actually starts (rows above). On
the page's first example ($3,000 / $800 PIAs, lower earner claiming at 62) the
lower earner's check was $975 under both strategies; it is $1,015 if the
higher earner claims at 62 and $1,260 from when they file at 70, and the
headline goes from "breakeven 87" to "waiting wins". Claims at or after FRA
are unchanged. Tests: `_dev/test-ss-dual-entitlement.mjs`.

Widow's-limit order fixed 2026-10-21 — the tool took the survivor's own age
reduction off the RIB-LIM amount. RIB-LIM is a cap on the age-reduced benefit
(row above), so a survivor under their FRA was shortchanged whenever the
deceased had claimed early: on a $3,000 PIA claimed at 62, a survivor aged 60
got $1,770 instead of $2,145, and one aged 63 got $2,087 instead of $2,475.
Survivors at or past their FRA are unchanged. Tests:
`_dev/test-ss-survivor.mjs`.

Survivor reduction timing fixed 2026-10-21 — the tool recomputed the
survivor's age reduction from their age in each month, so a survivor who
started at 62 saw it shrink to zero by FRA: a reduced benefit early AND the
full amount later, which Social Security never pays. The reduction is now
fixed when the survivor benefit starts, and a survivor under FRA at the death
takes the better of starting then or waiting for the full amount (rows above).
Only first deaths before the survivor's FRA change: for a higher earner who
dies at 65 ($3,000 / $1,200 PIAs, waiting to 70 vs claiming at 62, 0%
discount) the breakeven goes from 79 to 85. Tests: `_dev/test-ss-survivor.mjs`.

**Scope note (honest limitation):** uses each person's birth year to derive
their actual worker/spousal FRA from the SSA table (added 2026-08-26); does
not model the earnings test, benefit taxation, or divorced-spouse benefits;
models a real age gap between spouses via birth-year inputs (added 2026-08-26).
The main chart computes both death orders and shows whichever is more
conservative for the inputs (since 2026-08-26: RIB-LIM only limits an
*inherited* benefit, never a survivor's own, so the two orders can give
different answers); the heatmap shows every combination of both lifespans.
All of this is stated in the on-page disclaimer.

---

## Roth conversion (`roth-conversion/index.html`) — tax year 2026

### Federal income tax — ✅ verified against IRS Rev. Proc. 2025-32

Bracket thresholds (top of each band; 37% applies above the 35% top):

| Filing | 10% | 12% | 22% | 24% | 32% | 35% |
|---|---|---|---|---|---|---|
| Single | 12,400 | 50,400 | 105,700 | 201,775 | 256,225 | 640,600 |
| MFJ | 24,800 | 100,800 | 211,400 | 403,550 | 512,450 | 768,700 |
| MFS | 12,400 | 50,400 | 105,700 | 201,775 | 256,225 | 384,350 |
| HOH | 17,700 | 67,450 | 105,700 | 201,750 | 256,200 | 640,600 |

Standard deduction: 16,100 single / 32,200 MFJ / 24,150 HOH / 16,100 MFS — ✅
Additional standard deduction at 65 (IRC 63(f)): $2,050 single / HOH, $1,650 per spouse
65+ on a married return (joint or separate) — ✅
Senior deduction (OBBBA, 2025–2028): $6,000/person, less 6% of MAGI above
$75k single / $150k MFJ off each person's $6,000 (gone at $175k single, $250k joint);
none for MFS — ✅ ([Schedule 1-A](https://www.irs.gov/pub/irs-pdf/f1040s1a.pdf) lines 31–37)

> Fixed 2026-10-22: the tool left out the 63(f) amount (every 65+ filer's federal
> taxable income ran $1,650–$3,300 high), and took the senior deduction's phase-out off
> a couple's $12,000 once instead of off each $6,000 (a couple's deduction ran up to
> $6,000 high between $150k and $350k of MAGI, and a conversion there lost it half as
> fast as it does). `_dev/test-roth-aged-deduction.mjs`.
Source: [IRS Rev. Proc. 2025-32](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf) /
[IRS 2026 inflation adjustments](https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill)

> Fixed June 2026: four 32%/35% boundary thresholds were off by $25–$100 and
> two HOH values were off; corrected to match Rev. Proc. 2025-32 exactly.

### Social Security taxation — ✅ verified (thresholds are permanent, not indexed)

Provisional income = other income + 50% of SS. Thresholds $25k/$34k (single),
$32k/$44k (MFJ); two-zone 50% then 85% phase-in; MFS = 85% always.
Source: IRS Pub 915 / 26 U.S.C. §86.

### IRMAA (Medicare) — ✅ verified against CMS 2026 fact sheet

Standard Part B premium $202.90. Part B total premium by tier:
284.10 / 405.80 / 527.50 / 649.20 / 689.90. Part D surcharges:
14.50 / 37.50 / 60.40 / 83.30 / 91.00.
Thresholds (single): 109k/137k/171k/205k/500k; (MFJ): 218k/274k/342k/410k/750k.
Each tier starts *above* its threshold except the top one, which starts *at*
$500k / $750k ("greater than or equal to"). MFS compressed: ≤109k standard,
<391k tier 4, ≥391k tier 5.
> Fixed 2026-10-20: the figures above had drifted from the code (which matched
> CMS); the top tier was also treated as starting above $500k / $750k.
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

#### How the tool figures state tax — the Relocation engine since 2026-10-25 (fix-pack 12)

- **Before:** one flat rate per state (`roth.cr`, roughly the marginal rate near $100,000
  of income) times the taxable change, with special cases for the retirement exclusions
  (`core/retirement-rules.js`), Ohio's 0% band, Massachusetts' surtax, Michigan's cap and
  the local taxes. It missed lower brackets, deductions and exemptions, credits and their
  phase-outs, state Social Security tax, the federal-tax subtraction and state
  capital-gains rules.
- **Now:** `computeConversionCost` calls `computeStateAndLocalTax`
  (`relocation/relo-engine.mjs`) on the year's income with and without the conversion,
  from the same `taxRules`/`localTax` the Relocation tool uses (inlined as `STRULES` by
  `_dev/gen-st-table.mjs`). The retirement-side state rate is the engine's tax on $1,000
  more IRA withdrawal at the rate estimator's retirement income, at retirement age (it was
  `roth.cr`, or 0 for `ex:true` states). `roth.cr` remains as reference data for the notes.
- **The Roth-specific layer** is how a conversion counts (`conversionKind`): an IRA
  withdrawal in almost every state; exempt in `ex:true` states once the filer (both spouses
  on a joint return) meets `exMinAge`, ordinary income before; ordinary income in Michigan
  below 59 1/2 (`retDeduction.conversionAgeGate`) and in Ohio (`conversionAsOtherIncome`: its
  retirement income credit counts only distributions "received ... on account of
  retirement", R.C. 5747.055(A)). `_dev/check-states-json.mjs` G5 holds these against the
  engine data.
- **Floored at zero on both sides.** Alabama excludes a conversion inside its $6,000-a-person
  65+ exclusion but deducts all federal income tax, including the tax on the conversion, so
  converting can lower Alabama tax (by at most a few hundred dollars); the tool counts no
  state saving.
- **Examples (hand-verified in `_dev/test-roth-state-cases.mjs`, `test-roth-scenarios.mjs`
  and `test-roth-edge-cases.mjs`):** California couple, both
  66, $40,000 pension and $40,000 Social Security, converting $30,000: $459 (was $2,790).
  Utah, the same couple: $2,261 (was $1,335; Utah taxes Social Security and phases out its
  credits). Mississippi, single at 55 with no other income, converting $50,000: $1,268
  (was $2,000). Michigan, single at 65 with a $70,000 pension, converting $20,000: $700.83
  (was $850; the exemption the pension left unused now counts).
- **Data corrected with it (both tools):** Connecticut's 2026 IRA share, Massachusetts'
  2026 surtax threshold, Michigan's 2026 exemption (see those entries).
- **Tests:** `_dev/test-roth-state-engine.mjs` (wiring, all 51 jurisdictions; replaces
  `test-roth-rix.mjs`), `_dev/test-roth-state-cases.mjs`, and the re-derived Michigan grid
  (`test-roth-retded.mjs`), local-tax, scenario and edge-case files.

#### Michigan — ✅ fully verified June 2026; wages-exclusion bug found and fixed 2026-08-01

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
  > 2026 rules.
  > **Fixed 2026-08-24 (commit 31d9cfc, adversarially reviewed): a Roth**
  > **CONVERSION specifically is an exception to the birth-year-independent rule**
  > **above.** Confirmed via MI Treasury's own Roth-conversion FAQ: "the rollover
  > distribution from a regular IRA qualifies for the pension subtraction...
  > if the individual is at least 59 1/2 years of age when the rollover occurs."
  > This calculator had NO age check at all before this fix, wrongly sheltering
  > conversions made before 59.5 (confirmed live: a 45-year-old converting
  > $50,000 showed $0 Michigan tax — a 100% error, the correct figure is
  > $2,125). Ordinary pension/IRA income already being received is genuinely
  > unaffected by this gate (confirmed both via the general guidance and by an
  > independent adversarial review pass) — only the conversion itself is
  > gated, via a new `conversionAgeGate` field. Roth-calculator-only: the
  > Relocation tool's `iraWithdrawal` field has no conversion-specific
  > semantics (per user decision) and can represent a genuine pre-59.5
  > withdrawal-to-spend, which still qualifies under the age-independent rule.
  > **Corrected 2026-10-25 (fix-pack 12): the 59 1/2 rule is not conversion-only.** It
  > covers every IRA distribution: MCL 206.30(8)(a)(ii) counts IRAs as retirement or
  > pension benefits only "if the distributions are not made until the participant has
  > reached 59-1/2 years of age, except in the case of death, disability, or distributions
  > described by section 72(t)(2)(A)(iv)" ([MCL 206.30](https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-206-30);
  > [RAB 2017-21](https://www.michigan.gov/documents/treasury/RAB_2017-21_IRA_603142_7.pdf),
  > which also treats a rollover as a distribution from the original account). Pension
  > (employer-plan) income has no such age test. The Roth tool now applies the rule to its
  > retirement-side withdrawals too (`stateRetMarginal`); its current-year "Pension /
  > Retirement-Account" field still shelters at any age, and so does the Relocation
  > engine's "IRA / 401(k) withdrawal" input, which mixes IRAs with 401(k)s (Michigan
  > treats employer plans differently). Open, for the owner's decision.
  > **Stronger citation found during the adversarial review**: MI's 2026 Form
  > 446 (Withholding Guide, rev. Feb 2026) states the $67,610/$135,220 figures
  > directly and explicitly — "For 2026, recipients born after 1945 may
  > generally subtract qualifying retirement and pension benefits up to
  > $67,610 if single or married filing separately, or $135,220 if married
  > and filing a joint return" — a stronger, more direct source than RAB
  > 2026-1 alone for these exact dollar figures.
  > **Two related items re-examined 2026-08-24 by reading Form 446's full text**
  > **(not just the adversarial review's summary) — both confirmed IRRELEVANT**
  > **to the Roth conversion calculation specifically**, so neither needs
  > fixing: (1) Recipients born before 1946 get an unlimited deduction only
  > for **PUBLIC-source** pensions ("not taxed on any qualifying pension and
  > retirement benefits received from public sources") — their PRIVATE
  > pension/IRA income (what a Roth conversion always is) stays capped at the
  > same $67,610/$135,220 as everyone else, quote: "may subtract qualifying
  > private pension and retirement benefits up to the remaining balance of
  > $67,610... or $135,220." Doesn't touch conversions at all. (2) "Premature
  > distributions" are defined narrowly as amounts "paid on separation,
  > withdrawal, or discontinuance of A PLAN paid before the recipient could
  > have retired under the provisions of THE PLAN" — this is about early
  > separation from an EMPLOYER-SPONSORED plan (401(k)/403(b)/pension) with
  > its own vesting/retirement provisions, not IRA distributions or Roth
  > conversions, which have no "plan" to retire under in this sense. Could
  > only matter if a user's entered `pensionIncome` came from exactly this
  > kind of early separation payout — the same "the tool trusts entered
  > income is legitimately qualifying" simplification already accepted
  > elsewhere (e.g. CT's note on not being able to tell IRA money from
  > genuine pension income), not a new gap.
- **The deduction is for 1099-R retirement/pension distributions specifically —
  it does NOT apply to wages, salary, or self-employment income.** Confirmed
  against MI Treasury's own "Retirement and Pension Benefits" guidance: "wages,
  salaries, and personal compensation... are additions (not eligible for the
  subtraction)," and self-employment income is separately excluded too.
  > Fixed 2026-08-01: the tool's single "income" field previously fed BOTH the
  > federal calculation AND the amount competing for this cap — meaning a still-
  > working filer's wages were incorrectly treated as if they were pension income
  > already using up the $67,610/$135,220 cap, understating the deduction
  > actually available to shelter a conversion. Added a dedicated "Pension /
  > Other Retirement-Account Income" field so wages and pension income are
  > tracked separately; only the pension figure competes for the cap now. The
  > SAME fix was applied to Louisiana (the only other flat-cap RETDED state) and
  > to all 8 RIX states (GA/SC/VA/WI/NM/CT/NJ/WV), whose retirement-income
  > deductions are the same class of mechanism, each independently confirmed via
  > this project's earlier research to apply to retirement income specifically.
  > Regression-verified: identical results for pensionIncome=0 and for
  > pensionIncome equal to the old single income figure, across all 3 pre-
  > existing examples and all 8 RIX states.
- **Social Security:** not taxed by Michigan at any income or birth year. (The
  Social Security claiming tool models federal benefits only and applies no state
  tax, which is correct for Michigan.)
- **Married Filing Separately uses the single-filer cap.** Confirmed directly:
  [MI Treasury, 2025 Form 4884 Instructions](https://www.michigan.gov/taxes/-/media/Project/Websites/taxes/Forms/IIT/TY2025/4884-Instr.pdf),
  p.21: "For purposes of this form, single limits apply to taxpayers who are
  married filing separately." This is a structural rule of the form (repeated at
  every dollar tier in the instructions, not tied to one year's figures), so it
  carries forward to the 2026 fully-phased-in cap.
  > Added 2026-08-20. `states.json` already had `mfs` set equal to `single`
  > (set in the original modeling commit 8ef9356 by inference, never
  > independently sourced) — this closes that gap with a direct citation.
- **Head of Household is NOT a distinct category on Form 4884** — the
  instructions (26 pages, TY2025) never mention "head of household" anywhere;
  only Single, Married Filing Jointly, and Married Filing Separately are ever
  distinguished. `states.json` sets `hoh` equal to `single`, which is the only
  defensible reading given the form's structure, but this is an **inference from
  absence**, not a directly-quoted rule the way the MFS figure above is — flagged
  as the remaining soft spot if a future Form 4884 revision ever adds an HOH
  column.
- **Local city income tax is not modeled.** Michigan Treasury's own city-tax page
  ([michigan.gov/taxes/citytax](https://www.michigan.gov/taxes/citytax)) lists 24
  cities that levy their own income tax, including Detroit, administered
  separately from the state return. The calculator's Michigan note now discloses
  this (added 2026-08-20) but doesn't model it — same treatment as Indiana's
  county-tax disclosure. Exact city rates were findable only via secondary
  aggregators (consistently reporting Detroit at 2.4%/1.2% resident/nonresident),
  not confirmed against a primary-source rate table in this pass, so the note
  stays qualitative rather than citing a specific percentage.

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
- **Relocation tool bug fixed 2026-08-24 (`taxRules.bracketsByStatus.hoh`,
  not the Roth `cr` above — Roth's flat 9.3% approximation was unaffected).**
  Single, MFJ, and MFS all blend the +1% surcharge into a distinct top bracket
  row (a `{rate:0.133, upTo:null}` row after a split at the flat $1,000,000
  surcharge floor); HOH's table was missing that row entirely, topping out at
  12.3% with `upTo: null` — so an HOH filer's tax was silently computed with
  NO surcharge at all above $1,010,417. Confirmed live: at $2,000,000 taxable
  income the engine returned $219,192 instead of the correct $229,192, a real
  $10,000 (4.4%) understatement. Verified all four filing statuses' bracket
  thresholds against the primary source — [CA FTB 2025 Form 540 tax rate
  schedules](https://www.ftb.ca.gov/forms/2025/2025-540-tax-rate-schedules.pdf)
  (Schedule X/Y/Z) — before and after the fix, using `relo-engine.mjs`
  directly, not a reimplementation. Same "stale HOH" pattern this file has
  hit before (see the Stale MFS/HoH rule in CLAUDE.md); the `check-states-json.mjs`
  G1–G4 guard didn't catch it because it checks structural validity and
  MFJ-vs-single, not HOH bracket-count parity — worth a G5 guard someday, not
  added here to keep the fix minimal. See `roth-ca-hoh-surcharge-fix.md`
  project memory.

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
  > Fixed August 2026: the calculator was applying the flat 2.75% to the whole
  > conversion regardless of income level, ignoring the $26,050 zero-bracket the
  > note already disclosed in prose. Now taxes only the portion of pension+wages+
  > conversion income actually above $26,050 (ORC 5747.02; threshold confirmed
  > filing-status-independent — same for single and MFJ).
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

#### West Virginia — ✅ fully verified June 2026, retirement-deduction mechanic corrected 2026-08-01

- **Rate: 4.58% (corrected from ~4.86%).** WV is cutting income tax faster than
  any other state. The 5% cut enacted for the 2026 session (SB 392) brought the
  top rate from 4.82% to **4.58% effective Jan 1 2026** — one round further than
  the ~4.86% this entry previously cited (itself already one round ahead of the
  older 5.12% figure). Because of the ongoing trigger-based reductions, this rate
  is a moving target — re-verify each year. Source:
  [WV Tax Division — 2026 rate cut](https://tax.wv.gov/Individuals/Pages/PersonalIncomeTaxReductionBill.aspx).
  > Fixed 2026-08-01: rate ~4.86% → 4.58% (SB 392 superseded the cut this entry
  > had been tracking).
- **Retirement income: taxable (`ex:false` correct); the $8,000/$16,000
  modification shares ONE pool with Social Security.** Seniors 65+ get an
  $8,000 single / $16,000 joint modification against IRA/pension income — but
  W. Va. Code §11-21-12(c)(9) nets it against the SAME pool as the taxpayer's
  Social Security benefit and other pension exclusions. Since WV now exempts
  Social Security in full (see below), most SS-drawing retirees' benefit alone
  already exceeds $8,000, leaving little or nothing left to shelter IRA or
  conversion income — the modification is genuinely available in full only to
  someone 65+ who hasn't started claiming Social Security yet. The tool nets the
  SS benefit against the cap (`netAgainstSS` on `states.json`'s WV entry) rather
  than granting the nominal figure unconditionally.
  > Added 2026-08-01: this shared-pool mechanic was previously undocumented here
  > and unmodeled in the tool — the modification had been applied as a flat,
  > un-netted cap, overstating the benefit for most real SS-drawing users. No
  > per-spouse SS split is available in either engine, so a joint return nets
  > the full household SS benefit against the full $16,000 household cap — a
  > household-level approximation, not a true per-spouse netting.
  > **Fixed 2026-08-24 (commit 088ca20): the $16,000 joint figure was ALSO**
  > **gated only on the primary filer's own age**, so a mixed-age joint return
  > got the wrong shelter — the full $16,000 if only the primary was 65+ (should
  > be $8,000), or $0 if only the spouse was 65+ (should be $8,000, order-
  > dependent). Reshaped to the existing `ageTieredCap` mechanism (per-person
  > summing, already used by GA/WI/CO/LA/etc.) — a pure reclassification since
  > WV's pensionIncome is pooled, except `ageTieredCap` had no `netAgainstSS`
  > support yet (only the flat-cap branch did), so that was added to both
  > engines' `ageTieredCap` branches too. Found while auditing the identical
  > gap in NY and AL (same commit).
- **Social Security: now fully exempt (note corrected).** The prior note said
  "some Social Security exemption" — that described the phase-in. HB 4880's
  phase-out **completed in 2026**: SS is 100% exempt for all WV taxpayers
  regardless of income. Source:
  [WV Tax Division — SS modification](https://tax.wv.gov/Individuals/SeniorCitizens/Pages/SeniorCitizenSocialSecurityModification.aspx).
  So WV is correctly **not** in the eight-state SS disclosure, and the SS tool is
  correct for WV.
  > **Fixed 2026-10-21 (Relocation):** married filing separately uses half-width
  > bands ($5,000 / $12,500 / $20,000 / $30,000) per the same
  > [WV Tax Division page](https://tax.wv.gov/Individuals/Pages/PersonalIncomeTaxReductionBill.aspx);
  > the MFS table had the single bands.

#### New York — ✅ fully verified June 2026

- **Rate: 6.25% (corrected from 10.9%).** NY has nine graduated brackets 4%–10.9%,
  but the **10.9% top only applies above $25 million** — far too high as the
  representative rate. The tool stores one rate per state; 6.25% (the
  $161,550–$323,200 band) better reflects where a meaningful conversion lands.
  Source: [NY Dept. of Taxation & Finance](https://www.tax.ny.gov/) tax rate
  schedules.
  > **Fixed 2026-10-21: rates a year stale.** The tables held the TY2025 rates
  > (4/4.5/5.25/5.5/6%) while the bracket note called them post-cut. TY2026 schedule
  > from [Form IT-2105-I (2026)](https://www.tax.ny.gov/pdf/2026/inc/it2105i_2026.pdf),
  > which DTF says reflects ["certain income tax rate reductions"](https://www.tax.ny.gov/bus/wt/rate.htm):
  > 3.9/4.4/5.15/5.4/5.9%, then 6.85/9.65/10.3/10.9%, same thresholds. `roth.cr`
  > 6% → 5.9% (the $80,650–$215,400 single band).
- **$20,000 private retirement exclusion (age 59½+): CONFIRMED CORRECT — not
  changed.** Bills S2571/A259 proposed raising this to $25k (2025)/$30k (2026)/etc.,
  and several secondary guides reported those figures as if enacted. They were
  **not enacted** — the official tax.ny.gov "Information for retired persons" page
  and all current tax-prep software (Drake, TaxSlayer, TurboTax) still apply
  **$20,000 for 2026**. The exclusion covers IRA/401(k) distributions, per person.
  > Verified June 2026: resisted a tempting "fix" to $30,000 — it would have been
  > wrong, based on an unenacted bill. Source: tax.ny.gov + JustAnswer (Mar 2026):
  > "current enacted law stands at $20,000."
  > **Fixed 2026-08-24: the correctly-sourced $20,000 figure was never actually
  > APPLIED by the calculator.** `states.json` had the exclusion data all along,
  > but NY was missing from `_dev/gen-st-table.mjs`'s `RIX_STATES` allowlist, so
  > the tool silently fell back to taxing the full conversion at the flat 6% —
  > found live (a 62-year-old converting $15,000, entirely within the disclosed
  > cap, was still charged NY tax on the full amount). A data-vs-code gap, not a
  > sourcing error — the number above was always right, the code just wasn't
  > using it. Also confirmed: the calculator applies a flat $20,000 regardless of
  > filing status (not $40,000 for a joint return with two qualifying spouses) —
  > see `roth-ny-ma-state-tax-fixes.md` project memory for why a fully per-spouse
  > model was considered and reverted (would have silently broken the Relocation
  > tool's NY calculation via a gap in `relo-engine.mjs`'s non-pooled branch).
  > **Fixed 2026-08-24 (commit 088ca20): the flat-cap version above turned out to**
  > **have its OWN live bug** — gated only on the primary filer's own age, so a
  > joint return where just the SPOUSE was 59.5+ (not the primary) got ZERO
  > shelter, and where just the primary qualified, wrongly got the FULL $20,000
  > that should have been per-person anyway once BOTH spouses qualify (should be
  > $40,000). Confirmed genuinely per-individual via NY DOR: "capped at $20,000
  > per person, whether filing jointly or separately... one spouse can't claim
  > the other spouse's unused exclusion." Fixed properly this time by building
  > `ageTieredCap` support into `relo-engine.mjs`'s non-pooled branch (the exact
  > gap the June 2026 pass reverted around) and giving Roth a dedicated
  > `stateCode==='NY'` branch (shared with AL, same shape: pension separately
  > exempt) applying the per-person-summed cap to the conversion alone.
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
  > Clarified 2026-07-28: confirmed the $12,000 cap is genuinely PER-SPOUSE — if
  > both spouses are 65+, the cap doubles to $24,000, but the $50k/$75k AGI
  > threshold does NOT double (one shared test regardless of how many spouses
  > qualify, per VA's own Form 760 worksheet). Also confirmed VA's AGI test
  > ("AFAGI") backs Social Security out entirely — the same mechanic later
  > confirmed for NJ's income threshold, below.
- **Retirement income: taxable (`ex:false` correct).** IRA/conversion income taxed
  at 5.75%.
- **Social Security: fully exempt** — confirmed at
  [VA Tax — Subtractions](https://www.tax.virginia.gov/subtractions). So VA is
  **not** in the eight-state disclosure and the SS tool is correct for VA.
- Note: qualified *Roth* withdrawals don't raise AGI (preserving the age
  deduction), unlike the conversion itself — a genuine breakeven nuance.

#### New Jersey — ✅ fully verified June 2026 (most consequential fix); mechanic CORRECTED 2026-07-28 (was NOT a hard cliff)

- **`ex:true` → `ex:false` — this was the meaningful error.** The engine uses
  `ex:true` to set the state retirement-tax rate to **zero** (`stRetR = ex ? 0 :
  cr`), i.e. it assumed a NJ conversion is state-tax-free. But NJ's pension/
  retirement exclusion is income-gated, and a Roth conversion is taxable IRA
  income that *counts toward* that gate — so a sizable conversion (exactly what
  this tool models) can lose most or all of the exclusion. `ex:true` told users
  the conversion was free when it may trigger substantial taxation — backwards
  for the tool's core scenario. Now `ex:false`. Source:
  [NJ Treasury — Retirement Income Exclusions](https://www.nj.gov/treasury/taxation/njit7.shtml).
- **Rate: 6.37% (corrected from 10.75%).** 10.75% is NJ's millionaire rate (above
  $1M). 6.37% is the $75k–$500k band where conversion income lands.
- **Not actually a hard $150,000 cliff — corrected 2026-07-28.** NJ excludes
  retirement income for those **62+**, up to $75,000 single / $100,000 joint,
  gated on NJ's own **"Total Income" line — which excludes Social Security
  entirely**, unlike every other state modeled here, which gates off federal
  AGI. Between $100,000 and $150,000 the exclusion doesn't vanish outright — it
  steps down through two intermediate stepped-percentage-of-actual-income tiers
  (37.5%/50% of actual income, then 18.75%/25%), reaching $0 only above
  $150,000. The exclusion is also per-spouse: only the qualifying spouse's own
  retirement income counts. Sources: NJ-1040i, NJ GIT-1&2 instructions.
  > Fixed 2026-07-28: `states.json`'s `taxRules` (and this entry) previously
  > modeled a single hard cliff at $150,000 — granting the FULL exclusion to
  > anyone under $150k total income and $0 above. Real law has two intermediate
  > tiers between $100k–$150k; the old model materially OVERSTATED the exclusion
  > for anyone in that band — precisely the zone a Roth conversion is most
  > likely to land someone in. This was confirmed live in the shipped
  > relocation tool before the fix (`bcf88b9`), not just a documentation gap.
  > **Known simplification, not fixed:** NJ's real MFS cap is $50,000, distinct
  > from the $75,000 single figure — the engine collapses MFS to the
  > single-filer bucket everywhere, so MFS filers here get a more generous cap
  > than actual law allows.
- **Social Security: fully exempt** (and excluded from the Total Income
  threshold, see above) — so NJ is **not** in the eight-state disclosure and the
  SS tool is correct for NJ.
- Design note: erring toward "taxable" was the safe default while the mechanic
  was unmodeled; now that the real stepped tiers are implemented, the tool
  computes the actual figure instead of defaulting to worst-case.

#### Pennsylvania — ✅ fixed 2026-08-24 (the June 2026 "verification" below missed the actual rule)

- **Rate: 3.07% flat — confirmed correct.** Stable since 2004; lowest flat rate in
  the country.
- **`ex:true` correct, but `exMinAge:59.5` was WRONG — fixed 2026-08-24, no age
  gate at all.** The June 2026 pass (below, kept for the record) cited the right
  source but read only the general "eligible plan, age condition of the plan"
  rule that governs ORDINARY withdrawals-to-spend — and missed a separate,
  specific exception that applies to a CONVERSION. The same [PA DOR — Gross
  Compensation guide](https://www.pa.gov/agencies/revenue/forms-and-publications/pa-personal-income-tax-guide/gross-compensation)
  states: "A premature withdrawal from a regular IRA or Roth IRA is taxable
  compensation... **unless timely rolled over into an eligible Pennsylvania
  retirement plan**" — and the same guide separately confirms Roth IRAs ARE
  "eligible Pennsylvania retirement plans." A full trustee-to-trustee (or timely
  60-day) Roth conversion IS a rollover into an eligible PA retirement plan, so
  it falls under that exception and is untaxed **at any age** — the 59½ rule
  governs a genuine withdrawal you spend, not a conversion that stays inside the
  retirement-account system. Cross-checked against independent secondary sources
  (TurboTax community threads with practitioner replies, Bogleheads forum,
  advisor blogs) — all converge on the same reading. Caveat carried into the
  note: if any part of the distribution is withheld (e.g. for federal taxes)
  rather than fully converted, THAT portion is taxable under cost-recovery —
  this calculator assumes a full conversion with no withholding leakage.
  > Found live 2026-08-24: a $50,000 conversion at age 45 was charged the full
  > 3.07% (\$1,535) as an "early distribution," when it should have been \$0.
  > Only `roth.exMinAge` changed — `taxRules.retirementIncome.ageGate:59.5`
  > (used by the Relocation tool, which models genuine withdrawals-to-spend,
  > a real and still-correctly-59.5-gated scenario) was deliberately left
  > untouched. See `roth-pa-conversion-fix.md` project memory.
- **The `ex:true` advice copy is correct for PA:** the engine warns that converting
  in a state that won't tax the eventual withdrawal means paying state tax now for
  no benefit — exactly the right insight for PA.
- **Social Security: fully exempt** — so PA is **not** in the eight-state
  disclosure and the SS tool is correct for PA.

<details>
<summary>Superseded June 2026 note (kept for the record — the source cited was
right, the reading of it was incomplete)</summary>

> **`ex:true` — CONFIRMED correct (the opposite of NJ).** PA genuinely exempts
> IRA/401(k)/pension distributions once you reach retirement age (59½ for IRAs),
> with **no income cliff**. Per the PA DOR, an IRA distribution is exempt "so long
> as the taxpayer is not required to pay a penalty for early withdrawal" — i.e.,
> at 59½+. So a Roth conversion at 59½+ is genuinely PA-tax-free. This is why
> `ex:true` is right here but was wrong for NJ: PA has a real, cliff-free
> exemption.
> Note sharpened to add the 59½ condition: a conversion *before* 59½ could be
> taxed as an early distribution. (Also noted PA's up-front taxation of
> contributions — basis recovery means no double tax at withdrawal.)

</details>

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
  > **Fixed 2026-10-21: 4.4% was the TY2025 rate.** [MS DOR](https://www.dor.ms.gov/general-information)
  > lists 4.4% for tax year 2025, 4% for 2026 and 3.75% for 2027, on taxable income
  > over $10,000. Brackets and `roth.cr` now 4%.
- MS exempts retirement income **once plan retirement requirements are met
  (generally 59½)**. Per MS DOR, "early distributions are not considered
  retirement income and may be subject to tax." So a conversion at 59½+ is exempt
  (`ex:true` correct), but an early one is taxed. Added the age condition to the
  note. Source: [MS DOR FAQ](https://www.dor.ms.gov/individual/individual-income-tax-frequently-asked-questions),
  35 Miss. Code R. 3-02-07-104.

#### Georgia — ✅ `ex:true` → `ex:false` (WRONG flag, like NJ); cap now MODELED 2026-07-28

- Georgia does **not** fully exempt retirement income — it has a **capped
  exclusion**: $65,000/person at 65+, $35,000 at 62–64, and taxes the rest at its
  flat rate (4.99% for 2026, see below). A Roth conversion is large income that
  **exceeds the cap**, so the excess is taxable — `ex:true` falsely zeroed it.
  Flipped to `ex:false`. Source:
  [GA DOR — Retirement Income Exclusion](https://dor.georgia.gov/retirement-income-exclusion).
  > Fixed 2026-07-28: rate ~5.39% → **4.99%** (HB 463, signed May 2026, cut
  > effective for TY2026 — this entry hadn't caught up). More importantly, the
  > cap itself is now actually MODELED rather than just disclosed:
  > `states.json`'s `taxRules.retirementIncome` (`cliffType: ageTieredCap`)
  > computes each spouse's own tier from their own age and sums them for a
  > joint return — a converting spouse only shelters against their own tier; a
  > non-converting spouse's unused tier doesn't transfer (confirmed GA DOR
  > practice). The 65+ tier itself rises to $70,000 starting TY2027 (HB 463).

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
  > **Fixed 2026-08-24 (commit 136d868): the $6,000 exclusion mentioned above was**
  > **never actually applied by the Roth calculator** — AL wasn't in RETDED or
  > RIX_STATES, so it silently got $0 shelter. Confirmed via AL DOR's own Schedule
  > RS instructions (Parts II/III compute the exclusion independently for the
  > "Primary Taxpayer" and "Spouse," summed in Part IV) that it's genuinely
  > per-INDIVIDUAL: `capJoint` was also wrong in `states.json` (flat $6,000, same
  > as single) instead of $12,000. AL's defined-benefit pension is separately,
  > unconditionally exempt and does NOT compete for this cap — unlike every other
  > RETDED/RIX state — so it got a dedicated `stateCode==='AL'` branch applying the
  > cap to the conversion alone. Found while auditing the same per-person-not-flat
  > bug shape in AR/DE/KY/OK (see those entries) and LA (`roth-co-ri-la-audit.md`).
  > **Fixed further 2026-08-24 (commit 088ca20): that dedicated branch's flat**
  > **`capSingle`/`capJoint` was STILL gated only on the primary filer's own age**
  > — a mixed-age joint return got $12,000 if the primary alone qualified (should
  > be $6,000) or $0 if only the spouse qualified (should be $6,000, order-
  > dependent). Reshaped to `ageTieredCap`/`perPersonTiers` and merged into a
  > single shared `stateCode==='AL'||'NY'` branch (identical shape: pension
  > separately exempt, per-person-summed cap applies to the conversion alone).
  > Found while fixing the identical gap in NY and WV (same commit).

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
  > **Fixed 2026-10-21 (Relocation):** the subtraction now phases out as the statute
  > says, "reduced by ten percent for each $4,000 of adjusted gross income, or
  > fraction thereof" over the threshold
  > ([Minn. Stat. 290.0132 subd. 26(c)](https://www.revisor.mn.gov/statutes/cite/290.0132)),
  > tested on federal AGI. It used a generic band about half as wide, tested on income
  > plus the whole benefit. (MFS still uses the single threshold — the engine's
  > two-bucket simplification.)

#### Hawaii — ✅ rate fixed June 2026 (largest overstatement corrected)

- **Rate 11% → 8%.** 11% is the top of *twelve* brackets, only above $200k single
  / $400k joint. A 2024 reform (Act 46 / GAP II) widened brackets toward lower
  rates, phasing through 2031; effective rate is ~7.1% at $75k, ~9.5% at $300k. A
  typical conversion lands near 8%. Source:
  [HI DOR / Act 46](https://files.hawaii.gov/tax/forms/2024/n11ins.pdf).
  > **Fixed 2026-10-21: the bracket tables were the pre-2025 schedule.** Act 46's
  > schedule for tax years after 2024 ([HI DOTAX Tax Rate Schedules](https://tax.hawaii.gov/forms/d_25table-on/d_25table-on_p13/))
  > runs 1.4% to $9,600 … 7.6% to $125,000 … 11% over $325,000 single (joint bands
  > double, head of household 1.5×); the tables held 1.4% to $2,400 … 11% over
  > $200,000. `roth.cr` 8.25% → 7.6% (the $48,000–$125,000 single band). Relocation
  > also caps net capital gain at 7.25%, stacked on top of other income, per
  > [HRS 235-51(f)](https://www.capitol.hawaii.gov/hrscurrent/Vol04_Ch0201-0257/HRS0235/HRS_0235-0051.htm).
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

#### Connecticut — ✅ rate fixed June 2026; mechanic CORRECTED 2026-07-28 (was NOT a cliff)

- **Rate 6.99% → 5.5%.** 6.99% is the top of seven brackets; ~5.5% is
  representative for a conversion.
- **`ex:false` correct, but the mechanic this entry described was wrong.** CT
  does NOT have a smooth cliff to a hard $100k/$150k cutoff. It's a **10-tier
  stepped PERCENTAGE-OF-ACTUAL-INCOME table**: 100% sheltered under $75k
  single/$100k joint AGI, then a discrete step down through nine more tiers
  (85%, 70%, 55%, 40%, 25%, 10%, 5%, 2.5%, 0%) reaching $0 at $100k single/$150k
  joint. There is also **no dollar cap and no age gate at all** — CT is a
  structural outlier among every other state modeled here, where the shelter
  applies at any age. The IRA exemption's own phase-in (50%→75%→100%) completed
  for TY2026, so no separate haircut is needed for the tool's target year. A
  Roth conversion raises AGI and can push the filer into a lower-percentage
  tier — a large conversion shelters a smaller SHARE of itself than a small
  one, not an all-or-nothing cliff. Sources:
  [CT OLR 2025-R-0152](https://www.cga.ct.gov/2025/rpt/pdf/2025-R-0152.pdf),
  CT-1040 instructions, CT IP 2025(7).
  > Fixed 2026-07-28: this entry (and the tool's own `taxRules` data) previously
  > modeled a smooth linear phase-out to a hard cliff — the real law is a
  > discrete stepped table, confirmed via CT's own IP 2025(7) worksheet.
  > `states.json`'s `capSingle`/`capJoint` fields for CT had also been
  > repurposed as dollar caps when CT has no dollar cap at all (those numbers
  > are AGI thresholds) — a real, live bug in the relocation tool at the time,
  > fixed the same pass.
- **CT taxes Social Security** above the same AGI thresholds — consistent with
  its place on the eight-state SS disclosure list.
  > **Fixed 2026-10-21 (Relocation):** head of household now uses the $100,000 joint
  > Social Security threshold ([CT DRS](https://portal.ct.gov/drs/individuals/connecticut-tax-tips-for-senior-citizens)),
  > and the Social Security and pension tiers are tested on federal AGI, which counts
  > only the taxable part of the benefit (they were tested on income plus the whole
  > benefit).
  > **Fixed 2026-10-25 (fix-pack 12, both tools): IRA distributions count in full for
  > 2026.** The 2026-08-24 change (commit 328e8e7) weighted IRA money at 75% before the
  > tier percentage, from the 2025 Pension and Annuity Worksheet; 75% was the 2025 share
  > of the phase-in. The statute gives "for the taxable year commencing January 1, 2026,
  > and each taxable year thereafter, any distribution from an individual retirement
  > account other than a Roth individual retirement account" (CGS 12-701(a)(20)(B)(xxviii)(III),
  > joint (xxix)(III), [chapter 229](https://www.cga.ct.gov/current/pub/chap_229.htm));
  > [OLR 2025-R-0152](https://prdext2.cga.ct.gov/2025/rpt/pdf/2025-R-0152.pdf): "The
  > deduction is 75% for 2025 and 100% beginning in 2026." `iraWeightPct` and its engine
  > branch are removed; IRA and pension income share the stepped table. Example: single,
  > $60,000 wages, $10,000 conversion (AGI $70,000, the 100% tier): $0 (was $258.13).

#### Vermont — ✅ rate fixed June 2026

- **Rate 8.75% → 6.6%.** 8.75% is the top of four brackets, only above ~$230k
  single / ~$280k joint; a typical conversion lands in the 6.6% band. Source:
  [VT Dept. of Taxes](https://tax.vermont.gov/) 2026 brackets.
- `ex:false` correct — no broad retirement exclusion (only a small $10k deduction
  for certain pension/government income, not IRA conversions). Note adds the SS
  interaction: a conversion can push past VT's SS-exemption thresholds ($70k joint
  / $55k single). VT is on the eight-state SS disclosure list — consistent.
  > **Fixed 2026-10-21 (Relocation):** the Social Security exemption now phases out in
  > a straight line over the next $10,000 of federal AGI ($55,000 → $65,000 single,
  > $70,000 → $80,000 joint, [32 V.S.A. 5830e](https://legislature.vermont.gov/statutes/section/32/151/05830e)),
  > applied to the federally taxable part of the benefit; it used a generic band on
  > 85% of the benefit (and this entry said $65k joint). Capital gains get the flat
  > exclusion, $5,000 or the gain if less
  > ([IN-153 instructions, 2025](https://tax.vermont.gov/sites/tax/files/documents/IN-153-Instr-2025.pdf));
  > the 40% exclusion excludes publicly traded stocks and bonds, so it isn't applied.

#### Wisconsin — ✅ rate fixed June 2026; per-spouse mechanic clarified 2026-07-28

- **Rate 7.65% → 5.3%.** 7.65% top only above ~$315k single / ~$420k joint; most
  retirees and conversions land in the 5.3% band.
- **2025 Act 15 subtraction, $24,000 single / $48,000 joint — but $48,000 joint
  is NOT a flat doubling.** Taxpayers 67+ can subtract up to $24,000 of
  qualifying retirement income (WI DOR Pub. 126 confirms this includes
  IRA/conversion distributions), and the $48,000 joint tier requires **BOTH
  spouses to be 67+** — confirmed via WI DOR's own FAQ. A joint filer where only
  one spouse is 67+ gets $24,000, based solely on that spouse's own qualifying
  income, not half of a flat $48,000 household figure. `ex:false` stays correct
  (capped subtraction, not full exemption). **Claiming it forfeits every other
  Wisconsin tax credit for that year** — a real trade-off worth surfacing, not
  previously noted here. SS fully exempt. Source:
  [WI DOR Pub. 126](https://www.revenue.wi.gov/DOR%20Publications/pb126.pdf).
  > Clarified 2026-07-28: the "both spouses 67+" requirement and the
  > credit-forfeiture trade-off weren't in this entry before. `states.json`'s
  > `taxRules` previously modeled WI as `treatment:"taxed"` (unmodeled
  > entirely) — now `exclusion` with `cliffType:"ageTieredCap"`, summing each
  > spouse's own verified entitlement rather than assuming a flat doubling.

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

#### Louisiana — ✅ added 2026-07-28 (was undocumented in this file)

- **Rate: flat 3%** (2025 reform, Act 11/HB1, replaced the old graduated
  structure). Source:
  [LA DOR](https://revenue.louisiana.gov/tax-education-and-faqs/faqs/income-tax-reform/what-are-the-individual-income-tax-rates-and-brackets/).
- **`ex:false` correct.** IRA and conversion income is taxable, with a
  retirement-income exclusion at 65+: $12,000 single, $24,000 joint (per
  person, doubled for a joint return where both spouses qualify). The TY2026
  figure is technically CPI-adjusted slightly above $12,000 per statute, but
  LDR hadn't published the exact 2026 number as of this writing — kept at
  $12,000 with a note to recheck when LDR's 2026 IT-540i publishes
  (~Dec 2026/Jan 2027).
  > Added 2026-07-28: `states.json`'s prior entry had `capJoint` set flat to
  > $12,000 (same as single) instead of the confirmed per-person $24,000 — a
  > real, live bug in the relocation tool, fixed the same pass.
  > **Fixed 2026-08-24 (commit d6d40d2): the "doubled for a joint return where
  > both spouses qualify" language above was correct PROSE, but the actual
  > CODE still used a flat `capJoint:24000` gated only on the PRIMARY FILER's
  > own age (`cliffType:"hard"`) — the same bug class as the original NY
  > finding that opened this session's audit. Confirmed via La. Admin. Code
  > tit. 61, section I-1311's own worked examples (Example 1: a 65+ spouse who
  > receives no retirement income of their own contributes $0 — the
  > exemption doesn't transfer between spouses) that the cap is genuinely
  > per-INDIVIDUAL. A joint filer where only the primary filer was 65+ was
  > wrongly getting the full $24,000; reshaped to the existing `ageTieredCap`
  > mechanism (already used by GA/WI/CO) so each spouse's own age correctly
  > gates their own $12,000, no new engine code needed. Quantified live: a
  > 70/60 joint couple with $30,000 pension income went from $6,000 taxable
  > (wrong) to $18,000 taxable (correct — only the 70-year-old's $12,000
  > shelters).
- **Social Security and most LA government/military pensions are fully
  exempt.**

### ✅ Mid-rate `ex:false` audits — SS-list states (June 2026)

Five states from the remaining `ex:false` list, four of them on the eight-state SS
disclosure list (NM, MT, RI; NE and KS recently dropped SS tax). Pattern: mild
top-bracket overstatements plus several stale rates from recent reforms, plus two
IRA-specific deduction traps (RI, like ME).

#### New Mexico — ✅ rate fixed June 2026; deduction threshold CORRECTED 2026-07-28 (was materially wrong)

- **Rate 5.9% → 4.9%.** 5.9% (HB 252 restructure) only applies above $210k single /
  $315k joint; a typical conversion lands near 4.9%. Source:
  [NM Taxation & Revenue](https://www.tax.newmexico.gov/), HB 252.
- **`ex:false` correct, but this entry's $100k/$150k threshold for the $8,000
  deduction was wrong — that figure belongs to a different statute.** The
  $100k single / $150k joint AGI threshold is New Mexico's SEPARATE Social
  Security exemption (still correctly on the eight-state SS-tax list below).
  The $8,000 age-65+ retirement-income deduction is its own **stepped table**:
  8 brackets stepping down by $1,000 as AGI rises, reaching **$0 by $28,500
  single / $51,000 joint / $25,500 MFS AGI** — over 3x lower than the threshold
  this entry previously cited. A Roth conversion routinely erases the
  deduction's real ceiling at a much smaller size than "$100k" would suggest.
  The bracket is determined once from combined AGI, then the resulting dollar
  figure applies ×1 or ×2 per qualifying (65+) spouse; HOH filers use the joint
  table. Source: NM Taxation & Revenue Dept. (TRD) PIT instructions and worked
  examples.
  > Fixed 2026-07-28: `states.json`'s prior entry had `cliffType:"hard"` with
  > `cliffAGI: null` — meaning it granted the FULL $8,000 unconditionally
  > regardless of income, wrong for most real conversion scenarios. This
  > SOURCES.md entry independently had the wrong threshold too (confused with
  > the SS exemption's $100k/$150k, a genuinely different NM statute). Both
  > corrected the same pass; verified against NM TRD's own worked example
  > ($35k joint AGI, both 65+ → $12,000 excluded, i.e. $6,000 tier × 2).
  > **Fixed 2026-10-21 (Relocation):** the flat capital gains deduction, "100% of
  > your net capital gains, not to exceed $2,500"
  > ([2025 PIT-ADJ instructions](https://realfile.tax.newmexico.gov/2025pit-adj-ins.pdf),
  > line 16), applies to any gain, so Relocation now takes it from portfolio gains
  > too; the 40% business-sale alternative stays unapplied (`exclusionPct` corrected
  > from 0.5 to 0.4). The Social Security and $8,000-deduction thresholds are now
  > tested on federal AGI, which counts only the taxable part of the benefit.

#### Montana — ✅ rate fixed June 2026

- **Rate 5.9% → 5.65%** (HB337: 5.65% for 2026, 5.4% in 2027). Two brackets; 5.65%
  starts at just ~$20,500 single / ~$41,000 joint, so most conversion income is at
  5.65%. Source: [MT DOR HB337](https://revenue.mt.gov/news/recent-news/HB-337).
  > **Fixed 2026-10-21:** the 2026 bands are 4.7% on the first $47,500 single /
  > $71,250 head of household / $95,000 joint (same MT DOR page;
  > [MCA 15-30-2103](https://mca.legmt.gov/bills/mca/title_0150/chapter_0300/part_0210/section_0030/0150-0300-0210-0030.html)),
  > not ~$20,500 / ~$41,000, and head of household had the single band. Long-term
  > capital gains are taxed at 3.0% / 4.1% on the same bands, stacked on top of other
  > income (15-30-2103(2)); Relocation taxed them as ordinary income. `roth.cr`
  > unchanged (5.65%).
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
  > **Fixed 2026-08-24: the joint threshold above was $250 off** — re-read the same
  > source's own worked example ("Justin, 63, and Mark, 65... $133,500 limit which
  > applies for a married couple filing a joint income tax return") and corrected
  > `states.json` from `133750` to `133500`. Also found, re-reading the same guide's
  > Section 1b/Section 3 in full: BOTH the SS exemption and the pension modification
  > require the taxpayer to have reached Social Security **full retirement age**
  > (66-67, by birth year) — a separate gate from the AGI threshold, per the guide's
  > own Example #2 (a 63/65 couple under the AGI limit, denied the exemption solely
  > because neither had reached FRA). This age gate is **not modeled** in
  > `relo-engine.mjs`'s generic `exemptBelowAGI` SS path (confirmed live: a
  > 63-year-old and a 67-year-old get identical, both-exempt results for the same
  > income). Disclosed in the note; would need new shared-engine mechanism (an
  > age-gate check on the SS-threshold path), similar in kind to the CT/NM/MT
  > additions earlier in this audit — flagged for a future fix, not built without a
  > check-in first.
  > **Built 2026-08-24 (commit 4582c17), after a user check-in and an adversarial
  > review pass**: added `ssAgeGate: 67` to `taxableSS()` in `relo-engine.mjs` — below
  > the gate, SS stays fully taxable regardless of AGI. A joint return requires the
  > YOUNGER spouse to also clear the gate (a conservative simplification BY ANALOGY
  > to the pension modification's stated per-spouse-partial rule — the adversarial
  > review confirmed RI's guide states the per-spouse-partial clause explicitly for
  > the PENSION modification but doesn't repeat it for SS specifically, so this is
  > inferred, not directly sourced).
  > **Fixed 2026-10-21 (Relocation):** the pension/annuity modification's federal AGI
  > cliff — $107,000 single, head of household or MFS, $133,500 joint
  > ([Pub 2026-01](https://tax.ri.gov/sites/g/files/xkgbur541/files/2026-02/PUB_2026-01_Retirement_Income_Guide.pdf),
  > Tax Year 2025) — is now applied; `cliffAGI` was null, so the modification applied
  > at any income. Below full retirement age, Relocation now taxes the federally
  > taxable part of Social Security, not 85% of the benefit. Still simplified: the
  > modification is per person (up to $100,000 combined for a joint return when both
  > spouses qualify on their own income); Relocation applies one $50,000.

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
  > **Fixed 2026-08-24 (commit 136d868): the $12,500 exclusion above was never**
  > **actually applied by the Roth calculator** (not in RETDED or RIX_STATES —
  > $0 shelter silently). Confirmed genuinely per-INDIVIDUAL, not flat: "spouses"
  > who each receive a pension "are each permitted one exclusion," up to $25,000
  > combined for a joint return with both spouses 60+. `capJoint` in states.json
  > was also wrong (flat $12,500). Reshaped to the existing ageTieredCap mechanism.

#### Maryland — ✅ rate corrected, county tax modeled 2026-08-24

- **`roth.cr` corrected 5.75% → 4.75%.** The 4.75% band actually covers income up
  to $100k single (the site's own cr yardstick); 5.75% doesn't start until
  $250k–$500k. 5.75% had been substituted in as a rough, mathematically-wrong
  attempt to "offset" the unmodeled county tax below (4.75%+3.2% ≈ 7.95%, not
  5.75%) — found live via the code comment justifying it.
- **County tax (2.25%–3.30%, mandatory for every resident) now MODELED**, not just
  disclosed. Applies a flat 3.20% on top of the state rate — the median AND modal
  rate across all 24 MD jurisdictions (23 counties + Baltimore City), since 12 of
  24 sit at the 3.20% ceiling; also matches the Comptroller's own stated practice
  of basing combined withholding on "median local tax rates of Maryland's 23
  counties and Baltimore City." Unlike Michigan's opt-in city tax (left as
  text-only disclosure because most MI residents pay $0 local tax), Maryland's is
  mandatory for 100% of residents, so a representative numeric rate is
  defensible. Source: [MD Comptroller 2026 State and Local Income Tax Withholding
  Information memo](https://www.marylandcomptroller.gov/content/dam/mdcomp/md/state-payroll/memos/2026/2026-maryland-state-and-local-withholding-information.pdf)
  (Attachment 1, all 24 local rates).
- **IRA-exclusion trap (like ME, RI).** Maryland's ~$36k pension exclusion (65+)
  covers 401(k)/403(b)/pension but **explicitly excludes all IRAs** — a conversion
  gets no shelter. Sources confirm emphatically (RCS planning; SmartAsset). SS
  exempt. Source: [MD Comptroller](https://www.marylandtaxes.gov/).
- Full brackets (2026, single): 2%/3%/4%/4.75% to $100k; 5%/5.25%/5.5%/5.75% to
  $500k; 6.25% to $1M; 6.5% above (H.B. 352/FY26 budget added the last two).
  County rates range 2.25% (Worcester) to 3.30% (Dorchester, Kent); Anne Arundel
  and Frederick are themselves income-tiered.

#### Oklahoma — ✅ rate fixed June 2026

- **Rate 4.75% → 4.5%** (2026 restructure to ~4 brackets; 4.5% top starts ~$7,200–
  $13,550, so it's representative). Source:
  [OK Tax Commission](https://oklahoma.gov/tax/helpcenter/income-tax.html).
- `ex:false`; the $10,000 exclusion (65+) **does include IRA income** (IRC §408 per
  OTC) but is a small cap a conversion exceeds. SS fully exempt.
- Full brackets (2026): 0%/0.25%/2.75%/4.5%; top above ~$7,200 (single).
  > **Fixed 2026-08-24 (commit 136d868): the $10,000 exclusion above was never**
  > **actually applied by the Roth calculator** (not in RETDED or RIX_STATES —
  > $0 shelter silently). Confirmed genuinely per-individual: each spouse can
  > claim $10,000 separately, up to $20,000 combined for a joint return with
  > both 65+. `capJoint` in states.json was also wrong (flat $10,000). Reshaped
  > to the existing ageTieredCap mechanism.

#### South Carolina — ✅ rate fixed June 2026; mechanic CORRECTED 2026-07-28 (NOT two stacking deductions)

- **Rate 6.3% → 5.2%** (H.4216 reform from 7%; two brackets 1.99%/5.21% for 2026,
  with further cuts triggered by revenue growth). Source:
  [SC DOR / LegalClarity H.4216 summary](https://dor.sc.gov/).
- **Conversion-friendly, but NOT two stacking deductions to $25,000 as this
  entry used to imply.** SC has ONE shared $15,000-per-person ceiling across
  two pieces: an age-tiered retirement-income deduction ($3,000 under 65 /
  $10,000 at 65+, covers traditional IRA/conversion income) and a separate
  age-65+ deduction against any income, but the second piece is REDUCED by
  whatever the first already used (`age65Deduction = max(0, 15000 -
  retirementDeduction)`). Confirmed via SC DOR's own worked examples — NOT
  additive to $25,000. Post-65 is still a meaningfully favorable conversion
  window (full $15,000 vs. $3,000 under 65), just not as generous as "two
  separate deductions" suggested. SS exempt.
  > Fixed 2026-07-28: this entry previously described "a separate $15,000
  > deduction... can absorb conversion income" alongside the retirement
  > deduction, implying they stack. Corrected after SC DOR's worked examples
  > showed the shared-ceiling offset. `states.json`'s prior entry modeled
  > neither the age-tiering nor the offset (flat $10k, no age gate) — now
  > modeled as `treatment: offsetStack`.
  > **Known simplification, not fixed:** SC's real law lets tier-2's leftover
  > capacity shelter OTHER (non-retirement) income too if the retirement
  > deduction doesn't use it all. This tool only applies the shelter to
  > retirement/conversion income — narrower than real law, but only matters
  > when tier-2 has leftover room AND the filer has other taxable income.
- Full brackets (2026): 1.99% to $30k; 5.21% above.

#### Arkansas — ✅ rate confirmed, "verify locally" hedge resolved June 2026

- **3.9% confirmed** (AR DFA, down from 4.4%; top rate at low income ~$25,700).
  Removed the old note's "verify locally" hedge with primary sources.
- $6,000 retirement exemption **covers traditional IRA but only at 59½+** (early
  distributions disqualified); AR DFA confirms a Roth conversion is taxable in the
  conversion year. Social Security is not taxed at all. Source:
  [AR DFA Subject 206](https://www.arkansas.gov/dfa/income_tax/documents/206-PensionsandAnnuities.pdf).
  > **Fixed 2026-10-21:** this entry and `states.json` said Social Security was
  > exempt only below $100k AGI, and Relocation taxed 85% of benefits above it. No
  > Arkansas source supports a threshold:
  > [AR DFA Subject 209](https://dfa.arkansas.gov/wp-content/uploads/209-NontaxableIncome.pdf)
  > lists Social Security and Railroad Retirement as nontaxable income.
- Full brackets: 0% to ~$5,500, graduated to 3.9% >~$25,700 (separate flatter
  schedule for net income >$94,700).
  > **Fixed 2026-08-24 (commit 136d868): the $6,000 exemption above was never**
  > **actually applied by the Roth calculator** (not in RETDED or RIX_STATES —
  > $0 shelter silently). Confirmed genuinely per-individual: "each spouse gets
  > their own $6,000 exemption... does not transfer between spouses" — a joint
  > return with both spouses 59.5+ shelters $12,000, not $6,000. `capJoint` in
  > states.json was also wrong (flat $6,000). Reshaped to the existing
  > ageTieredCap mechanism, found while auditing the same bug shape in LA.

### ✅ Flat-tax `ex:false` audits (June 2026)

Flat-rate states carry no top-bracket-overstatement risk, but several had stale
rates from 2025–26 cuts. Rates cross-checked against the Tax Foundation 2026 State
Income Tax Rates report and state sources.

- **Idaho** — **5.695% → 5.3%** (HB40, 2025, retroactive). SS exempt. Flat.
  > **Fixed 2026-10-21: the 0% band was missing.** [ISTC's 2025 rate schedule](https://tax.idaho.gov/taxes/income-tax/individual-income/individual-income-tax-rate-schedule/):
  > 0% on the first $4,811 single / $9,622 married, 5.3% above;
  > [Idaho Code 63-3024(2)](https://legislature.idaho.gov/statutesrules/idstat/title63/t63ch30/sect63-3024/)
  > treats head of household as a joint return. Worth $255 single / $510 joint a year
  > in Relocation; `roth.cr` unchanged.
- **Kentucky** — **4% → 3.5%** (Jan 1 2026 revenue trigger). SS exempt; modest
  retirement exclusion. Flat.
  > **Fixed 2026-08-24 (commit 136d868): the "modest retirement exclusion" above**
  > **($31,110, no age requirement) was never actually applied by the Roth**
  > calculator (not in RETDED or RIX_STATES — $0 shelter silently). Confirmed
  > genuinely per-individual via KY DOR's own Schedule P (separate "Yourself"/
  > "Spouse" columns, computed independently and combined for joint filers) —
  > a joint return with both spouses receiving qualifying income shelters
  > $62,220, not a flat $31,110. `capJoint` in states.json was also wrong (flat
  > $31,110). Reshaped to the existing ageTieredCap mechanism (single tier,
  > minAge:0, since KY has no age requirement at all).
- **North Carolina** — **4.5% → 3.99%** (final phasedown step Jan 1 2026; heading to
  2.99% by 2028). SS exempt. Flat.
- **Indiana** — **3.05% → 2.95%** (Jan 1 2026; → ~2.9% in 2027). SS exempt; some
  counties add local income tax. Flat.
- **Utah** — **4.65% → 4.5%** (recently cut). On the eight-state SS list (taxes SS
  with a phased credit); small retirement credit phases out with income. Flat.
  Cross-checked against SS disclosure — consistent.
  > **Fixed 2026-10-21:** 4.45% for tax years from 2026
  > ([S.B. 60, 2026 GS](https://le.utah.gov/Session/2026/bills/enrolled/SB0060.pdf),
  > 59-10-104(2)(b)); `roth.cr` 4.5% → 4.45%. Relocation's Social Security credit now
  > follows [59-10-1042](https://le.utah.gov/xcode/Title59/Chapter10/59-10-S1042.html)
  > as written — the rate times the taxable Social Security, less $0.025 per dollar of
  > modified AGI over $54,000 single or $90,000 joint **and head of household** —
  > replacing a generic phase-in band; head of household had the $54,000 threshold.
- **Colorado** — **4.4% confirmed.** Pension/annuity subtraction ($20k at 55–64,
  $24k at 65+) covers IRA/conversion income but **excludes pre-59½ early
  distributions** (CO DOR, primary source). Fully exempts SS at 65+ (on SS list;
  consistent). TABOR can reduce the effective rate. Source:
  [CO DOR pension/annuity topics](https://tax.colorado.gov/income-tax-topics-social-security-pensions-and-annuities).
  > **Built 2026-08-24 (commit 4582c17), after a user check-in and an adversarial
  > review pass**: modeled the age/AGI-conditional shared SS/pension cap flagged
  > below as `sharesRetirementCap` in `relo-engine.mjs` — SS and pension/IRA now
  > share ONE combined age-tiered cap ($20k/$24k), confirmed word-for-word against
  > CO DOR's guide: "Any subtraction claimed for Social Security benefits will
  > reduce the subtraction an individual can claim for any other pension and
  > annuity income." At 65+, SS is subtracted in full (uncapped), reducing room
  > left for pension/IRA; at 55-64 the same applies only under the AGI threshold,
  > otherwise SS+pension/IRA together are capped at $20,000 combined; under 55,
  > neither gets any subtraction. A joint return conservatively requires BOTH
  > spouses to individually qualify for the uncapped tier (no per-spouse SS split
  > modeled) before falling through to the shared-cap branch.
  > **Fixed 2026-08-24: the age-tiered shape described above was documented in
  > this file's prose but never actually MODELED.** `states.json` had a flat
  > `$24,000` cap for all qualifying ages (`cliffType:"hard"`), and — worse —
  > Colorado was missing from `_dev/gen-st-table.mjs`'s `RIX_STATES` allowlist
  > entirely, so the Roth calculator's generated `RIX` table had no CO entry at
  > all and applied **zero** shelter from this deduction (worse than the
  > flat-cap bug: a 60-year-old with a $30,000 pension went from a wrongly
  > sheltered $6,000 taxable to a correct $10,000 taxable under the real
  > 55–64 tier). Reshaped to `ageTieredCap`/`perPersonTiers` (same mechanism
  > already used by GA/WI) and added to `RIX_STATES`. Also confirmed via the
  > same source: below 65, Colorado's Social Security exemption is
  > age/AGI-conditional (full exemption at 55–64 only under $75k single/$95k
  > joint AGI, otherwise SS shares the same $20,000 cap with pension/annuity
  > income; no exemption at all under 55) — disclosed in the `ssTreatment`
  > note but **not modeled**, since this tool's `socialSecurity` field only
  > drives the Relocation tool's calculation, not Roth's, and the shared cap
  > would need new engine mechanism similar to the CT/NM/MT additions this
  > session. Flagged for a future fix, not built.
- **Massachusetts** — **5% confirmed**, no retirement exclusion (IRA/401(k) fully
  taxed). SS exempt.
  > **Fixed 2026-08-24: the 4% surtax was disclosed in the note but never
  > MODELED.** A conversion that pushed total income well past $1M was still
  > taxed at a flat 5%, no surtax added — found live (income $900k + $300k
  > conversion, i.e. $1.2M total, computed as flat 5% with $0 surtax). Now
  > applies the extra 4% to the portion of income above the threshold (9% total
  > on the excess, 5% below it), same before/with-delta pattern as the Ohio
  > zero-bracket special case.
  > **Threshold precision — resolved 2026-08-24.** Initially shipped with
  > $1,000,000 (the constitutional amendment's original, un-indexed figure)
  > because mass.gov blocked every direct fetch (403 on the surtax info page,
  > DOR forms, and the TIR page) and secondary sources disagreed with each
  > other ($1,107,750 vs. $1,107,950) with no traceable DOR citation. Resolved
  > by reading mass.gov's own "4% Surtax on Taxable Income" page through an
  > archive.org snapshot (dated 2026-07-27, since archive.org itself isn't
  > blocked): DOR states plainly "The surtax threshold for: Tax year 2026 is
  > **$1,107,750**" (2025: $1,083,150; 2024: $1,053,750; 2023: $1,000,000).
  > Now the primary-sourced figure. **Still unconfirmed:** whether the
  > threshold is the same for every filing status or doubles for MFJ —
  > implemented as the same threshold regardless of status. mass.gov does
  > confirm MFJ couples subject to the surtax must file jointly in
  > Massachusetts with no exception (consistent with a single combined
  > threshold, not doubled), but doesn't explicitly rule out doubling — see
  > `roth-ny-ma-state-tax-fixes.md` and `roth-ma-surtax-threshold-fix.md`
  > project memory.
  > **Fixed 2026-10-25 (fix-pack 12):** the Relocation data (`taxRules`, which the Roth
  > tool now computes from) still started the 9% band at $1,000,000; it now starts at
  > $1,107,750, confirmed again in the DOR's
  > [2026 Form 1-ES](https://www.mass.gov/doc/2026-form-1-es-estimated-tax-payment-vouchers-instructions-and-worksheets/download):
  > "The surtax threshold for tax year 2026 is $1,107,750." The threshold applies to
  > taxable income, after the $4,400 exemption ($700 more at 65).
- **North Dakota** — **2.5% top confirmed** (0% bottom bracket; among the lowest
  conversion taxes anywhere). SS exempt.
- **Arizona** — **2.5% flat confirmed** (lowest flat rate nationally). SS exempt.
  > **Added 2026-10-21 (Relocation):** Arizona's 25% subtraction of net long-term
  > capital gain from assets acquired after 2011
  > ([2025 Form 140 instructions](https://azdor.gov/sites/default/files/document/FORMS_INDIVIDUAL_2025_140i.pdf),
  > lines 20–24) is now applied; gains were taxed in full.

### ✅ AUDIT COMPLETE — all 50 states + DC primary-sourced (June 2026)

**Count correction (discovered during extraction prep):** earlier records cited
"54 entries," but that number came from `grep -c "ex:true\|ex:false"`, which counted
the **52 real table entries** (50 states + DC + 1 blank "no state selected"
placeholder) PLUS **2 incidental `ex:false` fallbacks** in helper functions
(`ST[code]||{...ex:false}` at ~lines 1136 and 1986). The true table contents are
**50 states + DC = 51 real entries + 1 placeholder = 52 entries.** A structural
parse (`_dev/parse-states.mjs`) confirms all 50 states + DC present, none missing
or duplicated. The audit work is unaffected — every state was edited by key/name
and visually confirmed, never by position — but the count we should cite going
forward is **50 states + DC**, and the grep-count guard happened to flag deletions
correctly only by arithmetic coincidence (52 + 2 = 54; losing a state dropped it to
53). The extraction guard replaces that grep with a structural check.

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

## Relocation (`relocation/relo-engine.mjs`, `relocation/SCHEMA.md`)

The state-vs-state income-tax comparison is computed from two layers
inside `roth-conversion/states.json`, both keyed alongside (not inside) each state's
existing `facts` block:

**`taxRules` (Tier 1 — computed into the headline breakeven)** — bracket schedules
for all four filing statuses, plus per-source income treatment (Social Security
taxability, IRA/401(k) withdrawal exclusions and age gates, pension income, capital
gains treatment). The bracket schedules themselves are the *same* federal-adjacent,
primary-source-verified data already checked in the Roth section above — a schema
guard (`_dev/check-states-json.mjs`, "G2") enforces that `facts.brackets` and
`taxRules.bracketsByStatus.single` stay identical, so the two representations can't
silently drift apart.

The income-source-treatment rules (the part that's genuinely new to Relocation, not
inherited from Roth) have their own regression suite, `_dev/test-relo-exclusions.mjs`
— 47 checks against exact figures pulled from primary-source state DOR worksheets
and instructions, covering real bugs caught and fixed along the way: NJ and CT's
retirement-income cliffs were originally modeled as flat/linear when the real rules
are stepped multi-tier tables; Michigan's exclusion cap was stale by about $1,600;
Wisconsin's age-tiered joint cap requires *both* spouses 67+, not a flat doubling;
Virginia's per-person cap phases out by filing status, not spouse count. ✅ for the
states this suite covers (MI, GA, WI, NM, SC, VA, WV, NJ, CT, plus the states whose
figures the suite cross-checks against Roth's own already-verified numbers); ⚠️ for
the rest of the 51, which use the general flat-exclusion shape without a dedicated
regression check per state.

**2026-10-21 pass — `_dev/test-relo-state-data.mjs`** (34 checks, each worked by hand
from the state's own schedule or statute; 33 fail on the previous build):
- **Data:** NY, MS and UT rates moved to TY2026; HI to its schedule for tax years
  after 2024; ID's 0% band added; MT's head-of-household band and WV's MFS bands
  corrected; AR Social Security made nontaxable; RI's pension cliff applied (each
  state's entry above has the details and sources).
- **Capital gains:** a new `stacked` treatment taxes gains on their own ladder on top
  of other income (MT 3.0% / 4.1%, HI capped at 7.25%); AZ's 25% and VT's $5,000
  exclusions added; NM's $2,500 flat deduction now applies to portfolio gains.
- **Social Security:** the engine now starts from federal AGI and the federally
  taxable part of the benefit (it used 85% of the benefit and income plus the whole
  benefit), with each state's own phase-out: VT a straight line over $10,000, MN 10%
  per $4,000 step, UT a credit reduced $0.025 per dollar. CT and UT head of household
  use the joint threshold. The same federal AGI now feeds the retirement-exclusion
  thresholds (CT, NM, CO), as the Roth tool's call already did.
- **Standard deductions, personal exemptions, and exemption credits** were added
  2026-10-21 (`taxRules.standardDeduction`) and corrected 2026-10-22; see the next
  section.

**2026-10-22 pass — deductions, exemptions and credits (`_dev/test-relo-std-deductions.mjs`,
87 checks, each worked by hand from the state's own form or instructions; 57 fail on the
2026-10-21 build).** Figures are each state's latest published year: **2026** for ME, MN,
NE, OR, RI, KY, SC, DC and WI (the state has published them), **2025** for the rest.
Personal exemptions are folded into `deduction` wherever they share its phase-out (or have
none). Dependents (including a head of household's qualifying person), itemized deductions
and refundable credits are not modeled anywhere.

**Fix-pack 11 (2026-10-22): the last five states and the federal tax subtractions.** AL, CT,
OH, UT and WI had no deductions or credits at all (`_dev/test-relo-state-credits.mjs`, 44
checks, 42 fail before); AL, MO and OR now subtract federal income tax
(`_dev/test-relo-federal-tax.mjs`, 41 checks). The Relocation page's California preset
income (joint, both 68) moved from: UT $3,253 to $1,938, WI $665 to $0, CT $400 to $0, AL
$1,820 to $1,217, OR $4,285 to $3,929, OH $1,209 to $840, MO $1,013 to $985.

Engine (`relocation/relo-engine.mjs`):
- A joint return with no `spouseAge` counts the spouse at the filer's age, as the rest of
  the engine does; the page passes no `spouseAge`, so a couple both 65+ had been getting
  one age add-on or credit, not two (California preset: $612 shown, $459 owed).
- Married filing separately takes the *married* age add-on, as on the federal return.
- Phase-outs: `linear` (ME, SC) and `bands` (MD's exemption steps, RI's 20% steps, and
  the OR credit and IL exemption cutoffs), on federal AGI or the state's own AGI. Added
  for fix-pack 11: `steps` (CT's exemption, AL's standard deduction chart), `rate` (WI's
  standard deduction, UT's credit), and bands that set an amount (OH's exemption) or test
  "at least" (OR's federal tax limit, as its table reads).
- Federal enhanced deduction for seniors (`federalSeniorDeduction`): $6,000 per person
  65+, less 6% of modified AGI over $75,000 ($150,000 joint) off each person's $6,000;
  none for married filing separately (IRC 151(d)(5)(C);
  [Schedule 1-A Part V](https://www.irs.gov/pub/irs-pdf/f1040s1a.pdf);
  [IRS publication 6142](https://www.irs.gov/pub/irs-pdf/p6142.pdf)). Applies only where
  the state starts from federal taxable income or adopted it: CO, ID, IA, MT, ND.
- Stacked capital gains (MT, HI): deductions left over after the other income now reduce
  the gains (they were dropped).
- Local taxes (NYC, OR Metro/Multnomah, MD and IN county) are figured on the state's
  taxable income, after deductions, as each is levied (they used income before them).
- Federal income tax subtraction (`federalTaxDeduction`, AL, MO, OR; added for fix-pack
  11): the engine estimates federal income tax from the same income vector with the 2026
  figures the Roth tool uses (brackets, 0/15/20% gains rates stacked on top, standard
  deduction with the extra amount at 65, senior deduction; `FEDERAL_2026`, held equal to
  the Roth tool's by `_dev/test-relo-federal-tax.mjs`). AL's and MO's own figures are 2025,
  when federal tax ran a little higher, so their subtraction can come out slightly low (the
  state tax slightly high), never the reverse; likewise for the other federal taxes some
  states count that the estimate leaves out (the 10% additional tax on early IRA withdrawals).
- Credits list (`credits`, fix-pack 11): CT's personal credit (a share of the tax by CT AGI),
  UT's taxpayer credit (6% of the federal standard deduction, phased out), and OH's
  retirement income, senior and exemption credits, taken off the bracket tax with the
  exemption credits and floored at zero together.

| State | Year | Figures | Source |
|---|---|---|---|
| AL | 2025 | Std by Alabama AGI: $8,500 joint to $25,999, $175 less per $500 to $5,000 from $35,500; single $3,000 less $25, head of family $5,200 less $135, both to $2,500; separate $4,250 to $12,999, $88 less per $250 to $2,500 from $17,750. Exemption $1,500 ($3,000 joint, head of family). All federal income tax, with the net investment income tax | [Form 40 booklet](https://www.revenue.alabama.gov/wp-content/uploads/2026/01/25f40bk.pdf) (chart p. 8–9; worksheet p. 31) |
| AR | 2025 | Std $2,470 ($4,940 joint); $29 credit each, +$29 head of household, +$29 per 65+ | [AR1000F/NR instructions](https://www.dfa.arkansas.gov/wp-content/uploads/2025_AR1000F_and_AR1000NR_Instructions.pdf) |
| AZ | 2025 | Std $15,750 / $31,500 / $23,625 HoH; $2,100 per person 65+ (line 38) | [Form 140 instructions](https://azdor.gov/sites/default/files/document/FORMS_INDIVIDUAL_2025_140i.pdf) |
| CA | 2025 | Std $5,706 / $11,412 (joint, HoH); $153 credit each + $153 per 65+ | [FTB standard deduction](https://www.ftb.ca.gov/file/personal/deductions/index.html), [540 booklet](https://www.ftb.ca.gov/forms/2025/2025-540-booklet.html) |
| CO | 2025 | Federal std + add-on; senior deduction (flows through federal taxable income) | [DR 0104 booklet](https://tax.colorado.gov/sites/default/files/documents/Book104_2025.pdf), [Legislative Council OBBBA memo](https://content.leg.colorado.gov/sites/default/files/images/lcs_june_2025_forecast_updated_with_obbba_fiscal_impacts.pdf) |
| CT | 2025 | Exemption $15,000 / $24,000 joint / $12,000 separate / $19,000 HoH, $1,000 less per $1,000 (or part) of CT AGI over $30,000 / $48,000 / $24,000 / $38,000; personal credit 75% down to 1% of the tax by CT AGI, none over $64,500 / $100,500 / $52,500 / $78,500 (statutory, not indexed; the 2% bracket phase-out and recapture, Tables C and D, aren't modeled) | [CGS 12-702, 12-703](https://www.cga.ct.gov/current/pub/chap_229.htm), [CT-1040 TCS 2025](https://portal.ct.gov/-/media/drs/forms/2025/income/ct-1040-tcs_1225.pdf) Tables A and E |
| DC | 2026 | Std $16,100 / $32,200 / $24,150 HoH; +$2,050 unmarried / $1,650 married per 65+ | [2026 D-40ES](https://otr.cfo.dc.gov/sites/default/files/dc/sites/otr/publication/attachments/2026_D40ES_Book_wLinks04012026.pdf) |
| DE | 2025 | Std $3,250 ($6,500 joint); +$2,500 per 65+; $110 credit each + $110 per person 60+ | [PIT-RES instructions](https://revenuefiles.delaware.gov/2025/PITForms_Instructions/Instructions/PIT-RES_Instructions_2025-01.pdf) |
| GA | 2025 | Std $12,000 ($24,000 joint); no age add-on | [IT-511](https://dor.georgia.gov/document/document/2025-it-511-individual-income-tax-booklet/download), [DOR](https://dor.georgia.gov/georgia-standard-deductions-increases) |
| HI | 2025 | Std $4,400 / $8,800 / $6,424 HoH + $1,144 exemption each; +$1,144 per 65+ | [N-11 instructions](https://files.hawaii.gov/tax/forms/current/n11ins.pdf) |
| IA | 2025 | Federal std + add-on + senior deduction; $40 credit each (2 for HoH) + $20 per 65+ | [IDR conformity](https://revenue.iowa.gov/taxes/tax-guidance/individual-income-tax/1040-expanded-instructions/conformity-irc), [exemption credits](https://revenue.iowa.gov/taxes/tax-guidance/individual-income-tax/1040-expanded-instructions/exemption-credits) |
| ID | 2025 | Federal std + add-on + senior deduction (HB 559) | [ISTC](https://tax.idaho.gov/pressrelease/update-on-filing-2025-idaho-income-taxes-now-that-conformity-is-law/), [ISTC](https://tax.idaho.gov/pressrelease/file-now-to-get-your-conformity-deductions/) |
| IL | 2025 | $2,850 each + $1,000 per 65+; none above federal AGI $250,000 ($500,000 joint) | [IL-1040 Step 4](https://tax.illinois.gov/forms/incometax/currentyear/individual/il-1040-instr/step-4---exemptions.html) |
| IN | 2025 | $1,000 each + $1,000 per 65+ | [DOR seniors](https://www.in.gov/dor/i-am-a/individual/seniors) |
| KS | 2025 | Std $3,605 / $8,240 / $4,120 MFS / $6,180 HoH; exemption $9,160 each, +$2,320 HoH; +$850 unmarried / $700 married per 65+ | [KDOR booklet](https://www.ksrevenue.gov/incomebook25.html) |
| KY | 2026 | Std $3,360 per return (one on a joint return; a combined separate return, not modeled, gets two); $40 credit per 65+ | [DOR 2026](https://revenue.ky.gov/News/Pages/Kentucky-DOR-Announces-2026-Standard-Deduction.aspx), [740 instructions](https://revenue.ky.gov/Forms/740%20Packet%20Instructions.pdf), [Schedule ITC](https://revenue.ky.gov/Forms/Schedule%20ITC%20(2025).pdf) |
| LA | 2025 | Std $12,500 ($25,000 joint, HoH); the 65+ add-ons were repealed | [LDR](https://revenue.louisiana.gov/tax-education-and-faqs/faqs/income-tax-reform/are-there-any-changes-to-the-combined-personal-exemption-standard-deduction/), [LDR](https://revenue.louisiana.gov/tax-education-and-faqs/faqs/income-tax-reform/can-i-still-claim-the-additional-1-000-deduction-for-the-blind-persons-65-and-dependents/) |
| MA | 2025 | $4,400 / $8,800 / $6,800 HoH; +$700 per 65+ | [DOR](https://www.mass.gov/info-details/massachusetts-personal-income-tax-exemptions) |
| MD | 2025 | Std $3,350 ($6,700 joint, HoH); exemption $3,200 each, stepping down by federal AGI (single over $100,000, joint over $150,000); +$1,000 per 65+ | [resident booklet](https://www.marylandcomptroller.gov/content/dam/mdcomp/tax/instructions/2025/resident-booklet.pdf), [tax alert](https://www.marylandcomptroller.gov/content/dam/mdcomp/tax/legal-publications/alerts/tax-alert-changes-to-standard-and-itemized-deductions-and-to-state-and-local-income-tax-rates-from-the-2025-legislative-session.pdf) |
| ME | 2026 | Std $15,700 / $31,400 / $23,550 HoH, +$2,050 / $1,650 per 65+, phased out over Maine AGI from $102,250 single; exemption $5,300 each, phased out from $341,000 single; new 2% surcharge over $1M single (9.15% band) | [rate schedules](https://www.maine.gov/revenue/sites/maine.gov.revenue/files/2026-05/ind_tax_rate_sched_2026_rev.pdf), [std ded worksheet](https://www.maine.gov/revenue/sites/maine.gov.revenue/files/inline-files/26_item_stand_%20ded_phaseout_wksht_0.pdf), [exemption worksheet](https://www.maine.gov/revenue/sites/maine.gov.revenue/files/inline-files/26_1040es_pers_exempt_phaseout_wksht.pdf) |
| MI | 2026 | $5,900 each ($5,800 for 2025) | [Form 446 (2026)](https://www.michigan.gov/taxes/-/media/Project/Websites/taxes/Forms/SUW/TY2026/446_Withholding-Guide_2026.pdf) ("Personal Exemption Amount: $5,900"), [Treasury](https://www.michigan.gov/taxes/questions/iit/accordion/filing/what-are-the-current-tax-rate-and-exemption-amounts-1) (2025) |
| MN | 2026 | Std $15,300 / $30,600 / $23,000 HoH; +$2,000 unmarried / $1,600 married per 65+ | [DOR 2026 amounts](https://www.revenue.state.mn.us/sites/default/files/2025-12/inflation-adjusted-amounts-2026.pdf) |
| MO | 2025 | Federal std + add-on (no senior deduction); federal income tax x 35% / 25% / 15% / 5% / 0% for Missouri AGI to $25,000 / $50,000 / $100,000 / $125,000 / over, at most $5,000 ($10,000 joint) | [DOR 4711](https://dor.mo.gov/forms/4711_2025.pdf), [MO-1040 instructions](https://dor.mo.gov/forms/MO-1040%20Instructions_2025.pdf) (lines 9–13) |
| MS | 2025 | Exemption $6,000 / $12,000 / $8,000 head of family + std $2,300 / $4,600 / $3,400; +$1,500 per 65+ | [DOR](https://www.dor.ms.gov/general-information) |
| MT | 2025 | Federal std + add-on + senior deduction, + Montana's $5,660 per person 65+ | [Form 2 instructions](https://revenuefiles.mt.gov/files/Forms/Montana-Individual-Income-Tax-Return-Form-2-Instructions/2025_Montana_Individual_Income_Tax_Return_Form_2_Instructions.pdf), [Pub 1 2026](https://revenuefiles.mt.gov/files/Forms/Publication-1/Publication-1-2026.pdf) |
| NC | 2025 | Std $12,750 / $25,500 / $19,125 HoH; no age add-on | [NCDOR](https://www.ncdor.gov/taxes-forms/individual-income-tax/filing-topics/north-carolina-standard-deduction-or-north-carolina-itemized-deductions) |
| ND | 2025 | Federal std + add-on + senior deduction (starts from federal taxable income) | [ND-1](https://www.tax.nd.gov/sites/www/files/documents/forms/individual/2025-iit/28702-form-nd-1-2025.pdf) |
| NE | 2026 | Std $8,850 / $17,700 / $12,950 HoH; +$2,050 / $1,700 per 65+; $176 credit each | [2026 1040N-ES](https://revenue.nebraska.gov/sites/default/files/doc/tax-forms/2025/f_1040N-ES.pdf) |
| NJ | 2025 | $1,000 each + $1,000 per 65+ | [Division of Taxation](https://www.nj.gov/treasury/taxation/njit13.shtml) |
| NM | 2025 | Federal std + add-on (line 12; not the senior deduction) | [PIT-1 instructions](https://realfile.tax.newmexico.gov/2025pit-1-ins.pdf) |
| OH | 2025 | Exemption each by Ohio MAGI: $2,400 to $40,000, $2,150 to $80,000, $1,900 below $750,000, none above. While MAGI less exemptions is under $100,000: retirement income credit by the pension and IRA income in Ohio AGI ($25 over $500 up to $200 over $8,000, a return) and $50 senior credit (65+, a return); $20 each under $30,000. The joint filing credit needs each spouse's income: not modeled | [IT 1040 booklet](https://dam.assets.ohio.gov/image/upload/v1767095693/tax.ohio.gov/forms/ohio_individual/individual/2025/it1040-booklet.pdf) (exemption table; Schedule of Credits lines 2, 4, 9; Table 2) |
| NY | 2025 | Std $8,000 / $16,050 / $11,200 HoH | [DTF](https://www.tax.ny.gov/pit/file/standard_deductions.htm) |
| OK | 2025 | Std $6,350 / $12,700 / $9,350 HoH + $1,000 exemption each | [511 packet](https://oklahoma.gov/content/dam/ok/en/tax/documents/forms/individuals/current/511-Pkt.pdf), [OTC](https://oklahoma.gov/tax/individuals/exemptions.html) |
| OR | 2026 | Std $2,900 / $5,800 / $4,650 HoH; +$1,200 single, HoH / $1,000 others per 65+; $260 credit each, none above federal AGI $100,000 single ($200,000 joint, HoH); federal income tax up to $8,750 ($4,375 separate), the limit 80/60/40/20/0% at federal AGI of $125,000/130,000/135,000/140,000/145,000 or more ($250,000–$290,000 joint, HoH) | [OR-ESTIMATE 2026](https://www.oregon.gov/dor/forms/FormsPubs/publication-or-estimate_101-026_2026.pdf), [OR-40 instructions 2025](https://www.oregon.gov/dor/forms/FormsPubs/form-or-40-inst_101-040-1_2025.pdf) (Table 4), [ORS 316.695(3)](https://www.oregonlegislature.gov/bills_laws/ors/ors316.html) |
| RI | 2026 | Std $11,200 / $22,400 / $16,800 HoH + $5,250 exemption each, both phased out in 20% steps over federal AGI $261,000-$290,800 | [ADV 2025-22](https://tax.ri.gov/sites/g/files/xkgbur541/files/2025-11/ADV_2025_22_Inflation_Adjustments.pdf), [2025 worksheets](https://tax.ri.gov/sites/g/files/xkgbur541/files/2025-10/2025%20Tax%20Rate%20and%20Worksheets_d.pdf) |
| UT | 2025 | No deduction: taxpayer credit of 6% x (federal std $15,750 / $31,500 / $23,625 HoH + $2,000 unmarried / $1,600 married per 65+), less 1.3% of Utah income over $18,213 single and separate, $36,426 joint, $27,320 HoH | [TC-40 instructions](https://files.tax.utah.gov/tax/forms/current/tc-40inst.pdf) (lines 11–20), UCA 59-10-1018 |
| WI | 2026 | Std $13,960 / $25,840 / $12,280 separate / $18,030 HoH, less 12% / 19.778% / 19.778% / 22.515% of Wisconsin income over $20,120 / $29,040 / $13,780 / $20,120 (HoH then follows the single formula from $58,827); exemptions $700 each + $250 per 65+ | [2026 Form 1-ES instructions](https://www.revenue.wi.gov/TaxForms2026/2026-Form1-ES-Inst.pdf) |
| SC | 2026 | SCIAD $15,000 / $30,000 / $22,500 HoH, phased out on federal AGI (single $40,000-$95,000; joint $80,000-$190,000); replaces the federal deduction and its age add-on | [SCDOR legislation 2026](https://dor.sc.gov/administrative-legislative-regulations-tax-legislation-update-2026), [SCDOR H.4216](https://dor.sc.gov/news/information-about-h-4216) |
| VA | 2025 | Std $8,750 ($17,500 joint) + $930 exemption each; +$800 per 65+ | [Form 760 instructions](https://www.tax.virginia.gov/sites/default/files/vatax-pdf/2025-760-instructions.pdf) |
| VT | 2025 | Std $7,650 / $15,300 / $11,450 HoH + $5,300 exemption each; +$1,250 per 65+ | [income booklet](https://tax.vermont.gov/sites/tax/files/documents/Income-Booklet-2025.pdf) |
| WV | 2025 | $2,000 each | [IT-140 instructions](https://tax.wv.gov/Documents/PIT/2025/it140.PersonalIncomeTaxFormsAndInstructions.2025.pdf) |

Federal figures (2025, [IRS Pub 554](https://www.irs.gov/publications/p554)): $15,750 single /
$31,500 joint / $23,625 HoH; add-on $2,000 unmarried, $1,600 married, per person 65+.

**Not modeled (disclosed on the page):**
- OH's joint filing credit (20% down to 5% of the tax, up to $650; it needs each spouse's
  own income, which the page doesn't ask for). CT's 2% bracket phase-out and benefit
  recapture (CT-1040 TCS Tables C and D), which start at CT AGI over $56,500 single
  ($100,500 joint).
- High-income limits: CA's credit phase-out, MN's standard deduction phase-out (AGI over
  $244,400), CO's deduction addback (federal AGI over $300,000), VT's 3% minimum tax
  (federal AGI over $150,000), MD's 2% tax on capital gains (federal AGI over $350,000).
- Low-income extras, among them IN's $500 (65+, federal AGI under $40,000), OK's $1,000
  (65+, federal AGI up to $25,000 joint), NM's 65+ and low- and middle-income exemptions
  and AR's "65 Special" credit; and KY's combined separate return for couples.

**`taxContext` (Tier 2 — disclosed alongside the headline, never computed into it)**
— sales tax rate, median property tax rate, estate/inheritance tax flag. ⚠️ **NOT
value-verified.** The schema guard only checks that these fields are *present and
correctly typed* ("G3 — light — not value verification" per the guard's own
comment) — no primary-source pass has been run against Tax Foundation, Census, or
state DOR figures for this layer. This is the same category of gap as the Roth
state table above, and the tool's own design keeps it low-stakes by construction:
Tier 2 numbers are shown as disclosed, clearly-labeled estimates and are
structurally barred from ever feeding the precise headline crossover.

**North Carolina pensions, 2026-10-27.** North Carolina taxes pensions like other retirement
income here. It exempts government pensions only for retirees with five or more years of
service by August 12, 1989
([NCDOR, Bailey](https://www.ncdor.gov/taxes-forms/individual-income-tax/bailey-decision-concerning-federal-state-and-local-retirement-benefits)),
and military retirement pay only after 20 or more years or a medical retirement
([NCDOR, military retirement](https://NCDOR.gov/military-retirement)); neither is modeled.
House Bill 387 (2025), which would have exempted North Carolina and federal government
pensions, was referred to committee on March 13, 2025 and not enacted
([UNC School of Government bill page](https://lrs.sog.unc.edu/bill/eliminate-tax-govt-retirees-2)).
The $2,000 private-pension deduction ended with tax year 2014
([NCDOR, 2014 individual income tax changes](https://www.ncdor.gov/documents/policies/2014-individual-income-tax-changes/open)).
Tests: `_dev/test-relo-exclusions.mjs` section 22.

**Scope note:** county/municipal/city income taxes, sub-state property-tax variation
beyond the state median, vehicle/excise/registration taxes, and editorial
"tax-friendliness" scores are deliberately not modeled — stated directly in
`relocation/SCHEMA.md`'s design principles as a disclosed stop line, not an oversight.

---

## Medicare: Medigap vs. Medicare Advantage (`medicare/medicare-engine.mjs`, `medicare/states.json`)

The three national constants the breakeven math runs on:

| Constant | Value | Source | Status |
|---|---|---|---|
| Part B deductible (2026) | $283/year | [CMS 2026 Parts A&B fact sheet](https://www.cms.gov/newsroom/fact-sheets/2026-medicare-parts-b-premiums-deductibles) | ✅ (same fact sheet already verified for IRMAA above) |
| Medicare Advantage OOP ceiling (2026) | $9,250 in-network / $13,900 combined | CMS-set cap, confirmed via KFF and CMS's own MA out-of-pocket-limits page | ⚠️ found via WebSearch, not read directly from the CMS page itself |
| Standard Part B coinsurance | 20% | Well-established Medicare structural fact (Social Security Act §1833(a)) | ⚠️ not traced to a specific 2026 primary-source page; treated as a stable structural constant, unlikely to be the softer spot here |

**State-by-state regulatory data (rating method + guaranteed-issue rights, all 51
jurisdictions)** is deliberately *not* duplicated into this file — it has its own,
more granular confidence-tagging system (`PRIMARY` / `OFFICIAL-SUMMARY` /
`SECONDARY-CORROBORATED` / `UNVERIFIED`) directly inside `medicare/states.json` and
`_dev/medicare-research-2026-08.md`, since per-state citations and per-fact caveats
don't compress well into this file's per-tool checklist format. As of 2026-08-20,
West Virginia, Illinois, Rhode Island, and Maine are read direct from primary
statute/bill text (`PRIMARY`); most other states remain `SECONDARY-CORROBORATED`.
Missouri's rating method is `UNVERIFIED` on purpose — sources conflict and no
statute was found either way, so no guess was encoded.

**Switching rights corrected, 2026-10-27.** Massachusetts guarantees an annual February 1
to March 31 window, coverage from June 1; insurers may enroll at other times or year-round,
but that isn't guaranteed ([211 CMR 71.10](https://law.cornell.edu/regulations/massachusetts/211-CMR-71-10),
(5)(a), (8), (9)). Minnesota's open enrollment from August 1, 2026 is for first-time Medigap
applicants aged 65 to 70, October 15 to December 7 and January 1 to March 31, with a surcharge
of 15% (2026) rising 5 points a year to 35% (2030 on)
([Commerce Department Administrative Bulletin 2026-3](https://mn.gov/commerce-stat/insurance/industry/bulletins/2026/administrative_bulletin_2026-3.pdf)).
Washington's replaceable plan group is B, C, D, F, G (and high-deductible F and G), K, L, M
and N ([RCW 48.66.045](https://lawfilesext.leg.wa.gov/Law/RCW/RCW%20%2048%20%20TITLE/RCW%20%2048%20.%2066%20%20CHAPTER/RCW%20%2048%20.%2066%20.045.htm)).
Plans C and F are closed to people first eligible for Medicare on or after January 1, 2020,
not to every later enrollment ([Idaho Department of Insurance](https://doi.idaho.gov/shiba/new-to-medicare/medicare-supplement-medigap/)).
Tests: `_dev/test-medicare-engine.mjs`.

**Scope note:** employer-retiree-coverage-change guaranteed issue (28 states, added
2026-08-20 — see research doc section 12) is modeled as Yes/No only: the right's
existence is sourced to KFF's state survey, but window length, insurer scope, and
benefit-level detail were not independently confirmed per state and are left
unset rather than guessed, same `SECONDARY-CORROBORATED` discipline as everything
else in this file that isn't traced to a primary source. Also not modeled:
prescription drug coverage on the Advantage side, or plan-letter-specific
cost-sharing detail (e.g., Plan N's small office-visit copays). All stated in the
tool's own on-page disclosure.

---

## Edge-input robustness — ✅ verified June 2026

Both calculator compute functions were stress-tested against degenerate inputs
(zeros, identical values, extreme rates, inverted earners, huge values): no
NaN, no Infinity, no exceptions. The UI controls also bound inputs to sane
ranges.

---

## Life insurance (`life-insurance/life-engine.mjs`)

| Constant | Value | Source | Status |
|---|---|---|---|
| Retirement earnings test exempt amount (2026) | $24,480 | [SSA OACT COLA page](https://www.ssa.gov/oact/cola/rtea.html) | ✅ |
| Child survivor benefit eligibility, 75% amount, caregiver benefit ending at child's 16th birthday, family maximum range | Per SSA statement | [SSA publication EN-05-10085](https://www.ssa.gov/pubs/EN-05-10085.pdf) | ✅ |
| Family-max treatment under earnings-test deductions (redistribution) | Per POMS | [SSA POMS RS 02501.155](https://secure.ssa.gov/poms.nsf/lnx/0302501155) | ✅ |
| Social Security statement survivor line items | Per sample statement SSA-7005 | [SSA sample statement](https://www.ssa.gov/myaccount/) | ✅ |
| Final expenses default ($15,000) | Median funeral ~$8,000 + estate settlement estimate | [National Funeral Directors Association (NFDA)](https://nfda.org/news/statistics) | ⚠️ Median funeral cost sourced from NFDA; estate settlement portion is an assumption |

**Assumptions (not sourced from a primary authority):**

| Assumption | Value | Rationale |
|---|---|---|
| Spending continuation share | 80% | ⚠️ Common financial planning assumption; actual varies by household |
| Take-home share of gross pay | 75% | ⚠️ Rough after-tax-and-deductions estimate |
| Discount rate | 2% | ⚠️ Roughly the historical real return on safe investments |
| Inflation | 2.5% | ⚠️ Long-run CPI average; converts future mortgage balances and fixed term-policy payouts to today's dollars |
| Minimum face amount | $100,000 | ⚠️ Reflects common insurer minimums |
| Ladder minimum savings threshold | 15% | ⚠️ Judgment call: each extra policy carries its own fee and can miss a price break |
| Retirement age | 65 | ⚠️ Common planning assumption |
| "10 times pay" rule of thumb | 10x gross salary | ⚠️ Widely cited in consumer finance; shown for comparison, not as a recommendation |

Policy sizing fixed for inflation 2026-10-22 — needs are in today's dollars,
but a term policy pays a fixed dollar amount. Faces were sized and charted as
if they kept today's value, so a suggested ladder's long policy came up short
in the years after the short one ended ($88,227 at year 15 in the "Two
earners, preschooler" example, at 2.5% inflation), and existing term policies
counted at full face in every year. Faces are now sized against each year's
need in that year's dollars, existing term policies are deflated, and the
"with suggested policies" line shows payouts in today's dollars. Employer
coverage (usually tied to pay) is still held at today's value. Tests:
`_dev/test-life-inflation.mjs`.

Breakdown itemized 2026-10-26 — the "if it happened today" breakdown showed
spending shortfalls as a remainder and never listed the years when the
survivor's pay and Social Security exceed costs, which the engine counts
toward what the family has, so its lines didn't add up to the gap (in the
default example when your spouse dies, they came to $379,906 against a
$270,259 gap).
The engine now returns each year's parts, and the page lists them with
totals that match the chart. A 0 in "If no children: years of living costs
to cover" had been read as the 10-year default. Tests:
`_dev/test-life-breakdown.mjs`.

---

## Annual re-verification checklist (do each tax year)

1. **Federal brackets + standard deduction** → new IRS Rev. Proc. (issued each fall for the next year).
2. **Senior deduction** → confirm still in effect (OBBBA provision runs 2025–2028) and the amount/phaseout.
3. **IRMAA** → new CMS "Medicare Parts A & B Premiums and Deductibles" fact sheet (issued each fall).
4. **RMD divisors** → only change if the IRS revises the Uniform Lifetime Table (rare).
5. **Social Security** → reduction formulas are statutory (rarely change); confirm FRA assumption still fits the audience.
6. **State rates** → the big annual chore; verify against a current source, prioritizing high-population states. Both tools compute from `taxRules`, so include its year-specific figures: indexed exemptions and thresholds (Michigan's exemption, Massachusetts' surtax start) and scheduled phase-ins (Connecticut's IRA share reached 100% in 2026).
7. Update **"Last full verification"** date at the top of this file.
