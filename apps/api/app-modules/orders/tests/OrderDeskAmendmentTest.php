<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Delivery\Models\DeliveryZoneWindow;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Orders\Enums\CancellationReason;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Services\OrderLifecycle;
use Healthy360\Orders\Services\OrderPaymentReceipts;
use Healthy360\Orders\Tests\Fixtures\DeskWorld;
use Healthy360\Orders\Tests\Fixtures\OrderWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Identifiers\IdentifierService;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

/*
|--------------------------------------------------------------------------
| Editing an order the desk or the web shop already took
|--------------------------------------------------------------------------
|
| `PATCH /catalogue/order-desk/orders/{order}`: the lines are the whole basket,
| everything else is "keep what is stored" unless named, every line is repriced
| on the order's own channel, staff may override the cut-off and nothing else,
| and `amendable` on the kitchen shape is the same answer the edit gives.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = DeskWorld::build('desk-amend@kitchen.test');
    $this->agent = DeskWorld::agent($this->world, 'amend-agent@desk.test', [
        ...DeskWorld::AGENT_PERMISSIONS,
        'customer.create_on_behalf_organisation',
    ]);
    $this->headers = DeskWorld::headers($this->world);

    // A second article, so an edit can add one. Priced on the shared tariff and
    // offered on the web shop only: an edit of a web-shop order that could add
    // it was priced on the web shop, not on the counter.
    $this->soup = CheckoutWorld::publishedMeal($this->world->tenant, 'Lentil soup');
    PricingWorld::price($this->world->priceList, $this->soup, null, 1000);
    CheckoutWorld::offer($this->world->channel, $this->soup);

    $this->actingAs($this->agent);
});

/**
 * A desk delivery for the world's customer, placed and confirmed.
 *
 * @param  array<string, mixed>  $overrides
 */
function amendDeskDelivery(object $test, array $overrides = []): Order
{
    $response = $test->postJson('/api/v1/catalogue/order-desk/orders', [
        'fulfilment_type' => 'delivery',
        'payment_method' => 'cash_on_delivery',
        'customer_account_id' => (string) $test->world->customer->account->getKey(),
        'customer_address_id' => (string) $test->world->customer->address->getKey(),
        'lines' => [['catalogue_item_id' => (string) $test->world->meal->getKey(), 'quantity' => 2]],
        ...$overrides,
    ], $test->headers + ['Idempotency-Key' => 'amend-'.bin2hex(random_bytes(6))])->assertCreated();

    return Order::query()->findOrFail($response->json('data.order.id'));
}

/**
 * @param  array<string, mixed>  $body
 */
function amendPatch(object $test, Order $order, array $body, ?int $version = null): TestResponse
{
    return $test->patchJson(
        "/api/v1/catalogue/order-desk/orders/{$order->getKey()}",
        $body,
        $test->headers + ['If-Match' => '"'.($version ?? $order->refresh()->lock_version).'"'],
    );
}

/**
 * @return list<array<string, mixed>>
 */
function amendMealLines(object $test, int|string $quantity = 2): array
{
    return [['catalogue_item_id' => (string) $test->world->meal->getKey(), 'quantity' => $quantity]];
}

function amendRefusal(TestResponse $response): array
{
    $response->assertStatus(409)->assertJsonPath('error.code', 'order.placement_refused');

    return $response->json('error.details.reasons');
}

it('reprices a confirmed desk delivery and moves its lines by article', function (): void {
    CheckoutWorld::offer($this->world->desk, $this->soup);
    $order = amendDeskDelivery($this);
    $original = $order->lines()->sole();

    $response = amendPatch($this, $order, [
        'lines' => [
            ['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => 2],
            ['catalogue_item_id' => (string) $this->soup->getKey(), 'quantity' => 1],
        ],
    ])->assertOk();

    // 2 × 25.00 + 1 × 10.00 + 5.00 fee.
    expect($response->json('data.order.subtotal_minor'))->toBe(6000)
        ->and($response->json('data.order.total_minor'))->toBe(6500)
        ->and($response->json('data.order.status'))->toBe('confirmed')
        ->and($response->json('data.order.amendable'))->toBeTrue()
        ->and($response->json('data.order.lock_version'))->toBe($order->lock_version + 1)
        ->and($response->headers->get('ETag'))->toBe('"'.($order->lock_version + 1).'"')
        ->and($response->json('data.order.line_count'))->toBe(2);

    // An unchanged quantity keeps its row; only the soup is new.
    expect($order->lines()->whereKey($original->getKey())->exists())->toBeTrue();

    // A changed quantity is a new row, the old one deleted.
    amendPatch($this, $order, ['lines' => amendMealLines($this, 3)])->assertOk();

    $line = $order->lines()->sole();
    expect($line->getKey())->not->toBe($original->getKey())
        ->and((string) $line->quantity)->toStartWith('3')
        ->and($order->refresh()->total_minor)->toBe(8000);
});

it('reprices a web-shop order on the web shop', function (): void {
    $order = OrderWorld::place($this->world, 1);

    // The soup is offered on the web shop and not on the counter: pricing this
    // edit on the counter would refuse it `channel_unavailable`.
    $response = amendPatch($this, $order, [
        'lines' => [
            ['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => 1],
            ['catalogue_item_id' => (string) $this->soup->getKey(), 'quantity' => 2],
        ],
    ])->assertOk();

    expect($response->json('data.order.subtotal_minor'))->toBe(4500)
        ->and($response->json('data.order.status'))->toBe('placed')
        ->and($order->refresh()->sales_channel_id)->toBe((string) $this->world->channel->getKey());
});

it('quotes an edit on the order own channel, keeping its stored fee', function (): void {
    $order = OrderWorld::place($this->world, 1);

    $response = $this->postJson('/api/v1/catalogue/order-desk/quote', [
        'fulfilment_type' => 'delivery',
        'amending_order_id' => (string) $order->getKey(),
        'lines' => [['catalogue_item_id' => (string) $this->soup->getKey(), 'quantity' => 2]],
    ], $this->headers)->assertOk();

    expect($response->json('data.quote.quotable'))->toBeTrue()
        ->and($response->json('data.quote.refusals'))->toBe([])
        ->and($response->json('data.quote.subtotal_minor'))->toBe(2000)
        ->and($response->json('data.quote.delivery_fee_minor'))->toBe(500)
        ->and($response->json('data.quote.total_minor'))->toBe(2500);
});

it('lets staff override a passed cut-off, and records that they did', function (): void {
    CheckoutWorld::cutOff($this->world->branch, '15:00:00');
    $this->travelTo(CarbonImmutable::parse('2026-11-02 10:00:00', 'Asia/Beirut'));

    $order = amendDeskDelivery($this, [
        'branch_id' => (string) $this->world->branch->getKey(),
        'requested_delivery_date' => '2026-11-03',
    ]);

    $this->travelTo(CarbonImmutable::parse('2026-11-02 16:00:00', 'Asia/Beirut'));

    amendPatch($this, $order, ['lines' => amendMealLines($this, 1), 'requested_delivery_date' => '2026-11-02'])->assertOk();

    expect($order->refresh()->requested_delivery_date->toDateString())->toBe('2026-11-02');

    $audit = AuditLog::query()->where('action', 'order.amended')->sole();
    expect($audit->metadata['cut_off_overridden'])->toBeTrue()
        ->and($audit->metadata['date'])->toBe('2026-11-02')
        ->and($audit->metadata['lines_changed'])->toBe(1)
        ->and($audit->metadata['total_before'])->toBe(5500)
        ->and($audit->metadata['total_after'])->toBe(3000);
});

it('still refuses a day in the past or a day the branch is closed', function (): void {
    CheckoutWorld::cutOff($this->world->branch, '15:00:00');
    $this->travelTo(CarbonImmutable::parse('2026-11-02 10:00:00', 'Asia/Beirut'));

    $order = amendDeskDelivery($this, [
        'branch_id' => (string) $this->world->branch->getKey(),
        'requested_delivery_date' => '2026-11-03',
    ]);

    amendPatch($this, $order, ['lines' => amendMealLines($this), 'requested_delivery_date' => '2026-11-01'])
        ->assertUnprocessable();

    BranchOpeningHour::withoutTenancy()
        ->where('branch_id', $this->world->branch->getKey())
        ->where('weekday', CarbonImmutable::parse('2026-11-04')->dayOfWeekIso)
        ->update(['opens_at' => null, 'closes_at' => null, 'order_cut_off_at' => null]);

    $reasons = amendRefusal(amendPatch($this, $order, ['lines' => amendMealLines($this), 'requested_delivery_date' => '2026-11-04']));

    expect(array_column($reasons, 'reason'))->toBe(['closed']);
});

it('keeps the stored slot when only a quantity changes, even one its zone no longer offers', function (): void {
    $window = CheckoutWorld::window($this->world->zone, 'evening');
    $order = amendDeskDelivery($this, ['delivery_window_code' => 'evening', 'requested_delivery_date' => now()->addDays(2)->toDateString()]);

    DeliveryZoneWindow::withoutTenancy()->where('delivery_window_id', $window->getKey())->delete();

    amendPatch($this, $order, ['lines' => amendMealLines($this, 5)])->assertOk();

    $order->refresh();
    expect($order->delivery_window_code)->toBe('evening')
        ->and($order->requested_delivery_date->toDateString())->toBe(now()->addDays(2)->toDateString());
});

it('sends the order to a new address, with that zone fee', function (): void {
    $area = CheckoutWorld::area('hamra-amend');
    CheckoutWorld::servingZone($this->world->organisation, $area, 800, 'outer');

    $address = CustomerAddress::query()->create([
        'customer_account_id' => $this->world->customer->account->getKey(),
        'address_type' => CustomerAddressType::Delivery,
        'delivery_area_id' => $area->getKey(),
        'line_one' => 'Rue Hamra 40',
        'is_default' => false,
        'lock_version' => 0,
    ]);

    $order = amendDeskDelivery($this);

    $response = amendPatch($this, $order, [
        'lines' => amendMealLines($this),
        'customer_address_id' => (string) $address->getKey(),
        'payment_method' => 'wish',
    ])->assertOk();

    expect($response->json('data.order.delivery.line_one'))->toBe('Rue Hamra 40')
        ->and($response->json('data.order.delivery_fee_minor'))->toBe(800)
        ->and($response->json('data.order.total_minor'))->toBe(5800)
        ->and($response->json('data.order.payment_method'))->toBe('wish')
        ->and($response->json('data.order.delivery.area_id'))->toBe((string) $area->getKey());
});

it('refuses another customer address as not found, and a payment method the order cannot take', function (): void {
    $order = amendDeskDelivery($this);
    $stranger = CheckoutWorld::readyCustomer($this->world->area, 'Elsewhere');

    amendPatch($this, $order, ['lines' => amendMealLines($this), 'customer_address_id' => (string) $stranger->address->getKey()])
        ->assertNotFound();

    amendPatch($this, $order, ['lines' => amendMealLines($this), 'payment_method' => 'cash_at_counter'])
        ->assertUnprocessable()
        ->assertJsonPath('error.code', 'validation.failed');
});

it('answers a stale If-Match with a conflict and changes nothing', function (): void {
    $order = amendDeskDelivery($this);

    amendPatch($this, $order, ['lines' => amendMealLines($this, 4)], version: $order->lock_version - 1)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');

    expect($order->refresh()->total_minor)->toBe(5500);
});

it('refuses an order it may not edit, and serves the same answer as amendable', function (string $because, Closure $arrange): void {
    $order = amendDeskDelivery($this);

    $arrange($this, $order);

    $show = $this->getJson("/api/v1/catalogue/orders/{$order->getKey()}", $this->headers)->assertOk();
    expect($show->json('data.order.amendable'))->toBeFalse();

    $reasons = amendRefusal(amendPatch($this, $order, ['lines' => amendMealLines($this, 1)]));

    expect($reasons)->toBe([['reason' => 'order_not_amendable', 'because' => $because]]);
})->with([
    'closed' => ['closed', function (object $test, Order $order): void {
        app(OrderLifecycle::class)->cancel($order->refresh(), CancellationReason::CustomerRequested);
    }],
    'kitchen started' => ['kitchen_started', function (object $test, Order $order): void {
        $order->forceFill(['preparing_at' => now()])->save();
    }],
    'ready' => ['ready', function (object $test, Order $order): void {
        $order->forceFill(['ready_at' => now()])->save();
    }],
    'agreement priced' => ['agreement_priced', function (object $test, Order $order): void {
        $order->lines()->update(['price_source' => 'quotation']);
    }],
    'other channel' => ['other_channel', function (object $test, Order $order): void {
        $wholesale = SalesChannel::factory()->create([
            'organisation_id' => $test->world->organisation->getKey(),
            'code' => 'wholesale-amend',
            'channel_kind' => SalesChannelKind::B2b,
        ]);
        $order->forceFill(['sales_channel_id' => $wholesale->getKey()])->save();
    }],
    'paid online' => ['paid_online', function (object $test, Order $order): void {
        DB::table('payment_intents')->insert([
            'id' => app(IdentifierService::class)->generate(),
            'organisation_id' => $order->organisation_id,
            'order_id' => $order->getKey(),
            'status' => 'captured',
            'method_kind' => 'card',
            'currency_code' => $order->currency_code,
            'amount_minor' => $order->total_minor,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }],
    'legacy consumption' => ['legacy_consumption', function (object $test, Order $order): void {
        $piece = MeasurementUnit::query()->where('code', 'piece')->sole();
        $ingredient = Ingredient::factory()->create([
            'organisation_id' => $test->world->organisation->getKey(),
            'default_unit_id' => (string) $piece->getKey(),
        ]);
        $item = StockItem::query()->create([
            'organisation_id' => $test->world->organisation->getKey(),
            'code' => 'legacy-amend',
            'name_en' => 'Legacy shelf',
            'unit_code' => 'piece',
            'unit_id' => (string) $piece->getKey(),
            'ingredient_id' => (string) $ingredient->getKey(),
        ]);
        $inventory = app(InventoryService::class);
        $organisationId = (string) $test->world->organisation->getKey();
        $branchId = (string) $test->world->branch->getKey();
        app(TenantContext::class)->setOrganisation((string) $test->agent->getKey(), $organisationId);
        $inventory->recordMovement($organisationId, $branchId, (string) $item->getKey(), 'receipt', '5');
        // A consume from before INV1.5: no order line on it.
        $inventory->recordMovement($organisationId, $branchId, (string) $item->getKey(), 'consume', '-1', 'order', (string) $order->getKey());
        app(TenantContext::class)->clear();
    }],
]);

it('refuses an edit that takes the total below what was already paid', function (): void {
    $order = amendDeskDelivery($this);
    app(OrderPaymentReceipts::class)->write($order, PaymentMethod::CashOnDelivery, 5500, (string) $this->agent->getKey());

    $reasons = amendRefusal(amendPatch($this, $order, ['lines' => amendMealLines($this, 1)]));

    expect($reasons)->toBe([[
        'reason' => 'total_below_paid',
        'total_minor' => 3000,
        'paid_minor' => 5500,
        'currency_code' => 'USD',
    ]]);
});

it('serves amendable on the kitchen book and the desk queue', function (): void {
    $order = amendDeskDelivery($this);

    $book = $this->getJson('/api/v1/catalogue/orders', $this->headers)->assertOk();
    expect($book->json('data.0.amendable'))->toBeTrue();

    $order->forceFill(['preparing_at' => now()])->save();

    $book = $this->getJson('/api/v1/catalogue/orders', $this->headers)->assertOk();
    expect($book->json('data.0.amendable'))->toBeFalse();

    $queue = $this->getJson('/api/v1/catalogue/order-desk/queue', $this->headers)->assertOk();
    expect(collect($queue->json('data'))->firstWhere('id', (string) $order->getKey())['amendable'])->toBeFalse();
});

it('writes the audit row without redacting any of it', function (): void {
    $order = amendDeskDelivery($this, ['delivery_window_code' => null]);
    CheckoutWorld::window($this->world->zone, 'lunch');

    amendPatch($this, $order, ['lines' => amendMealLines($this, 1), 'delivery_window_code' => 'lunch'])->assertOk();

    $metadata = AuditLog::query()->where('action', 'order.amended')->sole()->metadata;

    expect($metadata)->not->toContain('[redacted]')
        ->and($metadata['window'])->toBe('lunch')
        ->and($metadata['payment_method'])->toBe('cash_on_delivery')
        ->and($metadata['lines_added'])->toBe(0)
        ->and($metadata['lines_removed'])->toBe(0)
        ->and($metadata['cut_off_overridden'])->toBeFalse();
});

it('lets the desk add an address for a registered web-shop customer', function (): void {
    // The customer registered on the web shop and ordered there; the desk then
    // takes their call and needs a new street for the edit.
    OrderWorld::place($this->world, 1);

    $this->postJson(
        "/api/v1/catalogue/order-desk/customers/{$this->world->customer->account->getKey()}/addresses",
        ['delivery_area_id' => (string) $this->world->area->getKey(), 'line_one' => 'Rue Monot 7'],
        $this->headers,
    )->assertCreated();
});
