# 04 — Component inventory

Reusable interface components identified on the public surfaces of both reference products.
Retrieval date for every row: **2026-07-30**.

This document describes **component roles and composition**, which are functional patterns. It
records no colour values, no typography, no imagery and no brand treatment — those are excluded by
`14-legal-and-licensing-boundaries.md`. Where a component is named, the name is our own descriptive
label, not the vendor's.

## 1. Right Bite — components

### 1.1 Navigation and chrome

| # | Component | Composition observed | Classification | Source |
| --- | --- | --- | --- | --- |
| RBC-01 | Header bar | Logo link, three or four primary links, a telephone link, an application-download link, and an authentication control | `OBSERVED_PUBLIC` | RB-02, RB-04 |
| RBC-02 | Overflow menu | A "More" affordance collapses secondary navigation; below the desktop breakpoint the entire navigation collapses into a menu button | `OBSERVED_PUBLIC` | RB-04 |
| RBC-03 | Menu panel | Full navigation, a language toggle, a region group under its own heading, and an application-download link | `OBSERVED_PUBLIC` | RB-04 |
| RBC-04 | Language toggle | Single control that switches to the other language, labelled in the target language | `OBSERVED_PUBLIC` | RB-04 |
| RBC-05 | Region selector | Two sibling controls under a "Region" heading | `OBSERVED_PUBLIC` | RB-04 |
| RBC-06 | Back control | A back affordance at the top of the plan detail page | `OBSERVED_PUBLIC` | RB-04 |
| RBC-07 | Footer | Grouped link columns, a telephone link, a live-chat entry, an application-download link, and a corporate-ownership line | `OBSERVED_PUBLIC` | RB-02 |
| RBC-08 | Authentication control | A header control opening an in-page panel rather than navigating to a route | `OBSERVED_PUBLIC` | RB-04 |

### 1.2 Catalogue and detail

| # | Component | Composition observed | Classification | Source |
| --- | --- | --- | --- | --- |
| RBC-10 | Plan card | Image, plan name, one- or two-line proposition, and a "starting from" per-meal price. **No calorie information, no macro information, no badge.** The whole card is the link | `OBSERVED_PUBLIC` | RB-03 |
| RBC-11 | Plan grid | Uniform card grid with no filter, sort or comparison control | `OBSERVED_PUBLIC` | RB-03 |
| RBC-12 | Dish thumbnail strip | Six labelled sample dishes on the plan detail page, each an image with a caption | `OBSERVED_PUBLIC` | RB-04 |
| RBC-13 | Document link | A link to a sample-menu document, presented twice on the same page | `OBSERVED_PUBLIC` | RB-04 |
| RBC-14 | Benefit tile grid | Four tiles, each an icon, a short title and a supporting line | `OBSERVED_PUBLIC` | RB-04 |
| RBC-15 | Statistic counters | Four large-number counters with captions | `OBSERVED_PUBLIC` | RB-04 |
| RBC-16 | Testimonial | Attributed quotation with a person's name | `OBSERVED_PUBLIC` | RB-04 |
| RBC-17 | Trust strip | Two short assurances placed adjacent to the primary action | `OBSERVED_PUBLIC` | RB-04 |
| RBC-18 | FAQ accordion | Question headings that expand to answers; used both inline on the plan page and as a standalone page | `OBSERVED_PUBLIC` | RB-04, RB-05 |

### 1.3 Configurator components — the most transferable group

| # | Component | Composition observed | Classification | Source |
| --- | --- | --- | --- | --- |
| RBC-20 | Package-type card | An icon or short code, a primary label naming the meals included, and a secondary line stating whether sides and snacks are included. Five siblings behave as a single-select group | `OBSERVED_PUBLIC` | RB-04 |
| RBC-21 | Calorie-band chip | A compact single-select chip whose entire label is a numeric range. Five siblings | `OBSERVED_PUBLIC` | RB-04 |
| RBC-22 | Duration chip with discount badge | A single-select chip carrying a day count, with an optional discount badge as a second line. Four siblings, three badged | `OBSERVED_PUBLIC` | RB-04 |
| RBC-23 | Deferred-input notice | A labelled block that occupies the visual slot of an input but states the choice is made later, with a one-line explanation | `OBSERVED_PUBLIC` | RB-04 |
| RBC-24 | Macro range summary | Three labelled figures — protein, carbohydrate, fat — each a range rather than a point value, under a shared heading, followed by a variability caveat | `OBSERVED_PUBLIC` | RB-04 |
| RBC-25 | Price summary and primary action | A subtotal line and the primary submit control, grouped | `OBSERVED_PUBLIC` | RB-04 |
| RBC-26 | Inline guidance link | Short prompts adjacent to a control ("not sure?") that link to a helper page | `OBSERVED_PUBLIC` | RB-04 |
| RBC-27 | Deferred-customisation note | A line under the package selector stating that dietary preferences are configured after purchase | `OBSERVED_PUBLIC` | RB-04 |

**Selected-state rendering.** The visual treatment of the selected chip or card was not observable,
because state changes did not take effect in this session. That the groups are single-select is
`INFERRED` from their structure and from a single subtotal being derived from them; recorded as
`RB-INF-02` in doc 13.

### 1.4 Business

| # | Component | Composition observed | Classification | Source |
| --- | --- | --- | --- | --- |
| RBC-30 | Audience section | Repeated block addressing one business audience with a proposition | `OBSERVED_PUBLIC` | RB-06 |
| RBC-31 | Enquiry form | Six fields — first name, last name, email, job role, company (a select), mobile number. **Not filled, not submitted** | `OBSERVED_PUBLIC` (structure) | RB-06 |

## 2. Eat This Much — components

### 2.1 Navigation and chrome

| # | Component | Composition observed | Classification | Source |
| --- | --- | --- | --- | --- |
| ETC-01 | Header bar | Logo, a dropdown group, two links, and two authentication actions rendered as distinct link styles | `OBSERVED_PUBLIC` | ETM-02 |
| ETC-02 | Dropdown navigation group | A parent link plus six children — five named diets and a "view all" | `OBSERVED_PUBLIC` | ETM-02 |
| ETC-03 | Menu button | Collapses navigation below the desktop breakpoint | `OBSERVED_PUBLIC` | ETM-02 |
| ETC-04 | Footer | Three link columns, application-store badges, social links and a copyright line | `OBSERVED_PUBLIC` | ETM-03 |
| ETC-05 | Store badge | Image link to an application store | `OBSERVED_PUBLIC` | ETM-03 |

### 2.2 Public generator — a compact, high-value pattern

| # | Component | Composition observed | Classification | Source |
| --- | --- | --- | --- | --- |
| ETC-10 | Diet chip group | Six labelled single-select options in a wrapping grid. Underlying values are more granular than the labels — one option's stored value names two dietary approaches while its label names one | `OBSERVED_PUBLIC` | ETM-02 |
| ETC-11 | Inline numeric field with unit | A number field embedded mid-sentence, with the unit as adjacent text, pre-filled with a default | `OBSERVED_PUBLIC` | ETM-02 |
| ETC-12 | Inline select with unit | A small select embedded mid-sentence, options one to six, defaulting to three | `OBSERVED_PUBLIC` | ETM-02 |
| ETC-13 | Read-only constraint chips | Three chips displaying macro minima as static text, not editable | `OBSERVED_PUBLIC` | ETM-02 |
| ETC-14 | Upgrade prompt | A line immediately beneath the read-only chips inviting account creation to unlock them | `OBSERVED_PUBLIC` | ETM-02 |
| ETC-15 | Cross-tool link | A prompt beside the calorie field linking to the calculator | `OBSERVED_PUBLIC` | ETM-02 |
| ETC-16 | Primary submit | A single generation action closing the form | `OBSERVED_PUBLIC` | ETM-02 |

**Pattern worth naming.** ETC-13 plus ETC-14 form a *visible-but-locked control* — the user sees the
capability, sees its current value, and is told precisely what unlocks it. This is materially better
than hiding the control, and is recommended in doc 17 §3 in original form.

### 2.3 Calculator components

| # | Component | Composition observed | Classification | Source |
| --- | --- | --- | --- | --- |
| ETC-20 | Unit-system toggle | Two-option single-select governing the unit of the three measurement fields | `OBSERVED_PUBLIC` | ETM-03 |
| ETC-21 | Segmented single-select | Repeated pattern used for sex (three options), body fat (three options) and units | `OBSERVED_PUBLIC` | ETM-03 |
| ETC-22 | Compound measurement field | Height rendered as **two** numeric inputs sharing one label and one unit caption | `OBSERVED_PUBLIC` | ETM-03 |
| ETC-23 | Numeric field with unit suffix | Weight and age; unit rendered as adjacent static text | `OBSERVED_PUBLIC` | ETM-03 |
| ETC-24 | Descriptive-option select | Activity level; option labels are lifestyle descriptions rather than numbers | `OBSERVED_PUBLIC` | ETM-03 |
| ETC-25 | Inline help disclosure | A help control attached to individual field labels — present on exactly the two fields most likely to confuse | `OBSERVED_PUBLIC` | ETM-03 |
| ETC-26 | Explanatory panel set | Six expandable panels beside the form explaining activity choice, macro basis, percentages, the calorie formula, TDEE and goals | `OBSERVED_PUBLIC` | ETM-03 |
| ETC-27 | Citation link | Literature links embedded in explanatory prose, pointing to primary sources | `OBSERVED_PUBLIC` | ETM-03 |
| ETC-28 | Sibling-tool card grid | Five cards, each a tool name and one-line description, linking to related calculators | `OBSERVED_PUBLIC` | ETM-03 |
| ETC-29 | Result panel | `UNKNOWN` — never rendered in this session | ETM-03 |

### 2.4 Marketing and trust

| # | Component | Composition observed | Classification | Source |
| --- | --- | --- | --- | --- |
| ETC-30 | Feature block | Heading plus explanatory paragraph, repeated four times | `OBSERVED_PUBLIC` | ETM-02 |
| ETC-31 | Award and rating strip | An award citation and two store ratings, each a score with a review count | `OBSERVED_PUBLIC` | ETM-02 |
| ETC-32 | Attributed testimonial | Quotation with a named person and a role or descriptor | `OBSERVED_PUBLIC` | ETM-02 |
| ETC-33 | **Results disclaimer** | A block immediately after the testimonials stating results are not guaranteed and explaining what the product actually is | `OBSERVED_PUBLIC` | ETM-02 |
| ETC-34 | **Medical disclaimer** | A standing statement that the product is not a substitute for professional medical advice, with a recommendation to consult a professional | `OBSERVED_PUBLIC` | ETM-02, ETM-03 |
| ETC-35 | Pricing tier card | Tier name, price, billing basis, and a feature list | `OBSERVED_PUBLIC` | ETM-04 |
| ETC-36 | Feature comparison | Feature names attributed to tiers, distinguishing free from paid capability | `OBSERVED_PUBLIC` | ETM-04 |

**ETC-34 is directly relevant to our own build.** Both reference products carry a standing medical
disclaimer on public nutrition surfaces. Our `MedicalDisclaimer` requirement is therefore not
over-caution; it matches established practice in this product category.

### 2.5 Planner components (documented, not observed)

Every row `DOCUMENTED_PUBLIC`; all screens `REQUIRES_PERMISSION`.

| # | Component | What the public documentation states | Source |
| --- | --- | --- | --- |
| ETC-40 | Meal group | Meals organised by type, each holding one or more foods | ETM-09 |
| ETC-41 | Per-meal regenerate control | A shuffle affordance regenerating one meal without affecting the rest of the day | ETM-09 |
| ETC-42 | Global regenerate control | A prominent control regenerating everything not locked | ETM-09 |
| ETC-43 | Lock/eaten control | A circle to the left of a food or meal; documented as available in the mobile application and not on the website | ETM-13 |
| ETC-44 | Preference controls | Favourite and block affordances on individual foods, steering future generation | ETM-09 |
| ETC-45 | Food bank sidebar | A source list from which foods are dragged into meal slots | ETM-09 |
| ETC-46 | Nutrition progress indicator | A progress bar that expands to show calories and macros consumed so far | ETM-13 |
| ETC-47 | Nutrition-profile selector | The active target set is a clickable label opening target editing; multiple named profiles are supported | ETM-09, ETM-12 |
| ETC-48 | Meal-layout editor | Add-meal control, drag-to-reorder, a same-every-day toggle, and per-day nutrition targets | ETM-12 |
| ETC-49 | Grocery list | Auto-syncing list with quantities, manual editing, a reset action and a delivery-partner export | ETM-09 |
| ETC-50 | Note affordance | Menus at day level and meal level that attach notes visible to the client and included in exports | ETM-14 |

## 3. Components present in one product and absent in the other

| Component role | Right Bite | Eat This Much | Note for our build |
| --- | --- | --- | --- |
| Calorie/macro calculator | absent | present | Our marketplace needs one; only ETM offers a public pattern |
| Plan comparison | absent | absent | **Neither reference offers one.** Our comparison screen has no reference precedent — design it from first principles |
| Catalogue filter/sort | absent | not observed | A fourteen-item catalogue survives without filters; a forty-meal catalogue will not |
| Nutrition information on catalogue cards | absent | not observed | Both omit it at card level. We should reconsider: see doc 17 §3 |
| Read-only locked control with upgrade prompt | absent | present | Adopt the pattern, originally implemented |
| Deferred-input notice | present | absent | Adopt: a good answer to "this step happens later" |
| Range-valued macro summary | present | absent | Adopt for plan-level nutrition where a point value would be false precision |
| Discount badge on a duration option | present | absent | Adopt for subscription duration |
| Explicit medical disclaimer | not observed on pages examined | present and repeated | Adopt, and place it more consistently than either reference |
| Literature citation in explanatory copy | absent | present | Adopt: it makes a nutrition calculation defensible |
| Per-day-of-week configuration | absent | present | Relevant to our planner |
| Region selector | present | absent | Relevant to our GCC multi-market build |

## 4. Component roles carried into our design system

These map observed roles onto components already planned for our design system. This is a
cross-reference, not a new decision.

| Observed role | Our planned component |
| --- | --- |
| RBC-20, RBC-21, RBC-22, ETC-10, ETC-21 | `SegmentedControl`, `Chip` / `FilterChip` |
| RBC-24, ETC-46 | `MeterBar`, `ProgressRing`, `MacroSummary` |
| RBC-18, ETC-26 | `Accordion` |
| RBC-23, RBC-27, ETC-14, ETC-33, ETC-34 | `Callout` — and its `MedicalDisclaimer` and `PrototypeNotice` derivatives |
| RBC-10, ETC-35 | `MealCard`, `PlanCard` |
| RBC-31, ETC-22, ETC-23 | `DateField`, `NumberStepper`, form field primitives |
| RBC-03, RBC-08 | `Drawer`, `ActionSheet` |
| ETC-25 | `Popover` |
| ETC-45, ETC-41 | Planner replacement drawer and per-entry actions |
| RBC-06, ETC-28 | `Breadcrumbs`, card grids |
| ETC-13 | `Chip` in a disabled/locked presentation with an adjacent `Callout` |
