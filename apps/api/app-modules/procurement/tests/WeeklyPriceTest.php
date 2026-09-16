<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Ingredients\Contracts\IngredientWeeklyPriceLookup;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Procurement\Enums\WeeklyPriceCarryReason;
use Healthy360\Procurement\Enums\WeeklyPriceSource;
use Healthy360\Procurement\Models\IngredientWeeklyPrice;
use Healthy360\Procurement\Models\WeeklyPricePublication;
use Healthy360\Procurement\Services\GoodsReceiptService;
use Healthy360\Procurement\Services\WeeklyPricePublisher;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| Weekly weighted-average purchase prices (PROD1)
|--------------------------------------------------------------------------
|
| The estimating basis: what an ingredient cost on average over one completed
| Monday–Sunday week, published on the Monday after it and used for recipe
| costing, technical sheets and production estimates.
|
| Four properties carry the whole feature and each is asserted below.
|
| 1. **The average is line subtotals over normalised quantity.** Header tax,
|    discount and delivery stay out of an ingredient's unit price — the rule §3.6
|    already states — and a week that bought by the kilo and by the bag averages
|    into one figure rather than two incomparable ones.
| 2. **A week that says nothing says *why*.** No purchases, two currencies, no
|    invoice yet, a unit that will not convert: four distinguishable answers, not
|    one null. Three of them are work somebody has to do.
| 3. **Nothing is ever fabricated.** An ingredient with no usable price gets a
|    row carrying no amount, and the lookup hands back nothing at all rather than
|    a zero. A free ingredient and an unknown one must never cost the same.
| 4. **Published prices do not move.** The tables are append-only, standing-ness
|    is derived, and a batch that pinned a publication reads that publication
|    however many Mondays pass afterwards.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('weekly@kitchen.test');
    $this->organisation = $this->tenant->organisation;

    // Beirut unless a test says otherwise: a launch-market clock two hours off
    // UTC, so a week boundary computed in the wrong zone shows up as a failure
    // rather than as a coincidence that passes.
    $this->organisation->timezone = 'Asia/Beirut';
    $this->organisation->save();

    $this->branch = OrganisationBranch::factory()->create([
        'organisation_id' => $this->organisation->getKey(),
        'country_code' => $this->organisation->country_code,
        'timezone' => 'Asia/Beirut',
    ]);

    app(TenantContext::class)->setOrganisation((string) $this->tenant->user->getKey(), (string) $this->organisation->getKey());

    $this->kg = MeasurementUnit::query()->where('code', 'kg')->sole();
    $this->g = MeasurementUnit::query()->where('code', 'g')->sole();
    $this->litre = MeasurementUnit::query()->where('code', 'l')->sole();
    $this->piece = MeasurementUnit::query()->where('code', 'piece')->sole();

    $this->publisher = app(WeeklyPricePublisher::class);

    // Monday 2026-08-31 → Sunday 2026-09-06 is "the week"; its prices take
    // effect on Monday 2026-09-07.
    $this->weekStart = CarbonImmutable::parse('2026-08-31');
    $this->effectiveFrom = '2026-09-07';
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

/** An ingredient stocked in the given unit, with a shelf to receive onto. */
function weeklyIngredient(string $code, MeasurementUnit $unit): array
{
    /** @var Ingredient $ingredient */
    $ingredient = Ingredient::factory()->create([
        'organisation_id' => test()->organisation->getKey(),
        'default_unit_id' => (string) $unit->getKey(),
    ]);

    /** @var StockItem $item */
    $item = StockItem::query()->create([
        'organisation_id' => test()->organisation->getKey(),
        'code' => $code,
        'name_en' => $code,
        'unit_code' => $unit->code,
        'unit_id' => (string) $unit->getKey(),
        'ingredient_id' => (string) $ingredient->getKey(),
    ]);

    return [$ingredient, $item];
}

/**
 * A real delivery through the real posting service — never a raw row, so the
 * purchase ledger and the stock movements cannot disagree with each other.
 *
 * @param  list<array<string, mixed>>  $lines
 * @param  array<string, string>  $charges
 */
function weeklyReceipt(array $lines, string $receivedOn, array $charges = []): void
{
    app(GoodsReceiptService::class)->post(
        (string) test()->organisation->getKey(),
        (string) test()->branch->getKey(),
        null,
        null,
        null,
        $lines,
        $receivedOn,
        null,
        null,
        $charges,
    );
}

it('averages a week of purchases into total cost over total quantity', function (): void {
    [$ingredient, $item] = weeklyIngredient('FLR', $this->kg);

    // 10 kg at 2.00 and 30 kg at 3.00 → 80.00 over 40 kg → 2.00.
    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '2.00', 'cost_currency_code' => 'USD']], '2026-09-01');
    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '30', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '3.00', 'cost_currency_code' => 'USD']], '2026-09-04');

    $publication = $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart);

    expect($publication)->toBeInstanceOf(WeeklyPricePublication::class)
        ->and($publication->computed_count)->toBe(1);

    $price = IngredientWeeklyPrice::withoutTenancy()->where('ingredient_id', $ingredient->getKey())->sole();

    expect($price->source)->toBe(WeeklyPriceSource::Computed)
        ->and((string) $price->average_unit_amount)->toBe('2.750000')
        ->and((string) $price->total_quantity)->toBe('40.000000')
        ->and((string) $price->total_cost_amount)->toBe('110.000000')
        ->and($price->currency_code)->toBe('USD')
        ->and($price->unit_id)->toBe((string) $this->kg->getKey())
        ->and($price->effective_from_date->toDateString())->toBe($this->effectiveFrom);
});

it('normalises a mixed-unit week into the ingredient unit before averaging', function (): void {
    [$ingredient, $item] = weeklyIngredient('FLR', $this->kg);

    // 10 kg at 2.00 = 20.00, then 5000 g at 0.0025 = 12.50 for 5 kg.
    // (20.00 + 12.50) ÷ 15 kg = 2.166667 per kg.
    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '2.00', 'cost_currency_code' => 'USD']], '2026-09-01');
    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '5000', 'unit_id' => (string) $this->g->getKey(), 'unit_price_amount' => '0.0025', 'cost_currency_code' => 'USD']], '2026-09-02');

    $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart);

    $price = IngredientWeeklyPrice::withoutTenancy()->where('ingredient_id', $ingredient->getKey())->sole();

    expect((string) $price->total_quantity)->toBe('15.000000')
        ->and((string) $price->total_cost_amount)->toBe('32.500000')
        ->and((string) $price->average_unit_amount)->toBe('2.166667');
});

it('keeps header tax, discount and delivery out of the unit price', function (): void {
    [$ingredient, $item] = weeklyIngredient('FLR', $this->kg);

    weeklyReceipt(
        [['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '2.00', 'cost_currency_code' => 'USD']],
        '2026-09-01',
        ['discount_amount' => '1.00', 'tax_amount' => '3.00', 'delivery_amount' => '5.00'],
    );

    $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart);

    // 20.00 ÷ 10 kg. Not 27.00, and not 19.00: a delivery fee is not what a
    // kilogram of flour costs, and the charges are reported by the spend summary
    // in their own named columns.
    expect((string) IngredientWeeklyPrice::withoutTenancy()->where('ingredient_id', $ingredient->getKey())->sole()->average_unit_amount)
        ->toBe('2.000000');
});

it('averages the priced lines only, and flags the week as provisional', function (): void {
    [$ingredient, $item] = weeklyIngredient('FLR', $this->kg);

    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '2.00', 'cost_currency_code' => 'USD']], '2026-09-01');
    // The invoice has not arrived for this one. It contributes quantity history
    // and no money — averaging it in would understate the price by exactly the
    // delivery nobody has been billed for yet.
    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '90', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => null, 'cost_currency_code' => null]], '2026-09-02');

    $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart);

    $price = IngredientWeeklyPrice::withoutTenancy()->where('ingredient_id', $ingredient->getKey())->sole();

    expect((string) $price->average_unit_amount)->toBe('2.000000')
        ->and((string) $price->total_quantity)->toBe('10.000000')
        ->and($price->unpriced_line_count)->toBe(1)
        ->and($price->has_unpriced_lines)->toBeTrue();
});

it('carries last week forward when two currencies make the week unaverageable', function (): void {
    [$ingredient, $item] = weeklyIngredient('FLR', $this->kg);

    // Week one prices cleanly.
    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '2.00', 'cost_currency_code' => 'USD']], '2026-08-25');
    $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart->subWeek());

    // Week two buys the same thing in two currencies. There is no exchange rate
    // in this system and this is not the place to invent one.
    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '3.00', 'cost_currency_code' => 'USD']], '2026-09-01');
    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '4.00', 'cost_currency_code' => 'EUR']], '2026-09-02');

    $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart);

    $carried = IngredientWeeklyPrice::withoutTenancy()
        ->where('ingredient_id', $ingredient->getKey())
        ->where('purchase_week_start_date', $this->weekStart->toDateString())
        ->sole();

    expect($carried->source)->toBe(WeeklyPriceSource::CarriedForward)
        ->and($carried->carry_reason)->toBe(WeeklyPriceCarryReason::MixedCurrency)
        ->and((string) $carried->average_unit_amount)->toBe('2.000000')
        ->and($carried->carried_from_week_start_date->toDateString())->toBe($this->weekStart->subWeek()->toDateString())
        // The carried row states no purchases of its own: the denominator and
        // numerator belong to the week that computed the figure.
        ->and($carried->total_quantity)->toBeNull();
});

it('carries forward when every line in the week is still unpriced', function (): void {
    [$ingredient, $item] = weeklyIngredient('FLR', $this->kg);

    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '2.00', 'cost_currency_code' => 'USD']], '2026-08-25');
    $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart->subWeek());

    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '40', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => null, 'cost_currency_code' => null]], '2026-09-01');

    $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart);

    $carried = IngredientWeeklyPrice::withoutTenancy()
        ->where('ingredient_id', $ingredient->getKey())
        ->where('purchase_week_start_date', $this->weekStart->toDateString())
        ->sole();

    expect($carried->source)->toBe(WeeklyPriceSource::CarriedForward)
        ->and($carried->carry_reason)->toBe(WeeklyPriceCarryReason::AllLinesUnpriced);
});

it('publishes an unpriced row when a week says nothing and there is nothing to carry', function (): void {
    [$ingredient, $item] = weeklyIngredient('FLR', $this->kg);

    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => null, 'cost_currency_code' => null]], '2026-09-01');

    $publication = $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart);

    $row = IngredientWeeklyPrice::withoutTenancy()->where('ingredient_id', $ingredient->getKey())->sole();

    expect($publication->unpriced_count)->toBe(1)
        ->and($row->source)->toBe(WeeklyPriceSource::Unpriced)
        // Never zero. A free ingredient and an unknown one must not cost a
        // recipe the same thing.
        ->and($row->average_unit_amount)->toBeNull()
        ->and($row->currency_code)->toBeNull()
        ->and($row->unit_id)->toBeNull();
});

it('restates a carried price when the ingredient unit moves to a convertible one', function (): void {
    [$ingredient, $item] = weeklyIngredient('FLR', $this->kg);

    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '2.00', 'cost_currency_code' => 'USD']], '2026-08-25');
    $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart->subWeek());

    // The library re-denominates the ingredient into grams. A price *per unit*
    // moves the opposite way to a quantity: 2.00 per kg is 0.002 per g.
    $ingredient->default_unit_id = (string) $this->g->getKey();
    $ingredient->save();

    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '5', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => null, 'cost_currency_code' => null]], '2026-09-01');
    $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart);

    $carried = IngredientWeeklyPrice::withoutTenancy()
        ->where('ingredient_id', $ingredient->getKey())
        ->where('purchase_week_start_date', $this->weekStart->toDateString())
        ->sole();

    expect($carried->source)->toBe(WeeklyPriceSource::CarriedForward)
        ->and((string) $carried->average_unit_amount)->toBe('0.002000')
        ->and($carried->unit_id)->toBe((string) $this->g->getKey());
});

it('refuses to carry a price across a unit change it cannot convert', function (): void {
    [$ingredient, $item] = weeklyIngredient('FLR', $this->kg);

    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '2.00', 'cost_currency_code' => 'USD']], '2026-08-25');
    $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart->subWeek());

    // Kilograms to pieces. Carrying 2.00 across would be wrong by whatever a
    // piece weighs, which nothing here knows.
    $ingredient->default_unit_id = (string) $this->piece->getKey();
    $ingredient->save();

    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '5', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => null, 'cost_currency_code' => null]], '2026-09-01');
    $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart);

    $row = IngredientWeeklyPrice::withoutTenancy()
        ->where('ingredient_id', $ingredient->getKey())
        ->where('purchase_week_start_date', $this->weekStart->toDateString())
        ->sole();

    expect($row->source)->toBe(WeeklyPriceSource::Unpriced)
        ->and($row->carry_reason)->toBe(WeeklyPriceCarryReason::NotConvertible)
        ->and($row->average_unit_amount)->toBeNull();
});

it('leaves an ingredient nobody bought on its most recent price, with its own effective date', function (): void {
    [$ingredient, $item] = weeklyIngredient('FLR', $this->kg);

    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '2.00', 'cost_currency_code' => 'USD']], '2026-08-25');
    $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart->subWeek());

    // Nothing bought the following week. No row is written for it — the standing
    // price is simply still last week's, and it says so through its own date.
    $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart);

    $standing = app(IngredientWeeklyPriceLookup::class)->standing((string) $this->organisation->getKey(), (string) $ingredient->getKey());

    expect($standing)->not->toBeNull()
        ->and($standing->amount)->toBe('2.000000')
        ->and($standing->effectiveFrom)->toBe('2026-08-31')
        ->and($standing->source)->toBe('computed')
        ->and(IngredientWeeklyPrice::withoutTenancy()->count())->toBe(1);
});

it('hands back nothing at all for an ingredient with no usable price', function (): void {
    [$ingredient, $item] = weeklyIngredient('FLR', $this->kg);

    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => null, 'cost_currency_code' => null]], '2026-09-01');
    $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart);

    $lookup = app(IngredientWeeklyPriceLookup::class);

    // The unpriced row exists as evidence — it is what the initial-price-entry
    // list reads — and it never leaves the lookup as a price.
    expect(IngredientWeeklyPrice::withoutTenancy()->count())->toBe(1)
        ->and($lookup->standing((string) $this->organisation->getKey(), (string) $ingredient->getKey()))->toBeNull()
        ->and($lookup->standingFor((string) $this->organisation->getKey(), [(string) $ingredient->getKey()]))->toBe([]);
});

it('publishes every overdue week oldest first after an outage', function (): void {
    [$ingredient, $item] = weeklyIngredient('FLR', $this->kg);

    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '2.00', 'cost_currency_code' => 'USD']], '2026-08-25');
    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '4.00', 'cost_currency_code' => 'USD']], '2026-09-01');

    // Monday 2026-09-14 in Beirut: both the 24th and the 31st are completed
    // weeks and neither was published, because nobody was running.
    $published = $this->publisher->publishDueWeeks(
        (string) $this->organisation->getKey(),
        CarbonImmutable::parse('2026-09-14 06:00:00', 'Asia/Beirut')->utc(),
    );

    expect($published)->toHaveCount(2)
        ->and($published[0]->purchase_week_start_date->toDateString())->toBe('2026-08-24')
        ->and($published[1]->purchase_week_start_date->toDateString())->toBe('2026-08-31');

    // Oldest-first matters: the later week must win the standing price, and it
    // only does if it was written after the earlier one.
    expect(app(IngredientWeeklyPriceLookup::class)
        ->standing((string) $this->organisation->getKey(), (string) $ingredient->getKey())->amount)
        ->toBe('4.000000');
});

it('is idempotent: a second run publishes nothing', function (): void {
    [, $item] = weeklyIngredient('FLR', $this->kg);

    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '2.00', 'cost_currency_code' => 'USD']], '2026-09-01');

    $now = CarbonImmutable::parse('2026-09-07 06:00:00', 'Asia/Beirut')->utc();

    expect($this->publisher->publishDueWeeks((string) $this->organisation->getKey(), $now))->toHaveCount(1)
        ->and($this->publisher->publishDueWeeks((string) $this->organisation->getKey(), $now))->toHaveCount(0)
        ->and(WeeklyPricePublication::withoutTenancy()->count())->toBe(1);
});

it('reads the week boundary in the organisation clock, not the server one', function (): void {
    [$ingredient, $item] = weeklyIngredient('FLR', $this->kg);

    // Sunday 2026-09-06 is the last day of the week in Beirut. A delivery
    // received on it belongs to that week; the following Monday does not.
    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '2.00', 'cost_currency_code' => 'USD']], '2026-09-06');
    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '9.00', 'cost_currency_code' => 'USD']], '2026-09-07');

    $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart);

    $price = IngredientWeeklyPrice::withoutTenancy()
        ->where('ingredient_id', $ingredient->getKey())
        ->where('purchase_week_start_date', $this->weekStart->toDateString())
        ->sole();

    // 2.00, not 5.50: the Monday delivery is next week's business.
    expect((string) $price->average_unit_amount)->toBe('2.000000')
        ->and((string) $price->total_quantity)->toBe('10.000000');
});

it('pins a publication so a later one cannot move what it said', function (): void {
    [$ingredient, $item] = weeklyIngredient('FLR', $this->kg);

    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '2.00', 'cost_currency_code' => 'USD']], '2026-08-25');
    $first = $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart->subWeek());

    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '8.00', 'cost_currency_code' => 'USD']], '2026-09-01');
    $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart);

    $lookup = app(IngredientWeeklyPriceLookup::class);
    $ids = [(string) $ingredient->getKey()];

    expect($lookup->standing((string) $this->organisation->getKey(), $ids[0])->amount)->toBe('8.000000')
        ->and($lookup->atPublication((string) $this->organisation->getKey(), (string) $first->getKey(), $ids)[$ids[0]]->amount)->toBe('2.000000');
});

it('writes a publication with one insert and never updates it', function (): void {
    [, $item] = weeklyIngredient('FLR', $this->kg);

    weeklyReceipt([['stock_item_id' => (string) $item->getKey(), 'quantity' => '10', 'unit_id' => (string) $this->kg->getKey(), 'unit_price_amount' => '2.00', 'cost_currency_code' => 'USD']], '2026-09-01');

    DB::flushQueryLog();
    DB::enableQueryLog();

    $publication = $this->publisher->publishWeek((string) $this->organisation->getKey(), $this->weekStart);

    $statements = array_map(
        static fn (array $entry): string => mb_strtolower((string) $entry['query']),
        DB::getQueryLog(),
    );

    DB::disableQueryLog();

    $updates = array_values(array_filter(
        $statements,
        static fn (string $sql): bool => str_starts_with($sql, 'update') && str_contains($sql, 'weekly_price_publications'),
    ));

    // The counts are known before the header is written, so the header is an
    // INSERT and nothing else. This is not a style preference: both weekly-price
    // tables are append-only at the grant level, so the runtime role may insert a
    // publication and may never update one. The test suite connects as the
    // migrator, which owns the tables and is therefore exempt from its own
    // REVOKE — so an UPDATE here would pass every test and fail in production,
    // which is exactly the failure this assertion exists to make visible.
    expect($updates)->toBe([])
        ->and($publication->computed_count)->toBe(1)
        ->and($publication->ingredient_count)->toBe(1);
});
