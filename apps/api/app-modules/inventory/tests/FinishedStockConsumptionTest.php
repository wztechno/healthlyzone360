<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Database\Factories\CatalogueFactory;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\ProductionMode;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Inventory\Models\OrderConsumptionException;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Orders\Services\OrderLifecycle;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| Selling what the kitchen made in advance (PROD1)
|--------------------------------------------------------------------------
|
| Two kinds of sale, one predicate. A thing cooked when ordered explodes its
| recipe and takes the raw materials now; a thing cooked earlier took them then,
| so selling it draws its own shelf and exploding it would take them twice.
|
| The shape of that shelf is the whole difficulty. A frozen meal counted in
| pieces is one piece a sale, and the arithmetic that has always been here is
| right. A 350 g tray against a shelf counted in kilograms is `0.35`, and
| `portion_factor` — which is dimensionless, "how much of a yield piece" —
| cannot say so. Where nothing says so, this refuses rather than deducting `1`
| and taking a kilogram of lasagne for one portion of it.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('finished@kitchen.test');
    $this->organisation = $this->tenant->organisation;
    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'country_code' => $this->organisation->country_code,
    ]);

    app(TenantContext::class)->setOrganisation(
        (string) $this->tenant->user->getKey(),
        (string) $this->organisation->getKey(),
    );

    $this->inventory = app(InventoryService::class);
    $this->lifecycle = app(OrderLifecycle::class);

    $this->kg = MeasurementUnit::query()->where('code', 'kg')->sole();
    $this->g = MeasurementUnit::query()->where('code', 'g')->sole();
    $this->piece = MeasurementUnit::query()->where('code', 'piece')->sole();
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

/**
 * A sellable backed by finished stock on a shelf counted in `$stockUnit`.
 *
 * Returns the shelf beside the item. Looking one up by `ingredient_id` afterwards
 * would be ambiguous: stock derivation mints its own row for every ingredient, so
 * two shelves legitimately share one — which is the arrangement
 * `OrderConsumptionService::resolveStockItem()` was written for.
 *
 * @param  array<string, mixed>  $attributes
 * @return array{0: CatalogueItem, 1: StockItem}
 */
function finishedStockItem(object $test, MeasurementUnit $stockUnit, string $onShelf, array $attributes = []): array
{
    $stock = stockedIngredient($test, $stockUnit, '4.000000', $onShelf, $onShelf);

    $catalogue = CatalogueFactory::new()->create(['organisation_id' => $test->organisation->getKey()]);

    /** @var CatalogueItem $item */
    $item = CatalogueItem::factory()->create([
        'catalogue_id' => $catalogue->getKey(),
        'organisation_id' => $test->organisation->getKey(),
        'ingredient_id' => $stock->ingredient_id,
        'status' => CatalogueItemStatus::Published,
        'item_type' => CatalogueItemType::FrozenMeal,
        'production_mode' => ProductionMode::Production,
    ] + $attributes);

    return [$item, $stock];
}

it('deducts 0.35 kg for one 350 g pack', function (): void {
    // The assertion the whole net-content column exists for. `portion_factor`
    // cannot express this: it is dimensionless, so a 350 there would read as 350
    // *pieces* and take 350 kg off the shelf.
    [$item, $stockItem] = finishedStockItem($this, $this->kg, '10', [
        'net_content_quantity' => '350',
        'net_content_unit_id' => (string) $this->g->getKey(),
    ]);

    $order = orderFor($this, $item, '1');
    $this->lifecycle->confirm($order, $order->lock_version);

    expect(StockLevel::withoutTenancy()->where('stock_item_id', $stockItem->getKey())->value('quantity'))
        ->toBe('9.6500');
});

it('scales the net content by the number sold', function (): void {
    [$item, $stockItem] = finishedStockItem($this, $this->kg, '10', [
        'net_content_quantity' => '350',
        'net_content_unit_id' => (string) $this->g->getKey(),
    ]);

    $order = orderFor($this, $item, '4');
    $this->lifecycle->confirm($order, $order->lock_version);

    expect(StockLevel::withoutTenancy()->where('stock_item_id', $stockItem->getKey())->value('quantity'))
        ->toBe('8.6000');
});

it('takes one piece a sale from a shelf that counts in pieces', function (): void {
    // No net content declared and none needed: the arithmetic this path has
    // always had, unchanged, which is why nothing already selling moves.
    [$item, $stockItem] = finishedStockItem($this, $this->piece, '40');

    $order = orderFor($this, $item, '5');
    $this->lifecycle->confirm($order, $order->lock_version);

    expect(StockLevel::withoutTenancy()->where('stock_item_id', $stockItem->getKey())->value('quantity'))
        ->toBe('35.0000');
});

it('refuses to guess how much a mass shelf loses when nothing says', function (): void {
    [$item, $stockItem] = finishedStockItem($this, $this->kg, '10');

    $order = orderFor($this, $item, '1');
    $this->lifecycle->confirm($order, $order->lock_version);

    // Deducting `1` here would have taken a kilogram for one portion — wrong by
    // three orders of magnitude and silent. The shelf is untouched and somebody
    // is told which item needs a net content.
    expect(StockLevel::withoutTenancy()->where('stock_item_id', $stockItem->getKey())->value('quantity'))->toBe('10.0000')
        ->and(OrderConsumptionException::withoutTenancy()->where('order_id', $order->getKey())->sole()->reason_code)
        ->toBe('no_net_content');
});

it('does not explode the recipe when the finished shelf is short', function (): void {
    [$item, $stockItem] = finishedStockItem($this, $this->piece, '2');

    $order = orderFor($this, $item, '5');
    $this->lifecycle->confirm($order, $order->lock_version);

    // A finished-goods shortage is a real shortage: the tray is not in the
    // freezer. Cooking one from raw ingredients is a decision for a person, not a
    // silent substitution by the consume path — so the shelf stands and the
    // exception queue carries it.
    expect(StockLevel::withoutTenancy()->where('stock_item_id', $stockItem->getKey())->value('quantity'))->toBe('2.0000')
        ->and(OrderConsumptionException::withoutTenancy()->where('order_id', $order->getKey())->sole()->reason_code)
        ->toBe('insufficient_stock');
});

it('leaves an ordinary meal exploding its recipe', function (): void {
    $flour = stockedIngredient($this, $this->kg, '2.000000', '50', '50');
    $meal = publishedMeal($this, 10, '0', [[$flour, '5', $this->kg]]);

    $order = orderFor($this, $meal, '2');
    $this->lifecycle->confirm($order, $order->lock_version);

    // The flag defaults false, so every meal already in the catalogue keeps the
    // behaviour it had: 5 kg over ten pieces is 0.5 a piece, twice is 1 kg.
    expect($meal->sellsFromFinishedStock())->toBeFalse()
        ->and(StockLevel::withoutTenancy()->where('stock_item_id', $flour->getKey())->value('quantity'))
        ->toBe('49.0000');
});

it('lets a meal made in advance sell from its own shelf instead', function (): void {
    $tray = stockedIngredient($this, $this->piece, '6.000000', '30', '30');
    $rawFlour = stockedIngredient($this, $this->kg, '2.000000', '50', '50');

    $meal = publishedMeal($this, 10, '0', [[$rawFlour, '5', $this->kg]]);
    $meal->ingredient_id = $tray->ingredient_id;
    $meal->sells_from_finished_stock = true;
    $meal->save();

    $order = orderFor($this, $meal, '3');
    $this->lifecycle->confirm($order, $order->lock_version);

    // The trays leave the freezer and the flour does not: it left the shelf when
    // the batch was cooked, and taking it again here is the double count the
    // whole predicate exists to prevent.
    expect(StockLevel::withoutTenancy()->where('stock_item_id', $tray->getKey())->value('quantity'))->toBe('27.0000')
        ->and(StockLevel::withoutTenancy()->where('stock_item_id', $rawFlour->getKey())->value('quantity'))->toBe('50.0000');
});

it('draws no packaging on a finished-stock sale', function (): void {
    // A batch's boxes left the shelf during production, beside its ingredients.
    // Drawing one again at the counter would be the packaging half of the same
    // double count.
    $boxes = stockedIngredient($this, $this->piece, '0.350000', '500', '500');
    [$item, $stockItem] = finishedStockItem($this, $this->piece, '20');

    $order = orderFor($this, $item, '4');
    $this->lifecycle->confirm($order, $order->lock_version);

    expect(StockLevel::withoutTenancy()->where('stock_item_id', $boxes->getKey())->value('quantity'))
        ->toBe('500.0000');
});
