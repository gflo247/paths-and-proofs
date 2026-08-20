# Medicare (Medigap vs. Medicare Advantage) — research working doc

Status: **research only, not yet backing any live code.** This is the raw findings from
the discovery pass run 2026-08-19/20, written down before any schema or UI decisions,
per this project's standing rule to verify before encoding (see CLAUDE.md — "no
unsourced numbers"). Once the tool actually ships, settled citations here should
migrate into `SOURCES.md` proper, the way the Roth and Relocation research eventually
did. Until then this file is the single place tracking what's confirmed, what's
secondary-corroborated only, and what's still open.

## Scope decision (settled, see conversation 2026-08-19)

The tool will **not** assert a dollar premium for any state — there is no primary
source for actual Medigap premiums (they're insurer-set, vary by company/age/state,
no IRS-Rev-Proc equivalent exists). The user supplies their own real quoted premium,
same pattern as Roth's `retRate` field. The tool's value-add is correctly modeling the
**state regulatory rules** that shape how that premium behaves over time and what
switching rights exist — not guessing the premium itself.

## Confidence key

- **PRIMARY** — read the actual statute/regulation text or an official state/federal
  government page directly (via browser, not just a WebSearch summary).
- **OFFICIAL-SUMMARY** — confirmed via an official government page/press release, but
  the underlying statute text itself wasn't read directly.
- **SECONDARY-CORROBORATED** — confirmed only via WebSearch summaries of secondary
  sources (law firm blogs, insurance broker sites, aggregators), but a specific
  citation was named and multiple independent sources agree.
- **UNVERIFIED / CONFLICTING** — sources disagree or no citation was found. Do not
  encode as fact.

---

## 1. National CMS baseline (applies to all states unless noted)

### Medigap standardized benefit chart — PRIMARY
Source: medicare.gov/health-drug-plans/medigap/basics/compare-plan-benefits (read
directly via browser, 2026-08-19)

| Benefit | A | B | C | D | F* | G* | K | L | M | N |
|---|---|---|---|---|---|---|---|---|---|---|
| Part A coinsurance + 365 extra hospital days | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Part B coinsurance/copay | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 50% | 75% | ✓ | ✓*** |
| Blood (first 3 pints) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 50% | 75% | ✓ | ✓ |
| Part A hospice coinsurance/copay | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 50% | 75% | ✓ | ✓ |
| Skilled nursing facility coinsurance | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 50% | 75% | ✓ | ✓ |
| Part A deductible | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | 50% | 75% | 50% | ✓ |
| Part B deductible | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Part B excess charge | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Foreign travel emergency | ✗ | ✗ | 80% | 80% | 80% | 80% | ✗ | ✗ | 80% | 80% |
| Out-of-pocket limit (2026) | N/A | N/A | N/A | N/A | N/A | N/A | $8,000 | $4,000 | N/A | N/A |

Footnotes (from the same page): Plans C & F closed to anyone turning 65 on/after Jan 1,
2020. F/G high-deductible variant: $2,950 deductible (2026). K/L's out-of-pocket limit
only applies after *also* meeting the $283 Part B deductible. Plan N excludes copays on
some office/ER visits.

### Part A/B costs (2026) — OFFICIAL-SUMMARY
Source: CMS fact sheet, same one Roth cites
(cms.gov/newsroom/fact-sheets/2026-medicare-parts-b-and-d-premiums-and-deductibles),
confirmed via WebSearch of CMS's Nov 14, 2025 release, not read directly (medicare.gov
blocks WebFetch with 403; browser-fetch wasn't attempted for this specific page since
the figures matched Roth's already-verified numbers).

- Part A inpatient hospital deductible: $1,736
- Part A coinsurance: $434/day (days 61-90), $868/day (lifetime reserve days), $217/day
  (skilled nursing, days 21-100)
- Part B standard premium: $202.90/month
- Part B deductible: $283/year

### Medicare Advantage out-of-pocket ceiling (2026) — OFFICIAL-SUMMARY
CMS-set cap: $9,250 in-network / $13,900 combined. Confirmed via KFF and CMS's own MA
out-of-pocket-limits page (cms.gov/medicare/health-drug-plans/medigap/k-l-out-of-pocket-limits-announcements
surfaced in search results, not read directly).

### IRMAA — PRIMARY (reused)
Already fully sourced and verified in `roth-conversion/index.html`'s `ITIERS`/`ITHR`
tables. No new research needed — direct reuse.

---

## 2. States with their own benefit-standardization scheme (not the A-N system)

### Massachusetts — PRIMARY
Source: medicare.gov/health-drug-plans/medigap/basics/compare-plan-benefits/massachusetts,
read directly via browser (screenshot-verified for checkmark cells).

Three plans: **Core**, **Supplement 1**, **Supplement 1A**.

| Benefit | Core | Supp 1 | Supp 1A |
|---|---|---|---|
| Basic benefits (inpatient hosp, medical costs, blood, Part A hospice) | ✓ | ✓ | ✓ |
| Part A: inpatient hospital deductible | ✗ | ✓ | ✓ |
| Part A: skilled nursing facility coinsurance | ✗ | ✓ | ✓ |
| Part B: deductible | ✗ | ✓ | ✗ |
| Foreign travel emergency | ✗ | ✓ | ✓ |
| Inpatient mental health hospital days | 60/cal yr | 120/benefit yr | 120/benefit yr |
| State-mandated benefits (Pap/mammogram) | ✗ | ✓ | ✓ |

### Minnesota — PRIMARY
Source: medicare.gov/health-drug-plans/medigap/basics/compare-plan-benefits/minnesota,
read directly via browser.

Two plans: **Basic**, **Extended Basic** (insurers can add optional riders to Basic:
Part A deductible, Part B deductible, usual/customary fees, non-Medicare preventive
care). MN also offers its own versions of standard K/L/M/N, and a high-deductible F
version limited to those Medicare-eligible before Jan 1, 2020.

| Benefit | Basic | Extended Basic |
|---|---|---|
| Basic benefits | ✓ | ✓ |
| Part A: inpatient hospital deductible | ✗ | ✓ |
| Part A: SNF coinsurance | ✓ (100 days) | ✓ (120 days) |
| Part B: deductible | ✗ | ✓ |
| Foreign travel emergency | 80% | 80% |
| Outpatient mental health | 50% | 50% |
| Usual and customary fees | ✗ | 80% |
| Medicare-covered preventive care | ✓ | ✓ |
| Physical therapy | 20% | 20% |
| Coverage while in a foreign country | ✗ | 80% |
| State-mandated benefits | ✓ | ✓ |

### Wisconsin — PRIMARY
Source: medicare.gov/health-drug-plans/medigap/basics/compare-plan-benefits/wisconsin,
read directly via browser (text-only page, no checkmark-icon ambiguity).

**One base plan**, not multiple letters: Part A coinsurance (hospital/SNF/hospice), 175
lifetime days of extra inpatient mental health care, 40 extra home health visits, Part
B 20% coinsurance, 3 pints of blood/year, state-mandated benefits. Optional add-on
riders: Part A deductible, more home health visits, Part B deductible, Part B excess
charge, foreign travel, a partial (50%) Part A deductible option, Part B copay/
coinsurance. Separate "50%/25% Cost-Sharing Plans" resemble K/L; a high-deductible
variant also exists.

**No community-rating, issue-age, or switching-rights mandate found for WI** beyond
this benefit structure — treat as baseline for rating/switching purposes.

---

## 3. Community-rating states (9) — premium doesn't vary by age

| State | Citation | Confidence | Effective | Notes |
|---|---|---|---|---|
| Arkansas | Ark. Code Ann. § 23-79-109(a)(4) | **PRIMARY** (read direct 2026-08-20) | 1990 | "composite age basis only" — confirmed word-for-word: "all Medicare supplement rates shall be based on a composite age basis only and shall not be based on any age banding or other groupings." |
| Connecticut | Conn. Gen. Stat. § 38a-495c(a) | **PRIMARY** (read direct 2026-08-20) | 1994 (P.A. 93-390) | no age/gender/claims/condition variation. Effective date corrected: the substantive rule was enacted by P.A. 93-390 (eff. Jan 1, 1994), not PA 05-20 (2006), which only made "technical changes" to already-existing language per the statute's own history note. |
| Idaho | Idaho Code § 41-4404 | SECONDARY-CORROBORATED | 2022 (SB 1143, signed 2021) | 65+ only; insurers can charge up to 150% for under-65 |
| Maine | Me. Rev. Stat. tit. 24-A § 5011(1) | **PRIMARY** (read via legislature.maine.gov) | 1993 | no age/gender/health/claims/duration/industry/occupation variation; tobacco-rating also banned as of 2024 amendment |
| Massachusetts | Mass. Gen. Laws ch. 176K § 7(a) | **PRIMARY** (read direct 2026-08-20) | — | on top of Core/Supp1/Supp1A system. §7 is community rating ONLY — the guaranteed-issue right is a separate section, §3, see section 7 below; an earlier draft of this file conflated the two under one citation. |
| Minnesota | Minn. Stat. § 62A.31 subd. 1r | **PRIMARY** (read direct 2026-08-20) | 1993 | on top of Basic/Extended Basic system. **Also discovered while verifying this citation**: a genuinely new, currently-unencoded guaranteed-issue right — see the Minnesota entry added to section 8 below. |
| New York | N.Y. Ins. Law § 3231(a)(4) | **PRIMARY** (read direct 2026-08-20) | — | explicitly names Medicare supplemental insurance |
| Vermont | Vt. Stat. Ann. tit. 8 § 4080e(a),(b) | **PRIMARY** (read direct 2026-08-20) | — | separate community rate allowed for age- vs. disability-eligible — confirmed word-for-word |
| Washington | Wash. Rev. Code § 48.66.045(3) | **PRIMARY** (read direct 2026-08-20) | 1996 | up to two rating pools (age vs disability); spousal/payment-method variation allowed — confirmed word-for-word. **Separately**, the switching-right citation in section 7 below was wrong and has been corrected — see that entry. |

**Pattern worth preserving precisely, not flattening:** Idaho, Vermont, and Washington
all permit a *separate* community rate for Medicare-by-disability enrollees vs.
Medicare-by-age enrollees. The accurate fact is "doesn't vary by age within your
eligibility category," not a flat "never varies by age."

---

## 4. States that ban attained-age rating (premium doesn't rise with age, though it
## does still vary person-to-person by enrollment age or insurer)

**Update, 2026-08-20 primary-source pass:** the "Florida mandates issue-age"
claim below did NOT survive direct checking — see the Florida row. Georgia's did,
cleanly. Arizona's underlying citation was wrong (pointed at provisions that don't
address rating method at all), but the claim itself is now backed by strong current
empirical evidence instead of the original citation. Original framing preserved below
with corrections layered in, rather than rewritten, so the "what changed and why" stays
visible.

| State | Citation | Confidence | Notes |
|---|---|---|---|
| Arizona | 2026 AZ SHIP Medigap comparison booklet (azship.org) | OFFICIAL-SUMMARY | attained-age prohibited; issue-age or community-rating both allowed. Original citation (Ariz. Rev. Stat. § 20-1133 / A.A.C. R20-6-1101) didn't hold up on direct reading — §20-1133 is about early-enrollment discounts, R20-6-1101 just incorporates the (rating-method-agnostic) NAIC model act. The actual modification text couldn't be reached (candidate PDF 403's from curl and browser alike). Re-grounded instead in the state's own current SHIP booklet, which lists every active insurer's real rating method: 0 of 32 use attained-age, all Community or Issue Age — strong current confirmation of the practice, just not a citation to the underlying legal clause. |
| Florida | — | **UNVERIFIED** | **Downgraded 2026-08-20.** Checked directly: Fla. Stat. §627.6741 (guaranteed issue/cancellation/replacement only, no rating provision), Fla. Admin. Code R. 69O-156.012 (lists "age" as an allowed rating factor without specifying issue- vs. attained-age), R. 69O-156.0075 (describes issue-age-rated policies as one existing scenario, doesn't mandate it), and Florida's own official consumer overview page (no mention). None support an issue-age mandate. The claim is repeated verbatim across many broker/aggregator sites but traces to no statute or rule found. Same treatment as Missouri now. |
| Georgia | Ga. Comp. R. & Regs. R. 120-2-8-.15(7) | **PRIMARY** | attained-age banned, confirmed 2026-08-20 via direct regulation text: "An issuer shall not present for filing or approval a rate structure... based upon attained age rating as a structure or methodology," eff. Sept. 23, 2009. Citation corrected from the enabling statute (which only grants rulemaking authority) to the actual regulation. |
| Missouri | — | **UNVERIFIED / CONFLICTING** | sources directly disagree on whether MO uses attained-age or issue-age; no statute found confirming either as a mandate, and no evidence found that MO bans attained-age at all. Do not encode. |

---

## 5. Birthday-rule / annual switching-window states (12)

All give **existing** Medigap holders (not first-time buyers) an annual window to
switch to equal-or-lesser coverage without medical underwriting.

| State | Citation | Confidence | Window | Restrictions |
|---|---|---|---|---|
| California | Cal. Ins. Code §§ 10192.11–.12 | SECONDARY-CORROBORATED | 60 days from birthday | any insurer, no age cap; carrier must notify 30-60 days ahead |
| Idaho | Idaho Code § 41-4404 | SECONDARY-CORROBORATED | 63 days from birthday | any insurer; new plan effective 1st of month after birthday month |
| Oregon | OAR 836-052-0143 / ORS 743.683 | SECONDARY-CORROBORATED | 30 days before–30 after | any insurer |
| Nevada | Nev. Rev. Stat. § 687B.352 (AB 250) | SECONDARY-CORROBORATED | 60 days from birthday month | same insurer's other offerings |
| Wyoming | Wyo. Ins. Reg. Ch. 35 (DOI Bulletin 06-2025) | SECONDARY-CORROBORATED | 63 days from birthday | eff. Jun 4, 2025 |
| Delaware | DE SB 71 (2025) | OFFICIAL-SUMMARY (news.delaware.gov) | 30 before–30+ after | signed Sep 3, 2025; effective date imprecise — one source says Jan 2026, Delaware's own press release covering it is dated May 13, 2026. Confirm the actual effective date before relying on it. |
| Maryland | — (exact bill not pinned down) | OFFICIAL-SUMMARY (insurance.maryland.gov) | 30 days from birthday | eff. Jul 1, 2023 |
| Illinois | 215 ILCS 5/363(8) | PRIMARY (read direct 2026-08-20) | 45 days from birthday | **ages 65-75 only**, same issuer **or affiliate** (corrected — not same-issuer-only as first recorded); statute separately guarantees under-65 disabled enrollees issue in several situations (215 ILCS 5/363(6),(10)), not modeled here (same shape as the deferred employer-retiree-coverage-change category) |
| Indiana | HEA 1226 (2025) / HEA 1260 | SECONDARY-CORROBORATED | 31 before–31 after | same plan letter, different carrier OK; **eff. Mar 15, 2026** (pushed from original Jan 1, 2026) |
| Louisiana | La. R.S. 22:1112 | SECONDARY-CORROBORATED | 63 days from birthday | same issuer or affiliate only (affiliate added 2023) |
| West Virginia | W. Va. Code § 33-15F-1(b) | PRIMARY (read direct from enrolled bill text, 2026-08-20) | 60 days from birthday month | **needs 24 months' continuous prior coverage**, same/affiliated insurer only; each replacement resets the clock; eff. Jun 1, 2026 for the underlying policy per the bill's own applicability clause (subsection (g)), distinct from the bill's general 90-days-from-passage effective date on its cover page. **A second, separate guaranteed-issue right was found in the same bill** (§ 33-15F-1(c)): anyone 65+ losing Medicaid (Title XIX) eligibility gets a 63-day window, any insurer, any plan — missed by every secondary source in the original pass. |
| New Mexico | NM SB 21 | OFFICIAL-SUMMARY (aging.nm.gov) | 60 days from birthday month | **not effective until Jan 1, 2027 — do not treat as live yet** |

## 6. Policy-anniversary state (different trigger, same effect)

**Missouri** — § 376.684 RSMo / 20 CSR 400-3.650(13). 30 days before/after the
*policy's own anniversary date* (not the person's birthday), same plan letter only,
different carrier OK. SECONDARY-CORROBORATED.

## 7. Year-round guaranteed issue (no window needed — strongest protection)

| State | Citation | Confidence | Scope |
|---|---|---|---|
| New York | N.Y. Ins. Law § 3231(a)(2) | **PRIMARY** (read direct 2026-08-20) | continuous, any time, ties to its community-rating law; **any plan**, not equal-or-lesser — see correction below |
| Connecticut | Conn. Gen. Stat. § 38a-495c(a) | **PRIMARY** (read direct 2026-08-20) | continuous, any time; **any plan**, not equal-or-lesser — see correction below |
| Washington | Wash. Rev. Code § 48.66.045(1),(2) | **PRIMARY** (read direct 2026-08-20) | **existing holders only** — switch restricted to same plan group (Plan A only replaceable by another Plan A; plans B-L broader within-group). Citation corrected: not § 48.66.055 (Washington's codification of the standard federal-baseline GI categories, entirely unrelated to this right — checked directly, contains nothing about switching). The widely-repeated "90+ days of prior coverage" figure was NOT found in this section, § 48.66.055, or the application-form regulation (WAC 284-66-130) — checked all three directly. Left unconfirmed rather than reasserted; the core switching right itself is confirmed. |
| Massachusetts | Mass. Gen. Laws ch. 176K § 3(a),(d) | **PRIMARY** (read direct 2026-08-20) | statutory floor is only Feb 1–Mar 31 annually; **all insurers currently offer it year-round in practice** — flag the gap between legal minimum and current market behavior, don't hardcode "year-round" as a legal guarantee. Citation corrected: the right is in §3, not §7 (§7 is community rating only, see section 3 above); **any plan**, not equal-or-lesser — see correction below. |

**Important distinction to preserve:** NY/CT/MA's right applies broadly (including to
people who didn't previously have Medigap); Washington's specifically requires the
person to already hold a Medigap policy. These are not the same right.

**Correction, 2026-08-20 primary-source pass:** all three (NY/CT/MA) were previously
encoded in the schema with `benefitLevel: equalOrLesser`, matching the near-universal
birthday-rule pattern. That's wrong for this category of right. `equalOrLesser` is a
switching concept — it only makes sense when there's a PRIOR policy to compare
against, which is exactly what a birthday rule is (switch from your current plan to
another, no worse). But NY/CT/MA's right covers people with NO prior Medigap at all,
and both NY (`"any... coverage offered by the insurer"`) and MA (`"all policies...
which that carrier is authorized to issue"`) use explicit any/all language in the
statute text — the same shape as Rhode Island's already-correctly-encoded `any`.
Corrected all three to `benefitLevel: any`.

**Maine is NOT year-round**, despite a loose secondary source claiming otherwise —
corrected during this research. Maine's actual mandate (§ 5012) is a minimum
one-month annual window for Plan A only, insurer's choice of timing, plus a separate
90-day-no-gap continuous-switch right. Weaker than NY/CT/WA/MA.

## 8. Annual-Enrollment-Period-tied guaranteed issue (distinct mechanism)

**Rhode Island** — R.I. Gen. Laws § 27-18.2-3(h). PRIMARY confidence (read direct
2026-08-20). Effective Jul 2, 2025, per the statute's own History line for the two
2025 Public Laws (ch. 433 and 434) most recently amending this section — corrects an
earlier secondary-sourced Sep 26, 2025 figure. Guaranteed issue for **any** plan an
issuer currently offers (more generous than the equal-or-lesser restriction most
other states use) tied to the Medicare Annual Enrollment Period (Oct 15–Dec 7, for
Jan 1 coverage), for anyone with no coverage gap over 90 days since their Initial
Enrollment Period. **Correction: applies to anyone continuously covered by either a
Medigap policy or a Medicare Advantage plan** — including someone on Advantage using
this right to newly enroll in Medigap — not existing Medigap holders only as first
recorded; same shape as the NY/CT/MA correction in section 7. Subsection (h)(2)
separately extends this right to under-65 disabled Advantage/Medigap-Plan-A
enrollees, not modeled here (same deferred category as Illinois's disability
provision above).

**Minnesota** — a genuinely new discovery, 2026-08-20, made while verifying the
community-rating citation (section 3) rather than through the KFF employer-retiree
project. PRIMARY confidence (read direct: revisor.mn.gov for Minn. Stat. § 62A.31
subd. 1h(a)(2)/1r(c) and § 62A.3099 subd. 18b; law.cornell.edu for the federal
cross-reference, 42 CFR 422.62(a)(2)-(4)). Effective **August 1, 2026** — enacted
2023, delayed one year from an original Aug 1, 2025 date; per this session's date,
**already live**. Two things distinguish it sharply from Rhode Island's shape:

1. **The window is a combined federal calendar, not a single one.** Minn. Stat.
   § 62A.3099 subd. 18b defines "open enrollment period" by direct reference to
   42 CFR 422.62(a)(2)-(4) — that's the federal AEP (Oct 15-Dec 7) *plus* the
   Medicare Advantage Open Enrollment Period (Jan 1-Mar 31) *plus* (for
   institutionalized individuals) an unlimited-timing window. A WebSearch summary
   claimed this was simply "the October 15 - December enrollment window" —
   checking the actual federal cross-reference directly showed that's incomplete.
2. **It's an age-capped, one-time right, not a recurring annual one.** § 62A.31
   subd. 1h(a)(2)(i): restricted to applicants "age 65 to 70," and usable only
   "for the first time" — someone who ages past 70 without having used it loses
   it permanently, and someone who uses it once can't use it again. This is a
   materially different shape from Rhode Island's ongoing annual right, even
   though both share the `annualEnrollmentPeriod` trigger type in the schema.

A premium surcharge attaches to using it (subd. 1r(b)(4) and (c) — confirmed
directly: applies to ages 65-70, first-use only, for the life of the policy). The
*mechanism* is PRIMARY-confirmed; the *specific percentages* are not — KFF's Oct
2024 brief reports 15% in year one rising to 35% by 2030, but that figure was not
independently checked against primary text as part of this pass and is flagged as
such in the schema.

---

## 9. Baseline states — no special provision found (25)

AL, AK, CO, DC, HI, IA, KS, KY, MI, MS, MT, NE, NH, NJ, NC, ND, OH, OK, PA, SC, SD, TN,
TX, UT, VA.

These follow the federal floor only: one-time 6-month guaranteed-issue window
starting the month the person turns 65 and enrolls in Part B; after that, insurers may
medically underwrite new applications or switches. Attained-age rating is the
prevailing market practice in most of these (insurer's choice, not state-mandated —
distinct from the issue-age-mandated states in section 4).

**This list has NOT been individually verified per state** — it's the residual after
extensive multi-angle searching (community-rating, issue-age, birthday-rule,
year-round, AEP-tied) failed to surface anything for these 26. That's a reasonable
basis for treating them as baseline, but it is not the same rigor as reading each
state's own statute, which is what sections 3-8 got.

---

## 9a. States split across multiple sections above

This doc is organized by category (matching how the research happened), which means a
few states' full picture requires reading more than one section. Flagging here so
nothing gets missed when this becomes a per-state schema:

- **Massachusetts** — own benefit structure (§2), community-rated (§3), year-round in
  practice though statutory floor is narrower (§7)
- **Minnesota** — own benefit structure (§2), community-rated (§3)
- **Idaho** — community-rated for 65+ (§3), birthday rule (§5)
- **Washington** — community-rated (§3), year-round for existing holders only (§7)
- **New York** — community-rated (§3), year-round (§7)
- **Connecticut** — community-rated (§3), year-round (§7)
- **Missouri** — rating method unverified (§4), policy-anniversary switching rule (§6)
- **Maine** — community-rated (§3), narrower-than-expected 1-month/Plan-A-only annual
  window plus separate 90-day-no-gap right (§7)

## 10. Known gaps — explicitly not yet done

1. **Employer-retiree-coverage guaranteed issue.** ~~A CRS/NAIC-cited summary~~
   ~~mentioned ~28 states require Medigap guaranteed issue when an employer changes~~
   ~~retiree health coverage. This is a distinct trigger from everything in sections~~
   ~~3-8 and has not been chased per-state at all.~~ **Done (2026-08-20), see section
   12** — the actual source turned out to be KFF (not CRS/NAIC), and 28 of the ~29
   states are now encoded, with a documented gap on which state changed between the
   2018 and 2024 KFF counts.
2. **Missouri's rating method** — see section 4, genuinely conflicting sources.
3. **Exact statute citations for Maryland's birthday rule** and a few others where
   only the official government *page* was found, not the underlying bill number.
4. Most of the above is still SECONDARY-CORROBORATED, not PRIMARY. **Done (2026-08-20):**
   West Virginia, Illinois, and Rhode Island were upgraded to PRIMARY by reading the
   actual statute/bill text directly — all three turned up real corrections (West
   Virginia's second Medicaid-loss GI right, Illinois's same-issuer-or-affiliate scope,
   Rhode Island's anyone-not-just-existing-holders scope and effective date). **Also
   done (2026-08-20):** the attained-age-rating states (section 4) — Georgia confirmed
   clean and upgraded to PRIMARY; Arizona's citation was wrong but the underlying claim
   held up on strong current empirical grounds (re-graded OFFICIAL-SUMMARY); Florida's
   "issue-age mandated" claim did NOT survive checking and was downgraded to
   UNVERIFIED — four states checked, three real corrections found, which is the
   pattern every primary-source pass has hit so far in this project. **Also done
   (2026-08-20):** NY/CT/MA's year-round right (section 7) — all three confirmed as
   `continuous`/`anyone`, but turned up three more real corrections: `benefitLevel`
   was wrong for all three (`equalOrLesser` → `any`, a switching-right concept that
   doesn't apply to a right covering people with no prior Medigap), Connecticut's
   effective date was wrong by 12 years (1994, not 2006), and Massachusetts's
   citation pointed at the wrong section entirely (§3, not §7, which is
   rating-only). Every primary-source pass run in this project has now found at
   least one real correction — nine states checked (WV, IL, RI, GA, AZ, FL, NY, CT,
   MA), eight corrected. No remaining high-stakes candidates identified; the
   remaining gap is breadth (most of the other ~40 states are still
   SECONDARY-CORROBORATED) rather than a specific known-risky fact.

## 11. Recheck triggers (facts with a known future change)

- **New Mexico** SB 21 — not effective until Jan 1, 2027. Don't treat as live before
  then; recheck closer to that date in case of amendment or repeal.
- **West Virginia** HB 4869 — confirmed via the enrolled bill text (2026-08-20): the
  operative effective date for the birthday-rule policy is Jun 1, 2026 (subsection
  (g)'s specific applicability clause), not the bill's general Jun 11, 2026
  90-days-from-passage cover-page date. No further recheck needed unless amended.
- **Rhode Island** § 27-18.2-3(h) — confirmed via primary text (2026-08-20): effective
  Jul 2, 2025 per the statute's own History line. No further recheck needed unless
  amended.
- **Employer-retiree-coverage-change GI (section 12)** — the state list is sourced to
  2017 data (published 2018); KFF's 2024 update reports one more state (29 vs 28) but
  its per-state table wasn't extractable (see section 12 for why). Recheck against a
  fuller source if one becomes fetchable, and before treating any single state's
  "no" as durable — the gap is which specific state changed, not whether the count
  changed.

## 12. Employer-retiree-coverage-change guaranteed issue (2026-08-20)

The category flagged as an unresearched gap in section 10 turns out to trace to KFF,
not CRS/NAIC as originally guessed from a WebSearch snippet. Two KFF briefs cover it:

- **["Medigap Enrollment and Consumer Protections Vary Across States"](https://www.kff.org/medicare/medigap-enrollment-and-consumer-protections-vary-across-states/)**
  (Jul 2018, data as of 2017) — Table 3 gives a full state-by-state Yes/No breakdown
  for this exact qualifying event ("Upon Retiree Benefit Changes"), read directly via
  browser `get_page_text` (plain HTML table, no PDF/fetch issues). Counting the "Yes"
  rows gives exactly 28 states, confirming this is the source of the original "~28
  states" figure. **This is the list encoded into `medicare/states.json` below.**
- **["Medigap May Be Elusive for Medicare Beneficiaries with Pre-Existing Conditions"](https://www.kff.org/medicare/medigap-may-be-elusive-for-medicare-beneficiaries-with-pre-existing-conditions/)**
  (Oct 2024, updated for Minnesota's 2025/2026 law) — KFF's own page says this
  supersedes the 2018 brief. Its methodology is stronger (state regulations plus
  direct contact with state insurance departments/SHIP offices where public
  documents were silent), and its text says the count is now **29 states**, not 28.
  But its actual state-by-state table (Appendix Table 2) is rendered as an
  interactive Datawrapper chart, not static HTML or a downloadable CSV/JSON — tried
  the standard Datawrapper CSV path (`/dataset.csv`) and the public API
  (`api.datawrapper.de/v3/charts/{id}/data`), both failed (404 / 401 unauthorized).
  Reading a 51-row legal-compliance table off chart screenshots was judged too
  error-prone to attempt. **Net effect: we know the count is now 29, not which state
  changed from the 28 below.**

**Scope decision, made with the user 2026-08-20**: encode the 28-state Yes/No list
from the 2018 table as `hasProtection: true` for this trigger, SECONDARY-CORROBORATED,
explicitly WITHOUT fabricating window length, insurer scope, or benefit-level detail
— neither KFF brief specifies those per state, only the Yes/No/count. This mirrors
the project's existing "don't guess" discipline (see Missouri's rating method, section
4): the right is real and sourced, but its exact mechanics for most states are not.

**The 28 states** (from the 2018 table, "Upon Retiree Benefit Changes" = Yes):
Alaska, Arkansas, California, Colorado, Florida, Idaho, Illinois, Indiana, Iowa,
Kansas, Louisiana, Maine, Minnesota, Missouri, Montana, Nebraska, Nevada, New Jersey,
New Mexico, Ohio, Oklahoma, Oregon, Pennsylvania, Texas, Vermont, Virginia, West
Virginia, Wisconsin.

Connecticut, Massachusetts, and New York are excluded from this list — not because
they lack the right, but because their existing `continuous`/`anyone` guaranteed-issue
right (section 7) already covers this and every other qualifying event; adding a
second, narrower entry for them would be redundant, not additive.
