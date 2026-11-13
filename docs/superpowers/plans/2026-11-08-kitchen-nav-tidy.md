# Kitchen navigation tidy-up: implementation plan

## Context

On 8 November 2026 the owner reviewed the 11 kitchen pages this session added since 2 November. They found:
- **Cash is split three ways.** Cash taken, Settlement and Daily close read the same drawer, but none links to the others.
- **Supplier prices are handled in three places.**
- **Dish margins is a dead end.** It shows a dish below target but can't open its recipe or price.
- **Core temperatures are logged away from the batch.**
- **Duplicate stock is hidden,** and a blocked Merge doesn't link to the count it needs.
- **The shop profile sits inside the opening-hours page.**
- **The sidebar mixes groups.** Workbench holds to-dos and reports together, and Operations has 14 items.

The owner asked for a plan written by an independent agent on Fable 5.1. That plan is the base below. Where it and my earlier draft differ, it won on the evidence: it checked the seeded roles, it found that `item_type` gives the recipe route without a recipe id, and it chose `?shelf=` over overloading `?item=`.

The owner's first three: (1) one Cash page, (2) core temperature on the batch page, (3) dish margins linking to its recipe and price.

**Branch:** `Nav-Tidy`, cut from `origin/dev`. dev is the source of truth, and this work is added onto it. Push only that branch; the owner opens the PR. No deploy. Mouhammad's open work touches only the shop shell, so nobody else is editing these files.

**Path shorthand:** `kadm:` = `apps/universal/src/features/kitchen-admin/`, `api:` = `apps/api/app-modules/`.

## Owner decision (8 Nov)

**Line cooks get read-only access to batch pages,** so they can record the core temperature there. The `kitchen_staff` role is granted `production.view_organisation` (slice 2).

## Rulings

1. **Dish margins is not a Cost-report tab.** The two pages differ in three ways:
   - **Permission:** `recipe.view_costs` against `inventory.view_costs`.
   - **Grain:** per dish from an overnight snapshot, against per month.
   - **URL:** the Cost report already uses `?from/?to/?month` for itself.

   The two sit side by side in Reports. The dead end is fixed with row links.
2. **One Cash family covers two permissions.**
   - The family's permission is `order.manage_organisation`. Every seeded holder of `settle_cash` also holds it (`access-control/database/migrations/2026_11_03_020202…`), and the Today card is already behind it.
   - The page Gate is `anyOf`, and each tab checks `useCan` itself.
   - A `PAGE_EXTRAS` row keeps `settle_cash` grantable in the role editor. This is what extras exist for (`entity-registry.ts:996-1019`).
   - Add extras' codes to `WORKSPACE_PERMISSIONS`. One line, so that a custom role holding only `settle_cash` still gets into the workspace.
3. **Old URLs redirect and never 404.** These six use the `app/kitchen/sauces/index.tsx` pattern:
   - `cash-report`
   - `settlement`
   - `close`
   - `payables`
   - `unpriced-receipts`
   - `unpriced-receipts/[receipt]`

   Staff alert links are pointed straight at the right tab.
4. **`?tab=` selects a tab and `?view=` stays "the open record".** The tab is read with `useLocalSearchParams` and written with `router.setParams`, the same as the cost report. Only existing parts are used: `Tabs`, `Gate`, `Redirect`, `CatalogueList` `rowActions`, `RecordLens` actions and `Dialog`.
5. **The `workbench` key stays and is relabelled "To do".** `buying`, `foodSafety` and `reports` are new keys.
6. **Setup is hidden once live** in the query-holding readers (`kitchen-chrome.tsx` and the kitchen home), not in `permittedFamilies`. The breadcrumb trail and the role editor still list it.
7. **No count endpoint for duplicates.** The home reuses the page's query key with a 5-minute `staleTime`. `ponytail:` add `GET /inventory/duplicates/count` if the scan ever shows up as slow.
8. **Supplier bills has two tabs:** To price and To pay. The To pay tab keeps the owed and paid lists as they are today.

**Not built:**
- a cost-report tab for dish margins
- a duplicates banner on Stock (it would add the heavy scan to the busiest page)
- a temperature field inside the Complete dialog (two endpoints behind one Save)
- folding the Purchases ledger into Supplier bills (it is a report, not a queue)
- per-item links into Activity (needs an API filter)

## Slices (in this order, one after another)

### 1. One Cash page
- **The page:** new `kadm:screens/order-desk-cash-screen.tsx` and route `app/kitchen/order-desk/cash/index.tsx` (copy `close/index.tsx`).
  - Gate: `anyOf [ORDER_MANAGE, ORDER_SETTLE_CASH]`.
  - `Tabs` as in `temperature-logs-screen.tsx:357-366`: `?tab=taken|handins|close`. Each tab is filtered by `useCan`, and an unpermitted tab falls to the first permitted one.
  - Each tab renders the existing `OrderDeskCashReportScreen`, `OrderDeskSettlementScreen` or `OrderDeskCloseScreen` unchanged.
- **Old routes:** `cash-report/`, `settlement/` and `close/` become `<Redirect>`s.
- **Registry:** remove the three families and add `cash` (orderDesk, `banknote`, `ORDER_MANAGE`). Add the extras row `cash-settle` (`ORDER_SETTLE_CASH`) and the `WORKSPACE_PERMISSIONS` line from ruling 2.
- **Today card and alerts:**
  - `kadm:today-card.tsx:60-66`: Cash expected opens `?tab=close`. Copy the Late card at :71-77.
  - `shell/staff-alerts-button.tsx:56-57`: `short_hand_in` opens `?tab=handins`, and `short_close` opens `?tab=close`.
- **i18n:**
  - `families.cash`, and `cash.tab.*` reusing the old family names.
  - `accessAdmin:extras.cashSettle`.
  - Remove the three old family keys.
- **Tests:**
  - New `order-desk-cash.test.tsx` covering the three permission mixes and the `?tab=` fallback.
  - A case in `today-card.test.tsx`.
  - These must still pass: `order-desk-cash-report.test.tsx`, `order-desk-settlement.test.tsx`, `kitchen-admin-daily-money.test.tsx`, `entity-registry.test.ts`, `page-permissions.test.ts`.

### 2. Core temperature on the batch page, and cooks can view batches
- **API:**
  - `api:production/src/Http/Controllers/ProductionOrderShowController.php:56-63` adds `cooking_temperatures`, newest first. Each row is shaped like `TemperatureLogController::log()` does it (:84-93) and reuses its name lookup.
  - This goes on the detail endpoint only, never in `ProductionOrderPresenter::summary()`, which would add one query per row to the desk list.
- **OpenAPI:** add the field to `ProductionOrderDetailEnvelope` (yaml :40595) using the existing `CookingTemperature` `$ref`, and keep it out of `required`. Then `composer api:bundle` and `pnpm gen:api`.
- **Cooks:** new migration `api:access-control/database/migrations/2026_11_08_000001_grant_kitchen_staff_production_view.php`, copying the shape of `2026_11_03_020202`.
  - It grants the existing `production.view_organisation` to roles matching `^kitchen_staff(_standard(_[0-9]+)?)?$` with `created_by IS NULL`, then bumps `PermissionCache`.
  - Its `down()` deletes only those grants.
  - Add the code to `kitchen_staff`'s list in `api:access-control/src/Services/PermissionRegistry.php` (around :810-858) so new organisations get it.
- **Client:**
  - `ProductionOrderDetail.coreTemperatures` (`contracts/kitchen-ops.ts:2197`), filled in `mapProductionOrderDetail` (`kitchen-ops-repository.ts:1208`) with the existing cooking-temperature mapper, defaulting to `[]`.
  - `useRecordCookingTemperatureMutation` (`apps/universal/src/data/kitchen-ops-hooks.ts:1748`) also invalidates `queryKeys.kitchenOps.productionOrder(id)`.
- **Dialog:** new `kadm:production-desk/core-temperature-dialog.tsx`. It is `BatchDialog` from `temperature-logs-screen.tsx:577-660` without the batch `Select`, taking the batch as a prop.
- **Batch screen** (`production-batch-screen.tsx`):
  - In `RecordLens` actions, add **Record core temperature** (`size="sm"`, secondary).
  - Show it only when `useCan([ORDER_PREPARE, INVENTORY_MANAGE], 'any')` passes and the batch has started and is neither cancelled nor abandoned.
  - Add a Core temperature fact ("76.0 °C · 14:32 · Sara") or `noValue`.
  - Mount the dialog next to `BatchSettlementDialog`.
- **Tests:**
  - Pest in `ProductionApiTest.php`: the show payload carries a posted reading.
  - Pest in `api:access-control/tests/PermissionRegistryTest.php`, or the role-permission test that pins `kitchen_staff`: it now holds `production.view`.
  - `kitchen-ops-repository.test.ts`: a payload without the field maps to `[]`.
  - `kitchen-production.test.tsx` "one batch" covers three cases:
    - a chef sees the fact and the button, and the dialog posts the reading;
    - a view-only reader sees no button;
    - a batch that hasn't started has no button.

### 3. Dish margins rows open the recipe
- **API:**
  - `DishMargins::list()` eager-loads `catalogueItem:id,name_en,name_ar,item_type`. The controller sends `item_type`, which is always meal, sauce, dressing or frozen_meal (`refresh()` already excludes product and plan at :65).
  - OpenAPI `DishMargin` (:43362) gets the required enum. Then `api:bundle` and `gen:api`.
- **Client:** `DishMargin.itemType: RecipeSellerKind`, mapped at `kitchen-ops-repository.ts:2056`.
- **Screen** (`dish-margins-screen.tsx`):
  - `onRowPress` opens `/kitchen/recipes/item/{catalogueItemId}?kind=…&tab=production`, with `returnTo` set to `/kitchen/dish-margins`.
  - `rowActions` offers **Open recipe** (the `production` tab) and **Change price** (the `selling` tab).
  - Both appear only with `useCan(RECIPE_VIEW_PERMISSION)`.
  - Build the hrefs with `withQuery` and `withReturnTo`.
- **Tests:**
  - `DishMarginsTest.php`: the index sends `item_type`.
  - The repository mapper.
  - `kitchen-admin-daily-money.test.tsx`: the row press href, the Change price href, and no actions without `recipe.view`.

### 4. Sidebar groups, and Setup until live
- **Group order:** `ENTITY_GROUPS` becomes `orderDesk, workbench, catalogue, commercial, operations, buying, foodSafety, reports, access`.
- **Moves:**
  - analytics, cost-report, dish-margins and activity go to `reports`;
  - supplyOrders, suppliers, procurement, purchases and payables go to `buying` (payables is replaced in slice 6);
  - temperatureLogs and qc go to `foodSafety`;
  - Operations becomes orders, production, production-batches, batch and complaints.
- **One label map:** export `GROUP_LABEL_KEYS` from `kadm:kitchen-nav.ts:27`, delete the copy in `kitchen-home-screen.tsx:88-95`, and import it there.
- **Icons:** `GROUP_ICONS` (`kitchen-chrome.tsx:34`) gets `buying: 'shoppingCart'`, `foodSafety: 'badgeCheck'` and `reports: 'chartColumn'`.
- **Setup until live:** `useKitchenNavigation` calls `useKitchenSetupQuery(permitted.has('setup'))` and drops `setup` when `isLive`. The home's family pills (`kitchen-home-screen.tsx:811-848`) apply the same filter.
- **i18n:** `nav.groups.workbench` becomes "To do", and `nav.groups.{buying,foodSafety,reports}` are added, in en and ar.
- **Tests:**
  - `kitchen-nav.test.ts:21-35` (the order).
  - `kitchen-admin.test.tsx:562-577` (the group list written out by hand).
  - `kitchen-chrome.test.tsx`: stock stays under Operations, and Setup is hidden when live and shown when not.

### 5. Duplicate stock on the home list, with a count link
- **Hook:** `useDuplicateStockQuery(enabled = true)` (`kitchen-ops-hooks.ts:1268`) with `staleTime: 5 * 60_000` and the `ponytail:` note from ruling 7.
- **Home check:** in `kitchen-home-screen.tsx` `checks` (443-528), add a `stock-duplicates` check shaped like the consumption-exceptions one. It counts `data.length` and is gated on `permitted.has('stock-duplicates')`. `pillCount` uses the same number.
- **Count link:**
  - In `stock-duplicates-screen.tsx` `rowActions` (112-154), a blocked pair gets **Count {code} to zero**. It opens `/kitchen/stock?shelf=<id>&direction=count` with `returnTo`. The disabled Merge item stays, because it explains why it is blocked.
  - The stock route reads `shelf` and `direction`. `stock-screen.tsx` `sentFor` (:307-320) also matches on the stock-item id. `StockMovementEditor` takes `initialDirection`, which replaces the literal `'increase'` at :1210.
- **i18n:** `hub.attention.duplicates`, `hub.action.resolve` and `stockDuplicates.countToZero`.
- **Tests:**
  - A home attention case in `kitchen-admin.test.tsx`.
  - New `stock-duplicates.test.tsx`: the Count href, with Merge still disabled.
  - A stock case: `?shelf=&direction=count` opens the editor on Count.

### 6. Supplier bills
- **The page:** new `kadm:screens/supplier-bills-screen.tsx` and route `app/kitchen/supplier-bills/index.tsx`.
  - Gate: `INVENTORY_VIEW_COSTS`.
  - Tabs, by `?tab=unpriced|bills`: `UnpricedReceiptsScreen` and `PayablesScreen`, unchanged.
- **Moves and redirects:**
  - Move the receipt detail to `app/kitchen/supplier-bills/[receipt].tsx`.
  - `payables/index.tsx`, `procurement/unpriced-receipts/index.tsx` and `procurement/unpriced-receipts/[receipt].tsx` become redirects. The last one forwards the id.
- **Links to update:**
  - `unpriced-receipts-screen.tsx:131`
  - `unpriced-receipt-screen.tsx:101`
  - `procurement-screen.tsx:478` and `:625`
  - `staff-alerts-button.tsx:58` (`price_approval` opens `?tab=bills`)
- **Registry:**
  - Replace the `payables` family with `supplier-bills` (buying, `banknote`, `INVENTORY_VIEW_COSTS`).
  - Delete the `unpriced-receipts` `PAGE_EXTRAS` row and its docblock.
- **i18n:**
  - Add `families.supplierBills` and `supplierBills.tab.*`.
  - Remove `families.payables` and `accessAdmin:extras.unpricedReceipts`.
- **Tests:**
  - New `supplier-bills.test.tsx`.
  - Existing payables and unpriced tests must stay green.
  - `procurement-order-link.test.tsx` and `post-receipt.test.tsx`, if they assert the old href.

### 7. Storefront page
- **The page:** new `kadm:screens/storefront-profile-screen.tsx`.
  - Lift `StorefrontProfileSection`, `StorefrontDraft`, `StorefrontCopy`, `cuisineList` and `storefrontDraftOf` out of `branch-operating-screen.tsx:905-1097`.
  - Gate: `allOf [CATALOGUE_MANAGE]`, which is the server's rule.
  - Drop `onDirtyChange`. The section's own `useUnsavedGuard` covers it.
- **Branch operating:** remove the section from `branch-operating-screen.tsx` (:472-474), along with `profileDirty` and the docblock paragraph at :117-119.
- **Route and registry:** `app/kitchen/storefront.tsx`, and a `storefront` family in `commercial`, placed after branch-operating, using `store`, with both its permission and its manage permission set to `CATALOGUE_MANAGE`.
- **Tests:** `kitchen-admin-delivery.test.tsx:1862-1915` renders the new screen, and a reader is refused. A `kitchen-nav.test.ts` case: hidden from a `catalogue.view`-only state.

## Final sidebar

| Group | Members |
|---|---|
| Order desk | Order desk · Calendar · Requirements · **Cash** |
| To do | Needs review · Stock gaps · Duplicate stock · Setup *(until live)* |
| Catalogue | Ingredients · Packaging · Recipes · Resale · Allergen classes |
| Commercial | Price lists · Wholesale · Quotations · Plans · Delivery zones · Delivery windows · Opening hours · **Storefront** |
| Operations | Orders · Production · Batch register · Batch planner · Complaints |
| Buying | Supply orders · Suppliers · Procurement · **Supplier bills** · Purchases ledger |
| Food safety | Temperature log · Quality control |
| Reports | Analytics · Cost report · Dish margins · Activity |
| Access | Team · Roles · Customers |

## Global constraints
- **UI:** existing patterns only, and nothing new visually.
  - Kitchen admin uses catalogue sizes, without `min-touch`.
  - Logical utilities only, no colour literals, both themes.
  - Strings in en and ar, then `pnpm gen:pseudo-locale` and `pnpm gen:i18n-keys`.
- **API:** additive only. Edit the yaml, then `composer api:bundle`, then `pnpm gen:api`. The only migration is the one in slice 2.
- **Commits:**
  - Stage explicit paths only. No stash.
  - End each commit with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Don't commit the 3 `kitchen.json` reorder files that are already there.
- **Tests:** targeted only, run at the end. Never `pnpm check`, full Jest or full Pest on this PC.

## Execution
Subagent-driven on Opus 5.5, one implementer per slice, in order, with a reviewer after each slice and a whole-branch review at the end. The slices are serial because they share the registry, the i18n catalogues and the generated client.

## Verification
1. **Pest, targeted:**
   - Take the `.superpowers/pest.lock`.
   - Start the Docker postgres and redis.
   - Run `php artisan test --filter='DishMargins|ProductionApiTest|TemperatureLogTest|PermissionRegistry|OpenApiContract'`.
2. **Generated code and translations:** `pnpm gen:api:check` and `pnpm i18n:check`.
3. **api-client:** vitest on `kitchen-ops-repository.test.ts` and `conformance.test.ts`.
4. **Jest:** `npx jest --runInBand` on every test file named above, plus `entity-registry`, `kitchen-nav`, `page-permissions`, `kitchen-chrome` and `today-card`.
5. **Static checks:** typecheck, ESLint on the changed files, `pint --dirty`.
6. **Browser walk on the local stack**, in light and dark and in Arabic, with screenshots:
   - the Today card opening the Cash close tab;
   - an old `/close` link redirecting;
   - a cook recording a reading on a batch, with the fact appearing;
   - a dish-margin row landing on the recipe with Dish margins in the trail;
   - home duplicates → the duplicates page → Count to zero → the stock editor opening on Count → Back;
   - the nine sidebar groups, with Setup gone for a live kitchen;
   - the Storefront page.
7. **Push `Nav-Tidy`.** The deploy note to include: run the new migration so existing cooks get batch view.
