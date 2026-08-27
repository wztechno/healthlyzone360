# Handoff: Wellness Green — Healthy360

## Overview

This package applies the **Wellness Green** mood board to the Healthy360 product
(`apps/universal`, Expo SDK 57 + NativeWind 4 + Tailwind 3.4).

The important finding first, because it changes what the work is:

**The colour palette is already applied.** `packages/design-tokens` already emits the wellness-green
values — `surface-base` is `#F7FCF9`, `accent-surface` is the mood board's violet `#6D28D9`,
`font-display` is Space Grotesk. A token swap is not the task, and re-running one will change
nothing visible.

What makes the current build read as generic is **structural**, and it is specific:

1. Cards in a grid do not share a baseline — each card's height follows its content, so the price,
   the one number a shopper compares, sits at a different vertical position in every card.
2. The price is the least prominent element on a card that exists to sell it.
3. Energy and protein — the product's stated differentiator, documented in `meal-card.tsx`'s own
   header comment — are not visible in the browse grid.
4. A page opens with a breadcrumb, an H1 and a form field. There is no moment of weight anywhere
   above the fold.
5. Toolbars occupy three stacked rows with ~1,400px of dead space between the left and right groups.
6. The most emphasised control in the top bar is **Sign out**. The basket is unstyled text.

This handoff fixes those, and does it in a way that reaches every screen in the product — including
the ones nobody has redesigned.

---

## About the design files

The `designs/` folder contains **six HTML design references** covering 21 screens. They are
prototypes showing intended look and behaviour. **They are not production code and must not be
copied into the app.**

Your task is to recreate them in the existing environment — React Native + NativeWind, the
`@healthy360/design-system` component library, and the generated token preset — using the codebase's
established patterns. Every screen in `designs/` was itself recreated from the repo's own source, so
the structure, copy and data shapes already match what is there; the change is visual and
compositional.

To open them: they are `.dc.html` files and need `support.js` (included) as a sibling. Open any of
them directly in a browser.

## Fidelity

**High fidelity.** Exact hex values, type sizes, radii, spacing and shadows are specified below and
present in the design files. Recreate them precisely, using tokens rather than literals wherever a
token exists.

---

## How to work through this

The package is deliberately ordered so that most of the value lands before you touch a single
screen.

| Phase | Where | Effort | Reaches |
| --- | --- | --- | --- |
| 1 — Tokens | `packages/design-tokens` | Small | Everything |
| 2 — Components | `packages/design-system` | Medium | Everything |
| 2b — Showcase | `apps/universal/src/screens/showcase-screen.tsx` | Small | Review surface |
| 3 — Shells | `apps/universal/src/shell` | Small | Every screen in an area |
| 4 — Screen composition | `apps/universal/src/features/**` | Per screen | Only screens you touch |

> **Decision — showcase first.** As each component in Phase 2 is changed, add or update its variant
> in `showcase-screen.tsx` (`/showcase`) in the same commit. That page becomes the review surface:
> every new variant visible in one place before Phase 3 builds on it. A component change that has
> not reached showcase is not done.

**Phases 1–3 propagate automatically to every persona app** — driver, clinic, corporate, insurance,
platform-admin, the B2B application flow, subscriptions, grocery list, dietitian directory, account
and consents. None of those were redesigned and none need to be. They inherit.

Phase 4 is per-screen judgement. Section 4 below gives rules plus a worked before/after against a
real file, so the same move can be applied to a screen nobody designed.

### One caveat, stated up front

`packages/design-system` **was not available** when this design work was done — only
`apps/universal` was. Every component change in Phase 2 was derived from the built CSS
(`apps/universal/dist-api/_expo/static/css/web-*.css`) and from call sites across
`apps/universal/src`. The change and the target values are correct; the exact prop names and
internal structure need the package open in front of you. Where a prop name is proposed rather than
observed, it is marked **(proposed)**.

### Decisions already taken

Seven questions were put to the product owner before implementation. The answers are binding and are
folded into the sections below; this is the summary.

| Question | Decision |
| --- | --- |
| Corner radius | **Unchanged** — 14/16px. No new radius token. The HTML draws 20px; the README wins |
| Card photo aspect | **4:3** for the card variant. Tighter cropping accepted |
| Sign out | **Demoted, but outlined** — not borderless, so it does not read as disabled |
| Staff-area primary | Rule + per-area table in §4, Rule 4 |
| Icon gap | **Extend** the set with eight glyphs (§2.8) |
| Showcase | **Updated first**, in the same commit as each component |
| Dark mode | **Out of scope** for this pass. Do not regress the existing `.dark` block |

---

## 1 — Tokens

### 1.1 Existing values (verified — do not change)

These are already correct. Listed so you can use the token rather than the literal.

```
surface-base            247 252 249   #F7FCF9
surface-raised          255 255 255   #FFFFFF
surface-sunken          237 246 240   #EDF6F0
surface-inverse          20  35  28   #14231C
text-primary             31  41  55   #1F2937
text-secondary           91 102 115   #5B6673
text-disabled           100 110 124   #646E7C
text-on-brand           255 255 255   #FFFFFF
border-subtle           204 238 218   #CCEEDA
border-default          170 221 192   #AADDC0
border-strong            95 143 118   #5F8F76
focus-ring               21 112  67   #157043
brand-surface            21 112  67   #157043
brand-surface-subtle    220 252 231   #DCFCE7
on-brand-surface-subtle  20  83  45   #14532D
accent-surface          109  40 217   #6D28D9
rating-star             181 125  13   #B57D0D
success-default          21 115  71   warning-default 138 90 9
danger-default          192  39  34   info-default      3 105 161
nutrition-optimal        31 107  76   #1F6B4C
nutrition-good           63 122 111   #3F7A6F
nutrition-moderate      122  82   9   #7A5209

radius   xs 2 · sm 4 · md 8 · lg 12 · xl 16 · 2xl 24 · full 9999
space    4-based (1=4 … 32=128), plus 0_5=2, 1_5=6, 2_5=10
type     xs 12/18 · sm 14/21 · base 16/24 · lg 18/27 · xl 20/30 · 2xl 24/36 · 3xl 30/36
         4xl 36/43 · 5xl 48/58
family   latin: Inter · display: SpaceGrotesk_700Bold
elevation-1  0 1px 2px 0 #1715140f, 0 1px 1px -1px #1715140a
elevation-2  0 2px 4px -1px #17151414, 0 1px 2px -1px #1715140d
elevation-3  0 4px 8px -2px #1715141a, 0 2px 4px -2px #1715140f
elevation-4  0 8px 16px -4px #1715141f, 0 4px 8px -4px #17151412
min-touch    44px
brand ramp   brand-100 rgb(220 247 225) · brand-500 #16A34A · brand-600 rgb(21 128 67)
```

### 1.2 New tokens to add

Eight additions. Everything else in the design uses what already exists.

```
--h360-color-surface-canopy        11  59  38     #0B3B26   deep forest band
--h360-color-surface-canopy-deep   18  79  51     #124F33   gradient partner
--h360-color-on-canopy            255 255 255     #FFFFFF   headings on canopy
--h360-color-on-canopy-muted      220 252 231     #DCFCE7   body on canopy, min alpha 0.62
--h360-color-accent-subtle        241 235 253     #F1EBFD   violet tint, AI surfaces
--h360-color-on-accent-subtle      76  29 149     #4C1D95
--h360-elevation-card              0 1px 2px rgba(23,21,20,.05), 0 14px 30px -18px rgba(11,59,38,.35)
--h360-elevation-card-hover        0 1px 2px rgba(23,21,20,.05), 0 24px 46px -20px rgba(11,59,38,.5)
```

> **Decision — corner radius is unchanged.** An earlier draft proposed a 20px `radius-card`. It was
> rejected: the softer corner is too much at the density of the workspace screens. Keep today's
> values — `rounded-xl` (16px) for content cards, `rounded-[14px]` where it is already used. **The
> HTML design files draw cards at 20px; the README wins.** Consolidating the ad-hoc `rounded-[14px]`
> in `kitchen-home-screen.tsx`, `analytics-charts.tsx`, `editor-frame.tsx` and `list-toolbar.tsx`
> into a named token is still worth doing, but at 14px, not 20px.

The canopy gradient used throughout:

```
linear-gradient(135deg, #0B3B26 0%, #124F33 58%, #0E6B41 100%)
```

with an optional radial glow, `radial-gradient(circle, rgba(22,163,74,.34) 0%, rgba(22,163,74,0) 70%)`,
420px, positioned `right:-80px; top:-120px`.

### 1.2b Type sizes — snap to the scale

> **Correction.** This document quotes sizes that are not on the token scale — 10.5, 11.5, 12.5,
> 13.5, 14.5, 15, 19, 22, 23 and 46px. Those are artefacts of the mood board's hand-written CSS, not
> design intent. **Snap them to the nearest token.** The scale stays authoritative; absorbing the
> half-steps would double it to encode noise.

| Quoted | Use |
| --- | --- |
| 10.5 · 11.5 · 12.5 | `text-xs` 12/18 |
| 13.5 · 14.5 | `text-sm` 14/21 |
| 15 | `text-base` 16/24 |
| 19 · 22 · 23 | `text-xl` 20/30 |
| 46 | `text-5xl` 48/58, leading overridden tight |
| 24 (card price) | `text-2xl` 24/36 — already a token |
| 25 · 28 (KPI values) | `text-2xl` / `text-3xl` — already in the app |

**Letter-spacing.** The uppercase micro-label values (.04em, .05em, .09em) all snap to
`tracking-widest` (.1em) — no new token. The negative display tracking is a real gap:
`tracking-tight` is −0.4px, which at 46px is a tenth of what is needed, and large display type set at
normal tracking genuinely reads loose. Add **one** token and apply it to Space Grotesk at 24px and
above:

```
--h360-tracking-display: -0.02em
```

That makes Phase 1 **nine** additions rather than eight. Do not add the other two negative values.

Where a snapped size looks wrong in review, raise it — do not reach for an arbitrary value.

### 1.3 The contrast rule — read this before writing any colour

This was got wrong three times during the design work. Encode it as a lint rule if you can.

- **`#16A34A` (brand-500) may fill a surface only when that surface carries graphics, or text at
  ≥18.66px bold / ≥24px regular.** White on `#16A34A` is 3.05:1 — legal for graphics and large text,
  illegal for anything smaller.
- **Any fill carrying small text uses `brand-surface` `#157043`** (white on it is ~6.5:1). This
  includes: the active sidebar item, primary buttons, count badges, the basket pill, hero search
  submit, "most chosen"-style badges.
- **`#16A34A` stays** on borders, focus rings, underline bars, meter and progress fills, dots,
  chart strokes, and the check glyph inside a mint circle.
- **Never invent a grey.** Secondary text is `text-secondary` `#5B6673`. Anything demoted further is
  `text-disabled` `#646E7C`. Both clear AA on `surface-base` and `surface-raised`.
- **On the canopy, minimum alpha is 0.62.** `rgba(220,252,231,0.62)` is 5.42:1 on `#0B3B26`;
  `0.45` is 3.60:1 and fails. Nav items sit at `0.74–0.78`, body copy at `0.82–0.86`.

---

## 2 — Design system components

All paths are in `packages/design-system` unless noted.

### 2.1 `Card` — add a pinned footer, and clip the media

Two changes, and the first is the one that fixes the ragged grid.

**Footer slot (proposed prop: `footer`).** When present it renders after the body with
`margin-top:auto`, so in a grid of stretched cards every footer lands on the same baseline
regardless of body length. Structure:

```
Card (display:flex; flex-direction:column; height:100%)
  media      — optional, flush to the card edge
  body       — flex:1, padding 18px 18px 0
  footer     — margin-top:auto, padding 14px 18px 16px
```

**Media clipping.** Today `Card padding="none"` renders `EntityImage` with its own `rounded-lg`
(12px) inside a card with a larger radius, so the image corners float inside the card corners. Put
`overflow:hidden` on the card and drop the image's own radius, so media is flush.

**Elevation only — radius is unchanged.** Keep `rounded-xl` (16px). Swap `elevation-1` for
`elevation-card`; that double shadow is what lifts the card off the page, and it does the work the
radius change was reaching for.

**Interactive state (proposed prop: `interactive`).** Adds `cursor:pointer` and, on hover,
`translateY(-4px)` + `elevation-card-hover`, transition `.18s cubic-bezier(.2,0,0,1)`.

> **Important — do not apply `interactive` to every card.** `plan-card.tsx` documents at length why
> the plan card is deliberately *not* one big pressable target: it carries a comparison checkbox, a
> duration picker and an open action, and a checkbox inside a button is unreachable by keyboard and
> ambiguous on touch. `MealCard`, `KitchenCard` and `DietitianCard` take `onPress` and are
> single-target — those get `interactive`. `PlanCard` does not; its hover affordance belongs on the
> "View plan" button.

### 2.2 `EntityImage` — card variant becomes 4:3

`ASPECT_CLASS.wide` is `aspect-video` (16:9). For the `card` variant in a grid, use **4:3**. The
detail variant stays 16:9.

Add two overlay slots (proposed): `overlayStart` (top-leading, for a kitchen or verified chip) and
`overlayEnd` (bottom-trailing). Overlay chip style: `padding:5px 11px; border-radius:999px;
background:rgba(11,59,38,.78); color:#fff; font-size:11.5px; font-weight:700`.

### 2.3 `Button` — a quiet emphasis level

Add `emphasis="quiet"` (proposed): **white fill, 1px `border-subtle`, `text-secondary` 14px/600,
44px tall.** This is what **Sign out** becomes.

> **Decision — quiet keeps its border.** Borderless was rejected: a bare text control in a row of
> filled and outlined buttons reads as disabled. The border says "still a button"; the neutral fill
> and grey label say "not the one you came for."

Primary stays `brand-surface` with white 14px/600 and a hover to `surface-canopy`.

### 2.4 `AppShell` — emphasis order and chrome

- **Trailing actions**, signed in, in order: locale (text) · My home (text) · **Basket (primary,
  with count badge)** · Sign out (quiet — outlined, per §2.3). Today `marketplace-shell.tsx` gives Sign out
  `variant="secondary"` — the strongest treatment in the row — while the basket is a ghost button.
  Invert that. The badge is `background:#fff; color:#157043` inside the pill.
- **Active nav (top bar)**: `brand-surface` text, 700, with a 2px `#16A34A` bar at the bar's bottom
  edge. Not a filled pill.
- **Active nav (sidebar)**: filled pill, `background:brand-surface` (**not** brand-500 — small text
  on a fill), white 14px/700, radius 11px, height 44px.
- **Sidebar group headings**: 10.5px/700, `letter-spacing:.09em`, uppercase,
  `rgba(220,252,231,0.62)`.
- **Brand mark**: 32px square, radius 9px,
  `linear-gradient(135deg,#6D28D9 0%,#16A34A 100%)`, white "H" in Space Grotesk 700 15px. Wordmark
  Space Grotesk 700 17px `text-primary`.

Applies to all four shells: `marketplace-shell.tsx`, `consumer-shell.tsx`, `area-shell.tsx`,
`kitchen-admin/kitchen-ops-shell.tsx`.

### 2.5 `FilterBar` / `ListToolbar` — one aligned row

`filter-bar.tsx` and `kitchen-admin/list-toolbar.tsx` both stack label + chips + a result row. Emit
one row instead, all items sharing a baseline, 44px controls:

```
[Filters ▤ (n)] [active chip ✕] [active chip ✕] [Clear all] ……… [Showing 6 of 40] [Order by ▾]
```

- Filters button: white, `border-subtle`, radius 12, 44px, `elevation-1`, filter glyph in
  `#16A34A`, count badge `brand-surface` on white.
- Active filter chip: `brand-surface-subtle` fill, `#16A34A` border, `on-brand-surface-subtle` text,
  44px, radius full, trailing `✕`.
- Result count is **Space Grotesk 700 14.5px**, with the number in `brand-surface`. It moves out of
  its own row and onto this one, immediately before the sort control.
- Sort keeps its visible "Order by" label.

### 2.6 `Table` — header treatment

Header cells: 11.5px/700, `text-disabled`, `letter-spacing:.04em`, uppercase,
`border-bottom:1.5px solid border-subtle`. Body cells `padding:13px 0`, `border-bottom:1px solid
surface-sunken`. Numeric columns right-aligned; the primary numeric column renders in Space Grotesk
700 15px `text-primary`.

### 2.7 `PageHero` — new component

The canopy band. Props (proposed): `breadcrumbs`, `title`, `subtitle`, `chips`, `trailing`.

```
padding      34px 44px 32px
background   canopy gradient + radial glow
breadcrumbs  13px, rgba(220,252,231,.75), current item #DCFCE7 600
title        Space Grotesk 700, 46px/1.05, letter-spacing -0.025em, #FFFFFF
subtitle     16px/24px, rgba(220,252,231,.85), max-width 56ch
chips        44px pill, rgba(255,255,255,.10), 1px rgba(220,252,231,.28), #DCFCE7 13px/600
trailing     380px column — search panel or a pair of CTAs
```

Search panel inside the hero: white, radius 14, `padding:6px 6px 6px 16px`, shadow
`0 12px 28px -14px rgba(0,0,0,.55)`; submit is a 44px `brand-surface` pill.

### 2.8 Icons — a real gap

`consumer-items.ts` and `steps.ts` both record it: the glyph vocabulary has no cart, no home, no
plate and no padlock, and the nearest honest glyph is used instead.

> **Correction.** An earlier draft of this section specified SVG reference drawings (24×24 viewBox,
> stroked). **That was wrong.** It was written without reading `icon.tsx`, which draws icons as
> **typographic characters** and documents in its header why `react-native-svg` was rejected — a
> native module, a config plugin, an expo-doctor entry and a dev-client rebuild. A visual design pass
> is not grounds to reverse a documented architecture decision. Keep the typographic approach.
>
> **Decision — extend `ICON_GLYPHS` with the missing characters only.** Five of the eight glyphs the
> designs use already exist: `search`, `filter`, `calendar`, `refresh`, `user`. Only **`basket`,
> `home` and `sparkle`** are genuinely missing (plus `plate` and `lock` if `steps.ts` needs them).
> Add those as characters; reuse the five that exist rather than duplicating them.
>
> The SVGs in the design files indicate **meaning and visual weight, not form**. Approximate fidelity
> is the accepted outcome. Do not add a native dependency to close the gap.
>
> Once the characters exist, delete the substitutes and the "recorded in the wave report" notes in
> `consumer-items.ts` and `steps.ts` — the gap is closed, and a stale note about a solved problem is
> its own defect.

The geometric diamonds and half-circles currently standing in for Kitchens and Dietitians in the nav
carry no meaning and add scanning noise; they go with the rest.

---

## 3 — Shells

Apply §2.4 to all four. Additionally:

- **Footer** (`marketplace-shell.tsx`): move onto the canopy. `#0B3B26`, 28px 44px 34px, wordmark
  Space Grotesk 700 16px white, body 13px `rgba(220,252,231,.75)`, links 13px `#DCFCE7`, the
  prototype disclosure 12px `rgba(220,252,231,.58)`. Keep the disclosure text exactly as it is — it
  is there because there are no published terms to link to.
- **Content width**: 1152px max, centred, 44px page gutters on marketplace surfaces; 28–30px on
  workspace surfaces inside a sidebar.

---

## 4 — Screen composition

Five rules. Each has a worked example against a real file. Apply the same rules to any screen not
listed, including all the ones nobody designed.

### Rule 1 — Every card in a grid shares a baseline

**Worked example: `src/features/marketplace/meal-card.tsx`**

*Today*: `Card padding="none"` → 16:9 image → a single `Stack space="sm" p-4` containing name,
type badge, description, nutrition badges, diet badges, allergen text, price. Card height follows
content; price lands wherever it lands.

*Change to*:

```
Card (interactive, radius-card, elevation-card, overflow hidden)
  media                4:3, overlayStart = kitchen chip
  body   flex:1        18px 18px 0, gap 9px
    title row          Space Grotesk 700 18px/1.25, -0.01em  +  trailing arrow glyph
    description        13.5px/20px text-secondary, min-height 40px
    diet tags          4px 10px pill, #F0FBF3 fill, #14532D text, 12px/600, min-height 24px
  footer  margin-top:auto   14px 18px 16px, gap 12px
    allergen line      6px dot + 12px text; #B57D0D dot / #79480A text when present,
                       brand-surface dot + text "No declared allergens" when not.
                       Fixed min-height 18px so the row below never shifts.
    numbers row        padding-top 13px, border-top 1px surface-sunken
      left  4 stats    value Space Grotesk 700 16px, label 10.5px/600 text-secondary uppercase
                       — kcal · protein · carbs · fat
      right price      Space Grotesk 700 24px brand-surface, line-height .95
```

Two things this fixes that are not cosmetic: the price becomes the second-largest thing on the card
(it was body text), and energy/protein/carbs/fat appear in the grid at all — which
`meal-card.tsx`'s own header comment says is the deliberate divergence from both reference
products, currently not visible.

**Mixed card species.** The grid renders both `meal` and `product` items, and products carry no
description, tags or nutrition. Give the product card the same footer with the nutrition stats
omitted and the price in the same position, so the price still aligns across the row.

Apply the same footer pattern to `kitchen-card.tsx` (footer = channel badges + delivery zone),
`dietitian-card.tsx` (footer = languages + the synthetic-credentials note — keep that note, the
file explains why it exists), and `plan-card.tsx` (footer already grows to the bottom; keep it, just
raise the price to 24px and leave the card non-interactive).

### Rule 2 — One toolbar row

**Worked example: `src/features/catalogue/screens/meals-screen.tsx`**

*Today*: a full-width `TextInputField`, then an `Inline` holding the filter toggle and the sort
`Select`, then a separate `Text` with the count — three stacked rows, with the filter button
bottom-aligned against a label-and-select twice its height.

*Change to*: search moves into the `PageHero` trailing panel. The remaining controls become one
row per §2.5, with the count on it. The `Collapse` filter panel is unchanged — closed by default,
open on arrival with a filter applied. That behaviour is right and documented; only the bar above it
changes.

The `Filters` icon is currently a left chevron, which reads as "back". Use a filter glyph.

### Rule 3 — A page opens with weight

Replace the breadcrumb → H1 → subtitle opening with a `PageHero`. Breadcrumbs move inside it. The
H1 becomes 46px Space Grotesk on canopy.

Where a screen has no natural hero content — an editor, a settings page — keep the current opening.
This rule is for browse, list and landing surfaces.

### Rule 4 — Emphasis follows value

Highest emphasis goes to the action that advances the person's goal. Basket, checkout, add-to-plan,
place-order. Sign out, cancel and dismiss are quiet. This is §2.3 plus judgement per screen.

**In staff areas there is no basket, so the rule is:** the primary slot carries the one action that
advances that area's core loop — and if the area has no such action, **leave the slot empty.**
Promoting navigation into it, or letting a destructive action occupy it, is worse than an empty slot.

| Area | Top-bar primary | Why |
| --- | --- | --- |
| Customer | **Basket** (with count) | The revenue action, and the thing they just filled |
| Kitchen workbench | **New meal** | The hub's most frequent create. The review-queue count sits beside it as a warning-toned chip, not as the primary |
| KDS | *(none)* | A wall display. The action is on each ticket — Confirm and Ready — and a top-bar button would compete with them |
| POS | *(none)* | The page owns its own primary, "Record the sale" |
| Kitchen editors | **Save draft** | Already correct in `editor-frame.tsx`; leave it |

For driver, clinic, corporate, insurance, platform-admin, invitations and the B2B application flow,
apply the same rule per area. Those screens were not read during this design work, so confirm the
core-loop action against the screen rather than guessing from the route name.

### Rule 5 — Violet is AI, and secondary emphasis

`accent-surface` `#6D28D9` marks machine-generated content and nothing else. It appears as:

- **AI band** — full-width, radius 18, `linear-gradient(120deg,#6D28D9 0%,#4C1D95 62%,#157043 160%)`,
  shadow `0 16px 34px -20px rgba(76,29,149,.75)`, a translucent `AI DIETITIAN` pill, a Space Grotesk
  700 22–23px headline, and one white CTA.
- **AI rail card** — 20px radius, `linear-gradient(150deg,#6D28D9,#4C1D95)`, same pill, 19px
  headline.
- **Origin badge** — on every machine turn in the virtual dietitian. `virtual-dietitian/state-presentation.ts`
  defines four origins that must differ on **three axes at once** — tone, glyph and wording — and
  asserts it by test. Do not collapse them to colour.

Secondary emphasis use is limited to the sparkle nav glyph and the AI tint `accent-subtle`.

---

## 5 — Interactions and states

- **Card hover**: `translateY(-4px)` + `elevation-card-hover`, `.18s cubic-bezier(.2,0,0,1)`.
  Single-target cards only (Rule 1).
- **Button hover**: primary `brand-surface` → `surface-canopy`, `.16s`.
- **Focus**: unchanged — 2px `focus-ring`, 2px offset, per the existing tokens.
- **Field focus**: 1.5px `#16A34A` border + `0 0 0 3px rgba(22,163,74,.16)`.
- **Field error**: 1.5px `#D16A64` border, message row = 6px `danger-default` dot + 12.5px
  `#8F1F1A` text.
- **Meters**: 8px track `surface-sunken`, fill uses the `nutrition-*` level tokens, and always
  carries its numeric value as text — never fill alone.
- **Reduced motion**: the token set already zeroes all durations under
  `prefers-reduced-motion: reduce`. Drive transitions from duration tokens so they inherit that.

---

## 6 — Screen map

Every design file was recreated from the repo files listed beside it. The kitchen module
(`/kitchen`, ~40 routes) has its own map and specs in `KITCHEN.md`.

| Design file | id | Screen | Built from |
| --- | --- | --- | --- |
| `Meals - Wellness Green` | 1a | `/meals`, `/meals/{meal}`, mobile | `catalogue/screens/meals-screen.tsx`, `marketplace/meal-card.tsx`, `marketplace/filter-bar.tsx`, `marketplace/section-header.tsx`, `shell/marketplace-shell.tsx`, `catalogue/screens/meal-detail-screen.tsx`, `catalogue/macro-rings.tsx` |
| | ref | Today's `/meals`, unchanged | same, plus generated tokens |
| `Marketplace - Wellness Green` | 2a | `/discover` | `marketplace/screens/discover-screen.tsx`, `kitchen-card.tsx`, `dietitian-card.tsx` |
| | 2b | `/plans` | `catalogue/screens/plans-screen.tsx`, `catalogue/plan-card.tsx` |
| | 2c | `/plans/{plan}` | `catalogue/screens/plan-detail-screen.tsx` |
| `Customer - Wellness Green` | 3a | `/customer` | `marketplace/screens/consumer-home-screen.tsx`, `navigation/consumer-items.ts` |
| | 3b | `/customer/planner/week/{monday}` | `planner/screens/planner-week-screen.tsx` |
| | 3c | `/customer/cart` | `commerce/screens/cart-screen.tsx` |
| | 3d | `/customer/checkout` | `commerce/screens/checkout-screen.tsx` |
| `Auth - Onboarding - Wellness Green` | 4a | `/sign-in` | `screens/sign-in-screen.tsx` |
| | 4b | `/register` | `screens/register-screen.tsx` |
| | 4c | `/customer/onboarding/activity` | `onboarding/step-body.tsx` (`ActivityStep`), `onboarding/schemas.ts` |
| | 4d | `/customer/onboarding/summary` | `onboarding/steps.ts` |
| `Kitchen Ops - Wellness Green` | 5a | `/kitchen` | `kitchen-admin/screens/kitchen-home-screen.tsx`, `kitchen-admin/entity-registry.ts`, `kitchen-nav.ts` |
| | 5b | `/kitchen/analytics` | `kitchen-admin/screens/analytics-screen.tsx`, `analytics-charts.tsx` |
| | 5c | `/kds` | `kds/kds-tickets-screen.tsx`, `kds/kds-board.ts` |
| | 5d | `/pos` | `pos/pos-sale-screen.tsx` |
| `AI - Nutrition - Wellness Green` | 6a | `/customer/virtual-dietitian/{session}` | `virtual-dietitian/targets-panel.tsx`, `composer.tsx`, `message-list.tsx`, `state-presentation.ts` |
| | 6b | `/customer/nutrition` | `nutrition/nutrition-target-screen.tsx` |
| | 6c | `/kitchens` | `marketplace/screens/kitchens-screen.tsx` |

### Behaviour that must survive the redesign

These are documented decisions in the source. The visual pass must not undo them.

- The meals filter panel is **closed on arrival** and opens only when a filter is already applied.
- `plan-card.tsx` is **not** a single pressable target.
- The KDS board has **no Cancel control** — cancelling is management work on `/kitchen/orders`.
- Every virtual-dietitian machine turn carries a **visible origin label**, not just a colour.
- The dietitian card's **synthetic-credentials note** is not a footnote to trim.
- Both register consents (`accept_terms`, `accept_privacy`) are **required**; an unticked box fails
  validation rather than submitting `false`.
- The virtual dietitian's **acknowledgement checkbox is a real gate** — `acceptProposal` refuses a
  request with `acknowledgedDisclaimer: false`.
- **Logical utilities only.** `ms`/`me`, `ps`/`pe`, `start`/`end`, `text-start`/`text-end`. Physical
  utilities and NativeWind's `rtl:`/`ltr:` variants are banned by the root ESLint config. The
  message-list alignment relies on `self-start`/`self-end` for exactly this reason.

---

## 7 — Screens not designed, and what to do with them

Not designed: subscriptions (list, detail, configurator), grocery list, dietitian directory and
profile, account and consents, driver, clinic, corporate, insurance, platform-admin, invitations,
and the B2B application flow.

**They need no bespoke design.** After phases 1–3 they inherit the surfaces, radii, elevation, card
and chip shape, field and focus treatment, table styling, shell chrome, emphasis order and the
contrast rule. Then apply Rules 1–5 by inspection:

- Any screen with a **card grid** → Rule 1.
- Any screen with a **filter or search toolbar** → Rule 2.
- Any **browse or landing** surface → Rule 3.
- Every screen → Rules 4 and 5.

Editors (`kitchen-admin/editor-frame.tsx` and everything using it) need only phases 1–3 plus the
`radius-card` swap.

---

## 8 — Acceptance checks

Run these before calling a phase done.

**Contrast.** No text below 4.5:1 against its background at any size under 18.66px bold / 24px
regular. Specific traps, all of which were hit during the design work: `#16A34A` as a fill under
small white text; any grey outside `text-secondary` / `text-disabled`; canopy text below alpha 0.62.

**Baselines.** In any card grid, every card's price occupies the same vertical offset from the card
bottom. Assert it: `getBoundingClientRect().bottom` of each price element minus the card's bottom
should be equal across the row.

**Toolbars.** One row. Result count present and stating a total, not just a shown-count.

**Emphasis.** No screen where Sign out is the highest-emphasis control.

**Touch targets.** 44px minimum retained — the token exists (`min-touch`) and the current build
honours it.

**RTL.** Set `lang="ar"`; assert geometry, not classes. The existing Playwright RTL specs already do
this — they must still pass.

**Showcase.** Every component changed in Phase 2 appears on `/showcase` in its new form.

**Dark mode not regressed.** Dark is out of scope for this pass, but the existing `.dark` block and
the `analytics-screen.tsx` theme toggle must still work. New tokens without dark counterparts must
not be used anywhere the dark theme renders — or must fall back cleanly.

**Behaviour.** The list in §6 still holds.

---

## 9 — Assets

`assets/` contains the dish, kitchen, plan, dietitian and marketing photography used in the designs.
**These are already in the repo** at `apps/universal/assets/images/` — they were copied here only so
the HTML files render standalone. Do not re-add them; use `EntityImage` and the generated manifest
as the app already does.

Attribution is at `apps/universal/assets/images/CREDITS.md`. The photographs are licensed stock, not
photographs of real Healthy360 products, and the fixtures they decorate stay labelled synthetic on
screen.

Fonts: **Inter** and **Space Grotesk**, both already in the token set.

---

## 10 — Files in this package

```
README.md                                  this document
KITCHEN.md                                 kitchen-module addendum (frames 7a–7j)
support.js                                 runtime for the design files
designs/
  Kitchen Module - Wellness Green.dc.html  7a–7j, all /kitchen routes by template
  Meals - Wellness Green.dc.html           1a + today's recreation
  Marketplace - Wellness Green.dc.html     2a 2b 2c
  Customer - Wellness Green.dc.html        3a 3b 3c 3d
  Auth - Onboarding - Wellness Green.dc.html   4a 4b 4c 4d
  Kitchen Ops - Wellness Green.dc.html     5a 5b 5c 5d
  AI - Nutrition - Wellness Green.dc.html  6a 6b 6c
assets/                                    photography, for standalone rendering only
```

## 11 — Open questions

1. **`PASSWORD_MIN_LENGTH`** lives in `@healthy360/validation`, which was not available. The
   register design shows "at least 12 characters" as a placeholder. Use the real constant.
2. **`packages/design-system` was not available.** Every proposed prop name in §2 is marked
   **(proposed)** and needs reconciling with what is actually there.
3. **Staff-area primary actions** beyond kitchen, KDS and POS — see the table in Rule 4. Confirm the
   core-loop action per area against the screen.

### Settled — do not re-open

- **Corner radius**: unchanged at 14/16px. No `radius-card` token. The HTML files draw 20px; the
  README wins.
- **Card photography**: 4:3 for the card variant, 16:9 for detail. Cropping the existing images
  tighter is accepted.
- **Sign out**: demoted, but outlined so it does not read as disabled.
- **Icons**: typographic, not SVG. Extend `ICON_GLYPHS` with the three missing characters only —
  `basket`, `home`, `sparkle`. See the correction in §2.8; do not add `react-native-svg`.
- **Showcase**: updated alongside each component, in the same commit.
- **Type scale**: snap to the tokens per §1.2b. One new token, `tracking-display: -0.02em`. No
  arbitrary sizes, no half-steps added to the scale.
- **Dark mode**: out of scope for this pass. The canopy, the AI gradients and `accent-subtle` have
  no dark counterparts yet; that is the first task of a later dark pass. Do not regress the existing
  `.dark` block in the meantime.
