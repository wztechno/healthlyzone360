<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| The two requirement endpoints
|--------------------------------------------------------------------------
|
| `RequirementForecastTest` proves the arithmetic. What is proved here is the
| pair of policies that live on the routes and nowhere else:
|
|  1. **The list refuses without a branch.** It is the one order-desk endpoint
|     that does, because half its response is `available` and there is no honest
|     organisation-wide value for that.
|  2. **The badge does not refuse.** It answers `null`, so a hub tile belonging
|     to a manager who holds no branch renders nothing rather than an error — or,
|     worse, a reassuring zero.
|
| Plus the window cap, which is thirty-one days rather than the calendar's sixty
| because a buy list beyond a month is speculation.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-07 09:00:00'));

    $this->world = CheckoutWorld::build('requirements@kitchen.test');
    $this->organisationId = (string) $this->world->organisation->getKey();
    $this->branchId = (string) $this->world->branch->getKey();

    $this->actingAs($this->world->tenant->user);
    $this->headers = PricingWorld::headers($this->world->tenant);

    $kg = MeasurementUnit::query()->where('code', 'kg')->sole();

    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $this->organisationId,
        'default_unit_id' => (string) $kg->getKey(),
    ]);

    StockItem::withoutTenancy()->where('ingredient_id', (string) $ingredient->getKey())->delete();

    $this->shelf = StockItem::withoutTenancy()->create([
        'organisation_id' => $this->organisationId,
        'code' => 'sku-flour',
        'name_en' => 'Flour',
        'unit_code' => $kg->code,
        'unit_id' => (string) $kg->getKey(),
        'ingredient_id' => (string) $ingredient->getKey(),
    ]);

    $recipe = Recipe::factory()->create(['organisation_id' => $this->organisationId]);
    $version = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $this->organisationId,
        'yield_piece_count' => 1,
        'waste_coefficient_percent' => '0.00',
    ]);
    RecipeVersionLine::factory()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $this->organisationId,
        'line_number' => 1,
        'ingredient_id' => (string) $ingredient->getKey(),
        'quantity' => '5',
        'unit_id' => (string) $kg->getKey(),
    ]);

    $this->pie = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->world->tenant->catalogue->getKey(),
        'organisation_id' => $this->organisationId,
        'recipe_id' => $recipe->getKey(),
        'status' => CatalogueItemStatus::Published,
    ]);

    /** An order for a date, wanting `$quantity` pies. */
    $this->order = function (string $date, string $quantity): Order {
        $order = Order::factory()->create([
            'organisation_id' => $this->organisationId,
            'customer_account_id' => $this->world->customer->account->getKey(),
            'sales_channel_id' => $this->world->channel->getKey(),
            'branch_id' => $this->branchId,
            'requested_delivery_date' => $date,
        ]);

        OrderLine::factory()->create([
            'order_id' => $order->getKey(),
            'catalogue_item_id' => $this->pie->getKey(),
            'quantity' => $quantity,
        ]);

        return $order;
    };

    /** What the branch holds of the one shelf. */
    $this->stock = fn (string $quantity): StockLevel => StockLevel::withoutTenancy()->create([
        'organisation_id' => $this->organisationId,
        'branch_id' => $this->branchId,
        'stock_item_id' => (string) $this->shelf->getKey(),
        'quantity' => $quantity,
    ]);
});

afterEach(function (): void {
    CarbonImmutable::setTestNow();
    app(TenantContext::class)->clear();
});

it('serves the buy list for a branch, with the holes kept apart from the numbers', function (): void {
    ($this->stock)('2.0000');
    ($this->order)('2026-09-10', '2.0000');

    $this->getJson('/api/v1/catalogue/order-desk/requirements?from=2026-09-07&to=2026-09-13&branch_id='.$this->branchId, $this->headers)
        ->assertOk()
        ->assertJsonPath('data.requirements.0.code', 'sku-flour')
        ->assertJsonPath('data.requirements.0.required', '10.000000')
        ->assertJsonPath('data.requirements.0.available', '2.0000')
        ->assertJsonPath('data.requirements.0.short', '8.0000')
        ->assertJsonPath('data.requirements.0.suggested_buy', '8.0000')
        ->assertJsonPath('data.requirements.0.unit_code', 'kg')
        ->assertJsonPath('data.not_computable.days', 0)
        ->assertJsonPath('meta.branch_id', $this->branchId)
        ->assertJsonPath('meta.from', '2026-09-07')
        ->assertJsonPath('meta.to', '2026-09-13')
        ->assertJsonPath('meta.max_window_days', 31);
});

it('refuses a buy list with no branch, because there is no organisation-wide shelf', function (): void {
    $this->getJson('/api/v1/catalogue/order-desk/requirements?from=2026-09-07&to=2026-09-13', $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['branch_id']]]]);
});

it('refuses a window longer than a month, naming the field a client already reads', function (): void {
    $this->getJson('/api/v1/catalogue/order-desk/requirements?from=2026-09-01&to=2026-10-02&branch_id='.$this->branchId, $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['to']]]]);

    // Thirty-one days counted inclusively answers; thirty-two does not.
    $this->getJson('/api/v1/catalogue/order-desk/requirements?from=2026-09-01&to=2026-10-01&branch_id='.$this->branchId, $this->headers)
        ->assertOk();
});

it('answers the badge with null when nobody has chosen a branch', function (): void {
    ($this->stock)('0.0000');
    ($this->order)('2026-09-08', '2.0000');

    // A shortfall exists — and the badge still says nothing, because without a
    // branch it does not know whose shelf it would be short from. `null`, never
    // a zero: zero shortfalls is good news and not knowing is not news at all.
    $this->getJson('/api/v1/catalogue/order-desk/requirements/shortfall-count', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.shortfall_count', null)
        ->assertJsonPath('data.branch_id', null);
});

it('counts only the ingredients the next seven days are actually short of', function (): void {
    ($this->stock)('4.0000');

    // Inside the badge's window and short: 5 kg needed against 4 kg held.
    ($this->order)('2026-09-09', '1.0000');

    $this->getJson('/api/v1/catalogue/order-desk/requirements/shortfall-count?branch_id='.$this->branchId, $this->headers)
        ->assertOk()
        ->assertJsonPath('data.shortfall_count', 1)
        ->assertJsonPath('data.branch_id', $this->branchId)
        ->assertJsonPath('meta.window_days', 7)
        ->assertJsonPath('meta.from', '2026-09-07')
        ->assertJsonPath('meta.to', '2026-09-13');
});

it('does not light the badge for a requirement the shelf covers', function (): void {
    ($this->stock)('50.0000');
    ($this->order)('2026-09-09', '1.0000');

    $this->getJson('/api/v1/catalogue/order-desk/requirements/shortfall-count?branch_id='.$this->branchId, $this->headers)
        ->assertOk()
        ->assertJsonPath('data.shortfall_count', 0);
});

it('looks seven days ahead and no further, whatever the list endpoint was asked', function (): void {
    ($this->stock)('0.0000');

    // A fortnight out: real demand, real shortfall, and outside the badge's
    // fixed window — which is fixed precisely so two people looking at the same
    // hub cannot disagree about how bad things are.
    ($this->order)('2026-09-21', '2.0000');

    $this->getJson('/api/v1/catalogue/order-desk/requirements/shortfall-count?branch_id='.$this->branchId, $this->headers)
        ->assertOk()
        ->assertJsonPath('data.shortfall_count', 0);

    $this->getJson('/api/v1/catalogue/order-desk/requirements?from=2026-09-21&to=2026-09-21&branch_id='.$this->branchId, $this->headers)
        ->assertOk()
        ->assertJsonPath('data.requirements.0.short', '10.0000');
});
