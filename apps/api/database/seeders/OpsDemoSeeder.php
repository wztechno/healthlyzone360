<?php

declare(strict_types=1);

namespace Database\Seeders;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\ProductionMode;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierContact;
use Healthy360\Procurement\Models\SupplierStockItem;
use Healthy360\Procurement\Services\GoodsReceiptService;
use Healthy360\Recipes\Enums\PackagingBasis;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\Recipes\Models\RecipeVersionPackaging;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Log;

/**
 * Synthetic kitchen-ops data for the demonstration kitchen (Verdant, seeded
 * by DemoTenantSeeder): stock items, two suppliers, the opening stock levels
 * behind them (O8) and — since SUP8 — the purchasing configuration that makes
 * the supply-order workflow demonstrable: named contacts, supplier/item links
 * and reorder thresholds.
 *
 * Insert-if-absent throughout (`firstOrCreate`, never `updateOrCreate`):
 * unlike the rest of the demo world, these rows are the starting point for
 * real API traffic — a demo user adjusts, wastes and receives against
 * them — and a reseed must never clobber a quantity the demo has since
 * moved. Re-running this seeder converges to "these rows exist" and
 * touches nothing that already does.
 *
 * The one write that is not an insert is {@see self::stockThresholds()}, and it
 * is null-guarded per column: a threshold is *filled in* where the kitchen has
 * none, never corrected where it has one. Quantity is never in that set at all.
 * This is the SUP8 seeding rule — demo seeding may add configuration and fill
 * nulls; it may not rewrite a quantity, a cost or any purchasing history.
 *
 * There are deliberately **no prebuilt purchase orders**: the demo shows an
 * empty order book that a demonstrator fills the way a kitchen would.
 *
 * Receipts are a different matter since PROD1, and the rule that kept them out
 * is worth restating rather than dropping. A receipt written *straight into the
 * table* bypasses `GoodsReceiptService`, so the purchase ledger, the stock
 * movements and the weighted ingredient cost disagree from the first run — a
 * demo world that lies about its own arithmetic. That objection is to the raw
 * row, not to the receipt: {@see self::demonstrateProduction()} posts two weeks
 * of priced deliveries **through the service**, which is what makes a weekly
 * purchase price exist at all. Without them every batch estimate in the demo is
 * withheld for want of a price, which demonstrates nothing except the absence.
 *
 * Guarded to local and testing environments, exactly like DemoTenantSeeder,
 * and a no-op if that seeder has not run yet: there is no demo kitchen to
 * hang synthetic stock off.
 */
class OpsDemoSeeder extends Seeder
{
    public function run(): void
    {
        if (! App::environment(['local', 'testing'])) {
            Log::warning('OpsDemoSeeder skipped: demo ops data is seeded in local and testing environments only.');

            return;
        }

        $verdant = Organisation::query()->where('slug', 'verdant-kitchen')->first();

        if ($verdant === null) {
            Log::warning('OpsDemoSeeder skipped: the demonstration kitchen (verdant-kitchen) has not been seeded yet.');

            return;
        }

        $branch = OrganisationBranch::withoutTenancy()
            ->where('organisation_id', $verdant->getKey())
            ->where('name', 'Al Quoz')
            ->first();

        if ($branch === null) {
            Log::warning('OpsDemoSeeder skipped: the demonstration kitchen has no Al Quoz branch yet.');

            return;
        }

        $gulfFoods = $this->supplier($verdant, 'gulf-foods', 'Gulf Foods Trading');

        // Two items linked to ingredients DemoTenantSeeder already declared
        // (O1's "optional ingredient_id"), and two with none at all — a
        // stock item is a warehouse concept and does not require a kitchen
        // to have modelled the same thing as a recipe ingredient yet.
        $chickenBreast = $this->stockItem($verdant, 'chicken-breast', 'Chicken breast', 'kg', $this->ingredient($verdant, 'chicken-breast'));
        $redLentils = $this->stockItem($verdant, 'red-lentils', 'Red lentils', 'kg', $this->ingredient($verdant, 'red-lentils'));
        $basmatiRice = $this->stockItem($verdant, 'basmati-rice', 'Basmati rice', 'kg', null);
        $oliveOil = $this->stockItem($verdant, 'olive-oil', 'Olive oil', 'l', null);

        $this->stockLevel($branch, $chickenBreast, '40.0000');
        $this->stockLevel($branch, $redLentils, '60.0000');
        $this->stockLevel($branch, $basmatiRice, '120.0000');
        $this->stockLevel($branch, $oliveOil, '25.0000');

        // The four shelves against the §4 ordering rules, chosen so the builder
        // demonstrates each of its cases on the opening quantities above:
        //
        // - chicken breast 40 against a threshold of 50 — plainly low, and a par
        //   of 120 gives it a suggested 80;
        // - red lentils 60 against a threshold of 60 — low *at* the boundary,
        //   because the comparison is inclusive (`quantity <= threshold`) and a
        //   kitchen sitting exactly on its reorder point has reached it;
        // - basmati rice 120 against a threshold of 40 — comfortably stocked,
        //   and therefore only reachable through **Add another item**;
        // - olive oil 25 against a threshold of 25 with **no par** — low at the
        //   boundary and deliberately without a suggestion, so the demo shows
        //   the manual-quantity case rather than the fiction that
        //   `threshold - quantity` (zero here) is an order worth placing.
        $this->stockThresholds($branch, $chickenBreast, '50.0000', '120.0000');
        $this->stockThresholds($branch, $redLentils, '60.0000', '100.0000');
        $this->stockThresholds($branch, $basmatiRice, '40.0000', '200.0000');
        $this->stockThresholds($branch, $oliveOil, '25.0000', null);

        // Named so a supplier index has more than one row to page through, and
        // since SUP4 so the builder has a second order to group into.
        $freshmart = $this->supplier($verdant, 'freshmart', 'Freshmart Wholesale');

        // Gulf Foods carries the fuller contact card: the person who takes the
        // order and the person who chases the invoice, with a WhatsApp number
        // that differs from the landline — the case the separate column exists
        // for. Freshmart carries the other realistic shape, one desk whose
        // mobile is also its WhatsApp.
        $this->contact($gulfFoods, 'Samir Haddad', [
            'role_title' => 'Sales representative',
            'email' => 'samir.haddad@gulf-foods.test',
            'phone' => '+971 4 555 0111',
            'whatsapp_phone' => '+971 50 555 0112',
            'is_primary' => true,
            'display_order' => 0,
        ]);
        $this->contact($gulfFoods, 'Rana Accounts', [
            'role_title' => 'Accounts',
            'email' => 'accounts@gulf-foods.test',
            'display_order' => 1,
        ]);
        $this->contact($freshmart, 'Omar Said', [
            'role_title' => 'Orders desk',
            'phone' => '+971 4 555 0220',
            'whatsapp_phone' => '+971 4 555 0220',
            'is_primary' => true,
            'display_order' => 0,
        ]);

        // Who sells what, arranged so the proposal demonstrates all three of its
        // supplier rules at once: chicken breast has one supplier and a
        // preference, rice and lentils have two each with the preference on
        // opposite sides, and olive oil has none — the unassigned bucket the
        // builder must show rather than silently drop.
        $this->link($gulfFoods, $chickenBreast, isPreferred: true, supplierItemRef: 'GF-CHKN-01');
        $this->link($gulfFoods, $redLentils, isPreferred: true);
        $this->link($gulfFoods, $basmatiRice, isPreferred: false);
        $this->link($freshmart, $basmatiRice, isPreferred: true);
        $this->link($freshmart, $redLentils, isPreferred: false);

        $this->demonstrateProduction($verdant, $branch, $gulfFoods);
    }

    /**
     * The internal production world (PROD1): what the kitchen makes for itself.
     *
     * Three things a demonstrator needs and could not previously show:
     *
     * 1. **A dressing that is an ingredient.** Caesar dressing has a published
     *    recipe with an *output*, so it lands on its own shelf when a batch
     *    completes and the salads that list it draw on that shelf rather than
     *    re-expanding into mayonnaise and lemon.
     * 2. **A frozen meal sold by the unit.** A recipe that makes forty trays and
     *    a catalogue item that sells from finished stock: selling one takes a
     *    tray off the freezer shelf and does not take its flour a second time.
     * 3. **Two weeks of priced deliveries.** Nothing else here can produce a
     *    weekly average price, and without one every batch estimate is withheld
     *    for want of a figure.
     *
     * No production orders are seeded. A batch is the demonstration — planning
     * one, watching it claim stock and reporting what came out — and a prebuilt
     * one would hand somebody the answer instead of the exercise.
     */
    private function demonstrateProduction(
        Organisation $organisation,
        OrganisationBranch $branch,
        Supplier $supplier,
    ): void {
        $mayonnaise = $this->productionIngredient($organisation, 'mayonnaise', 'Mayonnaise', 'l', '5.000000');
        $lemonJuice = $this->productionIngredient($organisation, 'lemon-juice', 'Lemon juice', 'l', '3.000000');
        $parmesan = $this->productionIngredient($organisation, 'parmesan', 'Parmesan', 'kg', '22.000000');
        $pastaSheets = $this->productionIngredient($organisation, 'pasta-sheets', 'Pasta sheets', 'kg', '4.000000');
        $freezerTray = $this->productionIngredient($organisation, 'freezer-tray', 'Freezer tray, 1 portion', 'piece', '0.400000');
        $lettuce = $this->productionIngredient($organisation, 'lettuce', 'Romaine lettuce', 'kg', '6.000000');

        // The three produced items. They carry no purchase price on purpose: a
        // kitchen does not buy its own dressing, and a typed figure here would
        // be a fallback the estimator reached for instead of the batch cost.
        $dressing = $this->productionIngredient($organisation, 'caesar-dressing', 'Caesar dressing', 'l', null);
        $lasagne = $this->productionIngredient($organisation, 'frozen-lasagne', 'Frozen lasagne, single portion', 'piece', null);
        $salad = $this->productionIngredient($organisation, 'prepared-caesar-salad', 'Prepared Caesar salad', 'kg', null);

        $this->openingStock($branch, [$mayonnaise, $lemonJuice, $parmesan, $pastaSheets, $freezerTray, $lettuce]);

        $this->productionRecipe(
            $organisation,
            'caesar-dressing',
            'Caesar dressing',
            $dressing,
            '20',
            'l',
            [[$mayonnaise, '15', 'l'], [$lemonJuice, '3', 'l'], [$parmesan, '2', 'kg']],
            shelfLifeDays: 5,
        );

        $this->productionRecipe(
            $organisation,
            'frozen-lasagne',
            'Frozen lasagne',
            $lasagne,
            '40',
            'piece',
            [[$pastaSheets, '6', 'kg'], [$parmesan, '2', 'kg']],
            [[$freezerTray, '40', 'piece']],
            shelfLifeDays: 90,
        );

        /*
         * The salad, and the second reason it is here: it puts the Caesar
         * dressing inside another recipe. A batch of salad *draws on* the
         * dressing's shelf rather than re-expanding mayonnaise, lemon juice and
         * parmesan a second time — which is the whole point of an intermediate
         * and is not visible while the dressing is only ever made.
         */
        $this->productionRecipe(
            $organisation,
            'prepared-caesar-salad',
            'Prepared Caesar salad',
            $salad,
            '12',
            'kg',
            [[$lettuce, '9', 'kg'], [$dressing, '1.5', 'l'], [$parmesan, '0.6', 'kg']],
        );

        $this->finishedStockItem(
            $organisation,
            $lasagne,
            'frozen-lasagne',
            'Frozen lasagne, single portion',
            CatalogueItemType::FrozenMeal,
            '1',
            'piece',
        );

        // 300 g off a shelf counted in kilograms: the conversion the net-content
        // columns exist for, and the sale `OrderConsumptionService` would refuse
        // with `no_net_content` if the pair were absent.
        $this->finishedStockItem(
            $organisation,
            $salad,
            'prepared-caesar-salad',
            'Prepared Caesar salad, 300 g',
            CatalogueItemType::Meal,
            '0.3',
            'kg',
        );

        $this->demonstrationReceipts($organisation, $branch, $supplier, [
            $mayonnaise, $lemonJuice, $parmesan, $pastaSheets, $freezerTray, $lettuce,
        ]);
    }

    /**
     * An ingredient with its derived shelf, and the typed purchase price the
     * estimator falls back to before a weekly average exists.
     *
     * `null` for the two produced items, deliberately: a kitchen does not buy
     * its own dressing, and a typed figure there would be a fallback the
     * estimator reached for instead of what the batch actually cost.
     */
    private function productionIngredient(
        Organisation $organisation,
        string $slug,
        string $nameEn,
        string $unitCode,
        ?string $purchasePrice,
    ): Ingredient {
        $unit = MeasurementUnit::query()->where('code', $unitCode)->first();

        /** @var Ingredient $ingredient */
        $ingredient = Ingredient::withoutTenancy()->firstOrCreate(
            ['organisation_id' => $organisation->getKey(), 'slug' => $slug],
            [
                'name_en' => $nameEn,
                'name_ar' => $nameEn,
                'default_unit_id' => $unit?->getKey(),
                'purchase_price_amount' => $purchasePrice,
                'purchase_price_currency' => $purchasePrice === null ? null : 'AED',
                'purchase_unit_id' => $purchasePrice === null ? null : $unit?->getKey(),
            ],
        );

        return $ingredient;
    }

    /**
     * The shelf an ingredient's observer derived, or null if it has none yet.
     *
     * Read back rather than created: derivation already minted one, and a second
     * shelf against one ingredient is a real shape the explosion has to break a
     * tie over — so seeding a duplicate would put a batch's yield on whichever
     * code happened to sort first.
     */
    private function derivedShelf(Ingredient $ingredient): ?StockItem
    {
        return StockItem::withoutTenancy()
            ->where('ingredient_id', $ingredient->getKey())
            ->orderBy('code')
            ->first();
    }

    /**
     * Opening quantities on the raw shelves, so a first batch has something to
     * claim. The produced items are left empty — their stock is what a batch is
     * for.
     *
     * @param  list<Ingredient>  $ingredients
     */
    private function openingStock(OrganisationBranch $branch, array $ingredients): void
    {
        foreach ($ingredients as $ingredient) {
            $shelf = $this->derivedShelf($ingredient);

            if ($shelf !== null) {
                $this->stockLevel($branch, $shelf, '0.0000');
            }
        }
    }

    /**
     * A published recipe version that makes `$output`, with its lines and any
     * packaging.
     *
     * Keyed on the recipe slug, so a reseed converges rather than publishing a
     * second version of the same dish every time it runs.
     *
     * `$shelfLifeDays` dates the batches the desk completes. The salad is left
     * without one on purpose, so the demo still shows a use-by typed by hand.
     *
     * @param  list<array{0: Ingredient, 1: string, 2: string}>  $lines
     * @param  list<array{0: Ingredient, 1: string, 2: string}>  $packaging
     */
    private function productionRecipe(
        Organisation $organisation,
        string $slug,
        string $nameEn,
        Ingredient $output,
        string $outputQuantity,
        string $outputUnitCode,
        array $lines,
        array $packaging = [],
        ?int $shelfLifeDays = null,
    ): void {
        $existing = Recipe::withoutTenancy()
            ->where('organisation_id', $organisation->getKey())
            ->where('slug', $slug)
            ->first();

        if ($existing !== null) {
            return;
        }

        $outputUnit = MeasurementUnit::query()->where('code', $outputUnitCode)->first();

        if ($outputUnit === null) {
            return;
        }

        /** @var Recipe $recipe */
        $recipe = Recipe::withoutTenancy()->create([
            'organisation_id' => $organisation->getKey(),
            'slug' => $slug,
            'name_en' => $nameEn,
            'name_ar' => $nameEn,
            'shelf_life_days' => $shelfLifeDays,
        ]);

        /** @var RecipeVersion $version */
        $version = RecipeVersion::withoutTenancy()->create([
            'organisation_id' => $organisation->getKey(),
            'recipe_id' => $recipe->getKey(),
            'version_number' => 1,
            'status' => 'published',
            'published_at' => CarbonImmutable::now(),
            'yield_quantity' => $outputQuantity,
            'yield_unit_id' => (string) $outputUnit->getKey(),
            'yield_piece_count' => 1,
            'waste_coefficient_percent' => '0.00',
            'packaging_waste_percent' => '0.00',
        ]);

        $lineNumber = 1;

        foreach ($lines as [$ingredient, $quantity, $unitCode]) {
            $unit = MeasurementUnit::query()->where('code', $unitCode)->first();

            RecipeVersionLine::withoutTenancy()->create([
                'organisation_id' => $organisation->getKey(),
                'recipe_version_id' => $version->getKey(),
                'line_number' => $lineNumber++,
                'ingredient_id' => (string) $ingredient->getKey(),
                'quantity' => $quantity,
                'unit_id' => $unit?->getKey(),
            ]);
        }

        $packagingLine = 1;

        foreach ($packaging as [$ingredient, $quantity, $unitCode]) {
            $unit = MeasurementUnit::query()->where('code', $unitCode)->first();

            RecipeVersionPackaging::withoutTenancy()->create([
                'organisation_id' => $organisation->getKey(),
                'recipe_version_id' => $version->getKey(),
                'line_number' => $packagingLine++,
                'ingredient_id' => (string) $ingredient->getKey(),
                'basis' => PackagingBasis::PerBatch,
                'quantity' => $quantity,
                'unit_id' => $unit?->getKey(),
            ]);
        }

        RecipeVersionOutput::withoutTenancy()->create([
            'organisation_id' => $organisation->getKey(),
            'recipe_version_id' => $version->getKey(),
            'ingredient_id' => (string) $output->getKey(),
            'output_quantity' => $outputQuantity,
            'unit_id' => (string) $outputUnit->getKey(),
            'is_primary' => true,
        ]);

        // The claim `RecipeOutputNutritionWriter` makes when a version with an
        // output is published. Stated here because this seeder writes the
        // version rather than publishing one through the service, and costing
        // follows exactly the version that claims the ingredient's nutrition —
        // without it, a salad listing the dressing has no component cost to read.
        $output->nutrition_derived_from_version_id = (string) $version->getKey();
        $output->save();
    }

    /**
     * A catalogue item that sells a produced ingredient off its own shelf.
     *
     * The two callers are the two halves of the rule (PROD1), and they are
     * deliberately different rather than one case seeded twice:
     *
     * - the **frozen lasagne** is a `frozen_meal`, a type that sells from
     *   finished stock whatever its flag says, on a shelf counted in pieces. One
     *   sold unit is one of them, so the deduction needs no conversion — and the
     *   net content is stated anyway, because `portion_factor` is dimensionless
     *   and stating it is what the columns are for;
     * - the **prepared salad** is an ordinary `meal` that opts in, on a shelf
     *   counted in kilograms, where 300 g per sold unit is a conversion nothing
     *   else in the record could express. That is the case OQ-051 is about, and
     *   the one the demo could not previously show.
     *
     * A `meal` that opts in has two preconditions the service enforces on any
     * write — a production mode of `production` or `both`, and an ingredient a
     * *published* recipe version outputs. This seeder writes the model directly,
     * as it does for recipes, so it states a world that satisfies the rule rather
     * than exercising it; `OpsDemoSeederIdempotencyTest` asserts the seeded salad
     * passes the real predicate, so a tightened rule breaks the seed rather than
     * quietly diverging from it.
     */
    private function finishedStockItem(
        Organisation $organisation,
        Ingredient $ingredient,
        string $slug,
        string $nameEn,
        CatalogueItemType $itemType,
        string $netContentQuantity,
        string $netContentUnitCode,
    ): void {
        $catalogue = Catalogue::withoutTenancy()
            ->where('organisation_id', $organisation->getKey())
            ->first();

        if ($catalogue === null) {
            return;
        }

        $netContentUnit = MeasurementUnit::query()->where('code', $netContentUnitCode)->first();

        CatalogueItem::withoutTenancy()->firstOrCreate(
            ['organisation_id' => $organisation->getKey(), 'ingredient_id' => (string) $ingredient->getKey()],
            [
                'catalogue_id' => $catalogue->getKey(),
                'slug' => $slug,
                'name_en' => $nameEn,
                'name_ar' => $nameEn,
                'item_type' => $itemType,
                'production_mode' => ProductionMode::Production,
                // Redundant on a `frozen_meal` and load-bearing on a `meal`: the
                // type answers for the first, the flag for the second. Set on
                // both so the column reads the same way as the behaviour on
                // every row this seeder writes.
                'sells_from_finished_stock' => true,
                'status' => CatalogueItemStatus::Published,
                'net_content_quantity' => $netContentQuantity,
                'net_content_unit_id' => $netContentUnit?->getKey(),
            ],
        );
    }

    /**
     * Two completed weeks of priced deliveries, posted through the real
     * receiving service.
     *
     * The second week is dearer than the first, so the weekly publisher has two
     * different averages to show and the carry-forward, the effective dates and
     * the "which week priced this batch" question all have something to point
     * at. Both weeks are *completed* relative to now, which is what makes them
     * publishable at all.
     *
     * Keyed on the document reference and skipped wholesale if either is already
     * there: a receipt is stock and money, and a reseed that posted it again
     * would double both.
     *
     * @param  list<Ingredient>  $ingredients
     */
    private function demonstrationReceipts(
        Organisation $organisation,
        OrganisationBranch $branch,
        Supplier $supplier,
        array $ingredients,
    ): void {
        $weeks = [
            ['ref' => 'DEMO-PROD-W2', 'weeksAgo' => 2, 'multiplier' => '1.00'],
            ['ref' => 'DEMO-PROD-W1', 'weeksAgo' => 1, 'multiplier' => '1.08'],
        ];

        $timezone = $branch->timezone ?? config('app.timezone');
        $now = CarbonImmutable::now(is_string($timezone) ? $timezone : 'UTC');

        // A real member of this kitchen, because the receipt writes an audit
        // entry and an audit entry names a person. No member, no receipts: a
        // delivery nobody booked in is precisely the fiction this seeder has
        // always refused to write.
        $actorId = OrganisationMembership::withoutTenancy()
            ->where('organisation_id', $organisation->getKey())
            ->value('user_id');

        if ($actorId === null) {
            Log::warning('OpsDemoSeeder skipped the demonstration receipts: the kitchen has no members to post them.');

            return;
        }

        // The receiving service resolves the branch through tenancy, exactly as
        // it does behind a request. A seeder runs with no context at all, so it
        // supplies one and puts it back: posting these through the real path is
        // the whole reason they are allowed here, and reaching around the scope
        // to avoid the ceremony would be the raw row again in a longer form.
        $context = app(TenantContext::class);
        $snapshot = $context->toArray();
        $context->setOrganisation((string) $actorId, (string) $organisation->getKey());

        foreach ($weeks as $week) {
            $alreadyPosted = GoodsReceipt::withoutTenancy()
                ->where('organisation_id', $organisation->getKey())
                ->where('document_ref', $week['ref'])
                ->exists();

            if ($alreadyPosted) {
                continue;
            }

            $lines = [];

            foreach ($ingredients as $ingredient) {
                $shelf = $this->derivedShelf($ingredient);

                if ($shelf === null || $ingredient->purchase_price_amount === null) {
                    continue;
                }

                $lines[] = [
                    'stock_item_id' => (string) $shelf->getKey(),
                    'quantity' => '60',
                    'unit_id' => $ingredient->default_unit_id,
                    'unit_price_amount' => bcmul((string) $ingredient->purchase_price_amount, $week['multiplier'], 6),
                    'cost_currency_code' => 'AED',
                ];
            }

            if ($lines === []) {
                continue;
            }

            app(GoodsReceiptService::class)->post(
                (string) $organisation->getKey(),
                (string) $branch->getKey(),
                (string) $supplier->getKey(),
                $week['ref'],
                null,
                $lines,
                $now->subWeeks($week['weeksAgo'])->startOfWeek()->addDay()->toDateString(),
            );
        }

        $context->restore($snapshot);
    }

    private function ingredient(Organisation $organisation, string $slug): ?Ingredient
    {
        return Ingredient::withoutTenancy()
            ->where('organisation_id', $organisation->getKey())
            ->where('slug', $slug)
            ->first();
    }

    private function supplier(Organisation $organisation, string $code, string $nameEn): Supplier
    {
        return Supplier::withoutTenancy()->firstOrCreate(
            ['organisation_id' => $organisation->getKey(), 'code' => $code],
            ['name_en' => $nameEn],
        );
    }

    private function stockItem(
        Organisation $organisation,
        string $code,
        string $nameEn,
        string $unitCode,
        ?Ingredient $ingredient,
    ): StockItem {
        return StockItem::withoutTenancy()->firstOrCreate(
            ['organisation_id' => $organisation->getKey(), 'code' => $code],
            [
                'name_en' => $nameEn,
                'unit_code' => $unitCode,
                'ingredient_id' => $ingredient?->getKey(),
            ],
        );
    }

    private function stockLevel(OrganisationBranch $branch, StockItem $item, string $quantity): void
    {
        // `withoutTenancy()` + an explicit organisation: the seeder runs with no
        // tenant context, and StockLevel is organisation-scoped since INV1.0.
        StockLevel::withoutTenancy()->firstOrCreate(
            ['branch_id' => $branch->getKey(), 'stock_item_id' => $item->getKey()],
            ['organisation_id' => $branch->organisation_id, 'quantity' => $quantity],
        );
    }

    /**
     * Fill a shelf's reorder point and par level **only where they are null**.
     *
     * The only non-insert write in this seeder, and the narrowest one that does
     * the job. The guard is per column rather than per row: a demonstrator who
     * clears a threshold gets it back and keeps the par they typed, and one who
     * retunes a threshold keeps it. `quantity` is not in the set under any
     * condition — it is the number the demo actually moves, and a reseed that
     * reset it would undo the receiving and wastage the demo just showed.
     *
     * A missing level is left missing rather than created here; {@see
     * self::stockLevel()} owns that, and a shelf with no branch level is not a
     * shortage (§4).
     */
    private function stockThresholds(OrganisationBranch $branch, StockItem $item, string $threshold, ?string $par): void
    {
        $level = StockLevel::withoutTenancy()
            ->where('branch_id', $branch->getKey())
            ->where('stock_item_id', $item->getKey())
            ->first();

        if ($level === null) {
            return;
        }

        $fill = [];

        if ($level->reorder_threshold === null) {
            $fill['reorder_threshold'] = $threshold;
        }

        if ($par !== null && $level->par_level === null) {
            $fill['par_level'] = $par;
        }

        if ($fill === []) {
            return;
        }

        $level->forceFill($fill)->save();
    }

    /**
     * One named person at a supplier, keyed on (supplier, name).
     *
     * `firstOrCreate` and not `updateOrCreate`, on the same terms as everything
     * else here: an edited phone number or a demoted primary flag is a demo
     * user's work, and a reseed that restored the seeded values would erase it.
     * The channel CHECK is satisfied by every caller — a contact nobody can
     * reach is refused by the database, which is the intended shape.
     *
     * @param  array<string, scalar>  $attributes
     */
    private function contact(Supplier $supplier, string $name, array $attributes): void
    {
        SupplierContact::withoutTenancy()->firstOrCreate(
            ['supplier_id' => $supplier->getKey(), 'name' => $name],
            ['organisation_id' => $supplier->organisation_id, ...$attributes],
        );
    }

    /**
     * One supplier/item link, keyed on the pair the unique index is keyed on.
     *
     * `is_preferred` is set **on create only**, and that is the whole point of
     * using `firstOrCreate` here rather than an upsert. A demonstrator who moves
     * the preference for basmati rice from Freshmart to Gulf Foods has made a
     * decision; a reseed that set the seeded flag again would quietly steal it
     * back, and — worse — would collide with the partial unique index on
     * `stock_item_id WHERE is_preferred` on the way, because the other holder is
     * still there. Insert-if-absent never touches either side of that swap.
     */
    private function link(Supplier $supplier, StockItem $item, bool $isPreferred, ?string $supplierItemRef = null): void
    {
        SupplierStockItem::withoutTenancy()->firstOrCreate(
            ['supplier_id' => $supplier->getKey(), 'stock_item_id' => $item->getKey()],
            [
                'organisation_id' => $supplier->organisation_id,
                'is_preferred' => $isPreferred,
                'supplier_item_ref' => $supplierItemRef,
            ],
        );
    }
}
