# Audit gaps, second pass — implementation plan (revision 2)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

> **Revision 2:** written by a fresh planning agent that re-checked every file and function against the code. It corrected about 30 points in the draft. The ones that change behaviour:
> - Duplicate merge can't move ledger rows, because `stock_movements` is append-only. Merge now links the rows instead of moving them.
> - The allergen-release stale check needed stale marking to reach quarantined versions. Release also had to keep the old label.
> - The phone rule applies on the online, guest and desk paths only, so subscriptions and B2B still place.
> - The permission is `order.supervise_organisation`, and the allergen codes are `tree_nut` and `peanut`.
> - The display sort needed a `due_at` field on the order.
> - Batch labels print only once a use-by date exists.
> - Undo on the display covers Ready and Fulfil only.

## Context

After the P0–P2 build (now in `origin/main`, 660f8680: the Security-Hardening merge on top of P0-Stage1 445bf033), the audit report lists 72 open gaps. The owner wants every gap closed that needs nothing from outside: no provider API, no credentials, no translator, no legal text, no kitchen data work. Three read-only surveys checked about 45 candidates, and a second planner re-verified every named file and function. The owner answered 8 business questions on 2026-11-03. Work goes on a new branch cut from `origin/main`.

**Goal:** close about 40 gaps in food safety, production, stock, purchasing, cash, the display, orders and the customer pages.
**Tech:** Laravel 13 + Pest 5 + Postgres RLS; Expo web + NativeWind; api-client generated from OpenAPI.

Path shorthand: `api:` = `apps/api/app-modules/`, `ui:` = `apps/universal/src/`, `kadm:` = `ui:features/kitchen-admin/`, `client:` = `packages/api-client/src/`.

## Owner answers (2026-11-03)

| Topic | Answer |
|---|---|
| Allergen release | A manager compares the old and new label, ticks that they checked it, and releases. The new label goes live on the same version. Audited. |
| Free-from tags | A tag that contradicts the label can't be saved or published. Dishes already on sale lose the tag on the customer side, and staff get a warning. |
| Sub-recipes | Allergens carry through: a published sub-recipe writes them onto the ingredient it produces, the way nutrition is. Affected dishes go to review. |
| Customer cancel | Allowed only while the order is `placed` (before the kitchen accepts). |
| Batches | Use-by required on finish. Bell alert after 2 days in production. Lot number given at start. |
| Today card | Sales and orders, cash to collect, late and past due, cancellations. |
| Display | Due-time sort, 10 s undo, lane tabs on phones, browser-printed ticket. |
| Purchasing | Create order from Requirements. Price variance with unit conversion, on the ledger and receiving. *Not* void, returns or part payments. |

## Rulings (object at plan review if wrong)

- **Waste reasons:** a fixed list: `expired`, `spoiled`, `damaged`, `overproduced`, `customer_return`, `other`. A note is required only for `other`. `stock_movements` is append-only at the grant level, so old rows are **not** backfilled; a null reason reads as `other`.
- **Stock counts:** a loss is valued at the current average and lowers the cost basis, as waste does. A gain raises the basis quantity at the current average. With no basis the count is unvalued, never free.
- **Duplicate stock rows that both have history:**
  - **Merge** never updates or deletes a movement.
    - The dropped shelf must stand at zero in every branch: count it to zero first, and T7 values that count.
    - Merge then links it through `stock_items.merged_into_stock_item_id`. Open purchase and production lines and supplier links follow as today.
    - The row is hidden from lists, and `MealExplosion::resolveStockItem()` follows the link. Its history stays readable on its own row.
  - **Keep both** stamps `stock_items.duplicate_dismissed_at` on the group's rows. `scan()` skips a group whose rows are all dismissed, and a new same-name shelf brings it back.
- **Cash report:**
  - **Day:** the branch's local day when a branch is chosen, otherwise the organisation's (`OrganisationTimezone`, the clock `DailyCloses` uses).
  - **Branch filter:** honoured, including settlements, which now carry `branch_id`.
  - **Courier expense:** the prepaid courier expense shows as an adjustment. The monthly report gets a separate "Courier expenses" operating line, outside COGS.
- **Driver:**
  - The address becomes a map link.
  - A delivery order (online, guest or desk) is refused `phone_required` when no phone resolves. The order checked is the address contact, then the account's best live phone, which is the driver run's own rule. No prefill is needed.
  - Subscription and B2B placement are untouched.
- **Store profile:** tagline, description and cuisines in English and Arabic, with cuisines as free text. Stored on `organisations` so the anonymous marketplace can read them. Edited on `branch-operating-screen.tsx`.
- **Customer copy:**
  - Checkout success says "placed, waiting for the kitchen".
  - The nutrition panel keeps only the source name.
  - `/how-it-works` drops the steps about the switched-off planner and targets.
- **KDS undo:** client-side, for **Ready** and **Fulfil** only. Accept and Start send at once, because Accept deducts stock and closes the customer-cancel window. The call is sent after 10 s unless undone.
  - `ponytail:` closing the tab inside those 10 s loses the bump. The upgrade is a server reverse transition.
- **Batch labels:** the lot exists from Start and shows on the batch. The label prints only once a use-by exists, because the GS1 string carries it. The lot's date is the start day; a later `production_date` is accepted as reported.

## Out of scope, and why

- **Needs outside input:** Whish, VAT, legal text, Twilio keys, recipes left in Draft, the translator, test-data removal, the dish margin target, the Cheddar dev data, deploy, and the full suite (cloud).
- **Needs a decision not asked, or new visuals:**
  - Customer ETA, kitchen phone or WhatsApp, delay message
  - Get help, courier message, promo, pickup option, planner share
  - Greying out closed dates (needs a new date control)
  - KDS wall mode
  - Manual "Today's hero"
  - Capacity per window
  - Two-branch subscription branch choice (stays a known limit)
- **Large or waiting for a reason:** lot-level recall, PIN and idle lock, phone push, third-party apps, dine-in, station routing, hidden future products, void, returns, part payments.

## Global constraints

- **Branch:** `git fetch && git switch -c Audit-Gaps origin/main`. Push only to `Audit-Gaps`; the owner opens the PR. No merge, no deploy, no hosted-data changes.
- **UI:**
  - Existing patterns only; each UI task names the screen it copies.
  - Catalogue sizes in `kitchen-admin/`, `min-touch` on customer surfaces.
  - No colour literals, logical utilities only, both themes, and colour is never the only signal.
- **Strings:** en and ar by hand, then `pnpm gen:pseudo-locale` (en-XA), then `pnpm gen:i18n-keys`. API notice copy is in `apps/api/lang/{en,ar}/notices.php`.
- **API changes:** edit `apps/api/openapi/healthy360.v1.yaml`, then `composer api:bundle`, then `pnpm gen:api`. `OpenApiContractTest` holds parity.
- **Migrations:**
  - Additive. Use `CREATE OR REPLACE` for any SQL function. A CHECK change drops and re-adds the named constraint.
  - Timestamp blocks, so lanes never collide: T1 `2026_11_04_00xxxx`, lane A `01xxxx`, lane B `02xxxx`, lane C `03xxxx`.
  - **No new tables in this plan**, so no new RLS policies.
- **Refusals:** use the existing shapes. No new `ErrorCode` cases.
  - `ApiException(ErrorCode::…, msg, ['reason' => '<code>'])`
  - `ValidationFailed` with `parameter`
  - the placement or quote `refusals[]` list with `reason`
- **Tenancy:**
  - Jobs and hooks with no tenant run inside `DatabaseTenantContext::during()` (jobs, as `AlertExpiringStock` and `EscalateUnacceptedOrders` do) or `SellerContext::during($org, $branch, $cb)` (customer-side order work).
  - A hook that swallows its own errors gets `Exceptions::fake()` + `assertNothingReported()` in its test.
- **Alerts:** `StaffAlerts::send(type, org, subjectId, data)`. `data` keeps only `order_number`, `total_minor`, `currency_code` and `severe`.
- **Shared files:** the yaml, `client:generated/*`, `client:contracts/*`, the i18n catalogues and `keys.generated.ts`, and `apps/api/routes/api-v1.php`.
  - Stage them by explicit path.
  - `composer api:bundle`, `pnpm gen:api`, `gen:pseudo-locale`, `gen:i18n-keys`, typecheck and the commit of generated files all run under one lock.
  - A regenerated file may carry another lane's in-flight yaml or catalogue edit. T20's `gen:api:check` proves final parity.
- **Tests:** written in each task, run only in T20, targeted. Never `pnpm check`, full Pest or full Jest on this PC.
- **Commits:** shared checkout, explicit-path staging, no stash. End each commit with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review focus

1. **Allergen release race:** a release while a newer ingredient change is pending must not publish a stale label. Both halves are needed: stale marking now reaches `review_required` versions (T2a), and release refuses with `derivation_stale`.
2. **Sub-recipe cycles:** carry-through rides the recompute walk (`MAX_DEPTH = 5`, with a visited set). The writer never schedules from the job (T3).
3. **Customer cancel vs kitchen accept:** exactly one wins, through the status-and-lock compare-and-set in `OrderLifecycle::transition()` (T17).
4. **Local day at 23:30 Beirut:** the cash report and Today card count it on the Beirut date (T10, T11).
5. **Duplicate merge:** never across units, never with stock on the dropped shelf, never a movement updated or deleted (T8).
6. **Phone rule scope:** subscription generation and B2B quotation placement still place without a phone (T14).

---

### T1 Setup and shared seams (serial, before the lanes)

- [ ] **Branch and records:** branch as above. Copy this plan to `docs/superpowers/plans/2026-11-03-audit-gaps-second-pass.md`. Record the owner answers and branch status in memory.
- [ ] **Two alert types,** so no two lanes edit the alert files:
  - In `api:support/src/Alerts/StaffAlertType.php`:
    - `BatchStuck = 'batch_stuck'`: audience `managers`, subjectType `production_order`, page `/kitchen/production-desk/{id}`.
    - `CustomerCancelled = 'customer_cancelled'`: audience `managers`, subject the order, default page.
  - Also update `apps/api/lang/{en,ar}/notices.php`, the `kitchen.json` staff-alert copy, `ui:shell/staff-alerts-button.tsx` (`ROW_ICONS`, `PAGES`), the yaml staff-alert `type` enum and `client:contracts/staff-alerts.ts`.
- [ ] **Due-time seam:** in `api:orders/src/OrderDesk/Services/OrderDeskQueue.php`, `DUE_AT` becomes `public const`. Add `public function dueCountsFor(string $organisationId, ?string $branchId, CarbonImmutable $now): array{past_due_count:int, overdue_count:int}`, delegating to the private `dueCounts()`.
- **Tests:** extend `api:support/tests/StaffAlertsTest.php`: both new types reach managers once.

### Lane A — food safety, production, listings

**T2a Allergen release — API**
- **Files:**
  - migration: `recipe_versions.previous_label jsonb null`
  - `api:recipes/src/Jobs/RecomputeRecipeDerivations.php`: `quarantine()` stores `$before` as `{code: containment}`
  - `api:recipes/src/Services/RecipeIngredientUsageRegistry.php::markDependentDerivationsStale`: status `whereIn [published, review_required]`
  - `RecipeVersionService::release(RecipeVersion $v, int $expectedLockVersion): RecipeVersion`
  - `RecipeUsageRegistry::releaseQuarantinedItems(Recipe $r): list<string>`, implemented in `api:catalogues/src/Services/CatalogueRecipeUsageRegistry.php`
  - new `RecipeVersionReleaseController`
- **API:** `POST /catalogue/recipes/{recipe}/versions/{version}/release`, body `{ confirmed: true }`, with `If-Match`. It sits in the `recipe.publish_organisation` + `org.trading` group with `precondition`. The version show and readiness payloads gain `previous_label` (nullable map).
- **Refusals:**
  - the version isn't `review_required`
  - `confirmed` isn't true (422)
  - `derivation_state = stale` (`reason: derivation_stale`)
- **Release:**
  - If another version of the recipe is published, the released one is retired (superseded). Otherwise it becomes `published`, with `review_reason` and `previous_label` cleared.
  - Every `review_required` item of the recipe returns to `published`.
- **Audit:** `catalogue.allergen_release` on the version, recording old and new classes (keys never contain `code`), and `catalogue.item_released` per item.
- **Tests (`api:recipes/tests/AllergenReleaseTest.php`):**
  - release restores the version and its items
  - unticked is refused
  - stale is refused
  - a mapping edit on a quarantined version marks it stale
  - release beside a newer published version retires it
  - audit rows are written
  - 403 without `recipe.publish_organisation`

**T2b Allergen release — screen**
- **Files:**
  - `kadm:screens/recipe-edit-screen.tsx`: the quarantine card at :2748 gains an `action`
  - `kadm:meal-listing.tsx:773`: the card links to the recipe's editor
  - `ui:data/kitchen-admin-hooks.ts`: the mutation
  - repository and contract
- **UI:** a `Dialog` showing old and new labels as allergen `Badge` rows (with text labels, so colour is not the only signal), and a `Checkbox` gating Release. It copies the over-receipt confirmation in `kadm:screens/receive-delivery-screen.tsx`. Existing quarantines with no `previous_label` show the `review_reason` text instead.
- **Tests:** Jest in `kadm:kitchen-admin-recipes.test.tsx`: the button is disabled until ticked, and a stale refusal shows the tray error.

**T3 Sub-recipe allergens carry through**
- **Migration:**
  - `ingredient_allergens.derived_from_version_id uuid null`, indexed
  - the source CHECK adds `recipe_derived`
  - `ingredients.allergens_derived_from_version_id uuid null`
- **New code:**
  - `AllergenMappingSource::RecipeDerived`
  - `api:recipes/src/Services/RecipeOutputAllergenWriter.php`, mirroring `RecipeOutputNutritionWriter`, with `write(RecipeVersion, bool $scheduleDependants = true): int` and `clear(RecipeVersion): int`
  - console `recipes:carry-allergens {--dry-run}`
- **Call sites:**
  - `RecipeVersionService::publish` (:970)
  - `RecipeVersionService::retire` (:1032)
  - `RecomputeRecipeDerivations::recompute` (:260), with `scheduleDependants: false`
- **Other changes:**
  - `RecipeVersionReadiness::undeterminedIngredientIds` treats an ingredient with `allergens_derived_from_version_id` as determined.
  - `AllergenMappingService` refuses edits to `recipe_derived` rows.
- **Behaviour:**
  - Published versions only, and only outputs in the kitchen's own organisation.
  - Derived rows are written on the version's organisation layer.
  - A code with a manual organisation-layer row keeps that row. It is raised to the derived containment if that is stronger, and never weakened or deleted.
  - Codes no longer derived lose their derived rows.
  - Only rows that actually changed trigger the invalidator.
- **Tests (`api:recipes/tests/RecipeOutputAllergenTest.php`):**
  - a sauce's allergens reach the dish label
  - a dependent published dish goes to review
  - a cycle stops (visited set, depth 5)
  - a manual mapping is kept and only strengthened
  - retire clears derived rows
  - an output with an empty label counts as determined
  - the dry run writes nothing
- **Deploy note:** run the dry run first; it lists the dishes that will go to review.

**T4 Free-from tags can't contradict the label**
- **Mapping:** `CatalogueItemService::FREE_FROM = ['gluten_free' => ['gluten'], 'dairy_free' => ['milk'], 'nut_free' => ['tree_nut', 'peanut']]`. The codes come from `allergens/database/data/allergens.json`. Both `contains` and `may_contain` contradict a tag.
- **Where it's enforced:** `CatalogueItemService::setDietClassifications` and `CatalogueItemReadiness::reasons` refuse with `diet_tag_contradicts_allergens` (context: the tag and the codes). They read the same allergen source as `MarketplaceMeals::allergenCodesOf`.
- **Customer side:** in `api:kitchens/src/Services/MarketplaceMeals.php`, `dietClassificationCodesOf`, `dietClassificationCodesOfKitchen` and `whereDietClassifications` drop a contradicting tag inside the same query (a correlated `NOT EXISTS`), with no extra round trip.
- **Staff side:** a warning card in `kadm:meal-listing.tsx` `listingCards`, the same shape as `kitchen-meal-quarantine`.
- **Tests (`api:catalogues/tests/FreeFromTagTest.php`):**
  - save refused
  - publish refused
  - an existing clash is hidden from the meal payload and the filter
  - the meal list's query count is the same with and without clashes (copy `orders/tests/DishChoiceAllergensTest.php:259`)

**T5 Choice allergens on every option, and demo seed**
- **Files:**
  - `client:api/marketplace-mappers.ts:383` keeps containment: `allergens: {code, containment}[] | null`; the contract is in `client:contracts/dish-options.ts`
  - `ui:ui/dish-choices.tsx` appends each option's allergens as text to its `Select` option label. "May contain" is worded apart, and an unassessed choice says so.
  - `apps/api/database/seeders/VerdantProductCatalogueSeeder.php::publishReadyProducts` skips rows whose fixture category is `Production`.
- **Tests:**
  - `ui:ui/dish-choices.test.tsx`: every option lists its codes, with may-contain worded apart
  - a seeder test that `Production` rows stay as unassessed drafts

**T6 Production batches**
- **Files:**
  - `api:production/src/Services/ProductionOrderService.php`:
    - `start()` mints the lot via `ProductionOrderNumbers::lot($org, <branch-local today>)`
    - `batchDates()` refuses a usable outcome with no use-by: `ValidationFailed`, `parameter: expiry_date`
  - new `api:production/src/Jobs/AlertStuckBatches.php`
  - `apps/api/routes/console.php`
  - `kadm:screens/production-batch-label-screen.tsx`: the empty state gets its own copy key and says why (no lot, or no use-by yet)
  - the batch screen shows the lot from Start
- **Stuck alert:**
  - runs daily, per organisation inside `during()` (copy `api:inventory/src/Jobs/AlertExpiringStock.php`)
  - sends `StaffAlertType::BatchStuck` for orders `in_production` with `started_at` < now − 48 h
  - once per batch, through the alert's unique index
- **Tests (`api:production/tests/ProductionOrderTest.php`, new cases):**
  - the lot exists after start and is unchanged after complete
  - an abandoned batch keeps its lot
  - finishing without a use-by and with no shelf life is refused
  - a shelf-life fill still passes
  - the alert sends once, and not before 48 h

**T18a Closures in the listing calendar, and customer copy**
- **Closures:** `api:kitchens/src/Services/MarketplaceAvailability.php::calendar(array $branches, array $hours, array $closures = [], ?CarbonImmutable $now = null)`. A date is open only on a branch that isn't closed. `MarketplaceProjector.php:259` loads the closures for the kitchen's branches in one query.
- **Copy:**
  - `ui:features/catalogue/nutrition-facts-panel.tsx` drops the version, the method and the synthetic badge, keeping the source name.
  - `ui:features/marketplace/screens/how-it-works-screen.tsx` drops the planner and targets steps.
- **Tests:**
  - `api:kitchens/tests/MarketplaceReadTest.php`: a closed day is unavailable; a branch closed while another is open stays available
  - a Jest snapshot of the two copy screens

**T18b Per-meal day off and sold out on listings**
- **Files:** `MarketplaceMeals` adds `availabilityByMeal(list<string> $itemIds, CarbonImmutable $from, int $days = 14): array<itemId, array<date, 'day_off'|'sold_out'>>`. It uses one batched query each for listing day rules and counted portions, the same sources `LineProbe` reads. The projector merges the result into each meal's calendar.
- **Tests:**
  - a sold-out meal shows sold out on that date
  - a day off shows unavailable
  - the query count is the same for 1 and 20 meals

### Lane B — stock, purchasing, cash, admin

**T7 Waste reasons, count valuation, activity links**
- **Waste reasons:**
  - migration: `stock_movements.waste_reason varchar(24) null` + CHECK
  - `api:inventory/src/Http/Controllers/StockWasteController.php` validates `reason` (enum) and `notes` (`required_if:reason,other`)
  - `InventoryService::recordWaste(..., string $reason)`
  - `kadm:screens/stock-screen.tsx` gets a reason `Select`, copying the cancel-reason `Select` in `kadm:screens/orders-screen.tsx`
- **Count valuation:** `InventoryService::recordCount` values the difference and stamps the cost on the movement.
  - Loss: `ConsumptionValuation::value` + `lowerBasis`.
  - Gain: new `ConsumptionValuation::raiseBasis(string $costId, string $quantityInCostUnit)`.
- **Activity:**
  - `StockActivityIndexController` returns `waste_reason` (null reads as `other`) and `order_id`.
  - `AuditActivityIndexController` returns `order_id` where the subject is an order.
  - `kadm:screens/activity-screen.tsx` shows the reason and links orders to `/kitchen/orders?view=`.
- **Tests (`api:inventory/tests/StockAccountabilityTest.php`, new cases):**
  - `other` without a note is refused
  - a reason is stored
  - a count loss lowers the basis and is valued
  - a count gain raises the basis at the average
  - no basis means unvalued
  - `StockCountImportTest` still passes (same service path)
  - activity rows carry `order_id`

**T8 Duplicate stock: Merge and Keep both**
- **Migration** on `stock_items`: `merged_into_stock_item_id uuid null`, `duplicate_dismissed_at timestamptz null`.
- **Service** (`api:inventory/src/Services/DuplicateStockShelves.php`):
  - `mergeWithHistory(string $org, StockItem $keep, StockItem $drop, ?string $actor): void`. It refuses different units, stock on `$drop`, and `open_work`. It links instead of deleting.
  - `dismiss(string $org, list<string> $stockItemIds, ?string $actor): void`
  - `scan()` skips merged rows and fully dismissed groups.
- **Elsewhere:** `StockItemIndexController` and `StockLevelIndexController` hide merged rows. `MealExplosion::resolveStockItem()` follows `merged_into`.
- **API:** `POST /catalogue/inventory/duplicates/merge` `{ keep_id, drop_id }` and `POST /catalogue/inventory/duplicates/dismiss` `{ stock_item_ids[] }`, in the duplicates index's permission group. Audit `inventory.stock_merged` (`origin: with_history`) and `inventory.duplicate_dismissed`.
- **Screen:** buttons on `kadm:screens/stock-duplicates-screen.tsx`, using the row-action pattern from `stock-screen.tsx`. Merge shows only for `both_have_history`, with the refusal text when stock remains.
- **Tests (`api:inventory/tests/DuplicateStockShelvesTest.php`, new cases):**
  - both histories survive
  - no movement row is changed or deleted
  - different units are refused
  - stock on the dropped shelf is refused
  - a merged shelf resolves to the kept one
  - a dismissed group is not listed, and a new same-name shelf brings it back
  - audited

**T9 Purchasing**
- **Create order:**
  - `kadm:screens/order-desk-requirements-screen.tsx` gets a "Create order" button, gated on `inventory.order_supplies_organisation`. It pushes `/kitchen/supply-orders/new?items=<id,id>&returnTo=…`.
  - `kadm:screens/supply-order-builder-screen.tsx` seeds `requestedIds` from `useLocalSearchParams().items` once.
- **Unit conversion:** `api:procurement/src/Services/ReceiptPriceControl::review` converts the previous price into the line's unit with `UnitConversionService::canConvert/convert` (mass and volume only) instead of skipping the line. An unconvertible line stays null.
- **Variance display:**
  - `PurchasesLedgerIndexController` and `GoodsReceiptPresenter::line` return `last_unit_price_amount` and `price_variance_percent`, cost-gated like the other amounts.
  - `kadm:screens/purchases-ledger-screen.tsx` shows a variance column, with the `Badge` tone used at `payables-screen.tsx:174`.
- **Tests:**
  - `api:procurement/tests/ReceiptPriceCompletionTest.php`: kg vs g variance is computed; count units are still null
  - the ledger row carries variance
  - Jest: the button carries the shortfall ids, and the builder seeds them

**T10 Cash report**
- **Controller** (`api:orders/src/OrderDesk/Http/Controllers/OrderDeskCashReportController.php`):
  - The `TIMEZONE` constant becomes a per-request zone: `BranchScheduleLookup::timezoneOf` with a branch, `OrganisationTimezone::forOrganisationId` without one.
  - The window and every `at time zone` use it, with validated identifiers only.
  - Settlements are filtered by `cash_settlements.branch_id` when a branch is chosen.
  - A `courier_expense` adjustment comes from `expense_minor`.
  - `meta.timezone` echoes the real zone, and `meta.branches` lists the tills (from `TillBranches`).
- **Monthly report:** `api:procurement/src/Services/MonthlyCostReportService` adds `courierExpenseByMonthCurrency()`, carried through the presenter and the yaml to a "Courier expenses" row on `kadm:screens/cost-report-screen.tsx`, outside COGS.
- **Screen:** `kadm:screens/order-desk-cash-report-screen.tsx` gets a branch `Select` (copy `kadm:screens/order-desk-close-screen.tsx:384`), defaulting to "All branches". Update the doc note at :135.
- **Tests (`api:orders/tests/OrderDeskCashReportTest.php`, `api:procurement/tests/MonthlyCostReportServiceTest.php`):**
  - a 23:30 Beirut receipt lands on the Beirut date
  - the branch filter applies to receipts, refunds and settlements
  - the expense shows in both reports and never in COGS

**T11 Today card on kitchen home**
- **API:** `GET /catalogue/order-desk/today?branch_id=`, in the `order.manage_organisation` group beside the cash report. New controller `api:orders/src/OrderDesk/Http/Controllers/OrderDeskTodayController.php`. The local day works as in T10.
- **Response:**
  - `day`, `timezone`
  - `sales: list<{currency_code, amount_minor}>`, `orders`
  - `cash_expected: list<{currency_code, amount_minor}>`, the figure `DailyCloses::open()` already computes
  - `overdue`, `past_due`, from `OrderDeskQueue::dueCountsFor`
  - `cancelled: {returned, wasted, other}`
- **Screen:** `kadm:screens/kitchen-home-screen.tsx` gets a `Card` like the existing module cards, with figures as in `kadm:catalogue/catalogue-stat-cards.tsx`. It polls every 60 s. Late and past due link to the desk's `past_due` lens. It's wrapped in `Gate` on `order.manage_organisation`.
- **Tests (`api:orders/tests/OrderDeskTodayTest.php`):**
  - figures for a seeded day, per currency
  - another branch is excluded when filtered
  - a 23:30 Beirut order counts today
  - 403 without the permission

**T15a Membership audit**
- **Files:** each of these calls `AuditRecorder::record`:
  - `api:access-administration/src/Services/MembershipAdministration.php` (`setScope`, `suspend`, `reactivate`, `end`)
  - `MembershipRoleAssigner::replace`
  - `RoleWriter::create/update/delete`
  - `StaffProvisioning`
- **Audit actions:** `membership.scope_changed`, `membership.suspended`, `membership.reactivated`, `membership.ended`, `membership.roles_replaced`, `role.created`, `role.updated`, `role.deleted`, `staff.provisioned`.
- **Comment:** fix the false comment at `StaffProvisioning.php:44`.
- **Tests (`api:access-administration/tests/MembershipAuditTest.php`):** one row per action, with the actor and subject.

**T15b Admin screen fixes**
- **Forbidden screen:** `ui:screens/forbidden-screen.tsx` shows permission labels from the `accessAdmin` catalogue instead of raw codes, and drops the reason badge.
- **Return link:**
  - Reproduce first: a signed-out deep link to `/kitchen/orders?view=…`, `/driver` and `/corporate/…`.
  - Only if the return is lost, provide `ArrivalHrefContext` in that layout, like `app/customer/_layout.tsx:77`.
  - Record the finding either way.
- **Product list packs:** `api:catalogues/src/Http/Controllers/CatalogueItemIndexController.php` accepts `include=variants`, batched like `CatalogueRecipeUsageRegistry::packs()` (:370). `listProducts` maps them.
- **Ingredients:** `kadm:catalogue/use-ingredient-list.ts` gains an `uncosted` filter on the client (`unitPrice === null`). The "uncosted" figure at `ingredients-screen.tsx:463` becomes pressable like the status figures.
- **Price lists:** the index returns `confirmed_entries_count` per row and `meta.status_counts`. `kadm:screens/price-lists-screen.tsx` drops `usePriceListWholeSetQuery`; `wholesale-setup-screen.tsx` keeps it.
- **Tests:**
  - a query-count test on the product index with `include=variants` (1 and 20 items)
  - price-list index counts
  - Jest for the forbidden-screen labels and the uncosted filter

### Lane C — display, orders, customer

**T12a Kitchen display — due sort, undo, lane tabs**
- **API:** `KitchenDisplayController` selects `OrderDeskQueue::DUE_AT as due_at`, and the ticket gains `due_at`. Update the yaml and the contract.
- **Sort:** `ui:features/kds/kds-board.ts` sorts by `dueAt`, then `placedAt`.
- **Undo** (`ui:features/kds/kds-tickets-screen.tsx`):
  - Ready and Fulfil schedule the mutation 10 s later, with `toast.show({ action: { label: Undo }, durationMs: 10_000 })`.
  - Undo cancels the timer.
  - The ticket shows a pending state in the meantime.
- **Lane tabs:** below `md` (`useBreakpoint().atLeast('md')` at :218), the three columns become `Tabs` from `@healthy360/design-system`.
- **Tests:**
  - `ui:features/kds/kds-tickets.test.tsx`: due order; undo cancels the mutation; it fires after 10 s; Accept is immediate; tabs below `md`
  - `api:orders/tests/KitchenDisplayTest.php`: `due_at` is present, and the query count is unchanged

**T12b Printed ticket**
- **Sheet:** new `ui:features/kds/ticket-print-sheet.tsx`, showing items, options (via `dishOptionsLine`), notes, allergy banner text, due time and number, with no money.
- **Routes:**
  - `apps/universal/app/kds/ticket.tsx` reads the order from `useKitchenDisplayQuery`, for line staff.
  - `apps/universal/app/kitchen/orders/ticket.tsx` reads it from `useKitchenOrderQuery`.
  - Both copy `app/kitchen/supply-orders/print.tsx` + `kadm:screens/supply-order-print-screen.tsx` and use `usePrintSheet()`.
- **Buttons:** Print on the KDS ticket and on the `kadm:screens/orders-screen.tsx` detail.
- **Tests:** the sheet contains the allergy text, options and note; nothing prints on mount.

**T13 Orders and desk small fixes**
- **Orders screen:** `useKitchenOrdersQuery(filters, enabled, refetchInterval?)` in `ui:data/kitchen-orders-hooks.ts`; `orders-screen.tsx` passes `ORDER_DESK_POLL_MS`.
- **Cancelled by:**
  - migration: `orders.cancelled_by uuid null` (FK to users, `nullOnDelete`)
  - `OrderLifecycle::cancel` stamps `$this->context->userId()`
  - the kitchen order presenter adds `cancelled_by_name` (the profile name, via the cash report's join)
  - the orders detail shows it
- **Remakes:** `OrderPresenter::preloadRemakes(list<string> $orderIds)`, like `preloadPlanDays`, gives `remake_of: {id, number} | null` from `order_complaints.remake_order_id`. The detail links it.
- **Desk:**
  - `DeskQuote::quoteNow` adds `warnings` per line from `LineProbeResult::$warnings`.
  - `kadm:screens/order-desk-sale-screen.tsx` shows "running low" with the existing warning `Callout`.
  - `kadm:order-desk-calendar.ts` drops meal rows with no orders.
- **Tests:**
  - `OrderDeskQuoteTest`: a `stock_short` warning on the line
  - a cancel test that sets `cancelled_by`
  - the remake link is present, with one query for a page
  - `OrderDeskCalendarTest` or Jest for the dropped rows
  - Jest for the poll interval

**T14 Driver**
- **Map link:** in `ui:features/driver/driver-jobs-screen.tsx`, the address opens `https://www.google.com/maps/search/?api=1&query=<encoded address>` through `Linking.openURL`.
- **Phone rule:** new `api:orders/src/Services/DeliveryPhone.php::resolves(?string $contactPointId, ?string $customerAccountId): bool`. It checks the address contact, then the `DriverJobIndexController::PHONE_SQL` fallback order.
- **Where it's checked (only these three paths):**
  - **Online:** `CheckoutPreviewService` refusals.
  - **Online and guest:** `OrderPlacementService` gets a new `bool $requireDeliveryPhone = false` argument, set by `OrderStoreController` and `GuestOrderStoreController`.
  - **Desk:** `DeskQuote` fulfilment refusals (:511) and `OrderDeskPlacementController`.
- **Refusal:** `reason: phone_required`. Checkout (`ui:features/commerce/screens/checkout-screen.tsx`) and the desk sale screen show it with a link to add a phone.
- **Tests (`api:orders/tests/DeliveryPhoneTest.php`):**
  - delivery without any phone is refused on online, guest and desk
  - pickup and counter are allowed
  - the account fallback passes
  - subscription generation and B2B quotation placement are unaffected
  - Jest for the map link

**T16 Store profile**
- **Data:** migration on `organisations`, all nullable: `tagline_en`, `tagline_ar` (string 160), `description_en`, `description_ar` (text), `cuisines_en`, `cuisines_ar` (jsonb list of strings).
- **API:** `GET` + `PUT /catalogue/storefront-profile` under `catalogue.manage_organisation` + `org.trading`. `api:kitchens/src/Presenters/MarketplaceKitchenPresenter.php:74-80` reads them in the request's locale. No extra query: the organisation is already loaded.
- **Screen:** a `FormSection` on `kadm:screens/branch-operating-screen.tsx` beside the service settings, with a `BilingualField` for each pair.
- **Tests:**
  - save
  - presenter output in en and ar
  - empty stays `''` / `[]`
  - 403 without the permission

**T17 Customer order page and cancel**
- **Options and notes:** `client:api/order-repository.ts` `mapOrderLine` keeps `options` and `note` (in the `PlacedOrderLine` contract). `ui:features/orders/order-tracking.tsx` and `ui:features/commerce/order-receipt.tsx` render them with `dishOptionsLine`.
- **Ready wording:** `mapPlacedOrder` carries `fulfilmentType`. Delivery orders show "Ready, out soon" on the timeline (`ui:features/orders/order-timeline.tsx`) and on the history badge (`ui:features/commerce/state-badge.tsx`).
- **Checkout success copy:** "placed, waiting for the kitchen".
- **Customer cancel:**
  - `POST /me/orders/{order}/cancel`, through a new `MyOrderCancelController` that finds the order like `MyOrderShowController`, via `OrderLocator::customerOrder`.
  - Refused unless the order is `placed` (`ResourceConflict`, `reason: order_already_accepted`).
  - Runs `OrderLifecycle::cancel($order, CancellationReason::CustomerRequested, $order->lock_version)` inside `SellerContext::during()`.
  - Sends `StaffAlertType::CustomerCancelled`.
  - The button uses the existing confirm `Dialog` and shows only while the order is placed.
- **Tests (`api:orders/tests/CustomerCancelTest.php`):**
  - cancel while placed
  - refused once confirmed
  - race: accept, then cancel at the same `lock_version`; the second gets 409
  - another customer's order is 404
  - the alert is sent once
  - Jest: options and note render, and the delivery wording

### T19 Hydration error 418 (serial, after the lanes)

- **Approach:** superpowers:systematic-debugging. Reproduce on the static build and find which suspect it is (locale, breakpoint or clock in render) before any edit. Fix it at the cause, and name the file in the commit.

### T20 Verification and handover

- [ ] **Targeted Pest, once, from `apps/api`:**
  - every test file the tasks added or extended
  - `tests/Feature/Api/OpenApiContractTest.php`, `app-modules/tenancy/tests/RlsTest.php`, `app-modules/access-control/tests`, `app-modules/support/tests/DataClassificationTest.php`
  - the module boundary tests: `IngredientDependencyTest`, `CatalogueDependencyTest`, `OrderArchitectureTest`, `PricingDependencyTest`, `DeliveryDependencyTest`
- [ ] **Jest:** `npx jest --runInBand <touched test files>`.
- [ ] **Checks:** `pnpm i18n:check`, typecheck, ESLint on the changed files, `vendor/bin/pint --dirty --format agent`, `pnpm gen:api:check`.
- [ ] **Browser walk** on the local stack with the preview tools, in both themes and in Arabic, with screenshots in the report:
  - allergen release and a free-from refusal
  - display tabs and undo, and the printed ticket
  - the Today card
  - a customer cancel and the order-page options
  - a cash report across midnight
- [ ] **Report and memory:** add an "Audit gaps second pass" section to the Claude Doc report (what's fixed, the manual checks, what's still open). Update memory with the owner answers and branch status.
- [ ] **Push** `Audit-Gaps`. Deploy notes for the owner:
  - run `recipes:carry-allergens --dry-run`, then the real run; the listed dishes go to review until released
  - delivery orders now need a reachable phone; subscriptions and B2B are unaffected
  - old waste rows show as `other` (no backfill, because the ledger is append-only)
  - a duplicate merge needs the dropped shelf counted to zero first

## Execution

Subagent-driven on Opus 5.5, with a reviewer per task and a whole-branch review at the end. T1 runs first and alone. Then three writer lanes run side by side, each lane serial:

| Lane A | Lane B | Lane C |
|---|---|---|
| T2a → T2b → T3 → T4 → T5 → T6 → T18a → T18b | T7 → T8 → T9 → T10 → T11 → T15a → T15b | T12a → T12b → T13 → T14 → T16 → T17 |

Then T19, then T20.

- No two lanes edit the same non-shared file.
- The shared files (yaml, api-client generated files and contracts, i18n catalogues and keys, `routes/api-v1.php`) are staged by explicit path.
- Generation, typecheck and generated-file commits run under one lock.
- Pest runs only in T20.
