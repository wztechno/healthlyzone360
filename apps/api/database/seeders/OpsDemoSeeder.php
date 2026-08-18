<?php

declare(strict_types=1);

namespace Database\Seeders;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierContact;
use Healthy360\Procurement\Models\SupplierStockItem;
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
 * There are deliberately **no seeded goods receipts and no prebuilt purchase
 * orders**. A receipt written straight into the table bypasses
 * `GoodsReceiptService`, so the purchase ledger, the stock movements and the
 * weighted ingredient cost would disagree from the first run — a demo world
 * that lies about its own arithmetic. Tests that need a priced receipt create
 * one through the real receiving path; the demo shows an empty order book that
 * a demonstrator fills the way a kitchen would.
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
