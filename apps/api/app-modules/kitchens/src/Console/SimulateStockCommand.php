<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Enums\ProductionMode;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Services\StockItemDerivationService;
use Healthy360\Kitchens\Console\Concerns\RunsInsideOneKitchen;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierStockItem;
use Healthy360\Procurement\Services\GoodsReceiptService;
use Healthy360\Procurement\Services\WeeklyPricePublisher;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Console\Command;

/**
 * Give one kitchen FAKE but realistic purchase prices and stock, so the owner can run it end to
 * end on a development world: receive, cost, produce, run low, reorder.
 *
 * Everything goes through the real receiving path. Two backdated goods receipts per supplier
 * (two weeks ago, last week, at slightly different prices) are posted with
 * {@see GoodsReceiptService::post()}, which is what keeps the shelf quantity, the moving-average
 * cost and the append-only cost events agreeing with one another — an `adjust` movement would
 * move the shelf and leave the cost ledger behind. The weekly price publisher then runs so
 * weekly recipe costing has prices to read. Thresholds are filled only where empty.
 *
 * Figures come from `database/data/simulation-prices.json` (price per kg / l / piece, and a
 * sensible on-hand level); anything the file does not name falls back to its category's default.
 * What the kitchen makes itself — a catalogue item in production mode, or a preparation the file
 * lists as `not_bought` — is never received from a supplier: its cost is what a batch costs.
 * About one shelf in eight is deliberately received short, below its reorder point, so the
 * low-stock and reorder screens have something to show.
 *
 * Idempotent: a receipt whose document reference already exists is skipped, so a re-run never
 * doubles stock or money. `--fresh-refs=<suffix>` posts another round on purpose.
 */
final class SimulateStockCommand extends Command
{
    use RunsInsideOneKitchen;

    /** Supplier code => [name, ingredient categories it delivers]. `*` takes the rest. */
    private const array SUPPLIERS = [
        'SIM-FRESH' => ['Bekaa Fresh Produce', ['vegetable', 'fruit']],
        'SIM-MEAT' => ['Cedar Meat & Poultry', ['meat-egg', 'fish-seafood']],
        'SIM-DAIRY' => ['Mount Lebanon Dairies', ['dairy']],
        'SIM-PACK' => ['Beirut Packaging Co.', ['packaging-disposables']],
        'SIM-BEV' => ['Levant Frozen, Bakery & Beverages', ['product']],
        'SIM-DRY' => ['Phoenicia Wholesale Foods', ['*']],
    ];

    /** Fresh herbs come from the produce market, not the spice merchant. */
    private const array FRESH_HERBS = ['basil', 'chives', 'coriander', 'dill', 'mint', 'rosemary', 'edible-flowers-viola'];

    protected $signature = 'kitchen:simulate-stock
        {--org= : The kitchen organisation (defaults to the configured one)}
        {--branch= : Branch name (defaults to the first branch)}
        {--fresh-refs= : Suffix for the receipt references, to post another round deliberately}
        {--dry-run : Show what would be received and write nothing}';

    protected $description = 'Post fake but realistic supplier receipts, prices and reorder points so a dev kitchen can be simulated.';

    public function handle(GoodsReceiptService $receipts, WeeklyPricePublisher $publisher, StockItemDerivationService $derivation): int
    {
        if ($this->refusesThisEnvironment('kitchen:simulate-stock')) {
            return self::FAILURE;
        }

        $organisation = $this->resolveOrganisation();

        if ($organisation === null) {
            return self::FAILURE;
        }

        /** @var array{currency: string, not_bought: list<string>, fallback_by_category: array<string, array{0: float, 1: float}>, items: array<string, array{0: float, 1: float}>} $data */
        $data = json_decode((string) file_get_contents(__DIR__.'/../../database/data/simulation-prices.json'), true, 512, JSON_THROW_ON_ERROR);
        $currency = (string) ($organisation->default_currency_code ?? $data['currency']);

        if ($currency !== $data['currency']) {
            $this->components->warn(sprintf('Prices are written in %s but the kitchen trades in %s; the numbers are used as-is.', $data['currency'], $currency));
        }

        /** @var int $exit */
        $exit = $this->insideOrganisation($organisation, function (string $organisationId) use ($organisation, $data, $currency, $receipts, $publisher, $derivation): int {
            $branch = $this->branch($organisationId);
            $actorId = OrganisationMembership::withoutTenancy()->where('organisation_id', $organisationId)->value('user_id');

            if ($branch === null || $actorId === null) {
                $this->components->error('The kitchen needs a branch and at least one member to receive stock.');

                return self::FAILURE;
            }

            if (! $this->option('dry-run')) {
                $derivation->syncOrganisation($organisationId);
            }

            if ($this->option('dry-run')) {
                $this->components->warn('Dry run: library ingredients without a shelf yet are not listed; the live run derives them first.');
            }

            $plan = $this->plan($organisationId, $data);
            $this->report($plan);

            if ($this->option('dry-run')) {
                return self::SUCCESS;
            }

            // The receiving service audits a person; the kitchen's first member books the deliveries in.
            app(TenantContext::class)->setOrganisation((string) $actorId, $organisationId);

            $timezone = is_string($branch->timezone) ? $branch->timezone : 'UTC';
            $tuesday = static fn (int $weeksAgo): string => CarbonImmutable::now($timezone)
                ->subWeeks($weeksAgo)->startOfWeek()->addDay()->toDateString();
            $suffix = $this->stringOption('fresh-refs');
            $posted = 0;

            foreach (self::SUPPLIERS as $code => [$name]) {
                $rows = array_filter($plan, static fn (array $row): bool => $row['supplier'] === $code);

                if ($rows === []) {
                    continue;
                }

                $supplier = Supplier::withoutTenancy()->firstOrCreate(
                    ['organisation_id' => $organisationId, 'code' => $code],
                    ['name_en' => $name, 'currency_code' => $currency],
                );

                foreach ($rows as $row) {
                    $this->link($supplier, $row['item']);
                }

                // Two weeks ago at the lower price, last week at the higher one: a moving average
                // and two published weeks to compare.
                foreach ([2 => 'low', 1 => 'high'] as $weeksAgo => $price) {
                    $ref = sprintf('%s-W%d%s', $code, $weeksAgo, $suffix === null ? '' : '-'.$suffix);

                    if (GoodsReceipt::withoutTenancy()->where('organisation_id', $organisationId)->where('document_ref', $ref)->exists()) {
                        continue;
                    }

                    $receipts->post($organisationId, (string) $branch->getKey(), (string) $supplier->getKey(), $ref, null, array_values(array_map(
                        static fn (array $row): array => [
                            'stock_item_id' => (string) $row['item']->getKey(),
                            'quantity' => $row['half'],
                            'unit_id' => $row['item']->unit_id,
                            'unit_price_amount' => $row[$price],
                            'cost_currency_code' => $currency,
                        ],
                        $rows,
                    )), $tuesday($weeksAgo));
                    $posted++;
                }
            }

            foreach ($plan as $row) {
                $this->thresholds($branch, $row['item'], $row['threshold'], $row['par']);
            }

            $weeks = $publisher->publishDueWeeks($organisationId);

            $this->components->info(sprintf(
                '%s: %d receipts posted across %d shelves, %d weekly price lists published.',
                $organisation->slug,
                $posted,
                count($plan),
                count($weeks),
            ));

            return self::SUCCESS;
        });

        return $exit;
    }

    /**
     * One row per costable shelf: who supplies it, what it is received at, and where it should sit.
     *
     * @param  array{not_bought: list<string>, fallback_by_category: array<string, array{0: float, 1: float}>, items: array<string, array{0: float, 1: float}>}  $data
     * @return list<array{item: StockItem, slug: string, supplier: string, low: numeric-string, high: numeric-string, half: numeric-string, threshold: numeric-string, par: numeric-string, short: bool, guessed: bool, unit: string}>
     */
    private function plan(string $organisationId, array $data): array
    {
        $units = MeasurementUnit::query()->get()->keyBy('id');
        $canonical = $units->filter(static fn (MeasurementUnit $u): bool => in_array($u->code, ['kg', 'l'], true))->keyBy('dimension');

        $items = StockItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereNotNull('ingredient_id')
            ->whereNotNull('unit_id')
            ->orderBy('code')
            ->get();

        $ingredients = Ingredient::withoutTenancy()->whereIn('id', $items->pluck('ingredient_id'))->get()->keyBy('id');
        $products = CatalogueItem::withoutTenancy()->whereIn('id', $items->pluck('catalogue_item_id')->filter())->get()->keyBy('id');
        $categories = IngredientCategory::withoutTenancy()->pluck('code', 'id');
        $madeHere = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('production_mode', ProductionMode::Production)
            ->whereNotNull('ingredient_id')
            ->pluck('ingredient_id')
            ->flip();

        $plan = [];

        foreach ($items as $item) {
            $ingredient = $ingredients[$item->ingredient_id] ?? null;
            $product = $item->catalogue_item_id === null ? null : ($products[$item->catalogue_item_id] ?? null);
            $unit = $units[$item->unit_id] ?? null;

            $slug = (string) ($product->slug ?? $ingredient?->slug);

            if ($ingredient === null || $unit === null || isset($madeHere[$ingredient->getKey()]) || in_array($slug, $data['not_bought'], true)) {
                continue;
            }

            $category = (string) ($categories[$ingredient->ingredient_category_id] ?? ($product !== null ? 'product' : '*'));
            $guessed = ! isset($data['items'][$slug]);
            [$price, $onHand] = $data['items'][$slug]
                ?? $data['fallback_by_category'][$category]
                ?? $data['fallback_by_category']['*'];

            // The file prices per kg / l; a shelf counted in g or ml takes the same money per its own unit.
            $scale = isset($canonical[$unit->dimension]) ? (float) $unit->base_ratio / (float) $canonical[$unit->dimension]->base_ratio : 1.0;
            $price *= $scale;
            $onHand /= $scale;

            // Deterministic per shelf, so a dry run and the real run agree: ±5% around the list
            // price, and one shelf in eight received short of its reorder point.
            $hash = crc32($slug);
            $drift = 0.95 + ($hash % 50) / 1000;
            $short = $hash % 8 === 0;
            $received = $short ? $onHand * 0.2 : $onHand;
            $countable = in_array($unit->dimension, ['count', 'package'], true);

            $plan[] = [
                'item' => $item,
                'slug' => $slug,
                'supplier' => $this->supplierFor($slug, $product !== null ? 'product' : $category),
                'low' => $this->money($price * $drift),
                'high' => $this->money($price * ($drift + 0.06)),
                'half' => $this->quantity($received / 2, $countable),
                'threshold' => $this->quantity($onHand * 0.3, $countable),
                'par' => $this->quantity($onHand, $countable),
                'short' => $short,
                'guessed' => $guessed,
                'unit' => $unit->code,
            ];
        }

        return $plan;
    }

    private function supplierFor(string $slug, string $category): string
    {
        if (in_array($slug, self::FRESH_HERBS, true)) {
            return 'SIM-FRESH';
        }

        foreach (self::SUPPLIERS as $code => [, $categories]) {
            if (in_array($category, $categories, true)) {
                return $code;
            }
        }

        return 'SIM-DRY';
    }

    /**
     * @param  list<array{item: StockItem, slug: string, supplier: string, low: numeric-string, high: numeric-string, half: numeric-string, threshold: numeric-string, par: numeric-string, short: bool, guessed: bool, unit: string}>  $plan
     */
    private function report(array $plan): void
    {
        $this->table(
            ['Shelf', 'Supplier', 'Unit', 'Price W-2', 'Price W-1', 'On hand', 'Reorder at', 'Note'],
            array_map(static fn (array $row): array => [
                $row['slug'],
                $row['supplier'],
                $row['unit'],
                $row['low'],
                $row['high'],
                bcmul($row['half'], '2', 3),
                $row['threshold'],
                trim(($row['short'] ? 'LOW ' : '').($row['guessed'] ? 'category default' : '')),
            ], $plan),
        );
    }

    private function link(Supplier $supplier, StockItem $item): void
    {
        $hasPreferred = SupplierStockItem::withoutTenancy()->where('stock_item_id', $item->getKey())->where('is_preferred', true)->exists();

        SupplierStockItem::withoutTenancy()->firstOrCreate(
            ['supplier_id' => $supplier->getKey(), 'stock_item_id' => $item->getKey()],
            ['organisation_id' => $supplier->organisation_id, 'is_preferred' => ! $hasPreferred],
        );
    }

    /** Filled only where empty, so a threshold somebody tuned survives a re-run. */
    private function thresholds(OrganisationBranch $branch, StockItem $item, string $threshold, string $par): void
    {
        $level = StockLevel::withoutTenancy()
            ->where('branch_id', $branch->getKey())
            ->where('stock_item_id', $item->getKey())
            ->first();

        if ($level === null) {
            return;
        }

        $level->forceFill([
            'reorder_threshold' => $level->reorder_threshold ?? $threshold,
            'par_level' => $level->par_level ?? $par,
        ])->save();
    }

    private function branch(string $organisationId): ?OrganisationBranch
    {
        $name = $this->stringOption('branch');

        return OrganisationBranch::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->when($name !== null, static fn ($query) => $query->where('name', $name))
            ->orderBy('created_at')
            ->first();
    }

    /** @return numeric-string */
    private function money(float $amount): string
    {
        return number_format(max($amount, 0.000001), 6, '.', '');
    }

    /** @return numeric-string */
    private function quantity(float $amount, bool $countable): string
    {
        return $countable
            ? (string) max(1, (int) round($amount))
            : number_format(max($amount, 0.001), 3, '.', '');
    }
}
