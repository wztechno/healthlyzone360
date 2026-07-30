# 13 — Observed versus inferred: the reconciliation ledger

Retrieval date: **2026-07-30**.

**Purpose.** Every inference made anywhere in documents 02 to 12 is listed here with a
back-reference. No inference is allowed to hide inside a feature table. If a statement elsewhere in
this document set is classified `INFERRED`, it appears below with its identifier, what it rests on,
what would falsify it, and what depends on it.

This document also records the material `UNKNOWN` findings and the documented inconsistencies, so
that a reader can see the complete shape of what we do not know.

## 1. The full inference ledger

| ID | Inference | Back-reference | Rests on | Would be falsified by | What depends on it | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| `RB-INF-01` | Right Bite's language and region controls live inside the menu panel rather than being URL-visible switches at the point of use | Doc 02, RBP-05 | Position of the controls in the accessible tree, under their own headings inside the panel | Observing a locale or region switch elsewhere in the page chrome at a wider viewport | Nothing. Our own locale strategy is already fixed | Low |
| `RB-INF-02` | Each configurator group (package type, calorie band, duration) is single-select | Doc 04 §1.3; doc 05, RBF-12 | Group structure, mutually exclusive semantics of the options, and a single derived subtotal | Observing two options selected simultaneously in a permissioned or better-instrumented session | Our subscription configurator design treats these as single-select | Low — the alternative is incoherent with a single subtotal |
| `RB-INF-03` | Right Bite's subtotal recomputes when a selection changes | Doc 05, RBF-14; doc 06, RBI-04; doc 11, PRC-04 | A subtotal is rendered; duration options carry differing discount badges, so a static subtotal would contradict the discounts | Observing an unchanged subtotal across selections **in a session where interaction demonstrably works** | Our price-summary component updating live | Low. **Note:** a discounted duration was activated and the subtotal did not change — this is attributed to the environment (doc 01 §5), not to the site, and the inference is held with that caveat stated |
| `RB-INF-04` | Right Bite's business-enquiry "company" field being a select rather than free text implies a curated account list or a segment picker | Doc 05, RBF-27 | The field is a select element | Reading the option list, which was not enumerated | Nothing. Our business enquiry design is independent | Low |
| `RB-INF-05` | Expressing subscription duration in days rather than weeks decouples the commitment from the delivery schedule | Doc 11, DUR-06 | Duration options are day counts; the vendor separately states delivery does not run every day and that day flexibility is managed later | Discovering the day count is in fact a calendar window | **Material.** Our recommendation to model a kitchen subscription as a consumable balance of delivery days (doc 11 §7, doc 17 §5) | Medium — see §4 |
| `RB-INF-06` | Right Bite's co-branded plan routes represent partnerships with third-party fitness brands | Doc 02, RBP-32 | Route naming differs in kind from the goal-based routes | Retrieving those pages, which was deliberately not done | Nothing. Recorded as context only | Low |
| `ETM-INF-01` | Attaching inline help to exactly two calculator fields, and placing method explanation adjacent rather than behind a link, is a deliberate transparency choice rather than an accident | Doc 05, ETF-23 | Help appears on precisely the two most ambiguous fields and nowhere else; six explanatory panels sit beside the form with literature citations | Nothing available to us would falsify intent; only the vendor could | Our recommendation to publish method and citations on our nutrition-target page (doc 09, IMP-04) — which stands on its own merits regardless | Low |
| `ETM-INF-02` | The Partner API's placement in the footer's business column signals a contracted commercial channel rather than a self-serve developer product | Doc 02, ETP-44 | Footer placement, plus the absence of any self-serve signup control, plus the documented contact-and-contract onboarding | Discovering a self-serve signup path | Doc 16's characterisation of the commercial model — which is independently supported by the vendor's own stated onboarding sequence | Low |
| `ETM-INF-03` | Eat This Much collects the health goal on the calculator's **result** step, since no goal field appears on the form yet the explanatory panels discuss goals at length | Doc 03 §6 | Absence of a goal control on the form; presence of two panels explaining how goals shift the recommendation | Rendering the result step and finding no goal control | Nothing. Our own flow asks goal and pace as their own onboarding steps by prior decision | Low |
| `ETM-INF-04` | Eat This Much's diet chip changes internal arrangement between viewports — most plausibly a stacked icon-and-label form giving way to a compact inline form | Doc 08, ETR-02 | Measured chip height more than doubles between 390 px and 768 px while width grows far less | Inspecting the chip's internal composition at both widths | Nothing. The measurement itself is what our responsive work uses | Low |
| `MOT-INF-01` | Right Bite's navigation menu panel is an animated overlay | Doc 07, RBM-01 | Panel structure with its own close control, displayed only below the desktop breakpoint | Observing an instant, unanimated appearance | Nothing — our motion system is required to be original | Nil |
| `MOT-INF-02` | Right Bite's FAQ accordion animates expansion and collapse | Doc 07, RBM-02 | Answer content present in the served document and toggled | As above | Nothing | Nil |
| `MOT-INF-03` | Right Bite renders a selected state on configurator chips and cards | Doc 07, RBM-04 | A single-select group is unusable without one | Nothing plausible | Our chip component rendering a selected state — which is a baseline usability requirement anyway | Nil |
| `MOT-INF-04` | Right Bite's subtotal transition is animated or otherwise marked | Doc 07, RBM-05 | Derived value that changes | Observation in a compositing session | Nothing | Nil |
| `MOT-INF-05` | Eat This Much's diets dropdown, field-level help disclosures and explanatory panels are animated | Doc 07, ETM-M01, ETM-M03, ETM-M04 | Disclosure structures | Observation in a compositing session | Nothing | Nil |

**Fifteen inferences in total.** Twelve are low or nil risk. One is medium risk (`RB-INF-05`).
Two — `RB-INF-02` and `RB-INF-03` — would be trivially resolved by a single session in which browser
interaction works.

## 2. Inferences that were deliberately **not** made

Recording these matters as much as recording the ones that were made.

| Temptation | Why it was refused |
| --- | --- |
| Deriving Right Bite's pricing formula from the observed subtotal and the option sets | A single subtotal against one unknown default configuration determines nothing. **The internal algorithm is not observable.** |
| Deriving a macro formula from Right Bite's displayed macro ranges and calorie bands | Directly forbidden by the specification's rule, repeated at the head of docs 09 and 10 |
| Reconstructing Eat This Much's calorie or macro calculation from the activity multipliers in the markup | The multipliers are conventional published values. Knowing them plus a named published formula does **not** yield the vendor's full pipeline — banding, clamping, rounding and goal adjustment are all unobserved |
| Estimating what the calculator would have returned for the synthetic inputs | The result never rendered. An estimate would be fabrication presented as observation |
| Inferring Right Bite's default configurator selections | Selected-state rendering was not observable. Recorded as `UNKNOWN` |
| Inferring generation scoring, weighting or constraint-solving in either product | No public material addresses it. Doc 10 §6 records the silence |
| Inferring allergen-handling behaviour from ingredient-exclusion capability | They are different problems. No public material distinguishes them |
| Inferring the contents of the thirteen unexamined Right Bite plan pages from the one examined | Would be a guess dressed as a survey. Recorded as `UNKNOWN` in doc 02, RBP-33 |
| Inferring either product's accessibility conformance from its markup | Markup shows element types, not operability. Doc 06, A11Y-05 records it as `UNKNOWN` |

## 3. Material `UNKNOWN` findings

Findings that would change or strengthen a design decision if resolved.

| ID | Unknown | Where | Why it is unknown | Consequence |
| --- | --- | --- | --- | --- |
| `UNK-01` | Eat This Much calculator output values and result-step layout | Doc 05, ETF-30/31 | Result never rendered (doc 01 §5) | None for correctness — our engine derives from published literature. We simply have no reference result presentation to compare against |
| `UNK-02` | Whether the unit toggle converts entered values or clears them | Doc 05, ETF-32 | State change did not take effect | Our onboarding must decide this itself. Recommendation: convert and round sensibly |
| `UNK-03` | Right Bite's default configurator selections | Doc 05, RBF-13 | Selected state not observable | Our configurator must choose its own defaults |
| `UNK-04` | Whether Right Bite's macro ranges vary with the calorie band | Doc 05, RBF-15; doc 09, RBN-09 | Not exercisable | Our plan detail should derive macro ranges from the selected variant regardless |
| `UNK-05` | Validation, error and unavailable-option states on either product | Doc 05, RBF-16, ETF-33 | Not exercisable | **Every one of our screens must render loading, empty and error states by our own rule.** No reference precedent |
| `UNK-06` | The exact breakpoint between Right Bite's one- and two-column layouts | Doc 08, RBR-11 | Intermediate widths not measured | None. Our breakpoints are our own |
| `UNK-07` | Whether either product honours a reduced-motion preference | Doc 07, GAP-04 | Not observable | None. Ours must, by rule |
| `UNK-08` | Whether Right Bite's region selector changes catalogue, currency or delivery rules | Doc 02, RBP-06 | Not exercisable | Our multi-market model must decide independently |
| `UNK-09` | Generation failure, restriction conflict, allergen safety and professional-authority behaviour in either product | Doc 10 §6 | Not publicly documented by either vendor | **Highest-consequence gap.** Our specification requires explicit states for all of these and there is no precedent. Design from first principles; have a qualified professional review them |
| `UNK-10` | Whether either product distinguishes allergy, intolerance, dislike, religious restriction, self-declared medical information and clinician-enforced restriction | Doc 05, FLD-08; doc 12 §5 | No public material distinguishes them | **Our six restriction kinds have no reference precedent.** This is an area where our design leads |
| `UNK-11` | Right Bite's resume action | Doc 11, MGT-04 | Not described in any public copy examined | We must design and name it ourselves |
| `UNK-12` | Whether an Eat This Much client is told their logs are visible to their professional | Doc 12, CSV-07 | Not addressed publicly | Treat as a privacy requirement for our build, not a feature choice |
| `UNK-13` | Contents of thirteen Right Bite plan pages | Doc 02, RBP-33 | Deliberately not retrieved | None material — one plan was examined in depth and the configurator is evidently a shared template |
| `UNK-14` | Whether either product's controls compensate for sub-minimum touch targets with additional tap padding | Doc 08, TCH-03 | Only element boxes measured | None. Our own minimum is enforced by test |

## 4. `RB-INF-05` — the one inference carrying real weight

**The inference.** Right Bite expresses subscription duration as a count of days, and that day count
is an entitlement to be consumed rather than a calendar window.

**Why it is more than a guess.** Four independent public facts point the same way: duration options
are day counts rather than weeks or months; the vendor states delivery runs six days a week with
market-specific non-delivery days; the vendor states day flexibility is managed later in the
application; and the terms state unused days may be transferred to another person. A calendar window
cannot be transferred to a friend; a balance of days can.

**Why it still matters that it is an inference.** The terms *also* state a fixed period within which
all days must be used. So the true model is plausibly a **hybrid** — a balance of days, bounded by an
expiry window. We have not observed which constraint binds first, or what happens at expiry.

**What depends on it.** Our recommendation to model a kitchen subscription as a consumable balance
of delivery days rather than a date range (doc 11 §7, item 3; doc 17 §5).

**Our position.** The recommendation stands, because a balance model is independently the better fit
for a product with pauses, skips and non-delivery days — it is right on its own merits, not because
the reference does it. But implementation should treat *both* the balance and the expiry window as
first-class, and doc 15 lists confirming this as a manual-capture item.

## 5. Documented inconsistencies and open questions

| ID | Item | Detail | Our response |
| --- | --- | --- | --- |
| `RB-INC-01` | Two different notice periods | Right Bite's FAQ states one advance window for pausing; its terms state a different notice period for placing a hold. Both are `DOCUMENTED_PUBLIC` and they do not agree | Not a defect we need to resolve. The lesson is carried: **one authoritative value, rendered in one place** (doc 11 §7, item 8) |
| `OQ-01` | Delivery day versus consumption day | Right Bite states meals for a non-delivery day arrive with the previous delivery. If those days can differ, a "skip" is ambiguous — does it skip a delivery or a day of eating? Neither our specification nor our planner design currently distinguishes them | **Open question for the product owner.** Raised in doc 17 §9 |
| `OQ-02` | Pre-purchase feasibility checks | The reference defers delivery-area and allergy checks past the price summary. Our recommendation is to move both before it (doc 11 §3) | **Decision required** before the subscription wave |
| `OQ-03` | Client agency in the professional relationship | The reference sells a tier in which the client has no software access at all. Our model always gives the consumer their own account | **Confirm** this is the intended product position |
| `OQ-04` | Export and branding | The reference allows professionals to remove vendor branding from exported plans. Our exports must retain disclaimers and synthetic-data marking regardless of branding | **Decision required** before any export work |

## 6. Ledger integrity

Every statement classified `INFERRED` in documents 02 to 12 appears in §1 of this document. The
mapping was built by walking each document's tables in order. Documents 09 and 10 contain **no**
inferences by design — both carry the specification's prohibition at their head, and both record
`UNKNOWN` wherever a formula or algorithm would otherwise have been guessed at.

Any future edit that introduces a new `INFERRED` row into documents 02 to 12 must add a
corresponding row here.
