<?php

declare(strict_types=1);

namespace Database\Seeders;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Procurement\Models\Supplier;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Log;

/**
 * Synthetic kitchen-ops data for the demonstration kitchen (Verdant, seeded
 * by DemoTenantSeeder): stock items, a supplier and the opening stock levels
 * behind them (O8).
 *
 * Insert-if-absent throughout (`firstOrCreate`, never `updateOrCreate`):
 * unlike the rest of the demo world, these rows are the starting point for
 * real API traffic — a demo user adjusts, wastes and receives against
 * them — and a reseed must never clobber a quantity the demo has since
 * moved. Re-running this seeder converges to "these rows exist" and
 * touches nothing that already does.
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

        $this->supplier($verdant, 'gulf-foods', 'Gulf Foods Trading');

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

        // Unused today (no PO UI, O2) but named so a supplier index has
        // more than one row to page through.
        $this->supplier($verdant, 'freshmart', 'Freshmart Wholesale');
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
        StockLevel::query()->firstOrCreate(
            ['branch_id' => $branch->getKey(), 'stock_item_id' => $item->getKey()],
            ['quantity' => $quantity],
        );
    }
}
