# Catalogue UI System — Implementation Plan

Read of `healthlyzone360` @ 2026-09-05. Nothing modified yet.

---

## 0. What the codebase actually is (and one constraint to agree first)

`apps/universal` is **Expo SDK 57 / React Native + NativeWind 4**, not a DOM React app.
Shared UI lives in `packages/design-system` (`@healthy360/design-system`), tokens in
`packages/design-tokens` → `pnpm build:tokens` → `generated/tailwind-preset.cjs`.

So the "components" are `.tsx` React Native components consuming Tailwind classes generated
from the token files. That is where the new system has to land.

**Constraint:** from here I can *read* your repo but not write into it. What I produce is:

1. **Pixel-accurate recreations** of the Catalogue screens as they are today (review baseline).
2. **The new system, built and interactive** — every primitive, every state, every Catalogue
   screen, as design components you can click through and review.
3. **A handoff package** — exact token values, class strings, prop signatures and a per-file
   migration map (`Button` → `actions/button.tsx`, etc.) so the React Native implementation is
   mechanical, plus a Claude Code handoff so it can be applied inside the repo in one pass.

Everything below is written against your real file paths so step 3 is a transcription, not a
reinterpretation.

---

## 1. Why the current Catalogue reads the way your supervisor described

Not opinion — these are the specific lines causing each complaint.

| Complaint | Cause in code |
| --- | --- |
| Giant buttons, inconsistent heights | `actions/button.tsx`: **every** size variant is `min-h-touch` = 44px (`MIN_TOUCH_TARGET`, `layout.ts`). `sm` and `md` differ only in padding, so they render nearly identically; `md`/`lg` share `text-base`. |
| Large typography | `primitives/text.tsx`: `Heading level={1}` = `text-3xl` (30px) on every list page. Body default 16px. |
| Font choice | `typography.ts`: Inter (latin) + Space Grotesk (display). Generic-SaaS pairing. `CLAUDE.md` already states the intended replacement (Schibsted Grotesk + IBM Plex Mono) but defers it. |
| Table-heavy, excessive borders | `data/record-list.tsx` + `data/table.tsx` drive Ingredients and Recipes; 17 fixed-width columns on ingredients, `border border-brand-100` panels on `list-toolbar.tsx`, `kitchen-page-header.tsx` (band), toolbar cards, KPI tiles. |
| Components too large | Each list page opens with `KitchenPageHeader` (30px title) + a 4-tile `KpiTile` strip + a bordered toolbar card + a bordered record list + pagination. Four stacked boxes before data. |
| Inconsistent spacing | `Stack space="lg"` at page level, `space="sm"`/`"xs"` inside, `gap-3` hand-written on stat strips, `p-3 md:p-4` on toolbars, `p-4` on skeleton cards. No single density decision. |
| Doesn't feel like one system | Ingredients/Recipes use `RecordList`; Sauces/Dressings/Meals/Products use different presentations; row editors use a third (`row-editor-shell.tsx` grid/card branch). |
| Modal to add an ingredient | `forms/select.tsx` is **"a button that opens a modal radio group"** (its own docblock, line 88). `recipe-row-editors.tsx` picks ingredients through it → every ingredient add is a full-screen modal. |

---

## 2. Preserve vs replace

### PRESERVE — untouched, imported by the new UI

- **Data layer:** `src/data/kitchen-admin-hooks.ts` (every query + mutation), `query-keys.ts`,
  `repository-provider.tsx`, `packages/api-client`.
- **Domain logic:** `recipe-draft.ts`, `recipe-sheet-view.ts`, `plan-menu.ts`, `plan-matrix.ts`,
  `packaging.ts`, `format.ts` (`displayName`, `parseQuantity`, `unitDimension`, `statusTone`,
  `humaniseCode`, `unitsInDimension`), `review-queue.ts`, `receive-delivery-model.ts`.
- **Stateful hooks:** `use-list-page.ts`, `use-optimistic-concurrency.ts`, `use-unsaved-guard.ts`,
  `useDebouncedRollupDraft`.
- **Access + routing:** `access/gate.tsx`, `useCan`, `entity-registry.ts` permission constants and
  `ENTITY_FAMILIES`, every route file under `app/kitchen/*`, `kitchen-nav.ts`, `kitchen-trail.tsx`.
- **Validation & concurrency:** lock-version sequencing in `recipe-edit-screen.tsx` (four ordered
  writes), `isValidationFailure` handling, publish readiness gates.
- **i18n:** all `kitchen:*` keys; new copy goes through `packages/i18n/catalogues/{en,ar,en-XA}` +
  `pnpm gen:i18n-keys`. No literals.
- **Test contracts:** every `testID` referenced by `e2e/specs/catalogue.*.spec.ts`,
  `kitchen-admin.*.spec.ts` and the `kitchen-admin-*.test.tsx` suites. New components accept and
  forward the same ids.
- **Invariants from `CLAUDE.md`:** logical utilities only (`ms/me/ps/pe/start/end`), dark mode
  values for every new token, `colour.test.ts` AA gate, RTL geometry specs, `web:` variant rule,
  shell scroll port.

### REPLACE — visual layer, entirely

- `data/record-list.tsx`, `data/table.tsx` as the Catalogue's presentation (kept in the package only
  if another area still needs them).
- `kitchen-page-header.tsx`, `list-toolbar.tsx`, `kpi-tile.tsx`, `editor-frame.tsx`,
  `ops-record-frame.tsx`, `row-editor-shell.tsx`, `ops-panel.tsx`, `gate-rail-card.tsx`.
- `forms/select.tsx` as the *picker* for entity references (stays for short enum lists only).
- Per-screen markup in all Catalogue screens (`ingredients-screen`, `ingredient-edit-screen`,
  `recipes-screen`, `recipe-edit-screen`, `sauces-screen`, `products-screen`, `product-edit-screen`,
  `meals-screen`, `meal-edit-screen`, `packaging-*`, `plans-*`, `price-lists-*`) — logic extracted,
  presentation rewritten.
- `actions/button.tsx`, `primitives/text.tsx`, `forms/text-input.tsx`, `navigation/tabs.tsx`,
  `navigation/breadcrumbs.tsx`, `content/card.tsx`, `content/badge.tsx` — rebuilt on the new size
  and type scales, same export names so unrelated areas keep compiling.

### REFACTOR — logic/presentation split

`ingredients-screen.tsx` (1085 lines) and `recipe-edit-screen.tsx` (2048 lines) mix both. Split:

```
ingredients-screen.tsx        → <Gate> + use-ingredient-list.ts (state, filters, sort, mutations)
                                + presentation from the new catalogue components
recipe-edit-screen.tsx        → use-recipe-editor.ts (drafts, dirty tracking, save sequence,
                                lock-version rebasing, publish) + step presentation
```

---

## 3. Token layer (`packages/design-tokens`)

Extend the existing generators — no parallel token system.

### 3.1 New: `control.ts` — component heights (the single source for "compact")

```
controlHeight = { xs: 24, sm: 28, md: 32, lg: 40 }   // pointer
controlHeightTouch = { xs: 36, sm: 40, md: 44, lg: 48 }  // coarse pointer / native
controlPaddingX = { xs: 6, sm: 8, md: 10, lg: 14 }
controlGap = { xs: 4, sm: 6, md: 6, lg: 8 }
iconSize = { xs: 12, sm: 14, md: 16, lg: 18 }
```

Emitted as `h-control-sm`, `px-control-sm`, etc. **This is the "make all compact inputs 2px
shorter" knob** — one number, one rebuild, every control follows.

Touch-target resolution: heights are pointer-first; the touch table applies under
`@media (pointer: coarse)` on web and always on native, so the 44px invariant and the compact
brief both hold. (Decision to confirm — see questions.)

### 3.2 Typography — one family, compact ramp

```
text-micro   10/14  600  0.06em upper   badges, column labels, eyebrows
text-caption 11/16  400                 helper, meta, secondary cell
text-body    12/18  400                 default body / cell / input value
text-label   12/16  500                 field labels, tabs, button text
text-strong  13/18  600                 list item titles, card titles
text-section 13/18  600  0.02em upper   section titles
text-title   16/22  600                 page title  (was 30px)
text-display 20/26  700                 the one big number on a KPI, if kept
```

Numerics (quantities, costs, references, versions) take a mono role so columns align. Latin family
per your answer on fonts; Arabic stays IBM Plex Sans Arabic; the 1.5/1.75 per-script multiplier is
untouched, so these line heights are the latin resolution.

### 3.3 Spacing — the same 4pt scale, a smaller working set

Catalogue uses only `1 / 1.5 / 2 / 3 / 4` (4/6/8/12/16px). Named aliases so it is stated, not
remembered: `space-hair 4`, `space-tight 8`, `space-snug 12`, `space-base 16`, `space-loose 24`.

### 3.4 Borders, radius, elevation

- Radius: controls `sm` (4), panels `md` (8). No 14px panel radius in the Catalogue, no pills
  except badges.
- **One border colour** (`stroke-subtle`) and mostly as a *separator*, not a box: `border-b`
  between list rows, `border-t` above a form section. No card outlines.
- Elevation: exactly two — flat, and one popover shadow (dropdowns/menus). Nothing else casts.
- Grouping comes from `surface-sunken` bands and type hierarchy.

---

## 4. Component architecture

Placed to match the repo's existing folders — no new top-level convention.

```
packages/design-system/src/
  primitives/    Text (new ramp) · Stack · Inline · Grid ← new · Separator ← new
  actions/       Button · IconButton · ActionGroup ← new · SplitButton?
  forms/         Input · Textarea · Select (enums only) · SearchInput ← new
                 SearchSelect ← new (inline, no modal) · QuantityInput ← new
                 Checkbox · Switch · FormField ← new · FormRow/FormGrid ← new · FormSection ← new
  content/       Card (compact) · ListItem ← rebuilt · DataList ← new · Badge · StatusBadge ← new
                 Tag/Chip · EmptyState · Tooltip ← new
  navigation/    Tabs (compact) · Breadcrumb (compact) · Pagination (compact)
  overlays/      Dropdown ← new (anchored popover) · Menu ← new · ConfirmationDialog ← new
                 Drawer · Dialog (kept, used sparingly)
  status/        Skeleton · Spinner · ErrorState · InlineBanner ← new

apps/universal/src/features/kitchen-admin/catalogue/
  CataloguePageHeader   title + trail + one primary action, single 44px-tall row
  CatalogueToolbar      search + status segments + filter menu + field menu, one 32px row
  CatalogueList         DataList bound to a column/field spec
  CatalogueListItem     one entity row, entity-agnostic
  CatalogueSummaryBar   the KPI strip, condensed to one inline line
  IngredientSelector    SearchSelect bound to useIngredientOptionsQuery
  RecipeIngredientList  the inline line editor
  EntityDetailPanel     the record drawer, compact
```

Rule: a component enters `design-system` only if two Catalogue entities use it. Everything else
stays in `catalogue/`.

### 4.1 Sizing API

`size="sm" | "md" | "lg"` on Button, IconButton, Input, Select, SearchInput, SearchSelect,
QuantityInput, Tabs, Badge, ListItem. Each maps **only** to `control.ts` values — no component
states its own height. Catalogue default is `sm`; `md` for a page's primary action; `lg` unused in
admin.

Widths: no component sets a width. Ever.

### 4.2 Layout system — the no-stretch rule

This is the part your last message is about, so it is a system, not a habit.

**`<FormGrid columns={3}>`** uses `grid-template-columns: repeat(3, minmax(0, var(--field-max)))`
with `justify-content: start` — *not* `1fr`. A lone field in the last row keeps the exact width of
the fields above it; the remaining columns are genuinely empty.

- `--field-max` is a token (`fieldWidth = 280`), not a per-page number.
- Column count is responsive by breakpoint (`1 → 2 → 3`), and the *field width stays constant*
  across breakpoints — only the number of columns changes.
- Spanning is explicit and only explicit: `<FormField span={2} />`, `<FormField fullWidth />`.
  Description/notes textareas and a dedicated search are the intended users of it.
- `<CardGrid columns={4}>` follows the same rule with `--card-min`/`--card-max`, so a final lone
  card sits at card width with empty space beside it.
- `flex: 1` / `w-full` is banned in field and card contexts; it stays legal only for a container
  that *is* the row (a toolbar spacer, a list row's title column).

React Native note: `display: grid` is web-only. `Grid`/`FormGrid` are platform-split
(`.web.tsx` real CSS grid, `.native.tsx` fixed-width flex children with `flex-wrap` and no
`flexGrow`) — which produces the same no-stretch geometry on both, and matches the existing
`.web.tsx`/`.native.tsx` pattern (`slider-field`, `date-field`).

---

## 5. Catalogue layout strategy

### 5.1 Every list page, same five parts

```
Breadcrumb                                   11px, one line, 16px tall
Ingredients                    [+ New]       16px title · one 32px primary · nothing else
248 items · 3 missing Arabic · 12 uncosted   11px inline summary (replaces 4 KPI tiles)
[⌕ search        ] [All|Draft|Live] [⚙]      one 32px toolbar row, no card, no border
─────────────────────────────────────────
name          ref     cat    unit  status ⋯  10px uppercase column labels, no cell borders
Tomato paste  IG-014  Cond.  kg    Live   ⋯  32px rows, border-b hairline, hover tint
...
Showing 1–25 of 248            ‹ 1 2 3 ›     compact pager
```

- No table element chrome, no vertical rules, no zebra. A row is a hairline separator + hover
  tint. Column labels are 10px uppercase, not table headers with borders.
- Above `lg` the row is a column grid (aligned, scannable, ~32px tall); below `md` the same
  `CatalogueListItem` renders two-line (title + meta run) — one component, two arrangements, the
  branch that `record-list.tsx` already proved.
- Row actions: trailing icon group, revealed on hover/focus, always present for keyboard and
  touch. Overflow beyond two actions goes to a `Menu`.
- Field visibility keeps working (`RecordFieldChooser`'s logic) but as a compact `Menu`, not a card.
- Detail stays a `Drawer` — it is already the right answer and costs no width.

### 5.2 One visual language across entities

`CatalogueList` takes a spec: `{ key, label, width, align, render, sortable, filterable }[]` —
the same shape as today's `RecordColumn`, so column definitions port with minimal edits. Ingredients,
Recipes, Sauces, Dressings, Meals, Products, Packaging all render through it. Entity-specific cells
(`AllergenClassCell`, `VersionCell`) stay as cell renderers, restyled.

### 5.3 Forms (`ingredient-edit`, `recipe-edit`, `meal-edit`, …)

```
FormSection "Identity"          13px uppercase section title, hairline above, no card
  FormGrid columns=3            Name(en) · Name(ar) · Reference
  FormGrid columns=3            Category · Subcategory · Kind
FormSection "Measurement"
  FormGrid columns=3            Unit · Purchase unit · Items per unit
FormSection "Description"
  FormGrid columns=3            Textarea span=2, third column empty
```

Labels 12px directly above 28px inputs (4px gap), helper 11px. Editor steps stay the existing five
`Tabs` — compact, 28px, text-label, active state by 2px underline, no container.

### 5.4 Recipe ingredients — inline, no modal (requirement 10)

`<SearchSelect>`: a 28px input; typing filters; results render in an anchored popover directly
below (`Dropdown`, popover shadow, 28px rows, name + category · price description exactly as
`useIngredientOptions` already composes); ↑/↓/Enter/Esc; closes on select and on outside press;
distinct empty ("No ingredient matches 'tom'"), loading (skeleton rows) and error states. Selection
appends a line and returns focus to the search field so five ingredients are five uninterrupted
type-selects.

Each line is one 32px row: name · `QuantityInput` · unit `Select` · note · optional toggle ·
remove `IconButton`. Move up/down and the undo bar keep `row-editor-shell.tsx`'s existing
announcement and restore-to-position behaviour, restyled.

`SearchSelect` then also replaces the modal picker in packaging rows, plan menus, price-list rows,
supply orders and the order desk — one component, six call sites.

---

## 6. Showcase — one source of truth

`src/screens/showcase-screen.tsx` (routes `/showcase`, `/platform-admin/showcase`) is extended, not
duplicated. `CLAUDE.md` already rules that a component change which has not reached `/showcase` is
not done; the new sections keep that:

Buttons (4 variants × 3 sizes × normal/hover/disabled/loading, plus icon+text alignment proof) ·
IconButton · Input/Textarea (normal/focus/error/disabled/with helper) · SearchInput ·
Select · **SearchSelect (empty / typing / results / no results / loading / selected)** · Tabs ·
Breadcrumb · Badge + StatusBadge (every lifecycle state) · Card · ListItem + DataList ·
FormField/FormRow/FormGrid (**including the 4-fields-in-3-columns no-stretch proof**) ·
CardGrid no-stretch proof · EmptyState · Loading/Skeleton · Dropdown/Menu/Tooltip ·
ConfirmationDialog · the full type ramp and spacing scale as swatches.

Same imports as the Catalogue. No showcase-only variants.

---

## 7. Migration order

1. **Tokens** — `control.ts`, typography ramp, spacing aliases, border/elevation reduction;
   `pnpm build:tokens`; `colour.test.ts` green in both themes.
2. **Primitives** — Text, Button, IconButton, Input, Textarea, Checkbox, Switch, Badge,
   StatusBadge, Tabs, Breadcrumb, Card, Separator, Grid. Same export names → the rest of the app
   keeps compiling and inherits the compact system.
3. **New patterns** — Dropdown, Menu, Tooltip, SearchInput, SearchSelect, QuantityInput,
   FormField/FormRow/FormGrid/FormSection, DataList, ListItem, EmptyState, ConfirmationDialog.
4. **Showcase** — every component, every state. **Review gate: you sign off here.**
5. **Catalogue shell** — CataloguePageHeader, CatalogueToolbar, CatalogueSummaryBar,
   CatalogueList/ListItem, EntityDetailPanel.
6. **Ingredients** — list + editor end to end. Reference implementation; `catalogue.*.spec.ts`
   and `kitchen-admin-catalogue.test.tsx` must stay green.
7. **Recipes** — list + editor + inline `IngredientSelector`. The biggest win.
8. **Sauces, Dressings, Meals, Products, Packaging** — mostly spec objects at this point.
9. **Plans, Price lists, Quotations** — same components, entity specs.
10. **Sweep** — delete `record-list.tsx`/`table.tsx` usage from Catalogue, delete `kpi-tile.tsx`,
    `editor-frame.tsx`, `list-toolbar.tsx`, `ops-record-frame.tsx`, `gate-rail-card.tsx`; grep for
    orphaned classes; `pnpm check`; RTL + a11y + responsive specs.

## 8. Quality gate (your §21, as checks)

Automated where it can be: a jest test asserting every Catalogue control resolves to a
`control.ts` height; an ESLint rule banning raw `text-[0-9]`, `h-[`, `w-[` and `flex-1` inside
`catalogue/`; `pnpm check`; `colour.test.ts`; existing e2e LTR/RTL/a11y suites. Visual pass over
every Catalogue route in both themes and both directions at `sm`/`md`/`lg`/`xl`.
