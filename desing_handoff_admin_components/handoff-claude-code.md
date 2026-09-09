# Handoff — Catalogue component system

Target: `healthlyzone360` (Expo SDK 57 · NativeWind 4 · Tailwind 3.4 · expo-router).
Reference implementations in this project: `Component System.dc.html`, `Catalogue.dc.html`.
Those are HTML mirrors of the intended output — the values below are the contract, not the markup.

Decisions locked with the user: Schibsted Grotesk + IBM Plex Mono · global 32px controls, 44px
invariant retired · toggleable row density, 32px default · KPI tiles → one 11px summary line ·
single `⋯` overflow menu per row · 280px field width · five compact recipe tabs, contents
restructured from `Recipes Instructions.xlsx` · allergens and nutrients read-only/derived ·
first migration pass = Ingredients, Recipes, Sauces.

---

## 1. Tokens — `packages/design-tokens/src`

### 1.1 New file `control.ts`

```ts
/** Component heights. The single knob for Catalogue density. */
export const controlHeight = { xs: 24, sm: 28, md: 32, lg: 36 } as const;
export const controlPaddingX = { xs: 6, sm: 8, md: 10, lg: 14 } as const;
export const controlGap = { xs: 4, sm: 6, md: 6, lg: 8 } as const;
export const iconSize = { xs: 12, sm: 14, md: 16, lg: 18 } as const;

/** Catalogue list row heights, user-selectable. `md` is the default. */
export const rowHeight = { sm: 28, md: 32, lg: 36 } as const;

/** The fixed column width FormGrid resolves to. Fields never exceed it. */
export const fieldWidth = 280;
export const cardWidth = { min: 200, max: 260 } as const;
```

Export from `index.ts`; emit through the existing generators so utilities read
`h-control-sm`, `px-control-md`, `w-field`, `h-row-md`.

**`layout.ts`:** `MIN_TOUCH_TARGET` is retired per the user's decision. Delete the constant and its
`min-h-touch` consumers rather than leaving it unused — grep first, it is referenced in
`button.tsx`, `icon-button.tsx`, `select.tsx`, `checkbox.tsx`, `switch.tsx` and two a11y specs.
Update those specs to assert `controlHeight.md` instead of 44.

Keep the 4-point spacing scale; add the aliases actually used:
`hair 4 · tight 8 · snug 12 · base 16 · loose 24`.

### 1.2 `typography.ts` — replace the ramp

Families: `Schibsted Grotesk` (latin) · `IBM Plex Sans Arabic` (arabic, unchanged) ·
`IBM Plex Mono` (numeric role). Drop Space Grotesk and Inter entirely, including the
`expo-font` loader entries and the `@font-face` blocks in `apps/universal/src/ui`.

| token | size/line | weight | tracking | case | use |
| --- | --- | --- | --- | --- | --- |
| `micro` | 10/14 | 600 | 0.06em | upper | column labels, eyebrows |
| `caption` | 11/16 | 400 | — | — | helper, meta, summary line |
| `body` | 12/18 | 400 | — | — | body, cell, input value |
| `label` | 12/16 | 500 | — | — | field label, tab, button |
| `strong` | 13/18 | 600 | — | — | list item / card title |
| `section` | 13/18 | 600 | 0.02em | upper | section title |
| `title` | 16/22 | 600 | -0.01em | — | page title (was `text-3xl`) |
| `display` | 20/26 | 700 | -0.015em | — | one number, rarely |

Line heights above are the latin resolution; leave the per-script 1.5/1.75 multiplier alone so
Arabic keeps its own leading. Every quantity, cost, reference and version renders in the mono role.

### 1.3 Borders, radius, elevation

- Radius: controls 4 (`sm`), panels 8 (`md`). No 14px panels, no pills except badges.
- Borders: `borderSubtle #cceeda` as a **separator** (row `border-b`, section `border-t`),
  `borderDefault #aaddc0` for control outlines. Retire panel outlines in the Catalogue.
- Elevation: two only — flat, and `0 6px 20px -4px rgba(16,42,30,0.24)` for popovers.
  Delete the other elevation steps' Catalogue usage.
- Colours are **unchanged** Wellness Green tokens, read from
  `packages/design-tokens/src/colour.ts` (`themeLight` + `semanticLight`). No new hexes. The
  mapping actually used:

| role in the mock | token | light value |
| --- | --- | --- |
| page canvas | `themeLight.surfaceBase` | `#f7fcf9` |
| cards, inputs | `themeLight.surfaceRaised` | `#ffffff` |
| read-only / sunken fill | `themeLight.surfaceSunken` | `#edf6f0` |
| primary button, focus ring, active nav | `themeLight.brandSurface` / `focusRing` | `#157043` |
| primary hover | `brand.800` | `#11532e` |
| active pill, Live badge | `themeLight.brandSurfaceSubtle` / `onBrandSurfaceSubtle` | `#dcfce7` / `#14532d` |
| body ink | `themeLight.textPrimary` | `#1f2937` |
| meta, helper, column labels | `themeLight.textSecondary` | `#5b6673` |
| disabled text | `themeLight.textDisabled` | `#646e7c` |
| row separator | `themeLight.borderSubtle` | `#cceeda` |
| control outline | `themeLight.borderDefault` | `#aaddc0` |
| Draft badge | `semanticLight.warning.subtle` / `onSubtle` | `#fdf2d6` / `#79480a` |
| Review / From-database badge | `semanticLight.info.subtle` / `onSubtle` | `#e2f1fb` / `#0b4a6f` |
| Restricted, destructive | `semanticLight.danger.*` | `#fde5e3` / `#8f1f1a` / `#c02722` |
| Archived badge | `neutral.100` / `neutral.600` | `#f1f5f9` / `#4b5563` |
| drawer backdrop | `themeLight.overlay` | `#14231ccc` |
| placeholder | `neutral.400` | `#94a3b8` |

  Note `brandSurface` (`#157043`) is deliberately **not** `brand.600` (`#158043`) — the role sits
  below `brand.500` so white text clears AA, per the file's own comment. Use the **role**, never
  the ramp stop, for anything with text on it. Dark-theme equivalents already exist for every
  role above; there are no new tokens to add values for.

Run `pnpm build:tokens`, then `colour.test.ts` and `scales.test.ts` in both themes. Because every
colour above is an existing role pair (`brandSurface`/`textOnBrand`, `warning.subtle`/`onSubtle`, …)
rather than a new value, the AA gate is already satisfied by construction — but re-run it, since
the type and density changes move text onto the semantic-subtle panels at smaller sizes.

---

## 2. Layout primitives — the no-stretch rule

`Grid` / `FormGrid` / `CardGrid` are platform-split, matching the existing `.web.tsx`/`.native.tsx`
convention (`slider-field`, `date-field`).

**`form-grid.web.tsx`**

```
display: grid
grid-template-columns: repeat(var(--cols), minmax(0, 280px))
justify-content: start          /* NOT 1fr, NOT stretch */
gap: 12px 16px
```

**`form-grid.native.tsx`** — `flexDirection: row`, `flexWrap: 'wrap'`, children
`{ width: fieldWidth, flexGrow: 0, flexShrink: 0 }`. Same geometry, no stretch.

Responsive column count only; **field width is constant across breakpoints**:
`sm: 1 · md: 2 · lg+: 3`.

Spanning is explicit and the only route to a wider field:

```tsx
<FormField span={2} />      // gridColumn: span 2 / width: 280*2 + gap on native
<FormField fullWidth />     // spans the declared column count
```

`CardGrid` uses `repeat(var(--cols), minmax(200px, 260px))` + `justify-content: start`.

**Enforcement.** Add an ESLint rule (`no-restricted-syntax`) failing on `flex-1`, `w-full`,
`flexGrow`, and raw `text-[`, `h-[`, `w-[` inside
`apps/universal/src/features/kitchen-admin/**`. `flex-1` stays legal only on a container that *is*
the row — a toolbar spacer, a list row's title column. Add a jest test asserting every Catalogue
control's resolved height is a member of `controlHeight`.

---

## 3. Components

Rebuild in place, same export names, so unrelated areas keep compiling and inherit the system:

`primitives/text.tsx` (new ramp) · `actions/button.tsx`, `icon-button.tsx` ·
`forms/text-input.tsx`, `checkbox.tsx`, `switch.tsx` · `content/card.tsx`, `badge.tsx` ·
`navigation/tabs.tsx`, `breadcrumbs.tsx`.

New in `packages/design-system/src`:

| path | notes |
| --- | --- |
| `primitives/grid.tsx` + `.web/.native` | Grid, FormGrid, CardGrid per §2 |
| `primitives/separator.tsx` | the only border-drawing component |
| `forms/form-field.tsx` | label 12px + control + helper 11px, `span`/`fullWidth` |
| `forms/form-section.tsx` | section title + hairline, no card |
| `forms/search-input.tsx` | 28px, leading glyph |
| `forms/search-select.tsx` | **§5** |
| `forms/quantity-input.tsx` | mono, end-aligned, unit-aware |
| `content/data-list.tsx` | column-spec driven, hairline rows |
| `content/list-item.tsx` | grid row above `lg`, two-line below `md` |
| `content/status-badge.tsx` | `statusTone()` from `format.ts` → badge |
| `overlays/dropdown.tsx`, `menu.tsx` | anchored popover, one shadow; items take `IconName` (§4.3) |
| `overlays/confirmation-dialog.tsx` | replaces ad-hoc confirms |
| `status/inline-banner.tsx` | saved / check / conflict |

`apps/universal/src/features/kitchen-admin/catalogue/`: `CataloguePageHeader`,
`CatalogueToolbar`, `CatalogueSummaryBar`, `CatalogueList`, `CatalogueListItem`,
`IngredientSelector`, `RecipeLineTable`, `EntityDetailPanel`.

Promotion rule: a component reaches `design-system` only when two Catalogue entities use it.

Sizing API: `size="sm" | "md" | "lg"` on every control, mapping **only** to `control.ts`.
Catalogue default `sm`; `md` for a page's primary action; `lg` unused in admin.
**No component sets a width.**

---

## 4. Catalogue screens

### 4.1 List pages — five parts, in this order

```
breadcrumb            11px, 16px tall
title + primary       16px title · one 32px button
summary line          11px: "N of M shown · N draft · N missing Arabic · N uncosted"
toolbar               one 28px row: search 240px · status segments · density · fields ▽
list                  10px upper column labels · 32px rows · border-b hairline · hover tint
pager                 "Showing 1–25 of 248" + compact buttons
```

Below the `md` breakpoint the same `CatalogueListItem` renders two-line (title + status badge,
meta run, metric, overflow) instead of a column grid. Between `md` and `lg`, drop the
lowest-priority columns until the tracks fit rather than letting the row scroll: Designation and
the overflow menu are never droppable, so the row action stays reachable without horizontal
scrolling.

No card, no panel outline, no vertical rules, no zebra. Row actions are a single overflow `Menu`:
**View · Edit · Archive**, each with a leading icon (`eye` · `pen` · `archive` — §4.3).

- **Edit** routes to the entity's form screen (`ingredientEdit` / `recipeEdit`).
- **View** opens a read-only right-side `Drawer` showing that one record's fields alone:
  reference, designation, category/kind, unit or yield, price/cost, version, status, last updated,
  plus derived allergens under a `From database` badge. Footer is Close + Edit, so a user who
  decides to change something moves straight into the form without returning to the list.
- The row body keeps its current behaviour \u2014 it opens the editor. View is explicit, from the menu.
  (Worth revisiting with the kitchen: click-to-inspect with an explicit Edit is the safer default
  for a catalogue people browse more often than they change.)

### 4.2 Collapsible navigation

The sidebar collapses to zero width behind a `menu` (☰) toggle, placed first on the breadcrumb line
of **every** Catalogue screen — list and both editors — so it is never orphaned. Animate `width`
and `flex-basis` (160ms) and set `visibility: hidden` when closed so collapsed items leave the tab
order. `KitchenOpsShell` should own the open state (it survives navigation between screens) and
expose it to the header components.

**Measure the list port after the transition, not during it.** The column-fitting logic in §4.1
reads the scroll port's width; a `ResizeObserver` alone did not re-fire reliably when the nav
animated, leaving 9 columns in a 713px port with 884px of content, overflowing horizontally.
Measure in the toggle's `setState` callback **and** again after the transition duration, plus on
window resize. On native, derive it from `onLayout` instead.

### 4.3 Column header sort + filter

Every non-action column header is a button. Clicking it opens a `Menu` anchored under the label:
sort ascending / descending, then that column's distinct values as toggleable rows with a `check`
mark. Multiple values within a column are OR-ed; filters across columns are AND-ed; `Clear` shows
only when that column has an active filter. The header label turns brand-coloured and gains a `▽`
(filtered) or chevron (sorted) marker, so an active constraint is visible without opening anything.

Derive distinct values from the **unfiltered** source so a column's options don't collapse as you
narrow it, and cap the list (12 in the mock) with a scroll region beyond that. Reset `page` to 1 on
every filter change. For high-cardinality columns (Designation, Reference) prefer sort-only plus
the toolbar search — a value list of 248 ingredient names is not a filter UI.

Sort must be locale-aware (`localeCompare`) for text and numeric for numbers. The mock branches on
`typeof`; in the repo drive it off the column spec (`sortType: 'text' | 'number'`) instead.

**`Menu` must own edge-flipping.** A fixed-width popover anchored to its trigger's start edge runs
off the port on right-hand columns — the clipped strip holds the value rows' right edge and the
`Clear` link, i.e. the affordance for undoing the filter, and it injects 44–50px of horizontal
scroll. Flip the anchor to the trigger's **end** edge when the menu would exceed the reference box.

The reference box is the **narrower of the scroll port and the grid's own `max-content` width** —
not the port alone. Because the row grids carry `min-width: max-content` (§4.1), a popover that
overflows the *grid* still grows `scrollWidth` even while it looks comfortably inside the port; the
first fix, measured against the port only, left exactly that phantom 44px scrollbar. Mirror for
RTL: `inset-inline-*` flips automatically, but so does the direction the overflow occurs in, so the
comparison must be against the inline-end edge, not a hard-coded right. This belongs in `Dropdown`/
`Menu` (with the trigger's inline offset as an input) so no call site can get it wrong — the same
reasoning as the `pointerdown` rule in §4.1.

Render the action column's header as a plain non-interactive element. Emitting the same
`role="button" tabindex="0"` wrapper for a column with no sort or filter leaves a keyboard-focusable,
tooltip-bearing target that does nothing — branch on the spec's sortability.

Two implementation notes that cost real debugging time in the mock:

1. **Popovers must swallow `pointerdown`.** The document-level outside-press closer fires on
   `pointerdown`, which unmounts the menu before its item receives the `click` — the action
   becomes unreachable. Stop propagation on the popover container (menu, `SearchSelect`
   dropdown, drawer panel). `Dropdown`/`Menu` should own this so call sites can't get it wrong.
2. **Clear the viewed record on navigation.** A record held across a list change gets rendered
   against the new entity's field spec (recipe fields on an ingredient → `NaN`,
   `undefined kcal`). Reset it in the nav action alongside `menuRow`, `search` and `page`. Field visibility keeps
`RecordFieldChooser`'s logic behind a compact `Menu`. Detail stays a `Drawer`.

`CatalogueList` takes the column spec — deliberately the same shape as today's `RecordColumn`,
so definitions port with minimal edits:

```ts
{ key, label, width, min, priority, align?, mono?, badge?, sortable?, filterable?, render? }
```

`min` is the numeric floor used for fitting; `priority` drives which columns survive a narrow
viewport (Designation 100, overflow 95, the entity's headline metric 85, status 80, reference 70,
down to `updated` 20). Row grids must carry `min-width: max-content` so the row box grows to the
full track sum — otherwise the hairline, hover tint and menu anchor stop at the scroll port's edge
while the cells overflow past it.

Ingredients, Recipes and Sauces differ only by that array. Entity-specific cells
(`AllergenClassCell`, `VersionCell`) survive as cell renderers, restyled.

### 4.4 Forms

`FormSection` + `FormGrid columns={3}`; labels 12px above 28px controls at 4px gap; helper 11px.
Textareas are the intended `span={2}` users.

### 4.5 Icons — real `IconName` values

`ICON_GLYPHS` in `packages/design-system/src/icons/icon.tsx` is itself glyph-based, so pass these
**names** to `<Icon name=… />`; never inline the character.

| use | `IconName` | glyph |
| --- | --- | --- |
| toolbar search | `search` | ⌕ |
| row overflow trigger | `more` | ⋯ |
| menu · View | `eye` | ◉ |
| menu · Edit | `pen` (see gap below) | ✎ |
| menu · Archive | `archive` (see gap below) | ▤ |
| nav toggle (hamburger) | `menu` | ☰ |
| column sort ascending / descending | `chevronUp` / `chevronDown` | ⌃ / ⌄ |
| filter marker, active filter | `filter` | ▽ |
| filter value selected | `check` | ✓ |
| field chooser | `filter` | ▽ |
| remove a line row | `close` | ✕ |
| new entity (primary) | `plus` | + |

`close` ✕ 53, `plus` + 54, `eye` ◉ 56, `menu` ☰ 63, `copy` ❐ 70, `search` ⌕ 71, `refresh` ⟳ 77,
`filter` ▽ 83, `more` ⋯ 85, `check` ✓ 52, `chevronUp` ⌃ 51, `chevronDown` ⌄ 50 are all confirmed
present in `ICON_GLYPHS`.

Use `chevronStart`/`chevronEnd` (`DIRECTIONAL_ICON_NAMES`) wherever the mark should follow writing
direction; `resolveIconGlyph(name, isRtl)` already handles the flip. Icon sizing comes from
`iconSize` in `control.ts`, not `ICON_SIZES`' Tailwind text classes.

**Gap: `pen` and `archive` are both missing from `ICON_GLYPHS`** — and both are now row actions the
user asked for by name. Add two entries (preferred), or accept the mock's substitutes `✎` and `▤`.
The file's docblock warns that a codepoint the platform cannot draw becomes a tofu box and that
every glyph is asserted in `icon.test.tsx`, so whichever characters you choose must be added to
that test — do not ship `✎`/`▤` as inline literals.

### 4.6 Split the two large screens first

```
ingredients-screen.tsx  (1085 lines) → use-ingredient-list.ts  + presentation
recipe-edit-screen.tsx  (2048 lines) → use-recipe-editor.ts    + five tab views
```

Extract state, filters, sort, mutations, dirty tracking, the four-write lock-version save
sequence and publish gating into the hooks **unchanged**. Only presentation is rewritten.

---

## 5. SearchSelect — the modal removal

`forms/select.tsx` is, per its own docblock, "a button that opens a modal radio group". It stays for
short enums; every **entity reference** moves to `SearchSelect`:

- 28px input; typing filters; results in an anchored `Dropdown` (popover shadow, 28px rows).
- Row content: name · `category · unit` meta · unit price, mono and end-aligned — exactly what
  `useIngredientOptions` already composes.
- `↑` `↓` `Enter` `Esc`; closes on select and outside press; **focus returns to the input** so five
  ingredients are five uninterrupted type-selects.
- Distinct states: idle, typing, loading (skeleton rows), no results
  (`No ingredient matches "zaatar" · Create it →`), error.

Six call sites: recipe raw materials, recipe packaging, plan menus, price-list rows, supply orders,
order desk.

---

## 6. Recipe editor — structure from `Recipes Instructions.xlsx`

The sheet's sections map onto the five tabs. Tab navigation is preserved (minimal scrolling);
contents follow the sheet, not the current UI.

| tab | from the sheet | fields |
| --- | --- | --- |
| **Description** | `Designation`, `Kind`, `Quantity Produced (Yield)`, the privacy note | designation EN/AR, reference (read-only), kind, category, shelf life, yield qty + unit, portions, method (`span={2}`), storage, **Restricted** flag |
| **Production** | `Raw Material (Production)` table | line per raw material: designation · U. · Q. · U.P. · T (derived) · Comments · remove; totals row (qty + cost); `SearchSelect` to add |
| **Packaging** | `Packaging` table | identical shape, packaging catalogue |
| **Costing** | `Cost (Production)`, `Cost (Packaging)`, `Total Cost` | the cascade, read-only, + waste % inputs and selling price |
| **Technical sheet** | the sheet as a whole | print view + derived composition/allergens + restricted notice |

### 6.1 The cost cascade — exact formulas

Verified against the sheet's own numbers (yield 1.7 kg, production 7.186, packaging 0.35):

```
lineTotal        = qty × unitPrice
productionCost   = Σ lineTotal                        = 7.186
productionPerKg  = productionCost / yield             = 4.2271
productionFinal  = productionPerKg × (1 + waste%)     = 4.3539   (waste 3%)
packagingCost    = Σ lineTotal                        = 0.35
packagingPerKg   = packagingCost / yield              = 0.2059
packagingFinal   = packagingPerKg × (1 + waste%)      = 0.2162   (waste 5%)
totalPerKg       = productionFinal + packagingFinal   = 4.5700
```

All four intermediate figures reproduce the spreadsheet exactly. Waste coefficients are per-recipe
inputs defaulting to 3% (production) and 5% (packaging) — they are constants in the sheet, so
confirm with the kitchen whether they should be tenant settings instead of per-recipe fields.

Display: 2 dp for prices, 3 dp for line totals and quantities, 4 dp inside the cascade (the sheet
carries more precision than 2 dp and rounding early loses the reconciliation). Store full precision;
round only at render.

### 6.2 Derived, never typed

Allergen classes and nutrients ("composition") resolve from the ingredient database:

- Recipe allergens = union over raw materials, each chip labelled with its source
  (`Egg · via Mayonnaise`) so a cook can see where it came from.
- Nutrients = mass-weighted roll-up over the lines, per 100 g.
- Render read-only on the sunken fill with a `From database` badge and one line of explanation.
  No input, no override. If a correction is needed it happens on the ingredient, not the recipe.

Ingredient editor: same treatment — Composition & allergens is a read-only confirmation panel.

---

## 7. Order

1. Tokens (`control.ts`, typography, spacing aliases, border/elevation reduction) → `build:tokens` → colour + scale tests.
2. Rebuild primitives in place (same exports).
3. New patterns (§3 table).
4. **`/showcase` — every component, every state. Review gate.**
5. Catalogue shell components.
6. **Ingredients** list + editor — reference implementation.
7. **Recipes** list + editor + inline `IngredientSelector`.
8. **Sauces** — a column spec at this point.
9. Sweep: delete Catalogue usage of `record-list.tsx`, `table.tsx`, `kpi-tile.tsx`,
   `editor-frame.tsx`, `list-toolbar.tsx`, `ops-record-frame.tsx`, `gate-rail-card.tsx`,
   `row-editor-shell.tsx`; grep orphaned classes.

## 8. Do not touch

`kitchen-admin-hooks.ts` · `query-keys.ts` · `repository-provider.tsx` · `packages/api-client` ·
`recipe-draft.ts` · `recipe-sheet-view.ts` · `plan-menu.ts` · `plan-matrix.ts` · `packaging.ts` ·
`format.ts` · `review-queue.ts` · `receive-delivery-model.ts` · `use-list-page.ts` ·
`use-optimistic-concurrency.ts` · `use-unsaved-guard.ts` · `access/gate.tsx` · `useCan` ·
`entity-registry.ts` permissions + `ENTITY_FAMILIES` · every `app/kitchen/*` route ·
`kitchen-nav.ts` · `kitchen-trail.tsx` · every `testID` the e2e specs reference.

## 9. Gate

`pnpm check` · `colour.test.ts` both themes · control-height jest test · the ESLint rule in §2 ·
existing `catalogue.*.spec.ts`, `kitchen-admin.*.spec.ts` and `kitchen-admin-*.test.tsx` green ·
new copy through `packages/i18n/catalogues/{en,ar,en-XA}` + `pnpm gen:i18n-keys`, no literals ·
logical utilities only (`ms/me/ps/pe/start/end`) · dark values for every new token · visual pass on
every Catalogue route in both themes and directions at `sm`/`md`/`lg`/`xl`.

## 10. Open with the kitchen

0. `pen` and `archive` icons — the two glyphs missing from `ICON_GLYPHS`, both now named row
   actions. Add entries (and `icon.test.tsx` assertions) or accept the substitutes (§4.3).
   `eye` for View and `menu` for the hamburger already exist.
1. Waste coefficients (3% / 5%) — per-recipe fields or tenant settings?
2. Selling price and margin are not in the sheet; confirm they belong on the Costing tab.
3. The sheet's privacy line is modelled as a per-recipe `Restricted` flag — confirm it is not
   simply true of all technical sheets.
