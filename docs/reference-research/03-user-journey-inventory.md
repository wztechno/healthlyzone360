# 03 — User journey inventory

Journeys as far as they are publicly traceable. Retrieval date for every row: **2026-07-30**.
Where a journey crosses the authentication or personal-data boundary, the crossing point is named
exactly and everything beyond it is classified `REQUIRES_PERMISSION`.

## 1. Right Bite — journey RB-J1: anonymous visitor to subscription checkpoint

This is the primary public journey and the one this research walked in full to its boundary.

| Step | What the public interface presents | Classification | Source |
| --- | --- | --- | --- |
| 1 | Landing page offers plan categories as the main entry, alongside dietitian consultation and app download | `OBSERVED_PUBLIC` | RB-02 |
| 2 | Plan catalogue lists fourteen plans as cards; the whole card is the link; no filter, sort or comparison control is present | `OBSERVED_PUBLIC` | RB-03 |
| 3 | Plan detail page opens with marketing, sample dish imagery and a downloadable sample-menu document | `OBSERVED_PUBLIC` | RB-04 |
| 4 | **Choose package type** — five mutually exclusive options, distinguished by which meals of the day are included and whether sides and snacks are included | `OBSERVED_PUBLIC` | RB-04 |
| 5 | A note states that dietary preferences such as vegan or pescatarian are configured _after purchase_ | `OBSERVED_PUBLIC` | RB-04 |
| 6 | **Choose calories** — five mutually exclusive calorie bands | `OBSERVED_PUBLIC` | RB-04 |
| 7 | A helper link offers guidance for choosing a band | `OBSERVED_PUBLIC` | RB-04 |
| 8 | **Choose duration** — four options; three carry a percentage discount badge | `OBSERVED_PUBLIC` | RB-04 |
| 9 | A start-date block states the start date is chosen _after checkout_ | `OBSERVED_PUBLIC` | RB-04 |
| 10 | **Nutrition breakdown** shows macro ranges with a caveat that they vary with preferences and dietitian recommendation | `OBSERVED_PUBLIC` | RB-04 |
| 11 | **Subtotal** and a primary `Subscribe` control | `OBSERVED_PUBLIC` | RB-04 |
| **12** | **CHECKPOINT — the journey stops here.** See §1.1 | `REQUIRES_PERMISSION` | RB-04 |

### 1.1 The personal-data checkpoint, stated exactly

**The checkpoint is the `Subscribe` control at the foot of the plan configurator on
`/en-ae/subscribe-to-a-plan/{plan}`.**

Everything above that control is anonymous, configurable and requires no personal data: package
type, calorie band, duration and the resulting subtotal are all selectable and readable without an
account.

The `Subscribe` control carries **no hyperlink target**; it is script-driven. The header offers a
`Log In` control that opens an in-page panel rather than navigating to a public route. The site
presents **no anonymous guest-checkout path** anywhere in the public surface examined.

Three separate pieces of the vendor's own public copy independently confirm that identity, address
and scheduling are collected on the far side of this control:

- the configurator states the start date is selected after checkout;
- the configurator states plan customisation for dietary preference happens after purchase;
- the FAQ states delivery availability is confirmed at checkout by entering a location.

Therefore **delivery-address entry, delivery-day selection, delivery-slot selection, start-date
selection, dietary-preference capture, allergy capture, account identity and payment all lie beyond
the checkpoint** and are classified `REQUIRES_PERMISSION`. No attempt was made to pass it. These
items are itemised for a permissioned session in `15-rightbite-manual-capture-checklist.md`.

## 2. Right Bite — journey RB-J2: post-purchase plan management

Not observable. Reconstructed **only** from the vendor's own public statements.

| Step | What the public documentation states | Classification | Source |
| --- | --- | --- | --- |
| 1 | The subscriber chooses a start date after checkout | `DOCUMENTED_PUBLIC` | RB-04 |
| 2 | The subscriber customises the plan for dietary preference after purchase | `DOCUMENTED_PUBLIC` | RB-04 |
| 3 | The subscriber browses a daily menu and selects meals from a rotating catalogue described as exceeding seven hundred dishes | `DOCUMENTED_PUBLIC` | RB-05 |
| 4 | The subscriber rates meals, and the vendor states this feeds menu refinement | `DOCUMENTED_PUBLIC` | RB-05 |
| 5 | The subscriber flags allergies and dietary preferences including gluten-free, dairy-free and vegetarian; more complex requirements are routed to customer service | `DOCUMENTED_PUBLIC` | RB-05 |
| 6 | The subscriber pauses the plan; the FAQ states a thirty-six-hour advance window | `DOCUMENTED_PUBLIC` | RB-05 |
| 7 | The terms state a hold may be placed with forty-eight hours' notice | `DOCUMENTED_PUBLIC` | RB-07 |
| 8 | The subscriber manages which days receive delivery | `DOCUMENTED_PUBLIC` | RB-04 |
| 9 | The subscriber delivers to multiple addresses; a location change requires two working days' notice | `DOCUMENTED_PUBLIC` | RB-04, RB-07 |
| 10 | The subscriber selects among delivery slots; a three-hour delivery window is quoted | `DOCUMENTED_PUBLIC` | RB-04, RB-07 |
| 11 | Every screen implementing steps 1–10 | `REQUIRES_PERMISSION` | — |

**A documented inconsistency worth recording.** The FAQ's pause window (thirty-six hours) and the
terms' hold notice period (forty-eight hours) do not agree. We do not know which governs, and we do
not need to; the lesson carried forward is that **a subscription product must state its cut-off in
exactly one authoritative place and render it from one value.** Recorded as `RB-INC-01` in doc 13.

## 3. Right Bite — journey RB-J3: dietitian consultation

| Step | Public presentation | Classification | Source |
| --- | --- | --- | --- |
| 1 | Dietitians are a primary navigation item, not a sub-page of plans | `OBSERVED_PUBLIC` | RB-02 |
| 2 | Named practitioners have individual profile routes | `OBSERVED_PUBLIC` | RB-02 |
| 3 | A "book consultation" action appears in the footer and on the landing page | `OBSERVED_PUBLIC` | RB-02 |
| 4 | Consultations are stated to be included free with every plan, in person at a clinic or online | `DOCUMENTED_PUBLIC` | RB-05 |
| 5 | A premium tier is stated to include unlimited consultations and a dedicated support line | `DOCUMENTED_PUBLIC` | RB-05 |
| 6 | The booking flow itself, including any personal-data collection | `REQUIRES_PERMISSION` | — |

Carried forward: the reference treats the human professional as a **bundled entitlement of the
subscription**, and surfaces practitioners by name and face before purchase. This is a
trust-building pattern our marketplace can adopt originally.

## 4. Right Bite — journey RB-J4: business enquiry

| Step | Public presentation | Classification | Source |
| --- | --- | --- | --- |
| 1 | A partners page addresses four distinct audiences: corporates, gyms, event organisers, and influencers/affiliates | `OBSERVED_PUBLIC` | RB-06 |
| 2 | Corporate is positioned as discounted employee access to the consumer plans, not a separate catalogue | `OBSERVED_PUBLIC` | RB-06 |
| 3 | Event catering is positioned as macro-counted meals for activations and pop-ups | `OBSERVED_PUBLIC` | RB-06 |
| 4 | An affiliate programme offers commission to content creators | `OBSERVED_PUBLIC` | RB-06 |
| 5 | An enquiry form collects first name, last name, email address, job role, company and mobile number | `OBSERVED_PUBLIC` (field inventory read) | RB-06 |
| 6 | **The form was not filled and not submitted.** No personal data was entered | policy | RB-06 |
| 7 | No minimum order quantity, volume tier or contract price appears anywhere on the public page | `OBSERVED_PUBLIC` (absence) | RB-06 |
| 8 | Everything after form submission — quotation, pricing, contracting | `REQUIRES_PERMISSION` | — |

Carried forward: the reference keeps **all business pricing private behind an enquiry**. This
matches, and independently supports, our own fixed rule that customer-facing screens must never
expose business contract prices.

## 5. Eat This Much — journey ETM-J1: anonymous visitor to public generator

| Step | Public presentation | Classification | Source |
| --- | --- | --- | --- |
| 1 | The landing page states its proposition and immediately offers an inline generator, above the feature marketing | `OBSERVED_PUBLIC` | ETM-02 |
| 2 | The visitor picks a diet from six mutually exclusive options | `OBSERVED_PUBLIC` | ETM-02 |
| 3 | The visitor sets a calorie target in a numeric field, pre-filled with a default | `OBSERVED_PUBLIC` | ETM-02 |
| 4 | A link offers the calorie calculator for visitors who do not know their target | `OBSERVED_PUBLIC` | ETM-02 |
| 5 | The visitor picks a meal count from one to six, defaulting to three | `OBSERVED_PUBLIC` | ETM-02 |
| 6 | Three macro minima are **displayed but not editable**, with copy inviting account creation to set specific targets | `OBSERVED_PUBLIC` | ETM-02 |
| 7 | A `Generate` control submits the form | `OBSERVED_PUBLIC` | ETM-02 |
| 8 | What the generator returns to an anonymous visitor | `UNKNOWN` — activation did not reach the page in this session (doc 01 §5) | ETM-02 |
| 9 | Saving, editing, regenerating or exporting a generated plan | `REQUIRES_PERMISSION` | ETM-04 |

Carried forward: the reference **gives away a generation result before asking for anything**, and
uses the _editable macro target_ as the first paywall. The upgrade prompt sits exactly on the
control the visitor wants next. This is a strong, original-implementable acquisition pattern.

## 6. Eat This Much — journey ETM-J2: calorie calculator

| Step | Public presentation | Classification | Source |
| --- | --- | --- | --- |
| 1 | The tool is reachable without an account, from navigation, footer and the landing generator | `OBSERVED_PUBLIC` | ETM-02, ETM-03 |
| 2 | The visitor chooses a unit system, sex, height, weight, age, body-fat band and activity level (full field detail in doc 05) | `OBSERVED_PUBLIC` | ETM-03 |
| 3 | Contextual help is available beside the two fields most likely to confuse — sex and body fat | `OBSERVED_PUBLIC` | ETM-03 |
| 4 | Six explanatory panels sit beside the form covering activity choice, macro basis, percentages, the calorie formula, TDEE and goals | `OBSERVED_PUBLIC` | ETM-03 |
| 5 | The vendor states the tool uses the Mifflin–St Jeor formula plus an activity-factor multiplier, and links to the primary literature | `DOCUMENTED_PUBLIC` | ETM-03 |
| 6 | A `Submit` control produces results | `OBSERVED_PUBLIC` (control exists) | ETM-03 |
| 7 | The result presentation — values, layout, whether a goal is chosen at this step | `UNKNOWN` — the result step was never rendered in this session | ETM-03 |
| 8 | Persisting the result as a nutrition target | `REQUIRES_PERMISSION` | ETM-04 |

**No goal selector was present on the calculator form itself**, yet the explanatory panels discuss
how goals affect the recommendation. A possible implementation would collect the goal on the result
step. This is `INFERRED` and recorded as `ETM-INF-03` in doc 13.

## 7. Eat This Much — journey ETM-J3: the planner (documented only)

Every row below is `DOCUMENTED_PUBLIC` from the vendor's own help centre and how-to guide. **No
planner screen was observed.** Detail is expanded in `10-meal-generation-observations.md`.

| Step | What the public documentation states | Source |
| --- | --- | --- |
| 1 | The user configures a meal layout — up to nine meals per day — in a meal-settings editor | ETM-12 |
| 2 | Meals may be added, and reordered by dragging | ETM-12 |
| 3 | By default one layout applies to every day; a toggle allows a different layout per day of the week, on the paid tier | ETM-12 |
| 4 | Nutrition targets are attached per day and may be swapped between saved target sets | ETM-12 |
| 5 | The generator produces a day; a control regenerates the whole day, and a per-meal control regenerates one meal without disturbing the rest | ETM-09 |
| 6 | Individual foods carry favourite and block actions that steer future generation | ETM-09 |
| 7 | Foods may be dragged from a sidebar food bank into meal slots | ETM-09 |
| 8 | Marking an item as eaten also **locks** it, so it survives regeneration | ETM-13 |
| 9 | Locking an item also removes its ingredients from the grocery list — the vendor warns users to unlock before shopping | ETM-13 |
| 10 | A weekly generator runs on the paid tier, considers the resulting grocery list to reduce waste, and is scheduled relative to the user's shopping day | ETM-09 |
| 11 | The grocery list updates automatically as meals change, supports manual editing and a reset, and exports to a grocery-delivery partner | ETM-09 |
| 12 | A pantry holds foods the user already owns, and the generator prioritises using them | ETM-02 |
| 13 | Leftovers are handled automatically on the paid tier | ETM-04 |
| 14 | Every screen implementing steps 1–13 | `REQUIRES_PERMISSION` |

**Design signal worth carrying:** step 8 conflates two distinct user intentions — "I ate this" and
"keep this in my plan" — and step 9 is the visible cost of that conflation, serious enough that the
vendor documents a workaround. Recorded as observation `ETM-OBS-LOCK` and acted on in doc 17 §4.

## 8. Eat This Much — journey ETM-J4: professional and client

Every row `DOCUMENTED_PUBLIC`. Expanded in `12-professional-workflow-analysis.md`.

| Step | What the public documentation states | Source |
| --- | --- | --- |
| 1 | A professional subscribes to one of two tiers, differing chiefly in whether clients may use the application | ETM-05 |
| 2 | Clients are provisioned by the professional, optionally with an invitation email | ETM-11 |
| 3 | An admin dashboard manages clients centrally and switches between client accounts | ETM-05 |
| 4 | The professional builds a plan against the client's targets, preferences and restrictions | ETM-05 |
| 5 | The professional attaches notes at day level or individual meal level | ETM-14 |
| 6 | Notes are visible to the client in web and mobile applications, and are included in exported documents and emails | ETM-14 |
| 7 | Notes persist across regeneration of a meal, day or week | ETM-14 |
| 8 | Plans are distributed as branded documents or email, optionally with the vendor watermark removed | ETM-05 |
| 9 | On the higher tier, per-client permissions are customised and the professional can view the client's logs | ETM-05 |
| 10 | Plans are saved and reused from account history | ETM-05 |
| 11 | Client provisioning is also available through the API to professional-tier accounts | `OFFICIAL_API_AVAILABLE` — ETM-11 |
| 12 | Every screen implementing steps 1–10 | `REQUIRES_PERMISSION` |

## 9. Journey coverage against the specification checklist

The specification enumerates journey topics for both products. This table records coverage honestly,
including the gaps.

| Topic | Right Bite | Eat This Much |
| --- | --- | --- |
| Catalogue browse | `OBSERVED_PUBLIC` | `UNKNOWN` (diet hub not enumerated) |
| Plan/meal detail | `OBSERVED_PUBLIC` | `UNKNOWN` |
| Calorie/macro calculation | not offered publicly | `OBSERVED_PUBLIC` (inputs) / `UNKNOWN` (outputs) |
| Onboarding questionnaire | `REQUIRES_PERMISSION` | `REQUIRES_PERMISSION` |
| Plan generation | not applicable | `DOCUMENTED_PUBLIC` |
| Meal regeneration / lock / swap / portion | `REQUIRES_PERMISSION` | `DOCUMENTED_PUBLIC` |
| Grocery list / pantry / leftovers | not applicable | `DOCUMENTED_PUBLIC` |
| Subscription configuration | `OBSERVED_PUBLIC` | not applicable |
| Checkout | `REQUIRES_PERMISSION` | `REQUIRES_PERMISSION` |
| Pause / resume / skip | `DOCUMENTED_PUBLIC` (existence) / `REQUIRES_PERMISSION` (screens) | not applicable |
| Delivery day / slot / address | `DOCUMENTED_PUBLIC` (existence) / `REQUIRES_PERMISSION` (screens) | not applicable |
| Meal selection / replacement / rating | `DOCUMENTED_PUBLIC` (existence) / `REQUIRES_PERMISSION` (screens) | `DOCUMENTED_PUBLIC` |
| Delivery status | `REQUIRES_PERMISSION` | not applicable |
| Professional client workflow | consultation only, `DOCUMENTED_PUBLIC` | `DOCUMENTED_PUBLIC` |
| Plan sharing / export | `REQUIRES_PERMISSION` | `DOCUMENTED_PUBLIC` |
| Business / corporate | `OBSERVED_PUBLIC` (proposition) / `REQUIRES_PERMISSION` (pricing) | `OBSERVED_PUBLIC` (API proposition) |
