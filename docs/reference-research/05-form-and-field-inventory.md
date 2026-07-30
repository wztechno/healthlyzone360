# 05 — Form and field inventory

Every publicly reachable input on both reference products, with its type, options and defaults.
Retrieval date for every row: **2026-07-30**.

**No form on either product was submitted with personal data. No account form was completed.** Where
a form collects personal data, its field list is recorded from structure only and marked as such.

## 1. Eat This Much — calorie calculator (`/calculator`)

Method: `browser` (Document Object Model read). This is the most completely observable form in
either product.

| # | Field | Control type | Options / units | Default | Classification |
| --- | --- | --- | --- | --- | --- |
| ETF-01 | Preferred units | Radio group, two options | "U.S. Standard", "Metric" | U.S. Standard | `OBSERVED_PUBLIC` |
| ETF-02 | Sex | Radio group, three options | "Male", "Female", "Non-Binary" | Male | `OBSERVED_PUBLIC` |
| ETF-03 | Height | **Two** numeric inputs under one label | Unit caption "ft in" in the U.S. Standard state | empty | `OBSERVED_PUBLIC` |
| ETF-04 | Weight | Numeric input | Unit caption "lbs" in the U.S. Standard state | empty | `OBSERVED_PUBLIC` |
| ETF-05 | Age | Numeric input | Unit caption "years" | empty | `OBSERVED_PUBLIC` |
| ETF-06 | Bodyfat | Radio group, three options | "Low", "Medium", "High" | Medium | `OBSERVED_PUBLIC` |
| ETF-07 | Activity | Select, five options | See §1.1 | first option | `OBSERVED_PUBLIC` |
| ETF-08 | Submit | Button | — | — | `OBSERVED_PUBLIC` |
| ETF-09 | Goal | **Not present on the form** | — | — | `OBSERVED_PUBLIC` (absence) |

### 1.1 Activity option values — observable in the public markup

The activity select's option labels are lifestyle descriptions, but each option carries a numeric
value that is present in the public page markup and was read directly:

| Option label (paraphrased by position) | Value in markup |
| --- | --- |
| Desk job, light exercise | `1.2` |
| Lightly active, workout three to four times weekly | `1.375` |
| Active daily, frequent exercise | `1.55` |
| Very athletic | `1.725` |
| Extremely athletic | `1.9` |

| # | Claim | Classification | Note |
| --- | --- | --- | --- |
| ETF-10 | These five multipliers are present as option values in the public markup | `OBSERVED_PUBLIC` | Read from the served document, not inferred from any displayed result |
| ETF-11 | These are the conventional published activity factors used with basal-metabolic-rate estimation, and are not proprietary | `DOCUMENTED_PUBLIC` | They are standard values in the published literature |
| ETF-12 | How these multipliers combine with the basal estimate to produce the final target, including any rounding, banding or goal adjustment | `UNKNOWN` | **The internal algorithm is not observable.** |

### 1.2 Stated calculation method

| # | Claim | Classification | Source |
| --- | --- | --- | --- |
| ETF-13 | The public documentation states the tool uses the Mifflin–St Jeor formula to estimate basal metabolic rate, plus an activity-factor multiplier to estimate total daily energy expenditure | `DOCUMENTED_PUBLIC` | ETM-03 |
| ETF-14 | The explanatory copy links directly to the primary literature for both the formula and the concept of basal metabolic rate | `OBSERVED_PUBLIC` | ETM-03 |
| ETF-15 | The public documentation describes the protein basis in terms of published intake guidance and cites two peer-reviewed sources | `DOCUMENTED_PUBLIC` | ETM-03 |
| ETF-16 | The public documentation states carbohydrate is scaled by activity level, weight and goal, and that fat is treated as having an essential floor | `DOCUMENTED_PUBLIC` | ETM-03 |
| ETF-17 | The public documentation describes a conventional energy-per-unit-of-body-mass figure when explaining how a goal shifts the target | `DOCUMENTED_PUBLIC` | ETM-03 |
| ETF-18 | The exact macro-derivation rules, coefficients, ordering, clamping and rounding | `UNKNOWN` | **The internal algorithm is not observable.** No coefficient was reconstructed. |

### 1.3 Field-level help and explanation

| # | Observation | Classification | Source |
| --- | --- | --- | --- |
| ETF-20 | Inline help controls are attached to exactly two field labels — sex and body fat — and not to the others | `OBSERVED_PUBLIC` | ETM-03 |
| ETF-21 | Six explanatory panels sit beside the form: choosing an activity level, the basis for macro suggestions, why percentage targets are discouraged, how the calorie target is calculated, what total daily energy expenditure means, and how goals affect the recommendation | `OBSERVED_PUBLIC` | ETM-03 |
| ETF-22 | The activity panel offers a five-band plain-language guide whose band names differ from the select's option labels | `OBSERVED_PUBLIC` | ETM-03 |
| ETF-23 | Attaching help to precisely the two most ambiguous fields, and putting method explanation adjacent rather than behind a link, is a deliberate transparency choice | `INFERRED` | ETM-03 |

### 1.4 What was exercised, and what was not

Synthetic, non-personal values were entered into the numeric fields: height five feet nine inches,
weight one hundred and sixty-five pounds, age thirty; with the form's own defaults for sex, body fat
and activity. The values were accepted into the fields. **The `Submit` action did not reach the page
in this session** (doc 01 §5), so the result step never rendered.

| # | Item | Classification |
| --- | --- | --- |
| ETF-30 | Calculator output values for any input set | `UNKNOWN` |
| ETF-31 | Result-step layout, and whether a goal selector appears there | `UNKNOWN` |
| ETF-32 | Behaviour of the unit toggle (whether fields switch to centimetres and kilograms, and whether entered values convert) | `UNKNOWN` |
| ETF-33 | Client-side validation rules, bounds and error messages | `UNKNOWN` |

**No output value was estimated, and no formula was reconstructed from any displayed number.**

## 2. Eat This Much — public meal-plan generator (landing page)

| # | Field | Control type | Options | Default | Classification |
| --- | --- | --- | --- | --- | --- |
| ETF-40 | Preferred Diet | Radio group, six options | Labels: Anything, Keto, Mediterranean, Paleo, Vegan, Vegetarian | Anything | `OBSERVED_PUBLIC` |
| ETF-41 | Calorie target | Numeric input, inline in a sentence | — | pre-filled with a default value | `OBSERVED_PUBLIC` |
| ETF-42 | Number of meals | Select, inline in a sentence | 1, 2, 3, 4, 5, 6 | 3 | `OBSERVED_PUBLIC` |
| ETF-43 | Carbohydrate minimum | **Display only**, not an input | shows a gram figure | fixed | `OBSERVED_PUBLIC` |
| ETF-44 | Fat minimum | **Display only** | shows a gram figure | fixed | `OBSERVED_PUBLIC` |
| ETF-45 | Protein minimum | **Display only** | shows a gram figure | fixed | `OBSERVED_PUBLIC` |
| ETF-46 | Generate | Submit button | — | — | `OBSERVED_PUBLIC` |

| # | Claim | Classification | Note |
| --- | --- | --- | --- |
| ETF-47 | One diet option's stored value names two dietary approaches while its visible label names only one | `OBSERVED_PUBLIC` | The underlying taxonomy is more granular than the presented labels. Our own diet classification should likewise separate the internal identifier from the display label. |
| ETF-48 | The three macro minima are framed as floors ("at least"), not as exact targets or ceilings | `OBSERVED_PUBLIC` | A meaningful modelling choice: a generator satisfying floors has a feasible search space in a way that exact targets do not. |
| ETF-49 | The macro minima become editable on account creation; the prompt sits immediately beneath them | `DOCUMENTED_PUBLIC` | ETM-02 |
| ETF-50 | Whether the displayed minima change in response to the entered calorie target | `UNKNOWN` | Not exercisable in this session |
| ETF-51 | The anonymous generator response | `UNKNOWN` | Activation did not reach the page |
| ETF-52 | No units, sex, height, weight, age or activity input appears on this form — it takes a calorie number directly and links out to the calculator for everything else | `OBSERVED_PUBLIC` | A clean separation of "estimate my target" from "make me a plan" |

## 3. Right Bite — plan configurator

Not a form in the conventional sense: the controls are grouped single-select button sets, and the
submit is a single subscribe action.

| # | Field | Control type | Options | Default | Classification |
| --- | --- | --- | --- | --- | --- |
| RBF-01 | Package type | Single-select card group, five options | Distinguished by which meals of the day are included, and by whether sides and snacks are included. Four options include them; one is explicitly without | not observable | `OBSERVED_PUBLIC` |
| RBF-02 | Calories | Single-select chip group, five options | Contiguous bands rising from a lowest band; each option is a range, never a point value | not observable | `OBSERVED_PUBLIC` |
| RBF-03 | Package duration | Single-select chip group, four options | Day counts of five, twenty, forty and sixty; the three longer options carry percentage discount badges rising with duration | not observable | `OBSERVED_PUBLIC` |
| RBF-04 | Start date | **Not an input.** A notice states the choice is made after checkout | — | — | `OBSERVED_PUBLIC` |
| RBF-05 | Dietary preference / allergies | **Not an input.** A note states customisation happens after purchase | — | — | `OBSERVED_PUBLIC` |
| RBF-06 | Delivery days | **Not an input.** A note states day flexibility is managed in the application | — | — | `OBSERVED_PUBLIC` |
| RBF-07 | Delivery address | **Not an input** on this page. The FAQ states availability is confirmed at checkout by entering a location | `DOCUMENTED_PUBLIC` | — |
| RBF-08 | Delivery slot | **Not an input.** Presented as a benefit, configured later | `OBSERVED_PUBLIC` | — |
| RBF-09 | Subtotal | Read-only derived figure | — | — | `OBSERVED_PUBLIC` |
| RBF-10 | Subscribe | Submit control with no hyperlink target; script-driven | — | — | `OBSERVED_PUBLIC` |

| # | Claim | Classification | Note |
| --- | --- | --- | --- |
| RBF-11 | The public configurator collects **exactly three** decisions before requesting anything personal | `OBSERVED_PUBLIC` | Package type, calorie band, duration |
| RBF-12 | Each group is single-select | `INFERRED` | From structure plus a single derived subtotal; state changes were not exercisable. Recorded as `RB-INF-02` in doc 13 |
| RBF-13 | The default selection in each group | `UNKNOWN` | Selected-state rendering was not observable |
| RBF-14 | The subtotal recomputes when a selection changes | `INFERRED` | A subtotal is present and the duration options carry differing discounts, so a static value would be incoherent. Not observed. Recorded as `RB-INF-03` in doc 13 |
| RBF-15 | Whether the macro ranges change with the selected calorie band | `UNKNOWN` | Not exercisable |
| RBF-16 | Validation, error and unavailable-option states | `UNKNOWN` | Not exercisable |

**Design lesson recorded.** The reference defers five inputs — start date, dietary preference,
allergies, delivery days, delivery address and slot — past the purchase decision, and *says so in
place* rather than omitting them. This keeps the pre-purchase form to three decisions. The cost is
that a subscriber commits money before knowing whether their allergy can be accommodated. Doc 17 §5
takes the pattern and rejects that cost.

## 4. Right Bite — business enquiry form

| # | Field | Control type | Classification |
| --- | --- | --- | --- |
| RBF-20 | First name | Text | `OBSERVED_PUBLIC` (structure only) |
| RBF-21 | Last name | Text | `OBSERVED_PUBLIC` (structure only) |
| RBF-22 | Email address | Text | `OBSERVED_PUBLIC` (structure only) |
| RBF-23 | Job role | Text | `OBSERVED_PUBLIC` (structure only) |
| RBF-24 | Company | Select | `OBSERVED_PUBLIC` (structure only) |
| RBF-25 | Mobile number | Text | `OBSERVED_PUBLIC` (structure only) |

**This form was not filled and not submitted.** No personal data was entered. Its post-submission
behaviour, validation and confirmation state are `REQUIRES_PERMISSION`.

| # | Claim | Classification | Note |
| --- | --- | --- | --- |
| RBF-26 | The business enquiry collects identity and contact details but **no order parameters** — no quantity, no site count, no delivery schedule, no budget | `OBSERVED_PUBLIC` | Qualification is deferred to a human conversation |
| RBF-27 | Company being a select rather than free text implies a curated account list or a segment picker | `INFERRED` | Recorded as `RB-INF-04` in doc 13 |

## 5. Forms behind the boundary

| # | Form | Product | Classification |
| --- | --- | --- | --- |
| GAP-01 | Registration and sign-in | Both | `REQUIRES_PERMISSION` |
| GAP-02 | Checkout: identity, address, slot, start date, payment | Right Bite | `REQUIRES_PERMISSION` |
| GAP-03 | Post-purchase preference and allergy capture | Right Bite | `REQUIRES_PERMISSION` |
| GAP-04 | Onboarding questionnaire | Eat This Much | `REQUIRES_PERMISSION` |
| GAP-05 | Nutrition-target editing and named nutrition profiles | Eat This Much | `REQUIRES_PERMISSION`; existence `DOCUMENTED_PUBLIC` (ETM-12) |
| GAP-06 | Meal-layout editor | Eat This Much | `REQUIRES_PERMISSION`; existence `DOCUMENTED_PUBLIC` (ETM-12) |
| GAP-07 | Ingredient exclusion, food preferences, budget, preparation time, recipe complexity | Eat This Much | `REQUIRES_PERMISSION`; the landing page names food preferences, budget and schedule as inputs to personalisation, but no such control is publicly reachable |
| GAP-08 | Client provisioning and permission editing | Eat This Much professional | `REQUIRES_PERMISSION`; the equivalent API parameters are `OFFICIAL_API_AVAILABLE` (see doc 16) |

## 6. Field-level observations carried into our onboarding design

Our onboarding is a twenty-two step wizard. These observations inform it; decisions are in doc 17 §6.

| # | Observation | Consequence for our onboarding |
| --- | --- | --- |
| FLD-01 | The reference calculator asks unit system **first**, before any measurement | Ask units first; every later step renders in the chosen system |
| FLD-02 | Height is a compound field in imperial and would be a single field in metric | Our `DateField`-style platform split needs an equivalent compound-vs-single height control |
| FLD-03 | Body fat is offered as three coarse bands rather than a number | A band is a legitimate, low-friction alternative to a percentage; our optional body-fat step should accept either, and only switch calculation method when a usable value exists |
| FLD-04 | Sex is offered with a non-binary option **and** an inline help control | Our step must explain why the value is requested, name which calculation consumes it, and not force a binary answer |
| FLD-05 | Activity is offered as lifestyle descriptions, with a longer plain-language guide adjacent | Never present a bare multiplier; present a description and explain it |
| FLD-06 | Macro targets are floors, not exact values | Our nutrition contracts already carry tolerance ranges; treat floors as first-class, not as a target with slack |
| FLD-07 | The reference calculator carries no goal field, yet explains goals at length | Our flow separates estimated maintenance from selected target, and asks goal and pace as their own steps — a clearer separation than the reference |
| FLD-08 | Neither reference publicly distinguishes allergy from intolerance from dislike from religious restriction from clinician-enforced restriction | **No reference precedent exists for our six restriction kinds.** This is an area where our design leads rather than follows; it must be designed from first principles and reviewed by a qualified professional |
