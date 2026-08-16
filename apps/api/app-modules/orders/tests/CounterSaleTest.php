<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\OrderConsumptionException;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Orders\Models\OrderPaymentReceipt;
use Healthy360\Orders\Services\ComposedLine;
use Healthy360\Orders\Services\CounterSale;
use Healthy360\Orders\Services\CounterSaleDraft;
use Healthy360\Orders\Tests\Fixtures\DeskWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| The walk-in sale: four acts, one transaction
|--------------------------------------------------------------------------
|
| `OrderDeskPlacementTest` pins what the placement endpoint takes and refuses.
| This file is about what happens *after* it accepts a counter body: the order is
| placed, confirmed, receipted and fulfilled before the response is rendered, and
| the four either all happened or none of them did.
|
| Four properties are worth the file, and three of them are only visible from
| here:
|
| **The confirm is real.** It is easy to write a counter sale that ends up
| `fulfilled` and never takes anything off the shelf — one `UPDATE` would do it —
| and the row would look identical. So the sale is made in a kitchen that has an
| ingredient, a recipe and stock, and the assertion is the shelf, not the status.
|
| **The rollback is whole.** The one genuine risk of collapsing four acts into
| one transaction is a partial sale: an order confirmed and deducted whose fulfil
| failed, sitting in the book at a status nobody at the counter chose. So the last
| step is forced to fail and *nothing* is asserted to remain — no order, no lines,
| no movements, no receipt, and no audit rows, which is the one people expect to
| survive and which deliberately does not.
|
| **Insufficient stock does not roll it back**, which is the opposite of what the
| paragraph above suggests and is correct. `OrderConsumptionService::deduct()`
| catches a shortfall and records an `insufficient_stock` exception instead of
| throwing: the food has been cooked and handed over, and refusing the sale would
| not put the ingredients back. The sale completes, fulfilled, with a row for
| somebody to reconcile.
|
| **A replay answers rather than redoes.** The tail would otherwise run against an
| order that is already fulfilled and `confirm()` would throw `TransitionRejected`,
| so a double tap would be answered with a 409 about an illegal transition — the
| least useful available sentence for "you already sold this".
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = DeskWorld::build('counter-sale@kitchen.test');
    $this->agent = DeskWorld::agent($this->world, 'counter-agent@desk.test');
    $this->headers = DeskWorld::headers($this->world);

    // The stock deduction inside the confirm is an organisation-scoped
    // read-modify-write, so it needs a tenant resolved — `OrderConsumptionTest`
    // says the same thing for the same reason. Every HTTP request below resolves
    // its own through `org.context`; this is what makes the fixture writes and
    // the two direct service calls work outside one.
    app(TenantContext::class)->setOrganisation((string) $this->agent->getKey(), (string) $this->world->organisation->getKey());

    $this->kg = MeasurementUnit::query()->where('code', 'kg')->sole();

    $this->actingAs($this->agent);
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
});

/**
 * An ingredient this kitchen stocks, with the given quantity on the branch shelf
 * and a moving-average cost to value what comes off it.
 *
 * The shelf is **found**, not created. INV2.0 derives a stock item the instant a
 * kitchen declares an ingredient, so creating a second one here would leave the
 * deduction choosing between two rows for one ingredient and the test would be
 * asserting against whichever it happened to pick.
 *
 * The cost row is not decoration. Without it the deduction still happens and
 * still records an exception — `no_ingredient_cost`, "stock deducted but COGS
 * unvalued" — and a fixture that left it out would make "no exceptions" an
 * assertion this file could never make, which is the assertion that proves the
 * confirm resolved the whole line rather than half of it.
 *
 * @param  numeric-string  $onShelf  in the ingredient's own unit
 * @param  numeric-string  $averageCost  per unit, in the kitchen's currency
 */
function counterSaleShelf(object $test, string $onShelf, string $averageCost = '2.000000'): StockItem
{
    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $test->world->organisation->getKey(),
        'default_unit_id' => (string) $test->kg->getKey(),
    ]);

    $item = StockItem::withoutTenancy()->where('ingredient_id', $ingredient->getKey())->sole();

    IngredientStockCost::query()->create([
        'organisation_id' => $test->world->organisation->getKey(),
        'ingredient_id' => (string) $ingredient->getKey(),
        'unit_id' => (string) $test->kg->getKey(),
        'quantity_on_hand' => $onShelf,
        'moving_average_cost_amount' => $averageCost,
        'last_purchase_cost_amount' => $averageCost,
        'currency_code' => 'USD',
    ]);

    if (bccomp($onShelf, '0', 6) > 0) {
        app(InventoryService::class)->recordMovement(
            (string) $test->world->organisation->getKey(),
            (string) $test->world->branch->getKey(),
            (string) $item->getKey(),
            'receipt',
            $onShelf,
        );
    }

    return $item;
}

/**
 * Teach the world's meal a published recipe that eats the given quantity of the
 * shelf per sold unit.
 *
 * Yield of one and no waste, so the arithmetic the assertions rest on is
 * `order quantity × per-unit quantity` and nothing else — the explosion itself is
 * `OrderConsumptionTest`'s subject, not this file's.
 *
 * @param  numeric-string  $perUnit
 */
function counterSaleRecipe(object $test, StockItem $shelf, string $perUnit): void
{
    $organisationId = (string) $test->world->organisation->getKey();

    $recipe = Recipe::factory()->create(['organisation_id' => $organisationId]);

    $version = RecipeVersion::factory()->published()->create([
        'recipe_id' => $recipe->getKey(),
        'organisation_id' => $organisationId,
        'yield_piece_count' => 1,
        'waste_coefficient_percent' => '0.00',
    ]);

    RecipeVersionLine::factory()->create([
        'recipe_version_id' => $version->getKey(),
        'organisation_id' => $organisationId,
        'line_number' => 1,
        'ingredient_id' => $shelf->ingredient_id,
        'quantity' => $perUnit,
        'unit_id' => (string) $test->kg->getKey(),
    ]);

    $test->world->meal->recipe_id = (string) $recipe->getKey();
    $test->world->meal->save();
}

/**
 * A counter body for the world's meal at the world's branch.
 *
 * The branch is stated because the deduction needs one: `orders.branch_id` is
 * nullable and a counter sale with no branch produces a `no_branch` consumption
 * exception rather than a movement, which would make every stock assertion here
 * pass for the wrong reason.
 *
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function counterSaleBody(object $test, array $overrides = []): array
{
    return [
        'fulfilment_type' => 'counter',
        'payment_method' => 'cash_at_counter',
        'branch_id' => (string) $test->world->branch->getKey(),
        'lines' => [[
            'catalogue_item_id' => (string) $test->world->meal->getKey(),
            'quantity' => 2,
        ]],
        'payment' => ['method' => 'cash_at_counter'],
        ...$overrides,
    ];
}

/**
 * @return array<string, string>
 */
function counterSaleHeaders(object $test, string $key): array
{
    return $test->headers + ['Idempotency-Key' => $key];
}

/**
 * The draft the endpoint composes, for the two properties only reachable by
 * calling the service twice.
 */
function counterSaleDraft(object $test, string $key): CounterSaleDraft
{
    return new CounterSaleDraft(
        organisationId: (string) $test->world->organisation->getKey(),
        salesChannelId: (string) $test->world->desk->getKey(),
        branchId: (string) $test->world->branch->getKey(),
        currencyCode: 'USD',
        lines: [new ComposedLine(catalogueItemId: (string) $test->world->meal->getKey(), quantity: '2')],
        placedOnBehalfBy: (string) $test->agent->getKey(),
        paymentMethod: PaymentMethod::CashAtCounter,
        idempotencyKey: $key,
    );
}

/** @return numeric-string */
function counterSaleLevel(StockItem $item): string
{
    return (string) StockLevel::withoutTenancy()->where('stock_item_id', $item->getKey())->value('quantity');
}

it('places, confirms, receipts and fulfils one sale before the customer walks away', function (): void {
    $response = $this->postJson(
        '/api/v1/catalogue/order-desk/orders',
        counterSaleBody($this),
        counterSaleHeaders($this, 'counter-complete'),
    )->assertCreated();

    $order = Order::query()->sole();

    expect($response->json('data.order.status'))->toBe('fulfilled')
        // Two bumps, from the confirm and the fulfil. Nothing on this platform
        // moves an order's status without moving its validator.
        ->and($response->json('data.order.lock_version'))->toBe(2)
        ->and($order->status->value)->toBe('fulfilled')
        // Three separate moments rather than one overwritten column, which is
        // what makes "how long did the counter take" answerable at all.
        ->and($order->placed_at)->not->toBeNull()
        ->and($order->confirmed_at)->not->toBeNull()
        ->and($order->fulfilled_at)->not->toBeNull();

    $receipt = OrderPaymentReceipt::query()->sole();

    expect($receipt->order_id)->toBe((string) $order->getKey())
        // Exactly the total, because that is what the till took. There is no
        // field on the request that could have said otherwise.
        ->and($receipt->amount_minor)->toBe($order->total_minor)
        ->and($receipt->amount_minor)->toBe(5000)
        // The order's currency, never a request's.
        ->and($receipt->currency_code)->toBe($order->currency_code)
        ->and($receipt->method)->toBe(PaymentMethod::CashAtCounter)
        // The whole control on a counter receipt is that a named person
        // asserted it, and the desk agent is who that was.
        ->and($receipt->confirmed_by)->toBe((string) $this->agent->getKey())
        ->and($receipt->confirmed_at)->not->toBeNull();
});

it('takes the ingredients off the shelf at the confirm and leaves the whole trail behind', function (): void {
    // 10 kg on the shelf, half a kilo per meal, two meals sold: 9 kg left.
    $shelf = counterSaleShelf($this, '10');
    counterSaleRecipe($this, $shelf, '0.5');

    $this->postJson(
        '/api/v1/catalogue/order-desk/orders',
        counterSaleBody($this),
        counterSaleHeaders($this, 'counter-deducts'),
    )->assertCreated();

    $order = Order::query()->sole();

    $movements = StockMovement::withoutTenancy()
        ->where('reference_type', 'order')
        ->where('reference_id', (string) $order->getKey())
        ->where('reason', 'consume')
        ->get();

    expect($movements)->toHaveCount(1)
        ->and((string) $movements->sole()->quantity_delta)->toBe('-1.0000')
        // Valued as it went, at the moving average: 1 kg × 2.00.
        ->and((string) $movements->sole()->cost_amount)->toBe('2.000000')
        ->and(counterSaleLevel($shelf))->toBe('9.0000')
        // Nothing was guessed at or skipped on the way past.
        ->and(OrderConsumptionException::withoutTenancy()->count())->toBe(0);

    /** @var list<string> $actions */
    $actions = AuditLog::query()
        ->where('subject_type', 'order')
        ->where('subject_id', (string) $order->getKey())
        ->pluck('action')
        ->all();

    // All four, and all four committed with the sale rather than beside it:
    // `OrderLifecycle` records its events after its own transaction, which
    // nested inside this one is still inside this one.
    expect($actions)->toContain('order.placed')
        ->toContain('order.confirmed')
        ->toContain('order.payment_recorded')
        ->toContain('order.fulfilled');
});

it('rolls back the order, the stock and the trail when the last step fails', function (): void {
    $shelf = counterSaleShelf($this, '10');
    counterSaleRecipe($this, $shelf, '0.5');

    // The least invasive honest forcing available. `OrderLifecycle` is `final
    // readonly` so there is nothing to subclass or partially mock, and its
    // transition is a query-builder `update()` rather than a model save, so no
    // model event fires either. A connection hook refuses the one statement the
    // fulfil is made of — the only `update "orders"` in the chain that binds
    // `fulfilled` — which is as close to "the database went away mid-sale" as a
    // test can honestly get.
    DB::beforeExecuting(function (string $query, array $bindings): void {
        if (str_contains($query, 'update "orders"') && in_array('fulfilled', $bindings, true)) {
            throw new RuntimeException('The till caught fire between the receipt and the handover.');
        }
    });

    $this->postJson(
        '/api/v1/catalogue/order-desk/orders',
        counterSaleBody($this),
        counterSaleHeaders($this, 'counter-rollback'),
    )->assertStatus(500);

    expect(Order::query()->count())->toBe(0)
        ->and(OrderLine::query()->count())->toBe(0)
        ->and(OrderPaymentReceipt::query()->count())->toBe(0)
        // The shelf is untouched: the deduction happened inside the confirm,
        // inside this transaction, and went back with it.
        ->and(counterSaleLevel($shelf))->toBe('10.0000')
        ->and(StockMovement::withoutTenancy()->where('reason', 'consume')->count())->toBe(0)
        // The one people expect to survive, and the one that most needs not to.
        // An `order.confirmed` row naming an order that does not exist is a
        // trail that cannot be read back.
        ->and(AuditLog::query()->where('subject_type', 'order')->count())->toBe(0);
});

it('completes the sale and records the shortfall when the shelf is short', function (): void {
    // Two meals need a kilo and there are a hundred grams. The customer is
    // standing at the counter holding the food.
    $shelf = counterSaleShelf($this, '0.1');
    counterSaleRecipe($this, $shelf, '0.5');

    $response = $this->postJson(
        '/api/v1/catalogue/order-desk/orders',
        counterSaleBody($this),
        counterSaleHeaders($this, 'counter-short'),
    )->assertCreated();

    $order = Order::query()->sole();

    // The sale stands. `deduct()` catches the shortfall by design rather than
    // throwing, because refusing the order would not put the ingredients back —
    // and a counter sale that rolled back here would leave a customer who has
    // already eaten with no order and the kitchen with no receipt.
    expect($response->json('data.order.status'))->toBe('fulfilled')
        ->and($order->fulfilled_at)->not->toBeNull()
        ->and(OrderPaymentReceipt::query()->sole()->amount_minor)->toBe($order->total_minor)
        // Nothing came off the shelf, which is the honest half: the movement was
        // refused, not silently made negative.
        ->and(counterSaleLevel($shelf))->toBe('0.1000')
        ->and(StockMovement::withoutTenancy()->where('reason', 'consume')->count())->toBe(0);

    $exception = OrderConsumptionException::withoutTenancy()
        ->where('order_id', (string) $order->getKey())
        ->sole();

    expect($exception->reason_code)->toBe('insufficient_stock');
});

it('answers a replayed sale with the one it already made rather than selling twice', function (): void {
    $shelf = counterSaleShelf($this, '10');
    counterSaleRecipe($this, $shelf, '0.5');

    $sales = app(CounterSale::class);
    $draft = counterSaleDraft($this, 'counter-replay');

    $first = $sales->complete($draft);
    $second = $sales->complete(counterSaleDraft($this, 'counter-replay'));

    expect((string) $second->getKey())->toBe((string) $first->getKey())
        ->and($second->status->value)->toBe('fulfilled')
        ->and(Order::query()->count())->toBe(1)
        // The three things a re-run tail would have duplicated. The second call
        // would not merely have written them twice: `confirm()` would have met a
        // fulfilled order and thrown `TransitionRejected` first.
        ->and(OrderPaymentReceipt::query()->count())->toBe(1)
        ->and(StockMovement::withoutTenancy()->where('reason', 'consume')->count())->toBe(1)
        ->and(counterSaleLevel($shelf))->toBe('9.0000')
        ->and(AuditLog::query()->where('action', 'order.fulfilled')->count())->toBe(1);
});

it('refuses a counter sale that says nothing about how it was paid for', function (): void {
    // A walk-in pays now — that is what counter means. A counter order with no
    // payment is a pickup wearing the wrong label, and nothing downstream could
    // tell it from a counter sale whose receipt was lost.
    $this->postJson(
        '/api/v1/catalogue/order-desk/orders',
        counterSaleBody($this, ['payment' => null]),
        counterSaleHeaders($this, 'counter-unpaid'),
    )
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    expect(Order::query()->count())->toBe(0);
});

it('refuses a payment block on an order whose money arrives later', function (string $type, array $party): void {
    // A delivery is settled at the door and a pickup when the customer collects,
    // both through the receipts endpoint, by whoever actually took the money.
    // Receipting one at placement would put cash in a day's takings that is
    // still in a customer's pocket.
    $this->postJson(
        '/api/v1/catalogue/order-desk/orders',
        counterSaleBody($this, ['fulfilment_type' => $type, 'payment_method' => 'cash_on_delivery'] + $party),
        counterSaleHeaders($this, 'later-money-'.$type),
    )
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    expect(Order::query()->count())->toBe(0);
})->with([
    'delivery' => fn (): array => ['delivery', [
        'customer_account_id' => (string) test()->world->customer->account->getKey(),
        'customer_address_id' => (string) test()->world->customer->address->getKey(),
    ]],
    'pickup' => fn (): array => ['pickup', [
        'customer_account_id' => (string) test()->world->customer->account->getKey(),
    ]],
]);
