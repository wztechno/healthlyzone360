# Recipe packages, prices and preparations — design

Date: 2026-11-12 · Branch at time of writing: `Update` · Status: **for owner review, nothing built**

## 1. Outcome

For every recipe the kitchen can read, on the recipe itself:

- what it costs to produce, per kg and per piece;
- what each **package** it is sold in costs — contents plus its packaging items;
- the **B2B price and the B2C price of each package**, with the margin beside each;
- and it can use a **preparation** (another recipe — a sauce, dressing, marinade) as a line,
  costed for the quantity used.

## 2. Owner rulings (12 Nov 2026)

1. Every package carries **both** a B2B price and a B2C price. Either may be left blank, which
   means "not sold on that channel in this size".
2. A preparation used inside another recipe **does not carry its packaging cost**. Only its
   production cost (ingredients, with its production waste) flows into the recipe that uses it.
3. Package contents convert volume to weight **1:1** — 1 L = 1 kg, so a 250 ml bottle holds
   0.25 kg. This applies to what a package holds only; ingredient lines keep their own densities
   (`ingredients.grams_per_unit`, the 15 Sep ruling).
4. The "per batch" packaging table on the Packaging tab **stays** until the stock follow-on.

## 3. What exists today

Verified in code on 12 Nov 2026.

| Area | Today | Where |
| --- | --- | --- |
| Recipe line | Names an ingredient only. No recipe reference, no line kind. | `recipes/…000603` — `ingredient_id` NOT NULL |
| Sauce inside a meal | Through a hidden ingredient "twin" created with the sauce's sold item. Unlabelled in the picker. A recipe with no sold item has no twin and cannot be used. | `CatalogueItemService::twinOf` |
| Twin's cost on a saved recipe | Typed purchase price first; the sauce's recipe cost last, and without the sauce's waste. | `RecipeVersionService::prepareLines`, `WeeklyRecipeCostingService::componentCost` |
| "Recipe makes ingredient" | A `recipe_version_outputs` row. The editor no longer writes one, so a hand-made sauce has none: no recipe-derived cost, and production refuses the batch. | `RecipeVersionService::setOutputs` has no editor caller |
| Packaging on the recipe | Lines saved as "N per batch", typed by hand. "Cost per package" = contents + **one** container; lid and label are not added. | `recipe-edit-screen.tsx:1018`, `RecipeCostingService::packageCost` |
| Sold pack | A `catalogue_item_variants` row with a size. Does not know which container it uses. | `catalogues/…000705`, `…000706` |
| Price charged | A `price_list_items` row on the pack. The Selling tab allows **one pack per channel** and saves through its own button. | `ChannelPackPriceService` (`CHANNELS = b2b, b2c`) |
| Recipe price columns | `recipe_versions.b2b_price_amount` / `b2c_price_amount`, per kg. The editor stopped writing them; **Dish margins still reads only them.** | `DishMargins.php:119` |
| Margin per package per channel | Does not exist anywhere. Costing shows no price; Selling shows no cost. | — |

### 3.1 What the dev server's data shows

Read on 12 Nov 2026 from `dev.157-230-121-66.nip.io` as the kitchen owner, through the app's own
read endpoints. Nothing was written.

| Fact | Count |
| --- | --- |
| Recipes | 112 — 43 sauce, 19 dressing, 25 meal, 17 frozen meal, 8 preparation |
| Recipes with at least one line | 36 (76 are unformulated placeholders) |
| Recipes with any packaging line | **1** of those 36 ("Taouk Preparation", one `per_batch` line) |
| Sold items | 103; every sauce and dressing has a twin |
| Items with a `b2b` and a `b2c` pack | 29 — sauces and dressings are 1 kg B2B / 300 g B2C |
| …of which both packs are the **same size** | 13 (all 7 frozen meals at 1 kg / 1 kg, 6 meals) |
| Items with one unpriced `unit` pack | 66 |
| Price rows | 49 retail (37 on a pack, 12 item-level, all meals), 32 wholesale (all on a pack) |
| Packs carrying both a B2B and a B2C price | 0 |
| Recipe versions carrying a price | 0 |
| Dish margins rows | 99, **none with a price** (27 `no_price`, 72 `no_recipe`) |
| Items selling from finished stock | 0 |
| Formulated recipes with no output row | 2 sauces, 3 preparations |
| Lines already costed from a component recipe (live path) | 5 |
| Recipes where saved cost ≠ live cost per kg | 30 of the 35 costed both ways |

What follows from it:

- **Margin per package is computable today for 19 items** from prices and live costs already in
  the system — it is only never put together. Contents alone, before any packaging: Honey Mustard
  Sauce B2B 1 kg sells at $5.00 and costs $5.80; Sour Cream B2B 1 kg sells at $5.00 and costs
  $6.40; Classic Burger Sauce B2C 300 g sells at $3.00 and costs $1.15.
- **The saved and the live cost disagree widely.** Barbecue Dip is $1.08/kg saved and $4.66/kg
  live; Halloumi Sticks is $103.06/kg saved and $8.28/kg live. §4.6 is not a tidy-up.
- The published recipe's Costing tab already shows the live figure; the saved figure is what the
  technical sheet prints as "Saved cost".
- Almost nobody uses the per-batch packaging table and nothing sells from finished stock. The
  owner chose to keep the table regardless (§10, point 1).
- Some meals carry both a priced pack and an item-level price (Chicken Red Tawouk: B2B 1 kg at
  $9.00 and an item-level $10.00). The item-level row is always shown as the "1 portion" package,
  whether or not packs exist.
- Data to look at, unrelated to this design: Halloumi Sticks has an item-level retail price of
  $2,000.00.

## 4. Design

### 4.1 The package

A **package** is one sellable unit of a recipe's sold item. It is the existing pack
(`catalogue_item_variants` + `catalogue_item_pack_variants`), given the one thing it lacks:

- **New table `catalogue_item_pack_components`** — `catalogue_item_variant_id`, `ingredient_id`
  (a packaging item), `quantity` (default 1), `organisation_id`. Same isolation as the pack table
  (`join-rls-parent`). This is the container, the lid, the label.
- **What it holds** — the pack's existing `pack_quantity` + `pack_unit_id`. Prefilled from the
  container's recorded capacity when a container is picked; editable.
- **Prices** — the existing price-list rows on that pack: one on the B2B channel's public tariff,
  one on the B2C channel's. Written through `PriceEntryService::setBasePrice`, so history and
  supersession stay the price list's own. **No new place stores a price.**
- **Cost** — computed on read, never stored.

Nothing about how an order is priced changes: checkout, the order desk and the B2B catalogue
already resolve a price per pack.

An item-level price row (11 meals on dev) is read as one implicit package: "1 portion", no
packaging items, that price — whether or not the item also has packs. No data migration is needed
for it to appear.

### 4.2 Cost per package

```
contents   = held × production cost per kg, with production waste        (weight or volume pack)
           = pieces × production cost per piece, with waste × portion factor   (piece pack)
packaging  = Σ component quantity × unit cost × (1 + packaging waste %)
cost       = contents + packaging
```

- `held` is the pack size in kg; a volume converts 1:1 (ruling 3).
- A packaging item's unit cost is its purchase price ÷ items per purchase pack, as today.
- Packaging waste is the recipe version's `packaging_waste_percent`, as today.
- Withheld, with the reason named, when production is not fully costed, the recipe has no yield,
  or a packaging item has no price. A partial figure is never shown as a cost.

### 4.3 Margin

`margin % = (price − cost) ÷ price × 100`, per package, per channel — the gross margin Dish
margins already computes. Shown only when both sides exist and share a currency.

### 4.4 Screens

All built from components already in the app.

**Packaging tab** (recipes with a sold item)

1. *Expiry & waste* — unchanged.
2. **Packages** — one card per package, in the existing package-cost card pattern:
   - Container (the packaging picker, items with a capacity) and what it holds.
   - Other packaging items with a quantity each (the existing line table).
   - Contents, Packaging, **Cost per package** (the existing cost ledger).
   - **B2B price** and **B2C price**, each with its margin (the margin pair on the ingredient form).
3. *Packaging used per batch* — the existing table, unchanged. It remains what a batch draws from
   stock until the stock follow-on (§5).

A recipe that backs two sold items shows one Packages group per item. A preparation with no sold
item shows no Packages section.

Packages save with the page's one Save. The separate "Save prices" button goes.

**Selling tab** — loses the Packs editor and the "B2B and B2C" block for cooked kinds (meal,
sauce, dressing, frozen meal); both are now the Packages section. Portion factor, "One sold unit
is" and the channel listing stay. The meal "Margin" rail goes — its basis was never stated and it
would disagree with the package rows.

**Costing tab** — keeps the Production card. The "Packaging per kg" and "Total cost per kg" cards
are replaced by a read-only table: Package · Cost · B2B price · Margin · B2C price · Margin. A
blended per-kg packaging figure means nothing once there is more than one package.

**Dish margins** — one row per item × package × channel. Price from the price list, cost from
§4.2. It stops reading the recipe version's price columns.

**Resold products** keep their current Selling block. They are bought and resold, have no recipe,
and are out of scope.

### 4.5 Preparations

The twin mechanism stays; no new line type. Stock deduction, nutrition and allergens all key on
the ingredient, and a recipe-typed line would have to be taught to every one of them.

- **Every recipe usable as an ingredient has a twin and an output row, written by the server.**
  Sauces and dressings already get a twin with their sold item. A recipe created as a
  *preparation* gets its own twin (kg, in a `preparation` ingredient category added by migration).
  The server writes the version's output row — the twin, at the version's yield — whenever the
  yield is saved. The editor needs no outputs control.
- **Picker.** The Production tab's picker lists two groups: *Raw materials* and *Preparations*
  (the grouped-sections pattern the design-system `Menu` already has). Packaging stays out.
- **Row.** A preparation line shows a "Preparation" badge, links to the recipe rather than to an
  ingredient form, and shows unit price and total like any line.
- **Cost.** A preparation's unit cost is its recipe's **production cost per kg with its
  production waste**, and nothing of its packaging (ruling 2). Today's figure omits the waste;
  that changes.
- **Not costed.** A preparation that is unpublished or not fully costed leaves the line "Not
  costed", and the Fix link opens that recipe. A draft's cost is not used: it can change under the
  recipe that depends on it.
- Depth cap (5) and the cycle guard stay.

### 4.6 One cost figure

- **One order of sources, everywhere:** the last price actually paid → the recipe that makes it
  (preparations) → the price somebody typed. Saving a recipe's lines adopts this order; today it
  ranks the typed price first, which is how a sauce's typed price outranks its own recipe.
- The Costing tab, the package rows and Dish margins all show this live figure.
- Cost snapshots taken at publish are unchanged — they are the record, not the working figure.
- Confirm and fix: the typed-price fallback for a packaging item must divide by items per purchase
  pack on every path.

## 5. Out of scope — the stock follow-on

A separate design, after this one ships:

- **Batch pack-out.** How many of each package a batch fills is a production-time fact. Once the
  batch records it, packaging is drawn per package and the hand-typed "per batch" table goes.
- **Stock value of a preparation.** A finished batch today blends every consumed line into the
  twin's average cost. Ruling 2 says bulk sauce must not carry bottle cost; applying that to the
  stock average and to COGS belongs with pack-out, because packaging cost then has to land
  somewhere else.
- Sale-time packaging deduction by the pack sold.

Also untouched: quotations (prices typed per line), the marketplace listing's "first priced pack"
rule, plans and subscriptions, currencies.

## 6. API

| Route | Change |
| --- | --- |
| `GET /catalogue/items/{item}/packages` | New. Packages with size, components, cost block (cost holders only), both prices, margins. |
| `PUT /catalogue/items/{item}/packages` | New. The whole set, `If-Match` = item lock. Needs `catalogue.manage` + `price_list.manage`, as channel prices do today. |
| `GET|PUT /catalogue/items/{item}/channel-prices` | Kept for resold products. |
| `GET /reports/dish-margins` | Rows gain the package; price source becomes the price list. |
| Technical sheet `computed.packages[]` | Removed when the Costing tab stops reading it. |
| Recipe lines | Wire gains the line's cost source and, for a preparation, the recipe it came from. |

OpenAPI bundle and the generated client regenerate with each slice.

## 7. Data

- One new table (§4.1) and one ingredient category (§4.5). No backfill: nothing is fabricated.
- Existing `b2b` / `b2c` packs appear as two packages, each with one price filled. The 13 items
  whose two packs are the same size are §10, point 5.
- `recipe_versions.b2b_price_amount` / `b2c_price_amount` stay in the schema, unread.

## 8. Tests that change

- `pricing/tests/ItemChannelPricesTest` — kept (resold products); a sibling covers packages.
- `catalogues/tests/DishMarginsTest` — price source and row grain.
- `recipes/tests/WeeklyRecipeCostingTest` — component cost gains waste; the source order.
- `recipes/tests/RecipePackagingCostTest` — per-line package cost gives way to §4.2.
- `kitchens/tests/RecipePricingFromCatalogueTest` — goes with its command (§10, point 3).
- `kitchen-admin-recipes.test.tsx`, `cooked-item-page.test.tsx`,
  `channel-prices-section.test.tsx` — Packaging, Costing and Selling tabs.
- New: package cost arithmetic (1:1 volume, piece packs, withheld reasons), package write
  (several packages, both prices, blank price), preparation twin + output on save, picker groups.

## 9. Build order

1. **Packages, server** — components table, cost read, `GET|PUT …/packages`.
2. **Packages, editor** — Packaging tab section, Selling tab trimmed, one Save.
3. **Margins** — Dish margins and the Costing tab table read packages.
4. **Preparations** — twin and output written by the server, cost with waste, source order,
   grouped picker, row badge.

Each slice carries its i18n keys, its `/showcase` entry where a component changes, and its tests.

## 10. Points for the owner to confirm

1. **Decided (owner, 12 Nov 2026): the "per batch" packaging table stays** until the stock
   follow-on, as §4.4 draws it. A bottle is named twice meanwhile — once in its package, once as
   what a batch draws.
2. The meal "Margin" rail on the Selling tab is removed.
3. `kitchen:price-recipes-from-catalogue` and its test are deleted — its only job was filling the
   recipe price columns nothing will read.
4. A preparation must be **published** before a recipe using it shows a cost.
5. **Same-size packs.** 13 items have a B2B and a B2C pack of the same size. Under ruling 1 each
   should be one package with two prices. Proposed: a one-off command with a dry-run report that
   moves the second price onto one pack and archives the other, run on dev first. Alternative:
   leave them as two packages and merge by hand.
6. Checked against dev only (§3.1). Production data was not read.
