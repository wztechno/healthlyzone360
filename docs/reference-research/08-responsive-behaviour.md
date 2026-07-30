# 08 — Responsive behaviour

Retrieval date: **2026-07-30**. Method: `browser` — viewport resized, then element geometry read
directly from layout.

**This is the most reliably observed document in the set.** Layout measurement does not depend on
the page compositing frames, so the numbers below are genuine measurements of the served pages at
the stated viewport widths, not inferences. Where a value is derived rather than measured, it says
so.

Two pages were measured: Right Bite's plan detail and configurator page, and Eat This Much's landing
page. Widths chosen from our own responsive target list: 390 px (small handset), 768 px (portrait
tablet) and 1280 px (desktop).

## 1. Right Bite — plan detail and configurator

### 1.1 Measurements

| Property | 390 px | 768 px | 1280 px | Classification |
| --- | --- | --- | --- | --- |
| Document scroll width | 390 | 753 | 1265 | `OBSERVED_PUBLIC` |
| Horizontal page overflow | none | none | none | `OBSERVED_PUBLIC` |
| Menu button | displayed, 56 × 59 | displayed | **not displayed** | `OBSERVED_PUBLIC` |
| Configurator column left edge | 16 | 24 | 609 | `OBSERVED_PUBLIC` |
| Configurator column width | 356 | 719 | 632 | `OBSERVED_PUBLIC` |
| Package-type cards, layout | 5 in one row | 5 in one row | 3 + 2, wrapped | `OBSERVED_PUBLIC` |
| Package-type card size | 200 × 234 | 200 × 234 | 200 × 234 / 200 × 210 | `OBSERVED_PUBLIC` |
| Rightmost package card's right edge | 1080 | 1088 | 1241 | `OBSERVED_PUBLIC` |
| Calorie chips per row | 3 | 3 | 4 | `OBSERVED_PUBLIC` |
| Calorie chip size | 111 × 40 | 227 × 40 | 149 × 40 | `OBSERVED_PUBLIC` |
| Primary action width | 356 | 719 | 632 | `OBSERVED_PUBLIC` |
| Primary action height | 56 | 56 | 56 | `OBSERVED_PUBLIC` |
| Primary action positioning | in flow, not pinned | in flow | in flow | `OBSERVED_PUBLIC` |

### 1.2 What the numbers mean

| # | Finding | Classification |
| --- | --- | --- |
| RBR-01 | The page never scrolls horizontally at any measured width. At 390 px the document scroll width equals the viewport exactly | `OBSERVED_PUBLIC` |
| RBR-02 | **The package-type selector is a horizontally scrolling strip at 390 px and 768 px.** Five cards of fixed 200 px width sit in one row whose right edge reaches 1080 px inside a 390 px viewport, yet the page itself does not overflow — the overflow is contained within the strip | `OBSERVED_PUBLIC` |
| RBR-03 | The card width is fixed at 200 px across every measured viewport; the selector adapts by changing how many are visible, not by resizing them | `OBSERVED_PUBLIC` |
| RBR-04 | At 1280 px the same five cards wrap into a 3 + 2 grid instead of scrolling, and the second row's cards are shorter — 210 px against 234 px | `OBSERVED_PUBLIC` |
| RBR-05 | **The layout changes from one column to two between 768 px and 1280 px.** At 768 px the configurator begins at x = 24 and spans nearly the full width; at 1280 px it begins at x = 609 and spans 632 px, leaving the left half of the page to media | `OBSERVED_PUBLIC` |
| RBR-06 | The navigation breakpoint sits in the same interval: the menu button is displayed at 768 px and suppressed at 1280 px | `OBSERVED_PUBLIC` |
| RBR-07 | Chips reflow by changing both count per row and individual width — 3 × 111 px, then 3 × 227 px, then 4 × 149 px — so the grid is fluid rather than fixed-column | `OBSERVED_PUBLIC` |
| RBR-08 | Chip height is constant at 40 px across all three widths | `OBSERVED_PUBLIC` |
| RBR-09 | The primary action always spans the full configurator column and never becomes a pinned bar | `OBSERVED_PUBLIC` |
| RBR-10 | A tablet at 768 px is treated as a large phone, not as a small desktop: single column, hamburger navigation, scrolling card strip | `OBSERVED_PUBLIC` |
| RBR-11 | The exact breakpoint between one and two columns | `UNKNOWN` — it lies between 768 px and 1280 px; intermediate widths were not measured |

## 2. Eat This Much — landing page

### 2.1 Measurements

| Property | 390 px | 768 px | Classification |
| --- | --- | --- | --- |
| Document scroll width | 390 | 753 | `OBSERVED_PUBLIC` |
| Horizontal page overflow | none | none | `OBSERVED_PUBLIC` |
| Menu button | displayed | displayed | `OBSERVED_PUBLIC` |
| Generator form left edge | 16 | 16 | `OBSERVED_PUBLIC` |
| Generator form size | 358 × 499 | 721 × 536 | `OBSERVED_PUBLIC` |
| Diet chips per row | 2 | 3 | `OBSERVED_PUBLIC` |
| Diet chip size | 175 × 42 | 235 × 95 | `OBSERVED_PUBLIC` |
| Generate button size | 130 × 40 | 130 × 40 | `OBSERVED_PUBLIC` |
| Generate button position | horizontally centred | horizontally centred | `OBSERVED_PUBLIC` |

### 2.2 What the numbers mean

| # | Finding | Classification |
| --- | --- | --- |
| ETR-01 | No horizontal page overflow at either measured width | `OBSERVED_PUBLIC` |
| ETR-02 | **The diet chip changes shape, not merely size, between the two widths** — 175 × 42 at 390 px against 235 × 95 at 768 px. A chip more than twice as tall at the wider viewport indicates a different internal arrangement, most plausibly a stacked icon-and-label form giving way to a compact inline form on the narrow viewport | `OBSERVED_PUBLIC` (measurement) / `INFERRED` (the cause) |
| ETR-03 | The form grid moves from two columns to three | `OBSERVED_PUBLIC` |
| ETR-04 | The form's overall height barely changes — 499 px against 536 px — despite doubling in width, because the chip grid compensates | `OBSERVED_PUBLIC` |
| ETR-05 | The submit control is a fixed 130 × 40 at both widths and is centred rather than stretched. **It does not become a full-width action on the narrow viewport** | `OBSERVED_PUBLIC` |
| ETR-06 | A 768 px viewport still receives the collapsed menu, matching Right Bite's treatment of a portrait tablet | `OBSERVED_PUBLIC` |
| ETR-07 | Behaviour at 1280 px on this page | `UNKNOWN` — not measured; measurement effort was concentrated on the calculator and on Right Bite's configurator |

## 3. Convergence between the two products

| # | Observation | Both products | Classification |
| --- | --- | --- | --- |
| CNV-01 | Neither page ever scrolls horizontally at any measured width | yes | `OBSERVED_PUBLIC` |
| CNV-02 | Both collapse navigation into a menu button at 768 px and below | yes | `OBSERVED_PUBLIC` |
| CNV-03 | Both treat a portrait tablet as a large phone rather than a small desktop | yes | `OBSERVED_PUBLIC` |
| CNV-04 | Both keep chip and card option groups as wrapping or scrolling grids rather than converting them to native select controls on narrow viewports | yes | `OBSERVED_PUBLIC` |
| CNV-05 | Neither uses a pinned bottom action bar on the narrow viewport | yes | `OBSERVED_PUBLIC` |
| CNV-06 | Neither exposes a bottom tab bar on the web at any measured width | yes | `OBSERVED_PUBLIC` |

CNV-05 and CNV-06 are notable **divergences from our own plan**, which specifies bottom tabs and
touch-safe full-screen workflows on mobile. Our plan targets a universal application including
native builds; both references are responsive websites whose native applications were not examined.
The divergence is therefore expected, and is recorded in doc 17 §8 rather than treated as a
correction.

## 4. Touch-target measurements — a cautionary finding

Measured control heights on the narrow viewport, against the forty-four-unit minimum our own
accessibility requirements assert:

| Control | Product | Height at 390 px | Meets 44 |
| --- | --- | --- | --- |
| Menu button | Right Bite | 59 | yes |
| Package-type card | Right Bite | 234 | yes |
| Primary subscribe action | Right Bite | 56 | yes |
| **Calorie band chip** | Right Bite | **40** | **no** |
| **Duration chip** | Right Bite | **40** (same group styling) | **no** |
| **Diet chip** | Eat This Much | **42** | **no** |
| **Generate button** | Eat This Much | **40** | **no** |

| # | Finding | Classification |
| --- | --- | --- |
| TCH-01 | Both products ship interactive controls below the conventional forty-four-unit minimum touch target on a 390 px viewport | `OBSERVED_PUBLIC` |
| TCH-02 | In both cases the under-sized controls are the *primary decision controls* of the page — the option chips a user must tap to configure anything, and one product's submit action | `OBSERVED_PUBLIC` |
| TCH-03 | Whether either product compensates with additional tap padding beyond the rendered box | `UNKNOWN` — only the element box was measured |

**This is a place where our build should not follow the references.** Our responsive specification
asserts a forty-four-unit minimum at every mobile viewport and our test suite enforces it. These
measurements confirm the assertion is not pedantry: two mature, well-reviewed products both fall
below it on exactly the controls that matter most.

## 5. Coverage against our seven responsive targets

Our own specification tests at 1440 × 1000, 1280 × 800, 1024 × 768, 768 × 1024, 430 × 932, 390 × 844
and 360 × 800. Reference coverage achieved:

| Target width | Right Bite | Eat This Much |
| --- | --- | --- |
| 1440 | not measured | not measured |
| 1280 | **measured** | not measured |
| 1024 | not measured | not measured |
| 768 | **measured** | **measured** |
| 430 | not measured | not measured |
| 390 | **measured** | **measured** |
| 360 | not measured | not measured |

Three widths were measured on the page that mattered most, and two on a second page. Widths were not
exhaustively swept, because the purpose was to identify *structural transitions* — one column to
two, inline navigation to menu, wrap to scroll — and those were located. The unmeasured widths are
`UNKNOWN`; none of our implementation decisions depends on them.

## 6. Responsive patterns carried forward

| # | Pattern | Evidence | Our position |
| --- | --- | --- | --- |
| RSP-01 | Contain horizontal overflow inside the scrolling component; never let the document scroll sideways | RBR-01, RBR-02, ETR-01 | **Adopt**, and our responsive specification already asserts it |
| RSP-02 | A fixed-width card strip that scrolls when narrow and wraps into a grid when wide | RBR-02, RBR-04 | **Adopt** for our meal and plan card rails, with a visible scroll affordance (doc 07, MOT-08) |
| RSP-03 | Chips that reflow by count and width while holding a constant height | RBR-07, RBR-08 | **Adopt**, but raise the constant height to meet the touch minimum |
| RSP-04 | Two-column workspace on desktop — media or context on one side, controls on the other — collapsing to one column below | RBR-05 | **Adopt** for plan detail, meal detail and the nutrition-target page |
| RSP-05 | Portrait tablet treated as a large phone | RBR-10, ETR-06, CNV-03 | **Adopt for the marketplace; reject for the planner.** A 768 px weekly planner has room for a genuine multi-day grid, and collapsing it to an agenda there wastes the viewport |
| RSP-06 | Full-width primary action within its column on narrow viewports | RBR-09 | **Adopt** |
| RSP-07 | A fixed-size, centred submit control that does not adapt | ETR-05 | **Reject.** Our primary actions span their column on narrow viewports |
| RSP-08 | Under-sized touch targets | TCH-01, TCH-02 | **Reject explicitly.** Enforced by test |
| RSP-09 | Option groups stay as chips on mobile rather than becoming native selects | CNV-04 | **Adopt for short option sets; reconsider for long ones.** Our date and time inputs remain platform-native by prior decision |
