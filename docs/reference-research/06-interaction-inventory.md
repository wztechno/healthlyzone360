# 06 — Interaction inventory

Interaction patterns on both reference products. Retrieval date for every row: **2026-07-30**.

**Read this caveat before every table.** In this session the browser pane could not composite
frames, so synthetic pointer and keyboard events did not reach either page (doc 01 §5). Structure
and layout were readable; **state transitions were not**. Consequently many rows below record that a
control *exists* as `OBSERVED_PUBLIC` while its *behaviour* is `UNKNOWN` or, where the vendor
describes it in its own documentation, `DOCUMENTED_PUBLIC`. Nothing was inferred from an unobserved
transition.

## 1. Right Bite — public interactions

### 1.1 Configurator

| # | Interaction | Control exists | Behaviour | Source |
| --- | --- | --- | --- | --- |
| RBI-01 | Select a package type from five options | `OBSERVED_PUBLIC` | `UNKNOWN` — selected-state rendering not observable | RB-04 |
| RBI-02 | Select a calorie band from five options | `OBSERVED_PUBLIC` | `UNKNOWN` | RB-04 |
| RBI-03 | Select a duration from four options | `OBSERVED_PUBLIC` | `UNKNOWN` | RB-04 |
| RBI-04 | Subtotal recalculates on selection change | `OBSERVED_PUBLIC` (a subtotal is rendered) | `INFERRED` — see `RB-INF-03`, doc 13. A discounted duration option was activated and the subtotal did not change, **but this is attributable to the environment, not to the site** | RB-04 |
| RBI-05 | Macro ranges respond to the selected calorie band | `OBSERVED_PUBLIC` (ranges are rendered) | `UNKNOWN` | RB-04 |
| RBI-06 | Submit the configuration | `OBSERVED_PUBLIC` — a `Subscribe` control with no hyperlink target | `REQUIRES_PERMISSION` — the checkpoint (doc 03 §1.1) | RB-04 |
| RBI-07 | Open the sample-menu document | `OBSERVED_PUBLIC` — link to an external asset host | not followed, by policy | RB-04 |
| RBI-08 | Follow inline guidance from the calorie selector | `OBSERVED_PUBLIC` | `OBSERVED_PUBLIC` — a conventional navigation | RB-04 |

### 1.2 Navigation and chrome

| # | Interaction | Control exists | Behaviour | Source |
| --- | --- | --- | --- | --- |
| RBI-10 | Open the navigation menu below the desktop breakpoint | `OBSERVED_PUBLIC` — a menu button present at 390 px and 768 px, hidden at 1280 px | `UNKNOWN` (panel transition) | RB-04 |
| RBI-11 | Close the menu panel | `OBSERVED_PUBLIC` — a close control exists in the panel tree | `UNKNOWN` | RB-04 |
| RBI-12 | Switch language | `OBSERVED_PUBLIC` — a single toggle labelled in the target language | `UNKNOWN` — whether it navigates to a different locale route or re-renders in place | RB-04 |
| RBI-13 | Switch region | `OBSERVED_PUBLIC` — two sibling controls | `UNKNOWN` — whether catalogue, currency or delivery rules change | RB-04 |
| RBI-14 | Open the authentication panel | `OBSERVED_PUBLIC` — a header control with no route | `REQUIRES_PERMISSION` | RB-04 |
| RBI-15 | Expand an FAQ item | `OBSERVED_PUBLIC` — heading controls that expand answers | `OBSERVED_PUBLIC` — answers are present in the served document, so the content is expand/collapse rather than fetch-on-demand | RB-04 |
| RBI-16 | Navigate back from a plan detail page | `OBSERVED_PUBLIC` — an explicit back control in addition to browser history | `UNKNOWN` | RB-04 |
| RBI-17 | Open the mobile application | `OBSERVED_PUBLIC` — an attribution link with a deep-link scheme and a web fallback | not followed | RB-04 |
| RBI-18 | Whole plan card acts as a single link target | `OBSERVED_PUBLIC` | `OBSERVED_PUBLIC` | RB-03 |

### 1.3 Interactions the vendor documents but which are gated

| # | Interaction | Classification | Source |
| --- | --- | --- | --- |
| RBI-20 | Pause a plan, stated to require advance notice | `DOCUMENTED_PUBLIC` / screens `REQUIRES_PERMISSION` | RB-05, RB-07 |
| RBI-21 | Resume a paused plan | `REQUIRES_PERMISSION` — **not described anywhere in the public copy examined** | — |
| RBI-22 | Skip a day | `DOCUMENTED_PUBLIC` (day flexibility is claimed) / `REQUIRES_PERMISSION` | RB-04 |
| RBI-23 | Select and replace meals from a rotating menu | `DOCUMENTED_PUBLIC` / `REQUIRES_PERMISSION` | RB-05 |
| RBI-24 | Rate a meal | `DOCUMENTED_PUBLIC` / `REQUIRES_PERMISSION` | RB-05 |
| RBI-25 | Change delivery address, with a stated notice period | `DOCUMENTED_PUBLIC` / `REQUIRES_PERMISSION` | RB-04, RB-07 |
| RBI-26 | Change delivery slot | `DOCUMENTED_PUBLIC` / `REQUIRES_PERMISSION` | RB-04 |
| RBI-27 | View delivery status | `REQUIRES_PERMISSION` — **not described in the public copy examined** | — |
| RBI-28 | Flag allergies and dietary preferences | `DOCUMENTED_PUBLIC` / `REQUIRES_PERMISSION` | RB-05 |
| RBI-29 | Escalate a complex dietary requirement to a human | `DOCUMENTED_PUBLIC` — routed to customer service rather than self-service | RB-05 |

**RBI-29 is worth carrying.** The reference draws an explicit line between requirements the
interface handles and requirements a human must handle. Our platform faces the same line with
clinician-enforced restrictions and serious allergies, and should draw it just as explicitly rather
than implying the interface can absorb everything.

## 2. Eat This Much — public interactions

### 2.1 Landing generator

| # | Interaction | Control exists | Behaviour | Source |
| --- | --- | --- | --- | --- |
| ETI-01 | Choose a diet from six options | `OBSERVED_PUBLIC` | `UNKNOWN` | ETM-02 |
| ETI-02 | Type a calorie target | `OBSERVED_PUBLIC` — accepts input | `OBSERVED_PUBLIC` — values were accepted into the field | ETM-02 |
| ETI-03 | Choose a meal count | `OBSERVED_PUBLIC` | `UNKNOWN` | ETM-02 |
| ETI-04 | Attempt to edit a macro minimum | `OBSERVED_PUBLIC` — **these are not controls**; they are static text | `OBSERVED_PUBLIC` — the capability is visibly present and visibly unavailable | ETM-02 |
| ETI-05 | Generate a plan anonymously | `OBSERVED_PUBLIC` | `UNKNOWN` — activation did not reach the page | ETM-02 |
| ETI-06 | Follow the upgrade prompt beneath the locked chips | `OBSERVED_PUBLIC` | `OBSERVED_PUBLIC` — navigates to registration | ETM-02 |
| ETI-07 | Follow the cross-link to the calculator | `OBSERVED_PUBLIC` | `OBSERVED_PUBLIC` | ETM-02 |

### 2.2 Calculator

| # | Interaction | Control exists | Behaviour | Source |
| --- | --- | --- | --- | --- |
| ETI-10 | Switch unit system | `OBSERVED_PUBLIC` | `UNKNOWN` — the toggle's underlying state changed but the dependent field captions did not re-render in this session; attributable to the environment | ETM-03 |
| ETI-11 | Choose sex, body fat | `OBSERVED_PUBLIC` | `UNKNOWN` | ETM-03 |
| ETI-12 | Enter height as two components | `OBSERVED_PUBLIC` | `OBSERVED_PUBLIC` — both components accepted values independently | ETM-03 |
| ETI-13 | Enter weight, age | `OBSERVED_PUBLIC` | `OBSERVED_PUBLIC` — values accepted | ETM-03 |
| ETI-14 | Choose an activity level | `OBSERVED_PUBLIC` | `UNKNOWN` | ETM-03 |
| ETI-15 | Open inline help on a field | `OBSERVED_PUBLIC` — present on sex and body fat only | `UNKNOWN` (disclosure transition) | ETM-03 |
| ETI-16 | Expand an explanatory panel | `OBSERVED_PUBLIC` — six panels | `OBSERVED_PUBLIC` — panel content is present in the served document | ETM-03 |
| ETI-17 | Follow a literature citation | `OBSERVED_PUBLIC` | not followed — outside scope | ETM-03 |
| ETI-18 | Submit and receive a result | `OBSERVED_PUBLIC` (control) | `UNKNOWN` — **the result step was never rendered** | ETM-03 |
| ETI-19 | Move between the sibling calculators | `OBSERVED_PUBLIC` — five cross-linked tools | `OBSERVED_PUBLIC` | ETM-03 |

### 2.3 Planner interactions (documented, not observed)

All rows `DOCUMENTED_PUBLIC`; all screens `REQUIRES_PERMISSION`. Expanded in doc 10.

| # | Interaction | What the public documentation states | Source |
| --- | --- | --- | --- |
| ETI-20 | Regenerate one meal | A per-meal shuffle affordance replaces that meal only, leaving the rest of the day untouched | ETM-09 |
| ETI-21 | Regenerate the whole day | A prominent control regenerates everything that is not locked | ETM-09 |
| ETI-22 | Regenerate a week | A weekly generator runs on the paid tier, taking the resulting grocery list into account to reduce waste | ETM-09 |
| ETI-23 | Regenerate a single food within a meal | Foods carry their own shuffle affordance | ETM-09 |
| ETI-24 | Lock an item | Tapping a circle beside a food or meal fixes it; documented as available in the mobile application and not on the website | ETM-13 |
| ETI-25 | Mark an item eaten | **The same control.** Marking as eaten is what locks it | ETM-13 |
| ETI-26 | Consequence of locking | Locking removes that item's ingredients from the grocery list; the vendor advises unlocking before shopping | ETM-13 |
| ETI-27 | Favourite a food | Steers future generation toward it | ETM-09 |
| ETI-28 | Block a food | Excludes it from future generation | ETM-09 |
| ETI-29 | Add a food by dragging | Foods are dragged from a sidebar food bank into meal slots | ETM-09 |
| ETI-30 | Move or copy meals, or a whole day | Documented as supported | ETM-10 |
| ETI-31 | Reorder meals | Meals are dragged into position in the layout editor | ETM-12 |
| ETI-32 | Adjust portion | A meal-size setting influences generation; the documentation states it applies when generating from scratch, and that a single meal may then be modified manually | ETM-12, websearch |
| ETI-33 | Modify a recipe or add a substitution note | Documented as supported | ETM-10 |
| ETI-34 | Edit the grocery list, or reset it | Documented as supported | ETM-09 |
| ETI-35 | Export the grocery list to a delivery partner | Documented as a one-click export | ETM-09 |
| ETI-36 | Add owned foods to a pantry | The generator is stated to prioritise using them | ETM-02 |
| ETI-37 | Generate using only pantry foods | Documented as a supported mode | ETM-10 |
| ETI-38 | Automate leftovers | Documented as a paid-tier capability | ETM-04 |
| ETI-39 | Schedule recurring foods | Documented as available on the free tier | ETM-04 |
| ETI-40 | Add a food by barcode | Documented as available on the free tier | ETM-04 |
| ETI-41 | Attach a note to a day or a meal | Via menus at day level and meal level; notes survive regeneration | ETM-14 |
| ETI-42 | Export a plan as a document or email it | Documented; a paid capability, with professional branding on the professional tier | ETM-04, ETM-05 |
| ETI-43 | Switch between managed client accounts | Documented as a professional admin-dashboard capability | ETM-05 |

## 3. Interaction patterns worth carrying, and one worth rejecting

| # | Pattern | Where seen | Verdict |
| --- | --- | --- | --- |
| PAT-01 | Scoped regeneration at three levels — item, meal, day, week | Eat This Much | **Adopt.** Our planner already plans meal, day and week regeneration scopes; the reference confirms a fourth, finer scope at individual-food level is useful |
| PAT-02 | Locking as the mechanism that makes regeneration safe | Eat This Much | **Adopt the mechanism** |
| PAT-03 | Locking and eaten-tracking sharing one control | Eat This Much | **Reject.** It causes a documented, user-visible grocery-list defect. Our platform should implement these as two distinct states on the same entry — `locked` and `consumed` — with independent controls |
| PAT-04 | Favourite and block as persistent generation signals attached to a food, not to a plan | Eat This Much | **Adopt.** Maps to our soft-preference model |
| PAT-05 | Drag-and-drop from a source list into a slot | Eat This Much | **Adopt only as a web enhancement.** Our fixed decision is that a keyboard "move to" action is the primary mechanism; drag remains an enhancement and never the only route |
| PAT-06 | Deferring configuration past purchase and saying so in place | Right Bite | **Adopt the notice pattern; reject deferring allergies.** See doc 17 §5 |
| PAT-07 | Escalating complex dietary requirements to a human | Right Bite | **Adopt.** Aligns with our dietitian-review and safety-escalation states |
| PAT-08 | A visible-but-locked control with an adjacent explanation of what unlocks it | Eat This Much | **Adopt**, in original form, for prototype-only actions and for any future tiering |
| PAT-09 | Whole card as a single link target | Right Bite | **Adopt with care.** It is fine when the card has one action; our meal cards carry several, so the card body links and the actions are separate targets |
| PAT-10 | Answers present in the document and toggled, rather than fetched on expansion | Both | **Adopt.** Better for search engines, for no-script rendering and for assistive technology |

## 4. Interaction accessibility observations

Only what was genuinely observable is recorded. Keyboard and screen-reader behaviour could not be
exercised in this session.

| # | Observation | Classification | Source |
| --- | --- | --- | --- |
| A11Y-01 | Both products build their single-select groups from native radio inputs wrapped in labels, rather than from unlabelled generic elements | `OBSERVED_PUBLIC` | ETM-02, ETM-03 |
| A11Y-02 | Right Bite's configurator groups are built from button elements rather than radio inputs, so group semantics depend on additional attributes that were not verified | `OBSERVED_PUBLIC` (element types) / `UNKNOWN` (semantics) | RB-04 |
| A11Y-03 | Right Bite's menu, close and back controls carry accessible names; one contains a spelling error, which indicates hand-authored labels rather than generated ones | `OBSERVED_PUBLIC` | RB-04 |
| A11Y-04 | Eat This Much's height inputs share a single label between two fields; the second field had no separately readable name | `OBSERVED_PUBLIC` | ETM-03 |
| A11Y-05 | Keyboard operability, focus visibility, focus order and screen-reader announcements on either product | `UNKNOWN` — not exercisable | — |
| A11Y-06 | Touch-target sizes: several controls measure under the conventional forty-four-unit minimum on the narrow viewport | `OBSERVED_PUBLIC` — see doc 08 §4 | ETM-02 |

**A11Y-03 and A11Y-04 are cautionary, not exemplary.** Our own build should give every input its own
programmatic name, including each component of a compound measurement field.
