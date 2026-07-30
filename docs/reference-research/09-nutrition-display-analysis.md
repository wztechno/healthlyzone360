# 09 — Nutrition display analysis

> **Do not infer exact server calculations merely from displayed ranges.**
>
> _(Repeated verbatim from the project specification. It governs every statement in this document.)_

Retrieval date: **2026-07-30**.

## 1. How nutrition is presented on the public surfaces

### 1.1 Right Bite — plan-level nutrition

| # | Finding | Classification | Source |
| --- | --- | --- | --- |
| RBN-01 | Plan cards in the catalogue display **no nutrition information at all** — no calories, no macros. They display a name, a proposition and a per-meal starting price | `OBSERVED_PUBLIC` | RB-03 |
| RBN-02 | The plan detail page presents calories as a **selectable band**, not as a displayed value. Five contiguous bands are offered as the second configurator decision | `OBSERVED_PUBLIC` | RB-04 |
| RBN-03 | Macros are presented under a "nutrition breakdown" heading as **three labelled ranges** — protein, carbohydrate, fat — each a low-to-high span rather than a point value | `OBSERVED_PUBLIC` | RB-04 |
| RBN-04 | Fibre is **not** displayed anywhere on the public plan surface | `OBSERVED_PUBLIC` (absence) | RB-04 |
| RBN-05 | Micronutrients are not displayed anywhere on the public plan surface | `OBSERVED_PUBLIC` (absence) | RB-04 |
| RBN-06 | The macro block carries an explicit caveat that the breakdown can change according to the subscriber's preferences and the dietitian's recommendations | `OBSERVED_PUBLIC` | RB-04 |
| RBN-07 | The public copy states meals are calorie- and macro-tracked, and describes the plans as macro-balanced | `DOCUMENTED_PUBLIC` | RB-05 |
| RBN-08 | No per-meal nutrition panel is publicly reachable. Sample dishes appear as captioned images with no nutrition data | `OBSERVED_PUBLIC` (absence) | RB-04 |
| RBN-09 | Whether displayed macro ranges vary with the selected calorie band | `UNKNOWN` — not exercisable in this session | RB-04 |
| RBN-10 | Whether displayed macro ranges vary between plans | `UNKNOWN` — only one plan page was examined | RB-04 |
| RBN-11 | How the ranges are derived | `UNKNOWN`. **The internal algorithm is not observable.** No relationship was computed between the displayed calorie bands and the displayed macro ranges, and none is asserted | RB-04 |

**On RBN-03, the design lesson is the *shape* of the value, not the numbers.** Presenting a
plan-level macro figure as a range is an honest response to a genuine problem: a plan that rotates
across seven hundred dishes does not have a single true protein figure. A point value would be false
precision. Our own contracts already model tolerance ranges; this confirms the modelling choice is
right at plan level, not merely at target level.

### 1.2 Eat This Much — target-level nutrition

| # | Finding | Classification | Source |
| --- | --- | --- | --- |
| ETN-01 | The public landing generator displays three macro constraints — carbohydrate, fat and protein — as **floors**, phrased as minimums rather than as exact targets or ceilings | `OBSERVED_PUBLIC` | ETM-02 |
| ETN-02 | Those three figures are **display-only** on the public page; the copy states editable targets require an account | `OBSERVED_PUBLIC` | ETM-02 |
| ETN-03 | Calories are an **input** on the landing generator, not an output — the visitor types the number | `OBSERVED_PUBLIC` | ETM-02 |
| ETN-04 | Fibre is not present on the public generator | `OBSERVED_PUBLIC` (absence) | ETM-02 |
| ETN-05 | The calculator's result presentation | `UNKNOWN` — never rendered (doc 01 §5) | ETM-03 |
| ETN-06 | Whether the displayed macro floors respond to the entered calorie figure | `UNKNOWN` | ETM-02 |
| ETN-07 | The public documentation states nutrition totals are shown against target ranges in the planner, and that the active target set is named and switchable | `DOCUMENTED_PUBLIC` | ETM-09, ETM-12 |
| ETN-08 | The public documentation states multiple named nutrition profiles are supported, and that targets can be attached per day of the week | `DOCUMENTED_PUBLIC` | ETM-12 |
| ETN-09 | The public documentation states a progress indicator shows calories and macros consumed so far, expanding for detail | `DOCUMENTED_PUBLIC` | ETM-13 |
| ETN-10 | The public documentation states net carbohydrate can be displayed instead of total carbohydrate | `DOCUMENTED_PUBLIC` | ETM-10 |
| ETN-11 | The public documentation states targets can be set for saturated fat, potassium and other micronutrients | `DOCUMENTED_PUBLIC` | ETM-10 |
| ETN-12 | The public documentation states exercise or calories burned can be entered and factored in | `DOCUMENTED_PUBLIC` | ETM-10 |
| ETN-13 | Every screen implementing ETN-07 to ETN-12 | `REQUIRES_PERMISSION` | — |

## 2. Stated calculation method — what the vendor says, and where our knowledge stops

| # | Statement | Classification | Source |
| --- | --- | --- | --- |
| CAL-01 | The public documentation states the calorie calculator uses the Mifflin–St Jeor formula to estimate basal metabolic rate, plus an activity-factor multiplier to estimate total daily energy expenditure | `DOCUMENTED_PUBLIC` | ETM-03 |
| CAL-02 | The explanatory copy links to the primary literature for both the formula and the underlying concept | `OBSERVED_PUBLIC` | ETM-03 |
| CAL-03 | Five activity multipliers are present as option values in the public page markup | `OBSERVED_PUBLIC` | ETM-03 |
| CAL-04 | Those multipliers are the conventional published activity factors, not proprietary values | `DOCUMENTED_PUBLIC` | published literature |
| CAL-05 | The public documentation frames protein guidance in terms of published intake recommendations and cites two peer-reviewed sources | `DOCUMENTED_PUBLIC` | ETM-03 |
| CAL-06 | The public documentation states carbohydrate is scaled by activity level, weight and goal | `DOCUMENTED_PUBLIC` | ETM-03 |
| CAL-07 | The public documentation states fat is treated as having an essential floor rather than being purely residual | `DOCUMENTED_PUBLIC` | ETM-03 |
| CAL-08 | The public documentation uses a conventional energy-per-unit-of-body-mass figure when explaining goal adjustment | `DOCUMENTED_PUBLIC` | ETM-03 |
| CAL-09 | The public documentation explicitly discourages percentage-based macro targets in favour of absolute grams | `DOCUMENTED_PUBLIC` | ETM-03 |
| CAL-10 | The exact macro-derivation rules — coefficients, ordering, clamping, rounding, banding, and how goal and pace shift the result | `UNKNOWN`. **The internal algorithm is not observable.** | — |
| CAL-11 | Any relationship between Right Bite's displayed calorie bands and its displayed macro ranges | `UNKNOWN`. **The internal algorithm is not observable.** No such relationship was computed | — |

**Nothing in CAL-01 to CAL-09 is proprietary to either reference product.** Mifflin–St Jeor is
published literature, the activity factors are conventional, and the protein guidance is cited to
peer-reviewed sources by the vendor itself. Our own `MockNutritionTargetEngine` is therefore free to
use published formulae with published citations. **It must do so on the authority of that
literature, and must never be described as reproducing any reference product's calculation.**

## 3. The transparency pattern — the most valuable finding in this document

Eat This Much's calculator does something unusual and worth adopting: it publishes its method
alongside its form. Six explanatory panels sit beside the inputs covering how to choose an activity
level, what the macro suggestions are based on, why percentage targets are discouraged, how the
calorie target is calculated, what total daily energy expenditure means, and how goals affect the
recommendation — with literature citations embedded in the prose.

| # | Element of the pattern | Classification | Why it matters |
| --- | --- | --- | --- |
| TRN-01 | The formula is **named**, not hidden | `DOCUMENTED_PUBLIC` | A user can verify the estimate independently |
| TRN-02 | The estimate is explicitly framed as rough, with a statement that the reliable route is measurement over time | `DOCUMENTED_PUBLIC` | Sets honest expectations for a number users tend to over-trust |
| TRN-03 | Claims are cited to primary literature | `OBSERVED_PUBLIC` | Makes the recommendation defensible rather than merely asserted |
| TRN-04 | A standing recommendation to consult a health professional accompanies the tool | `OBSERVED_PUBLIC` | The correct posture for a non-clinical product |
| TRN-05 | Help is attached to precisely the two fields most likely to be misunderstood | `OBSERVED_PUBLIC` | Targeted rather than uniform help |

## 4. Both products carry a standing medical disclaimer

| # | Finding | Classification | Source |
| --- | --- | --- | --- |
| MED-01 | Eat This Much states on public nutrition surfaces that the product is not a substitute for professional medical advice, and recommends consulting a professional before significant dietary change | `OBSERVED_PUBLIC` | ETM-02, ETM-03 |
| MED-02 | Eat This Much attaches a results disclaimer directly beneath its testimonials, stating outcomes are not guaranteed and restating what the product actually is | `OBSERVED_PUBLIC` | ETM-02 |
| MED-03 | Right Bite routes complex dietary requirements to a human rather than absorbing them into the interface, and presents named qualified practitioners as part of the offering | `DOCUMENTED_PUBLIC` | RB-05 |
| MED-04 | Right Bite attaches outcome expectations to dietitian consultation rather than to the interface, framing targets as personalised by a practitioner | `DOCUMENTED_PUBLIC` | RB-05 |

Our `MedicalDisclaimer` requirement — mandatory on nutrition targets, every virtual-dietitian state,
planner warnings, medical onboarding steps and review screens — is **consistent with established
practice in this product category**, and in placement it is more thorough than either reference.

## 5. What neither product displays publicly

| Item from our specification | Right Bite | Eat This Much |
| --- | --- | --- |
| Estimated maintenance calories, shown separately from the selected target | not shown | `UNKNOWN` (result step) |
| Macro percentages alongside grams | not shown | discouraged in copy; `UNKNOWN` in the result |
| Macro calories alongside grams | not shown | `UNKNOWN` |
| Tolerance range on a target | ranges shown at plan level | floors shown; ranges documented in the planner |
| Fibre target | not shown | not shown publicly |
| Calculation-source attribution on a value | not shown | method stated on the tool, not per value |
| Calculation timestamp | not shown | not shown |
| Recipe or nutrition version identifier | not shown | not shown |
| Professional-override indicator on a target | not shown | not shown publicly |
| "Why this target?" explanation attached to a computed value | not shown | adjacent panels, not attached per value |
| Per-100 g presentation | not shown | not shown publicly |
| Nutrition on a catalogue card | not shown | not observed |

**This table is the strongest argument for original design in the whole document set.** Ten of our
specification's nutrition-display requirements have **no public precedent in either reference**. We
are not behind these products on nutrition transparency; on the requirements we have set ourselves,
we are ahead of what either publicly shows, and we must design them from first principles.

## 6. Consequences for our nutrition display

| # | Our platform should implement… | Justified by |
| --- | --- | --- |
| IMP-01 | …plan-level and target-level nutrition as ranges with an explicit tolerance, never as false point precision, wherever the underlying value genuinely varies | RBN-03, RBN-06 |
| IMP-02 | …a visible separation between estimated maintenance energy and the selected target, since neither reference shows one and users conflate them | §5 |
| IMP-03 | …macro targets as absolute grams, with percentages available as a secondary view rather than the primary representation | CAL-09 |
| IMP-04 | …a named calculation method, a citation, and a plain statement that the figure is an estimate, on the nutrition-target page | TRN-01, TRN-02, TRN-03 |
| IMP-05 | …a "why this target?" interaction that discloses the inputs used and the assumptions made, attached to the value rather than parked elsewhere on the page | TRN-05, §5 |
| IMP-06 | …a source, a version and a calculation timestamp on every nutrition-facts panel, since neither reference offers any provenance and our fixtures are synthetic and must say so | §5 |
| IMP-07 | …fibre as a first-class target, since neither reference displays it publicly and our specification requires it | RBN-04, ETN-04 |
| IMP-08 | …nutrition summary information on marketplace catalogue cards, where both references omit it — a differentiator, provided the card stays legible | RBN-01 |
| IMP-09 | …a professional-override indicator wherever a practitioner has changed a computed value, since Right Bite's own copy makes the practitioner authoritative over the number but shows no such marker | RBN-06, MED-04 |
| IMP-10 | …nutrition status communicated by shape, pattern and numeric label as well as colour | our accessibility requirement; neither reference verified on this point |
| IMP-11 | …every synthetic fixture value labelled as synthetic prototype data, visibly in the facts panel and contractually in the source field | our own rule; no reference precedent |

## 7. Explicit statement on formulae

No formula, coefficient, threshold, band boundary or rounding rule was reverse-engineered from any
number displayed by either reference product. Where a method is named above, it is named because the
vendor states it publicly and cites published literature. Where a method is not stated, this
document records that **the internal algorithm is not observable** and stops there.

Our `MockNutritionTargetEngine` derives from published literature with citations, produces
deterministic results, and marks every result as prototype output. It reproduces no reference
product's calculation, and nothing in this document could be used to attempt one.
