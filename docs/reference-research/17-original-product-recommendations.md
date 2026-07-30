# 17 — Original product recommendations

Retrieval date of underlying research: **2026-07-30**.

## 1. How to read this document

This is the document later implementation waves read. Documents 00 to 16 record what was observed;
this one records **what we should build**. Every recommendation is framed as "Our platform should
implement…", carries a back-reference to the evidence behind it, and is marked for its relationship
to decisions already fixed in the approved plan:

| Marker | Meaning |
| --- | --- |
| **AGREES** | Confirms a decision already fixed. Implement as planned; the research adds confidence, not change |
| **EXTENDS** | Adds detail or a sub-requirement to a fixed decision, without contradicting it |
| **DIVERGES** | Departs from a reference product's approach, deliberately. Our position, and why |
| **NEW** | No reference precedent. Design from first principles; carries the most design risk |
| **QUESTION** | Requires a product-owner decision before the relevant wave |

**Nothing here copies either reference.** Recommendations derive from functional patterns and from
the gaps between what the references do and what our specification requires. The constraints in
`14-legal-and-licensing-boundaries.md` §5 bind every item.

## 2. Where this agrees and disagrees with our fixed information architecture

Our architecture is already fixed: a `(marketplace)` route group in the `public` area, and an
expanded `customer` area, with no new route-area values. The research tested that decision rather
than assuming it.

### 2.1 Agreements

| # | Finding | Fixed decision it supports |
| --- | --- | --- |
| IA-01 | Both references keep the working surface entirely behind authentication — Eat This Much's planner at `/app/**`, Right Bite's whole product in a post-purchase application (doc 02, ETP-03, RBP-25) | **AGREES** with a public marketplace group and a separate authenticated customer area. The split is the category norm |
| IA-02 | Both references treat public tools and catalogue as acquisition surfaces reachable with no account (doc 02, CON-01) | **AGREES** with placing the marketplace, calculators and how-it-works in the `public` area |
| IA-03 | Right Bite prefixes every route with a combined language–region segment across two markets (doc 02, RBP-01, RBP-03) | **AGREES** with our multi-market, bilingual approach |
| IA-04 | Eat This Much treats diet classification as a top-level discovery axis with its own route family (doc 02, ETP-18) | **AGREES** with our `diets/:diet` routes |
| IA-05 | Eat This Much cross-links a family of calculators into a cluster (doc 02, ETP-16, CON-05) | **AGREES** with our `tools/` group, and suggests it should grow |
| IA-06 | Right Bite keeps all business pricing behind an enquiry, with no public rate (doc 11, BIZ-02) | **AGREES** with our business-price-privacy rule and its enforcing test |
| IA-07 | Neither reference exposes a public professional-facing product surface — Right Bite has none at all (doc 12, RBP-09) | **AGREES** with placing dietitian screens in an authenticated area, not the marketplace |

**No finding in this research contradicts the fixed information architecture.** That is a
meaningful result: the plan was made before the research, and the research supports it.

### 2.2 Divergences from the references, deliberately chosen

| # | Reference approach | Our position | Marker |
| --- | --- | --- | --- |
| IA-10 | Right Bite has no plan-comparison surface, and neither does Eat This Much (doc 04 §3) | **Our platform should implement a plan-comparison screen.** A fourteen-plan catalogue without comparison forces the user to hold options in their head. Ours has one; neither reference does | **DIVERGES / NEW** |
| IA-11 | Right Bite's catalogue has no filter or sort (doc 04, RBC-11) | **Our platform should implement filtering on the marketplace catalogue.** Fourteen items survive without it; forty meals across six kitchens will not | **DIVERGES** |
| IA-12 | Neither reference shows nutrition on a catalogue card (doc 09, RBN-01) | **Our platform should implement nutrition summary information on marketplace cards.** In a nutrition-led product, hiding calories until the detail page works against the proposition | **DIVERGES**, and a differentiator |
| IA-13 | Right Bite merges marketing and transaction on one page (doc 02, RBP-41) | **Our platform should keep marketing above and transaction below the fold on plan detail, but must not interleave them.** A user re-configuring a plan should not scroll through testimonials to reach the price | **DIVERGES** |
| IA-14 | Neither reference website uses bottom tabs or a pinned action bar (doc 08, CNV-05, CNV-06) | **Our platform should retain bottom tabs and touch-safe full-screen workflows.** We are a universal application including native targets; the references are responsive websites. The divergence is expected | **DIVERGES**, expected |

## 3. Marketplace and discovery

| # | Our platform should implement… | Evidence | Marker |
| --- | --- | --- | --- |
| MKT-01 | …a public calculator cluster — calorie, macro and, later, siblings — reachable with no account, cross-linked to one another and to the planner | Doc 02, CON-01, CON-05 | **AGREES** |
| MKT-02 | …a calculator that publishes its method: the formula named, a citation to primary literature, and a plain statement that the result is an estimate | Doc 09, TRN-01 to TRN-03 | **EXTENDS** |
| MKT-03 | …contextual help attached to precisely the fields most likely to confuse — the sex input and the optional body-fat input — rather than uniformly | Doc 05, ETF-20 | **EXTENDS** |
| MKT-04 | …a **visible-but-locked** control pattern: show the capability, show its current value, state exactly what unlocks it | Doc 04, ETC-13 + ETC-14; doc 06, PAT-08 | **EXTENDS** — reuse for `usePrototypeAction()` |
| MKT-05 | …catalogue cards carrying a calorie figure and a primary macro, plus allergen and diet tags | Doc 09, IMP-08 | **DIVERGES** |
| MKT-06 | …filters on meals and plans covering kitchen, meal type, diet, calorie range, macro ranges, price, preparation time and allergens | Doc 04 §3 | **AGREES** |
| MKT-07 | …a plan-comparison screen showing two or three plans side by side across calories, macros, meal composition, duration, price and delivery | IA-10 | **NEW** |
| MKT-08 | …dietitian profiles surfaced publicly by name and credential before any commitment | Doc 12, RBP-01, RBP-02 | **AGREES** |
| MKT-09 | …a fixed-width card rail that scrolls horizontally on narrow viewports and wraps to a grid when wide, with a visible scroll affordance and no page-level horizontal scroll | Doc 08, RSP-02; doc 07, MOT-08 | **EXTENDS** |
| MKT-10 | …a landing page that gives something away before asking for anything — a calculation or a sample plan, with no account | Doc 03, ETM-J1 | **EXTENDS** |

## 4. Planner workflow

| # | Our platform should implement… | Evidence | Marker |
| --- | --- | --- | --- |
| PLN-01 | …**four** regeneration scopes: individual food, meal entry, day, and week | Doc 10, GEN-01 to GEN-04, REQ-01 | **EXTENDS** — our plan has three; the fourth is new |
| PLN-02 | …**`locked` and `consumed` as two independent states** on a plan entry, with separate controls, separate indicators, and separate effects on the grocery list | Doc 10, PRS-03, PRS-04, REQ-02; doc 06, PAT-03 | **DIVERGES**, emphatically. The reference conflates them and documents the resulting defect |
| PLN-03 | …a grocery list that excludes only what is **consumed**, never what is merely locked | Doc 10, PRS-04 | **DIVERGES** |
| PLN-04 | …persistent per-food preference signals — favour and exclude — that outlive any single plan | Doc 10, PRS-06, PRS-07, REQ-03 | **AGREES** |
| PLN-05 | …notes at plan, day and entry level, persisting across regeneration at every scope, and carried into any export or duplication | Doc 12, AUT-02, AUT-05, AUT-06; doc 10, PRS-05 | **EXTENDS** — plan-level notes are ours; the reference documents only day and meal |
| PLN-06 | …meal layout as a first-class configurable structure — count, order, type — with optional per-day-of-week variation | Doc 10, INP-06, INP-07, REQ-07 | **AGREES** |
| PLN-07 | …portion adjustment on an existing entry, distinct from any pre-generation size setting | Doc 10, INP-09, REQ-08 | **EXTENDS** — the reference conflates them |
| PLN-08 | …pantry contents as a **soft preference** that raises desirability, never as a hard constraint | Doc 10, INP-11, REQ-05 | **AGREES** |
| PLN-09 | …grocery-list efficiency and cross-day variety as explicit soft preferences in week-scope generation | Doc 10, INP-12, INP-13, REQ-06 | **AGREES** |
| PLN-10 | …grocery aggregation across meals **and dates**, not per-day lists concatenated | Doc 10, API-05, REQ-14 | **EXTENDS** |
| PLN-11 | …keyboard "move to" as the primary mechanism for moving an entry, with drag-and-drop as a web-only enhancement that is never the sole route | Doc 06, PAT-05 | **AGREES** |
| PLN-12 | …**explicit, designed states** for generation failure, restriction conflict, no suitable meals and safety escalation | Doc 10 §6, REQ-09; doc 13, `UNK-09` | **NEW** — no precedent in either reference. Highest design risk in the planner |
| PLN-13 | …an explainable scoring rationale surfaced to the user — why this meal, in one sentence | Doc 10, REQ-12 | **NEW**, and a differentiator |
| PLN-14 | …a weekly planner that stays a genuine multi-day grid at tablet width, rather than collapsing to an agenda | Doc 08, RSP-05 | **DIVERGES** from both references' treatment of tablets |
| PLN-15 | …a replacement drawer previewing nutrition, cost and allergen **differences** against the entry being replaced | Doc 04 §3; doc 15 §3.4 | **NEW** — no precedent |

## 5. Subscription flow

| # | Our platform should implement… | Evidence | Marker |
| --- | --- | --- | --- |
| SUB-01 | …a short pre-purchase configuration — three or four decisions, on one page, not a wizard | Doc 11, SUB-01, SUB-03 | **AGREES** |
| SUB-02 | …**a delivery-area check and an allergy check before the price summary**, not after it | Doc 11 §3, `DEC-SUB-01`; doc 13, `OQ-02` | **DIVERGES**, and important. Both are cheap to ask and dispositive |
| SUB-03 | …a deferred-input notice component that occupies the slot and explains that the choice comes later, rather than omitting it | Doc 04, RBC-23; doc 11 §3 | **AGREES** |
| SUB-04 | …a kitchen subscription modelled as a **consumable balance of delivery days**, with any expiry window as a separate, equally first-class attribute | Doc 11, DUR-06; doc 13 §4 (`RB-INF-05`) | **EXTENDS**. Note the inference's caveat |
| SUB-05 | …duration discounts as badges attached to the duration option itself | Doc 11, DUR-05 | **AGREES** |
| SUB-06 | …calorie **bands** for kitchen-delivered subscriptions and exact targets for home-prepared planning, without forcing one model onto both | Doc 11 §2.2 | **EXTENDS** |
| SUB-07 | …plan-level macros as ranges with an explicit variability caveat, never as false point precision | Doc 09, RBN-03, IMP-01 | **AGREES** |
| SUB-08 | …meal combination and snack inclusion as **two modelled attributes** of a plan variant, with the offered set derived from kitchen configuration | Doc 11, PKG-04 | **DIVERGES** from the reference's hand-curated flat list |
| SUB-09 | …both price units — per meal and total — visible in both catalogue and detail, with one clearly primary | Doc 11, PRC-03 | **DIVERGES** |
| SUB-10 | …one authoritative cut-off value for pause and change windows, rendered everywhere from that single source | Doc 13, `RB-INC-01` | **EXTENDS** |
| SUB-11 | …an explicit, named **resume** action, designed as a first-class flow | Doc 11, MGT-04; doc 13, `UNK-11` | **NEW** — the reference does not document one at all |
| SUB-12 | …a subscription detail screen whose primary figure is the remaining entitlement, with the next delivery and any expiry alongside | Doc 15 §3.10 | **EXTENDS** |
| SUB-13 | …business pricing reachable only through an enquiry, never rendered on a consumer surface | Doc 11, BIZ-02, BIZ-03 | **AGREES** |

## 6. Onboarding

| # | Our platform should implement… | Evidence | Marker |
| --- | --- | --- | --- |
| ONB-01 | …unit system as the **first** measurement-related step, with every later step rendering in the chosen system | Doc 05, FLD-01 | **AGREES** |
| ONB-02 | …a height control that is compound in imperial and single in metric, with each component separately labelled for assistive technology | Doc 05, FLD-02; doc 06, A11Y-04 | **EXTENDS** |
| ONB-03 | …unit conversion that preserves the entered value rather than clearing it, rounded sensibly | Doc 13, `UNK-02` | **NEW** — reference behaviour unobserved |
| ONB-04 | …an optional body-fat step accepting either a coarse band or a precise figure, switching calculation method only when a usable value exists | Doc 05, FLD-03 | **EXTENDS** |
| ONB-05 | …a sex-related input that offers a non-binary option, explains why the value is requested, names which calculation consumes it, and never forces a binary answer | Doc 05, FLD-04 | **AGREES** |
| ONB-06 | …activity presented as lifestyle descriptions with an adjacent plain-language guide, never as a bare multiplier | Doc 05, FLD-05 | **AGREES** |
| ONB-07 | …goal and target pace as their own steps, distinct from the maintenance estimate | Doc 05, FLD-07 | **EXTENDS** — a clearer separation than the reference offers |
| ONB-08 | …**six distinct restriction kinds** — consumer preference, self-declared medical information, dietitian-enforced restriction, allergy, intolerance, dislike, religious restriction — each captured, stored and enforced differently | Doc 05, FLD-08; doc 13, `UNK-10` | **NEW** — no precedent in either reference. Our clearest lead over both |
| ONB-09 | …allergy captured with severity, and a defined route for requirements the interface must not absorb | Doc 06, RBI-29; doc 12, PRQ-06 | **EXTENDS** |
| ONB-10 | …macro targets as absolute grams, with percentages as a secondary view | Doc 09, CAL-09, IMP-03 | **AGREES** |
| ONB-11 | …macro floors as first-class, distinct from a target with slack | Doc 05, FLD-06; doc 09, ETN-01 | **EXTENDS** |
| ONB-12 | …a `MedicalDisclaimer` on every medical-related onboarding step | Doc 09, MED-01, MED-02 | **AGREES** — matches category practice |
| ONB-13 | …a URL-addressable wizard so a user can leave and return to the exact step | our own plan | **AGREES** |

## 7. Nutrition display and macro visualisation

| # | Our platform should implement… | Evidence | Marker |
| --- | --- | --- | --- |
| NUT-01 | …a visible separation between **estimated maintenance energy** and **selected target** | Doc 09, IMP-02 | **NEW** — neither reference shows one |
| NUT-02 | …a named calculation method, a literature citation, and a plain "this is an estimate" statement on the nutrition-target page | Doc 09, IMP-04, TRN-01 to TRN-03 | **EXTENDS** |
| NUT-03 | …a "why this target?" interaction attached to the value, disclosing the inputs used and the assumptions made | Doc 09, IMP-05 | **NEW** |
| NUT-04 | …source, version and calculation timestamp on every nutrition-facts panel | Doc 09, IMP-06 | **NEW** — neither reference offers provenance |
| NUT-05 | …fibre as a first-class target alongside protein, carbohydrate and fat | Doc 09, RBN-04, ETN-04, IMP-07 | **NEW** — neither reference displays it publicly |
| NUT-06 | …tolerance ranges rendered visually — a band on the meter, not just a number | Doc 09, IMP-01 | **EXTENDS** |
| NUT-07 | …nutrition status communicated by **shape, pattern and numeric label as well as colour** | Doc 09, IMP-10 | **AGREES** — already a fixed accessibility rule |
| NUT-08 | …a professional-override indicator naming who set a value and when | Doc 09, IMP-09; doc 12, PRQ-03 | **NEW** — Right Bite's copy makes the practitioner authoritative but shows no marker |
| NUT-09 | …every synthetic fixture value labelled synthetic, visibly in the panel and contractually in the source field | Doc 09, IMP-11 | **AGREES** |
| NUT-10 | …progress toward a target animated as travel rather than a jump, collapsing to the final state under a reduced-motion preference | Doc 07, MOT-06, CST-02 | **AGREES** |

## 8. Professional review

| # | Our platform should implement… | Evidence | Marker |
| --- | --- | --- | --- |
| PRO-01 | …**per-client access grants** rather than a single professional-client relationship flag | Doc 12, CLI-04, CLI-05, PRQ-02 | **EXTENDS** |
| PRO-02 | …consumer agency retained always — the consumer keeps their own account and planner; professional authority is scoped to enforced restrictions and review | Doc 12, PRO-03 to PRO-05 | **DIVERGES** from the reference's no-client-access tier |
| PRO-03 | …a client-facing explanation of any enforced restriction, naming who enforced it and offering a defined route to question it | Doc 12, CSV-05, CSV-06, PRQ-04 | **NEW** |
| PRO-04 | …explicit disclosure to the consumer when a professional can see their activity | Doc 12, CSV-07, PRQ-05 | **NEW**, and a privacy requirement rather than a feature |
| PRO-05 | …a dietitian review queue and review-detail surface | Doc 12, PRQ-08 | **NEW** — neither reference exposes one |
| PRO-06 | …plan templates saved and reused across clients | Doc 12, AUT-09, PRQ-10 | **AGREES** |
| PRO-07 | …exports that retain medical disclaimers and synthetic-data marking **regardless of professional branding** | Doc 12, AUT-10, PRQ-09; doc 13, `OQ-04` | **EXTENDS** |
| PRO-08 | …an explicit human-escalation route for requirements the interface must not absorb | Doc 06, RBI-29; doc 12, PRQ-06 | **AGREES** |
| PRO-09 | …AI-generated suggestions clearly labelled as such in the Virtual Dietitian, never presented as medical care, always human-overridable | our own plan; doc 09, MED-01 | **AGREES** |

## 9. Questions for the product owner

| # | Question | Blocks | Reference |
| --- | --- | --- | --- |
| Q-01 | Do we check delivery area and allergies **before** the price summary, accepting two more pre-purchase steps in exchange for not selling an unfulfillable subscription? | Subscription wave | SUB-02; doc 13, `OQ-02` |
| Q-02 | Can a **delivery day** and a **consumption day** differ in our model? If so, does "skip" skip a delivery or a day of eating? Neither our specification nor our planner design currently distinguishes them | Subscription and planner waves | Doc 13, `OQ-01`; doc 11, MGT-11 |
| Q-03 | Is a kitchen subscription a **balance of days**, an **expiry window**, or both? | Subscription wave | SUB-04; doc 13 §4 |
| Q-04 | Confirm that the consumer always retains their own account, even under professional supervision | Professional wave | PRO-02; doc 13, `OQ-03` |
| Q-05 | Do exports carry professional branding, and if so what must survive it? | Any export work | PRO-07; doc 13, `OQ-04`; doc 14, `LR-07` |
| Q-06 | Do we open a commercial conversation with the Eat This Much Partner API, given that it cannot serve kitchen-delivered planning at all? | Not this phase | Doc 16, DEC-01, DEC-02 |

## 10. Implementation risk register from this research

| # | Item | Risk | Mitigation |
| --- | --- | --- | --- |
| RISK-01 | Every item marked **NEW** has no reference precedent | Higher design risk; no external validation available | Prototype early, review with a qualified professional, expect iteration. There are fourteen such items and they are named individually |
| RISK-02 | The six restriction kinds (ONB-08) are our clearest lead **and** our largest unknown | Getting the taxonomy wrong propagates into onboarding, planner, replacement and review | Model the taxonomy in the domain types first; validate with a qualified dietitian before building the screens |
| RISK-03 | Planner failure states (PLN-12) have no precedent | Easy to under-design; users meet them at their worst moment | Enumerate all eleven Virtual Dietitian states and all planner failure states as first-class screens with fixtures, not as afterthought toasts |
| RISK-04 | Splitting `locked` from `consumed` (PLN-02) touches planner, grocery and tracking simultaneously | Cross-cutting change if retrofitted | Model both states in the entry contract from the start |
| RISK-05 | `RB-INF-05` carries the subscription model | Medium-risk inference underpinning SUB-04 | Treat balance and expiry as separate first-class attributes, so either reading is representable |
| RISK-06 | Touch targets below the conventional minimum (doc 08, TCH-01) | Both mature references fall below it on their most important controls | Our forty-four-unit minimum stays enforced by test. Do not follow the references here |
| RISK-07 | Nutrition provenance (NUT-04) has no precedent | Easy to omit under delivery pressure | Source, version and timestamp are contractual fields, not optional presentation |

## 11. Summary for wave leads

**Take from the references:** scoped regeneration; locking as the mechanism that makes regeneration
safe; persistent food preferences; notes that survive regeneration; short pre-purchase
configuration; deferred-input notices; duration discounts as badges; calorie bands for
kitchen-delivered plans; macro ranges with caveats; published calculation method with citations;
visible-but-locked controls; contained horizontal scroll; business pricing behind an enquiry;
per-client access grants; standing medical disclaimers.

**Reject from the references:** conflating locking with eaten-tracking; deferring allergy and
delivery-area checks past purchase; hand-curated flat option lists; switching price units between
catalogue and detail; two conflicting notice periods; sub-minimum touch targets; fixed-size submit
controls on narrow viewports; treating a tablet planner as a phone; leaving resume undocumented; and
tiers that strip a client of software access entirely.

**Build without precedent:** the six restriction kinds; planner failure, conflict and safety states;
professional-override indication; nutrition provenance; the maintenance-versus-target separation;
fibre targets; plan comparison; nutrition on catalogue cards; difference previews in the replacement
drawer; explainable scoring; the review queue; enforced-restriction explanation; activity-visibility
disclosure; and an explicit resume action.
