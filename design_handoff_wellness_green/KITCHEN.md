# Handoff addendum: Kitchen module — Wellness Green

Companion to `README.md` in this folder. That document's phases 1–3 (tokens, design-system
components, shells) and its seven settled decisions are **already implemented and merged** — do not
redo them, and do not re-open the decisions. This addendum is **Phase 4 composition work only**,
for every screen under `/kitchen`.

## Design file

`designs/Kitchen Module - Wellness Green.dc.html` — ten frames, ids `7a`–`7j`, each 1280px with the
kitchen sidebar. Open in a browser with `support.js` beside it. As before: these are references to
recreate in React Native + NativeWind against `@healthy360/design-system`, **not code to copy**.

Four kitchen surfaces were already designed in the main package (`Kitchen Ops - Wellness Green.dc.html`):
home `5a`, analytics `5b`, KDS `5c`, order-desk sale `5d`. They are unchanged.

## The template idea — read this first

The kitchen module is ~40 routes but only a handful of screen shapes, and the codebase already
builds it that way (`entity-registry.ts` drives the lists; `editor-frame.tsx` drives the editors).
Implement the **templates**, and the routes fall out. Do not hand-style 40 screens.

| Frame | Template | Implements |
| --- | --- | --- |
| 7a | Entity list | `list-toolbar` + table inside the registry list screen |
| 7b | Editor + publication gate | `editor-frame` + the meal editor's gate rail |
| 7c | Stock board | stock table with level meters |
| 7d | Production day list | KPI strip + totals table |
| 7e | Receive flow | task screen: lines, inputs, summary rail, one primary |
| 7f | Supply orders landing | shortage table + created-callout |
| 7g | Order desk | book table + three-book week calendar |
| 7h | Report | KPI strip + share bars + category table + data-quality flag |
| 7i | Queue | read-only review rows / action rows for exceptions |
| 7j | Recipe & version editor | ingredient lines, computed nutrition, allergen declaration, version rail |

## Route map — every route under /kitchen

- `7a` → `meals`, `recipes`, `ingredients`, `products`, `sauces`, `dressings`, `plans`,
  `price-lists`, `suppliers`, `quotations`, `delivery-zones`, `orders`, `purchases-ledger`,
  `allergen-classes` (read-only: no create button, no row actions)
- `7b` → `meals/[meal]` (with the gate rail), and the editor pattern for `ingredients/[ingredient]`,
  `products/[product]`, `sauces/[product]`, `dressings/[product]`, `plans/[plan]`,
  `price-lists/[priceList]`, `suppliers/[supplier]` + `suppliers/new`, `delivery-zones/[zone]`
  (gate rail only where a publication gate exists — meals; others keep the two-action header)
- `7j` → `recipes/[recipe]` (and its `new` value)
- `7c` → `stock`
- `7d` → `production`
- `7e` → `procurement/receive` (+ `procurement` hub as a 7a-shaped list of receivable orders;
  `procurement/unpriced-receipts` as a 7i-shaped queue)
- `7f` → `supply-orders` (+ `supply-orders/new` builder and `/print` — see behaviours; `[order]` is 7b-shaped)
- `7g` → `order-desk`, `order-desk/calendar`
- `7h` → `cost-report`, `order-desk/cash-report`, `order-desk/requirements`,
  `purchases-ledger` weekly/monthly summary modes, `branch-operating` (as a form-report)
- `7i` → `review`, `consumption-exceptions`, `qc`
- Batch 5 → `index` (5a), `analytics` (5b), `order-desk/sale` (5d); KDS (5c) is its own area

## Template specs (deltas from what phases 1–3 already give you)

Values not listed here (type scale, chips, buttons, focus, table header treatment) are already in
the merged component work. Radius decision holds: **cards 16px, panels/trays the named 14px token,
nothing at 20/24px.**

**Sidebar (all frames).** Canopy gradient `180deg #0B3B26 → #0E4429`, 232px. Group headings
10.5px/700 `.09em` uppercase `rgba(220,252,231,.62)`. Items 30px, 12.5px, `rgba(220,252,231,.78)`,
**white-space:nowrap**; active = `brand-surface` pill, white 700, radius 9. Queue counts (review,
exceptions) as warning-toned badges (`#FDF2D6`/`#79480A`) on their items. Sign out pinned at the
bottom: quiet, translucent border (`rgba(220,252,231,.28)`), never filled. Brand block: gradient "H"
mark + wordmark + `Kitchen · {branch}` in muted mint.

**Page header (all frames).** Breadcrumb 12px `text-secondary` → title Space Grotesk 700 26px
`-0.02em` → one-line purpose subtitle 13.5px. Status chip beside the title where the page has a
state (stock "1 item short", review count, editor draft state). Actions right-aligned on the title
row: one primary maximum (Rule 4 — the table in the main README §4 already rules `New meal`,
`Save draft`, and the empty slots; new ones here: receive → `Book in the delivery`, supply orders →
`Start an order`, everything else → none).

**Entity list (7a).** One toolbar row: Filters button (glyph in `#16A34A`, count badge
`brand-surface`) · search field 300px · then right-aligned `Showing N of M` (Space Grotesk 700, N in
`brand-surface`) · `Order by` select. Table in a 16px card: 44px row thumbnails at radius 10 where
the entity has imagery; numerics right-aligned Space Grotesk 700 `#0B3B26`; visibility chips
Published/Draft/Blocked = mint/amber/red. Footer line inside the card for provenance notes ("Energy
and macros come from the linked recipe version") + `Load N more`.

**Editor (7b).** White header band (title, state chip, quiet `Discard changes`, primary
`Save draft`, unsaved-guard note). Form cards 16px, inputs 48px radius 11, focus = 1.5px `#16A34A` +
3px `rgba(22,163,74,.16)`. Gate rail 330px: five checks as 20px pass/fail dots (mint ✓ / red ✕),
amber explainer panel, and a **disabled** `Publish to marketplace` button while any check fails.
Cross-link card to the review queue.

**Stock (7c).** Level meters: 8px track `surface-sunken`; fill `#16A34A` in range, `#B57D0D` low,
`#C02722` short — fills are graphics, always paired with the numeric columns. `History` per row
deep-links to `purchases-ledger?item=…`.

**Receive (7e).** Received-quantity inputs are real 40px fields right-aligned in the line grid.
Variance and no-invoice-price flags as amber chips on the line. Summary rail: lines, priced value,
short-against-order, unpriced count. One primary at the card footer.

**Order desk (7g).** Window filter chips (day scope ·divider· meal window), selected =
`brand-surface-subtle` + `#16A34A` border. Calendar: 150px book label column + 7 day columns, counts
in Space Grotesk 700, today's column `brand-surface`. **No totals row** — see behaviours.

**Report (7h).** KPI strip of 4 equal cards (label uppercase 11.5px, value Space Grotesk 700 28px,
one-line meaning under each). Data-quality callout amber, above the KPIs' table, linking to the
fixing surface. Share bars 8px, `#16A34A` (use `#0E6B41` for a second series).

**Queue (7i).** Review rows are **read-only** + one trailing link into the family editor. Exception
rows carry `Resolve` (quiet) + `Retry deduction` (primary) on the row.

**Recipe editor (7j).** Ingredient lines with editable quantity fields; computed nutrition card
(505 kcal headline + P/C/F strip) explicitly labelled *computed*; allergen declaration rows
(Undeclared = amber + `Declare handling` action, contains = red, not-present = mint); versions rail
with live/draft/retired states and the "meals stay on their version" note; used-by card.

## Behaviour that must survive (kitchen additions to README §6)

- **The calendar never adds the three books together.** No totals row, no combined count anywhere.
- **Receive is reachable without the order book** (inventory permission, not order-supplies) and
  crumbs under Procurement. The order is `?order=`, never a path segment.
- **Unpriced receipt lines flow to Unpriced receipts** and the cost report carries the
  data-quality flag while any exist.
- **The review queue is a read.** Every fix happens in the editor the row links to. No inline
  resolve on `/kitchen/review`.
- **Exceptions: reading needs view, Resolve/Retry need manage** — keep the buttons hidden or
  disabled accordingly, as the screen already does.
- **`new` is a value of the editor's `[param]`, not a sibling route** — creating and editing share
  the form, validation and unsaved guard. `supply-orders/new` and `/print` are the deliberate
  static-segment exceptions.
- **`?created=` on supply orders** is only ever set by the builder replacing itself; no parameter,
  no callout. Ledger deep links `?supplier=` `?item=` `?mode=` **seed** filters, never lock them.
- **Recipe versioning:** editing creates the next version; linked meals stay on theirs until moved.
  Nutrition and allergens are computed from ingredient lines, never hand-typed.
- **No Cancel on the order book or KDS** — cancelling stays management work on `/kitchen/orders`.
- **Production and stock cover count confirmed orders only**, never placed ones.

## Acceptance checks (beyond README §8)

- Sidebar: no label wraps (nowrap holds at 232px with badges present); active pill is
  `brand-surface`, not brand-500; badge text ≥ 4.5:1 on its amber fill.
- Lists: one toolbar row; `Showing N of M` present; every numeric column right-aligned.
- Editor: `Publish` visibly disabled while a gate check fails; the failing check names the fix and
  the place to make it.
- Reports: every bar/meter has its number beside it — no colour-only encoding.
- Queue counts in the sidebar match the queue pages' own counts.

## Open questions

1. **Field-level reconciliation.** `apps/universal` was not mounted when these frames were drawn —
   they are grounded in each route's docstring, `entity-registry.ts`, `editor-frame.tsx`,
   `list-toolbar.tsx` and the batch-5 work, but exact list columns, editor field sets, and the
   production/QC status vocabularies are **(proposed)**. Reconcile every frame against
   `src/features/kitchen-admin/screens/` before styling it; where the source disagrees, the source
   wins and the frame is only the visual treatment.
2. **QC's real shape** — designed as a 7i queue by analogy; verify against `QualityControlScreen`.
3. **Supplier/branch naming** — sample data uses invented suppliers (Levant Grain Co etc.); use
   fixtures from the repo.
