# 10 — Meal-generation observations

> **Do not infer exact server calculations merely from displayed ranges.**
>
> _(Repeated verbatim from the project specification. It governs every statement in this document.)_

Retrieval date: **2026-07-30**.

## 1. Scope of this document, stated honestly

Eat This Much's meal generator is the reference capability closest to our own planner. **It was not
observed.** The generator lives behind authentication, and the public landing generator's response
never rendered in this session (doc 01 §5).

Everything below therefore comes from **Eat This Much's own public materials** — its help centre,
its how-to guide, its pricing and feature pages, and its partner-API page — and is classified
`DOCUMENTED_PUBLIC`. Where the vendor is silent, this document says `UNKNOWN` rather than guessing.

**No generation algorithm, scoring rule, weighting, constraint-solving strategy or selection
heuristic is claimed for the reference product.** The internal algorithm is not observable. What
follows is a description of *documented behaviour and user-facing capability*, from which our own
independent design can take its requirements.

## 2. Generation scopes

| # | Scope | What the public documentation states | Classification | Source |
| --- | --- | --- | --- | --- |
| GEN-01 | Single food | Individual foods carry a shuffle affordance that replaces just that food | `DOCUMENTED_PUBLIC` | ETM-09 |
| GEN-02 | Single meal | A per-meal shuffle regenerates that meal without affecting the rest of the day | `DOCUMENTED_PUBLIC` | ETM-09 |
| GEN-03 | Whole day | A prominent control regenerates the day; anything locked is preserved | `DOCUMENTED_PUBLIC` | ETM-09, ETM-13 |
| GEN-04 | Whole week | A weekly generator is a paid-tier capability | `DOCUMENTED_PUBLIC` | ETM-04, ETM-09 |
| GEN-05 | Partial periods | The documentation addresses planning for multiple weeks, or for just a few days | `DOCUMENTED_PUBLIC` | ETM-10 |
| GEN-06 | Constrained generation | Generating using only foods already held in the pantry is a documented mode | `DOCUMENTED_PUBLIC` | ETM-10 |
| GEN-07 | Single meal per day | Generating only one meal a day is a documented, supported configuration | `DOCUMENTED_PUBLIC` | ETM-10 |
| GEN-08 | What the generator does internally at any scope | `UNKNOWN`. **The internal algorithm is not observable.** | — | — |

**The most important structural finding is GEN-01 to GEN-04: four nested regeneration scopes.** Our
plan currently specifies three (entry, day, week). The reference documents a fourth, finer scope —
an individual food *within* a meal. This matters for a composed meal such as a main plus a side: the
user's real intention is often "keep this main, change the side", and only a food-level scope
expresses it.

## 3. What is preserved across regeneration

| # | Mechanism | What the public documentation states | Classification | Source |
| --- | --- | --- | --- | --- |
| PRS-01 | Locking | Checked items stay in place when plans are regenerated | `DOCUMENTED_PUBLIC` | ETM-13 |
| PRS-02 | The locking control | A circle beside the food or meal; documented as available in the mobile application and **not** on the website | `DOCUMENTED_PUBLIC` | ETM-13 |
| PRS-03 | Locking is the same action as marking eaten | Marking an item eaten is what fixes it in place | `DOCUMENTED_PUBLIC` | ETM-13 |
| PRS-04 | **The documented side effect** | Locking removes that item's ingredients from the grocery list; the vendor advises unlocking before shopping | `DOCUMENTED_PUBLIC` | ETM-13 |
| PRS-05 | Notes | Notes attached by a professional persist across regeneration of a meal, a day or a week | `DOCUMENTED_PUBLIC` | ETM-14 |
| PRS-06 | Blocked foods | Blocking excludes a food from future generation | `DOCUMENTED_PUBLIC` | ETM-09 |
| PRS-07 | Favourited foods | Favouriting steers future generation toward a food | `DOCUMENTED_PUBLIC` | ETM-09 |
| PRS-08 | Recurring foods | Scheduled foods recur into generated plans; a free-tier capability | `DOCUMENTED_PUBLIC` | ETM-04 |
| PRS-09 | Whether regeneration is deterministic or randomised | `UNKNOWN` | — | — |
| PRS-10 | Whether a regenerated meal can repeat a recently seen meal | `UNKNOWN` | — | — |

**PRS-03 and PRS-04 together are the clearest design defect visible anywhere in this research**, and
the vendor documents it themselves. Two distinct user intentions — "I have eaten this" and "keep
this in my plan" — share one control, and the consequence is that locking a meal silently removes
its ingredients from the shopping list. The workaround is documented, which means users hit it.

**Our platform should implement `locked` and `consumed` as two independent states on a plan entry**,
each with its own control and its own effect on the grocery list. This is recorded as decision
input `DEC-PLANNER-01` and carried to doc 17 §4.

## 4. Inputs the generator is documented to respect

| # | Input | What the public documentation states | Classification | Source |
| --- | --- | --- | --- | --- |
| INP-01 | Calorie target | A target is set, and the generator picks foods meeting the day's nutrition needs | `DOCUMENTED_PUBLIC` | ETM-02, ETM-09 |
| INP-02 | Macro targets | Carbohydrate, fat and protein constraints, publicly presented as floors | `DOCUMENTED_PUBLIC` | ETM-02 |
| INP-03 | Micronutrient targets | Targets for saturated fat, potassium and others are documented as supported | `DOCUMENTED_PUBLIC` | ETM-10 |
| INP-04 | Net versus total carbohydrate | A documented display and targeting option | `DOCUMENTED_PUBLIC` | ETM-10 |
| INP-05 | Diet classification | Six public options; the documentation describes customising an eating style rather than only picking a preset | `DOCUMENTED_PUBLIC` | ETM-02 |
| INP-06 | Meal count and layout | Up to nine meals a day, arranged in an editable layout | `DOCUMENTED_PUBLIC` | ETM-12 |
| INP-07 | Per-day-of-week variation | Different layouts and different targets per day, on the paid tier | `DOCUMENTED_PUBLIC` | ETM-12 |
| INP-08 | Custom meal types | Users create their own meal types to carry day-specific settings | `DOCUMENTED_PUBLIC` | ETM-12 |
| INP-09 | Meal size | A meal-size setting influences generation; documented as applying when generating from scratch | `DOCUMENTED_PUBLIC` | ETM-12 |
| INP-10 | Ingredient filtering / exclusions | Named as a product capability | `DOCUMENTED_PUBLIC` | ETM-04 |
| INP-11 | Pantry contents | The generator is stated to prioritise using foods the user already owns | `DOCUMENTED_PUBLIC` | ETM-02 |
| INP-12 | Grocery-list efficiency | The weekly generator is stated to consider the resulting grocery list in order to reduce waste | `DOCUMENTED_PUBLIC` | ETM-09 |
| INP-13 | Variety | The weekly generator is stated to ensure variety across days | `DOCUMENTED_PUBLIC` | ETM-09 |
| INP-14 | Leftovers | Automatic leftovers handling on the paid tier | `DOCUMENTED_PUBLIC` | ETM-04 |
| INP-15 | Exercise / energy expended | Documented as enterable and factored in | `DOCUMENTED_PUBLIC` | ETM-10 |
| INP-16 | Budget | The landing page names budget as an input to personalisation; **no budget control is publicly reachable** | `DOCUMENTED_PUBLIC` (claim) / `REQUIRES_PERMISSION` (control) | ETM-02 |
| INP-17 | Schedule / time available | Named on the landing page as an input; no control publicly reachable | `DOCUMENTED_PUBLIC` (claim) / `REQUIRES_PERMISSION` (control) | ETM-02 |
| INP-18 | Preparation time, recipe complexity | Not named in any public material examined | `UNKNOWN` | — |
| INP-19 | Meal timing (clock times per meal) | Not confirmed; the documentation covers meal *count*, *order* and *type*, not times of day | `UNKNOWN` | — |
| INP-20 | How any of these inputs are weighted against one another | `UNKNOWN`. **The internal algorithm is not observable.** | — | — |

## 5. Generation as a partner capability

The vendor's partner-API page describes generation as a contracted service. This is the clearest
public statement of generation *granularity* available, because a commercial interface must name
what it sells.

| # | Statement | Classification | Source |
| --- | --- | --- | --- |
| API-01 | Plans can be generated for a full week, a single day, or an individual meal | `OFFICIAL_API_AVAILABLE` / `DOCUMENTED_PUBLIC` | ETM-06 |
| API-02 | Generation accepts calorie and macro targets | `DOCUMENTED_PUBLIC` | ETM-06 |
| API-03 | Diet presets are supported, together with ingredient exclusions | `DOCUMENTED_PUBLIC` | ETM-06 |
| API-04 | A recipe corpus in the thousands is offered, with nutrition data and preparation instructions | `DOCUMENTED_PUBLIC` | ETM-06 |
| API-05 | Grocery lists are produced with ingredients aggregated across meals and dates | `DOCUMENTED_PUBLIC` | ETM-06 |
| API-06 | Output is available as structured data or as rendered documents | `DOCUMENTED_PUBLIC` | ETM-06 |
| API-07 | The generation algorithm itself | `UNKNOWN` — a commercial interface exposes capability, not method | — |

API-01 independently corroborates GEN-02 to GEN-04, and API-05's phrasing — aggregation across
meals *and dates* — tells us the grocery list is a genuine roll-up over a date range rather than a
per-day list concatenated.

## 6. What the reference does **not** publicly document

| Item | Status |
| --- | --- |
| Scoring or ranking of candidate foods | `UNKNOWN` — the internal algorithm is not observable |
| How hard constraints and soft preferences are traded off | `UNKNOWN` |
| Whether generation is deterministic for identical inputs | `UNKNOWN` |
| Repetition-avoidance window | `UNKNOWN` |
| Behaviour when no feasible plan exists | `UNKNOWN` — **no failure state is documented anywhere in the public material** |
| Behaviour when a restriction conflicts with a target | `UNKNOWN` |
| Allergen handling as distinct from ingredient exclusion | `UNKNOWN` — no public material distinguishes them |
| Time budget or timeout for a generation request | `UNKNOWN` |
| Portion adjustment on an already-generated entry, as distinct from the pre-generation meal-size setting | `UNKNOWN` |
| Whether professional-set restrictions bind more strongly than user preferences | `UNKNOWN` |

**The last five rows are the most consequential gaps.** The reference publishes nothing about
failure, conflict, allergen safety or professional authority. Our specification requires explicit
states for all of them — generation failed, restriction conflict, no suitable meals, safety
escalation, professional override. **We have no reference precedent for any of these and must design
them from first principles.**

That is not a research shortfall. A vendor does not market its failure states. It does mean these
screens carry more design risk than the ones with precedent, and it is exactly why our specification
enumerates them.

## 7. Requirements our internal planner takes from this

Design inputs, not implementations. Our scoring rules are our own; **no competitor scoring rule is
invented or assumed anywhere in this document.**

| # | Our platform should implement… | Justified by |
| --- | --- | --- |
| REQ-01 | …four regeneration scopes: individual food, meal, day and week | GEN-01–GEN-04 |
| REQ-02 | …`locked` and `consumed` as independent states on a plan entry, with independent controls and independent grocery-list effects | PRS-03, PRS-04 |
| REQ-03 | …persistent per-food preference signals — favour and exclude — that outlive any single plan | PRS-06, PRS-07 |
| REQ-04 | …notes that survive regeneration at every scope | PRS-05 |
| REQ-05 | …pantry contents as a soft preference that raises an item's desirability, never as a hard constraint | INP-11 |
| REQ-06 | …grocery-list efficiency and cross-day variety as explicit soft preferences in week-scope generation | INP-12, INP-13 |
| REQ-07 | …meal layout as a first-class configurable structure, with optional per-day-of-week variation | INP-06, INP-07 |
| REQ-08 | …portion adjustment on an existing entry, distinct from any pre-generation size setting, since the reference conflates them | INP-09, §6 |
| REQ-09 | …explicit, designed states for generation failure, restriction conflict, no suitable meals and safety escalation | §6 |
| REQ-10 | …allergens as a hard constraint modelled separately from ingredient dislikes, never merged into one exclusion list | §6 |
| REQ-11 | …clinician-enforced restrictions that outrank user preference, with a visible indication of why an option is unavailable | §6 |
| REQ-12 | …a documented, explainable scoring rationale surfaced to the user, since neither reference explains why a given meal was chosen | §6 |
| REQ-13 | …deterministic generation in the prototype, clearly marked as prototype output | our own rule |
| REQ-14 | …grocery aggregation across meals and dates, not per-day lists | API-05 |

## 8. Closing statement on method

This document contains no claim about how either reference product computes anything. It records
documented capability and documented behaviour, attributes each to the vendor's own public material,
and marks every gap. Where the vendor is silent, this document is silent.

**The internal algorithm is not observable.**
