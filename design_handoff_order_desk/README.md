# Handoff: Order Desk redesign — on the Catalogue UI system

Design file: `Order Desk.dc.html` (fully clickable). Earlier Wellness-Green draft kept at
`Order Desk v1 (Wellness Green).dc.html` for reference only — **do not build from it**.

Target routes: `/kitchen/order-desk`, `/kitchen/order-desk/sale`, `/kitchen/order-desk/calendar`,
`/kitchen/order-desk/cash-report`, `/kitchen/order-desk/requirements`.

---

## 0. What changed, and why it is not the first brief

The first brief specified the current app's chrome — Inter + Space Grotesk, dark-forest sidebar,
36–40px controls, 16px card radii, 16px body text. **That is superseded by the Catalogue UI system**
(`desing_handoff_admin_components/catalogue-redesign-plan.md` + `Catalogue.dc.html`), which is the
newer decision for every admin surface: Schibsted Grotesk + IBM Plex Mono, 12px body, 28/32px
controls, hairline separators instead of card outlines, light rail instead of the canopy band.

The palette is unchanged — the same wellness-green values already in `packages/design-tokens`. Only
the chrome, the type ramp and the density moved.

## 1. Tokens used (all from the Catalogue system — nothing new)

```
surface        page #f7fcf9 · rail/sunken #edf6f0 · panel #fff
lines          structural #aaddc0 (header underline, control borders, panel edge)
               hairline   #cceeda (row separators, section rules)
text           #1f2937 primary · #5b6673 secondary · placeholder #94a3b8
primary        #157043, hover #11532e, white text
tints          hover #edf6f0 · selected #dcfce7
status         ok #dcfce7/#14532d · warn #fdf2d6/#79480a · bad #fde5e3/#8f1f1a · info #e2f1fb/#0b4a6f
type           10/600/.06em upper (micro) · 11 (caption) · 12 (body, controls) · 13/600 (row title,
               section title .02em upper) · 16/22/600 (page title) · mono 22/26/600 (one big number)
numerics       IBM Plex Mono — every time, quantity, money, reference, count
controls       inputs/segments/selects 28px · buttons 32px · icon buttons 24px · radius 5 (controls),
               4 (icon/pager), 6 (popover/banner), 8 (panel/card)
rows           26 / 32 / 40px by the density control; border-bottom hairline; hover tint; no zebra
elevation      flat, plus popover 0 6px 20px -4px rgba(16,42,30,.24) and drawer -8px 0 24px -8px
focus          2px #157043, 1px offset (global, unchanged)
```

## 2. Components

Existing app components (`@healthy360/design-system` + `kitchen-admin/`) that this design uses **as
rebuilt by the Catalogue pass** — i.e. no Order-Desk-specific change beyond what the Catalogue
migration already lands:

| Component | State | Note |
| --- | --- | --- |
| `Text` | EXISTING (Catalogue ramp) | every size here is on the new ramp; no literals |
| `Stack` / `Inline` | EXISTING | unchanged |
| `Button` | EXISTING (Catalogue rebuild) | `size="sm"` 28px / `md"` 32px; primary, secondary, quiet |
| `IconButton` | EXISTING (Catalogue rebuild) | 24px close/collapse glyphs |
| `Badge` / `StatusBadge` | EXISTING (Catalogue rebuild) | 17px, 10px upper; tones ok/warn/bad/info |
| `TextInputField` → `SearchInput` | EXISTING (Catalogue rebuild) | 240px queue search, 280px pickers |
| `Select` | EXISTING | kept for the short enum lists only (kind of sale, branch, method) |
| `Tabs` | EXISTING (Catalogue rebuild) | the sale wizard's step strip, 28px, 2px underline |
| `Breadcrumb` | EXISTING (Catalogue rebuild) | `Kitchen / Order desk / <leaf>`, 11px |
| `DataList` + `ListItem` | EXISTING (Catalogue new-in-that-pass) | queue, cash, requirements and menu lists all render through it with a column spec |
| `Drawer` | EXISTING | 372px, `placement="end"` — the order drawer |
| `Dialog` | EXISTING | assign-driver and record-payment |
| `EmptyState` | EXISTING (Catalogue rebuild) | 13px title + 11px body + 28px action |
| `ErrorState` | EXISTING | restyled to the same centred block; retry is a 28px secondary |
| `Skeleton` | EXISTING | 9px bars on the row grid, 1.3s shimmer |
| `InlineBanner` | EXISTING (Catalogue new-in-that-pass) | offline, truncation, three-numbers, WISH, address, refusal |
| `Dropdown` / `Menu` | EXISTING (Catalogue new-in-that-pass) | row overflow, if row actions grow past two |
| `QuantityInput` | EXISTING (Catalogue new-in-that-pass) | basket −/+ stepper at 24px |
| `FormSection` / `FormGrid` / `FormField` | EXISTING (Catalogue new-in-that-pass) | every sale step; `repeat(3, minmax(0, 240px))`, `justify-content: start` — the no-stretch rule |
| `Toast` (`useToast`) | EXISTING | confirm/fulfil/assign/record announcements |
| `Gate` / `useCan` | EXISTING | unchanged permission gates |

New, Order-Desk-only. Each lives in `features/kitchen-admin/order-desk/`, not in the design system
(the two-entity rule), until a second surface needs it:

| New component | Purpose | Options |
| --- | --- | --- |
| `QueueRow` | one open order as a 10-column grid row | `density: 'compact' \| 'comfortable' \| 'relaxed'`; `hovered`; trailing `Open` revealed on hover/focus. Row is the target; no nested interactive element except the trailing action |
| `DueBadge` | relative ageing, text always present | `tone` derived from minutes past due: neutral early, `warn` ≥15 late, `bad` ≥30 late. Never colour alone — the label *is* the interval |
| `DeliveryStateBadge` | the five delivery states | `state: 'not_delivered' \| 'awaiting_confirmation' \| 'no_run' \| 'unassigned' \| 'assigned'`; renders an em dash for `not_delivered` with an accessible label naming the fulfilment type |
| `PaymentCell` | intended method + position in one cell | `settled: boolean`; unsettled shows the shortfall, not a bare "no" |
| `OrderDrawerBody` | the drawer's five blocks | `sections: customer \| lines \| totals \| payment \| run`; run block omitted for collection/counter |
| `SaleWizardFrame` | step strip + body + footer rail | `steps: string[]` (4 for counter, 5 for collection, 6 for delivery); `current`; back/next; steps ahead of `current` are not clickable |
| `BasketRail` | live basket and the server quote | `lines`, `subtotal`, `fee`, `total`, `blockedLines`; renders `—` until the server has quoted. **Never prices anything itself** |
| `MenuPicker` | catalogue rows, no prices | `items`, `search`, `onAdd`; availability column carries `Not at desk` as a warn badge |
| `CalendarDayRow` | one day of the week as a row | `readings: CalendarReading[]` (Orders/Scheduled/Forecast, right-aligned 22px mono on shared column tracks); `today`; `expanded`; `slotCount`. Unknown days read `—` in all three and say "not answered" |
| `CalendarSlotLine` | one delivery slot inside an expanded day | `code: string \| null` — `commerce:slots.<code>`, or "Slot not set" for the `null` bucket; sits on the parent row's column tracks so the split reads as a decomposition. Forecast is dashed + hatched, differing on three axes, not only colour |
| `CurrencyTotalsPanel` | per-currency subtotals | `totals: {currency, amount}[]`. Has **no** grand-total slot to pass |
| `ShortfallRow` | needed / shelf / short / position | `short: string \| null`; `Covered` vs `Short` badge |

Changed existing components: **none beyond the Catalogue migration.** If `Table` is still the
Catalogue's list at implementation time, use it with the column spec rather than adding a second
list component.

## 2b. The rail

All 29 families from `entity-registry.ts`, in registry order, grouped by `ENTITY_GROUPS`
(orderDesk · workbench · catalogue · commercial · operations). Every label is lifted verbatim from
`packages/i18n/catalogues/en/kitchen.json` → `families.*.name` — no invented strings. Note the ones
that are easy to guess wrong: `products` is **Resale**, `branchOperating` is **Opening hours**,
`review` is **Needs review**, `orderCashReport` is **Cash taken**, `sauces` is **Sauces &
marinations**, and `dressings` is a **separate family** from sauces. Counts on Order desk, Needs
review, Consumption exceptions and Requirements are the queue badges the rail already carries.

## 2c. The order calendar: day rows, slots on demand

Corrected after reading `order-desk-calendar-screen.tsx` + `order-desk-calendar.ts`: the shipped
screen is `CalendarGrid` — day columns × delivery-slot rows, all three bases in every square.
Delivery slots exist in the product: the wire calls them `day.windows[]` with the kitchen's own
nullable `code`, labelled from `commerce:slots.*` — **Morning, Midday, Evening**. There is no
"afternoon" in the vocabulary; `midday` is the middle slot.

**The design deliberately does not copy that grid.** Seven days × four slots × three bases is 84
figures on one screen, all captioned — a wall of digits an agent cannot scan. The redesign keeps the
same data and inverts the structure:

- **Seven day rows**, one per day, in the desk's own list idiom (same as queue, cash, requirements).
- **Three basis columns** — Orders, Scheduled, Forecast — aligned down the week at 22px mono, so
  comparing Friday to Sunday is a single vertical scan. Each column is captioned once, in the header,
  not 28 times in the cells.
- **The slot split is the detail the row opens onto** (`Open every day` opens all seven at once).
  Expanded slot lines sit on the same column tracks as the parent row, so the split reads as a
  decomposition of the figures above it, not a second table.
- **Chrome is gone**: no frame, no rules, no cell outlines. Today is a green tint plus a `Today`
  badge; an open row is a lighter tint. Structure comes from alignment and space.

Rules the screen still inherits from `order-desk-calendar.ts`:

- **Basis names are `Orders` / `Scheduled` / `Forecast`** (`kitchen:calendar.basis.*`). The earlier
  draft's "Claimed"/"Projected" were invented; they are fixed.
- **The unslotted bucket is labelled "Slot not set"**, appears only on days that have one, and is
  never a permanent empty row.
- **`0` and `—` are different facts** (see §3).

## 3. Rules honoured (assert these)

- **No Cancel control anywhere.** Cancelling stays management work on `/kitchen/orders`.
- **Status and ageing always carry text.** `DueBadge`, `DeliveryStateBadge`, `ShortfallRow` and the
  projected calendar cell all read correctly in greyscale.
- **The calendar never totals its three books.** No totals row, no combined figure, and neither
  `CurrencyTotalsPanel` nor `CalendarDayRow` has a prop that could add one. A day's three figures are
  per-basis sums of that day's slots — each basis summed within itself only, never across the three.
- **Zero and unknown are different answers.** A slot missing from an answered day is a true `0`;
  a day missing from the answer entirely is an em dash in all three columns. `order-desk-calendar.ts`
  draws exactly this distinction (`isEmpty` vs `isUnknown`, deliberately not one three-valued
  predicate) and the design shows both — week two's Saturday and Sunday are unanswered on purpose.
- **No price before the server quotes.** `MenuPicker` has no price column; `BasketRail` shows `—`
  until a quote lands; a blocked line reads "not priced" and the sellable rest still totals.
- **Queue sort is fixed and no column sorts.** Column labels are 10px captions, not sort controls —
  the footer says so in words.
- **Bounded list, stated.** The truncation banner appears when the server caps the read; there is no
  second page to offer.
- **Logical properties only** — `padding-inline`, `inset-inline-start/end`, `border-inline-end`,
  `text-align: start/end`. Set `direction: rtl` (the `direction` tweak) and the whole desk mirrors.
- **One primary per screen.** Queue → `New sale`. Sale → `Next`/`Place order`. Calendar, cash report
  and requirements → none; requirements is read-only and says so.

## 4. States in the design file

Tweaks panel: `dataState` (`normal · loading · empty · error · offline`), `truncated`, `direction`.
In-design controls (real app chrome, not prototype furniture): rail collapse, density S/M/L,
`Show figures` stat strip, week stepper, date picker, branch select.

- Queue — normal, loading skeletons, empty (two copies: filtered vs nothing due), error + retry,
  offline banner, truncation banner, drawer open, assign-driver dialog, record-payment dialog.
- Sale — every step for all three kinds, plus the not-available basket line and its review refusal.
- Calendar — normal, loading, empty, error.
- Cash report — normal, loading, empty, error.
- Requirements — no branch chosen (friendly, not an error), normal, loading, empty, error.

## 5. Open questions

1. **Queue search scope.** The design searches order number, customer name and telephone; today
   `GET /catalogue/order-desk/queue` takes order number only, and `desk.searchHint` says names and
   numbers are not searchable. Either widen the endpoint or narrow the placeholder — the screen
   should not promise a match it cannot make.
2. **Density control persistence.** Catalogue's density lives in the toolbar; agreeing where it is
   stored (per user, per surface) is one decision for both surfaces.
3. **Row action set.** Only `Open` is offered. If confirm-from-row is ever wanted, it goes in a
   `Menu`, not as a second visible button — two visible row actions is the documented limit.
