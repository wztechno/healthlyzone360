<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Orders\Enums\FulfilmentType;
use Healthy360\Orders\Exceptions\PlacementRefused;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Services\ComposedLine;
use Healthy360\Orders\Services\ComposedPlacement;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Orders\Tests\Fixtures\DeskWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| Selling across the counter: the three shapes, the bypass, and the one guard
|--------------------------------------------------------------------------
|
| `OrderComposedShapeTest` pins what `composeNow()` will take and
| `OrderFulfilmentShapeTest` pins what the database will take. This pins the HTTP
| surface in front of both, and three things about it are load-bearing enough to
| be worth stating up front.
|
| **A counter sale with no customer has to persist.** It is the shape the whole
| fulfilment migration was written for, it is the one every other order-writing
| path on the platform would refuse, and if it fails it fails as SQLSTATE 23514
| from inside a transaction rather than as a sentence.
|
| **The eligibility bypass is the desk's reason to exist.** A cold caller's
| account is provisional, has no verified email and satisfies no activation
| requirement — and the member of staff standing in front of them is the
| verification the checklist was asking for. Both halves are built here: the same
| account places through the desk and is refused when nobody is named, because a
| bypass that could not be shown to be a bypass is just a gate nobody wired up.
|
| **The idempotency key is the only guard there is.** A customer's double-tapped
| checkout finds its cart already converted and refuses; a desk sale has no cart
| and may have no customer, so nothing in the schema would notice a second
| identical counter sale — two orders, two sets of stock movements at confirm,
| and a till out by one lunch. Hence a *required* key, enforced by the controller
| because the middleware deliberately passes a keyless request straight through.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->world = DeskWorld::build('desk-sale@kitchen.test');
    $this->agent = DeskWorld::agent($this->world, 'sale-agent@desk.test');
    $this->headers = DeskWorld::headers($this->world);

    $this->actingAs($this->agent);
});

/**
 * A placement body for the world's meal, with only the fields under test stated.
 *
 * The `payment` block follows the fulfilment type rather than the defaults,
 * because the request requires it on a counter sale and prohibits it on the
 * other two: a fixed default would make every delivery case in this file
 * remember to unset it, and the one that forgot would fail as a 422 about
 * payment while claiming to be about something else. Pass `['payment' => null]`
 * to build the counter body that is missing one on purpose.
 *
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function deskSaleBody(object $test, array $overrides = []): array
{
    $body = [
        'fulfilment_type' => 'counter',
        'payment_method' => 'cash_at_counter',
        'lines' => [[
            'catalogue_item_id' => (string) $test->world->meal->getKey(),
            'quantity' => 2,
        ]],
        ...$overrides,
    ];

    if ($body['fulfilment_type'] === 'counter' && ! array_key_exists('payment', $overrides)) {
        $body['payment'] = ['method' => 'cash_at_counter'];
    }

    return $body;
}

/**
 * The headers a sale needs, with a key nobody else in the suite will reuse.
 *
 * @return array<string, string>
 */
function deskSaleHeaders(object $test, string $key): array
{
    return $test->headers + ['Idempotency-Key' => $key];
}

it('sells lunch to a stranger and writes a legal row for it', function (): void {
    $response = $this->postJson(
        '/api/v1/catalogue/order-desk/orders',
        deskSaleBody($this),
        deskSaleHeaders($this, 'counter-sale-1'),
    )->assertCreated();

    $order = Order::query()->sole();

    // Fulfilled, not placed: a counter body carries a payment block, so the
    // endpoint runs `CounterSale::complete()` and the customer has walked away
    // with the food by the time this response is rendered. `CounterSaleTest`
    // owns that behaviour; what is pinned here is that the *row* is legal.
    expect($response->json('data.order.status'))->toBe('fulfilled')
        ->and($response->json('data.order.fulfilment_type'))->toBe('counter')
        ->and($response->json('data.order.subtotal_minor'))->toBe(5000)
        ->and($response->json('data.order.total_minor'))->toBe(5000)
        // The kitchen shape, because the audience is a member of staff reading
        // their own book: the validator, and the name of whoever took the order.
        // Two, because the confirm and the fulfil each bumped it.
        ->and($response->json('data.order.lock_version'))->toBe(2)
        ->and($response->json('data.order.placed_on_behalf_by'))->toBe((string) $this->agent->getKey())
        // Nobody was named, and that is legal rather than tolerated.
        ->and($order->customer_account_id)->toBeNull()
        // The whole delivery snapshot stays null under the fulfilment-shape
        // CHECK — not merely unpopulated, refused if it were not.
        ->and($order->delivery_line_one)->toBeNull()
        ->and($order->delivery_area_id)->toBeNull()
        ->and($order->delivery_fee_minor)->toBeNull()
        // Captured intent, stated by the caller. `persist()` hardcoded cash on
        // delivery for the whole of C1 and stopped being able to the moment
        // somebody could pay at a counter.
        ->and($order->payment_method->value)->toBe('cash_at_counter')
        ->and($order->placed_on_behalf_by)->toBe((string) $this->agent->getKey());
});

it('delivers to a real customer at a real address, fee and all', function (): void {
    $response = $this->postJson('/api/v1/catalogue/order-desk/orders', deskSaleBody($this, [
        'fulfilment_type' => 'delivery',
        'payment_method' => 'cash_on_delivery',
        'customer_account_id' => (string) $this->world->customer->account->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
    ]), deskSaleHeaders($this, 'delivery-sale-1'))->assertCreated();

    $order = Order::query()->sole();

    expect($response->json('data.order.fulfilment_type'))->toBe('delivery')
        // 2 × 2500, plus the zone's 500. Repriced at placement from the standing
        // tariff, never from a number the desk sent — there is no field for one.
        ->and($response->json('data.order.subtotal_minor'))->toBe(5000)
        ->and($response->json('data.order.delivery_fee_minor'))->toBe(500)
        ->and($response->json('data.order.total_minor'))->toBe(5500)
        ->and($response->json('data.order.delivery.line_one'))->toBe('Rue Gouraud 12')
        ->and($order->customer_account_id)->toBe((string) $this->world->customer->account->getKey())
        ->and($order->sales_channel_id)->toBe((string) $this->world->desk->getKey())
        ->and($order->placed_on_behalf_by)->toBe((string) $this->agent->getKey());
});

it('refuses a pickup that carries an address, and names the reason', function (): void {
    // The refusal a desk meets most often: an agent starts a delivery for a
    // known customer, the customer decides to wait for it, and the address is
    // still on the placement. Dropping it quietly would mean the caller believed
    // something about this order that is not true of it — and the database would
    // refuse the row anyway, three layers down and as a 500.
    $response = $this->postJson('/api/v1/catalogue/order-desk/orders', deskSaleBody($this, [
        'fulfilment_type' => 'pickup',
        'customer_account_id' => (string) $this->world->customer->account->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
    ]), deskSaleHeaders($this, 'pickup-with-address'))
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'order.placement_refused');

    /** @var list<array<string, mixed>> $reasons */
    $reasons = $response->json('error.details.reasons');

    expect(array_column($reasons, 'reason'))->toContain('address_not_applicable')
        ->and(Order::query()->count())->toBe(0);
});

it('refuses a collection asked for after the kitchen closed its book for the day', function (): void {
    // A pickup is still cooked to a slot. The address gates fall away because
    // nothing travels, but the cut-off is about when the food can be *made*, so
    // a collection asked for too late is refused exactly as a delivery is.
    CheckoutWorld::cutOff($this->world->branch, '15:00:00');

    // 20:00 UTC is at least 22:00 in Beirut whatever the season, which is well
    // past a three o'clock cut-off — stated in UTC so the assertion does not
    // move when the clocks do.
    $this->travelTo(CarbonImmutable::parse('2026-09-15 20:00:00', 'UTC'));

    $today = CarbonImmutable::now('Asia/Beirut')->toDateString();

    $response = $this->postJson('/api/v1/catalogue/order-desk/orders', deskSaleBody($this, [
        'fulfilment_type' => 'pickup',
        'customer_account_id' => (string) $this->world->customer->account->getKey(),
        'branch_id' => (string) $this->world->branch->getKey(),
        'requested_delivery_date' => $today,
    ]), deskSaleHeaders($this, 'late-pickup'))
        ->assertStatus(409);

    /** @var list<array<string, mixed>> $reasons */
    $reasons = $response->json('error.details.reasons');

    expect(array_column($reasons, 'reason'))->toContain('cut_off_passed')
        ->and(Order::query()->count())->toBe(0);
});

it('sells to a provisional account the same account could not check out for itself', function (): void {
    // Both halves of the bypass, because a bypass that cannot be shown to be one
    // is a gate nobody wired up. The account is `provisional` with no verified
    // email and no dietary declaration — every one of which is a real
    // requirement for *self*-service.
    $caller = CustomerAccount::factory()->create(['display_name' => 'Cold caller']);

    $this->postJson('/api/v1/catalogue/order-desk/orders', deskSaleBody($this, [
        'fulfilment_type' => 'pickup',
        'customer_account_id' => (string) $caller->getKey(),
    ]), deskSaleHeaders($this, 'provisional-pickup'))->assertCreated();

    // The same placement with nobody named. Composed rather than driven over
    // HTTP because the self-service route for this shape is a cart checkout, and
    // arranging one would make the test fail for two reasons at once; what is
    // under test is the single condition in `composeNow()` that reads
    // `placedOnBehalfBy === null`.
    $refusal = null;

    try {
        app(OrderPlacementService::class)->placeComposed(new ComposedPlacement(
            account: $caller,
            address: null,
            organisationId: (string) $this->world->organisation->getKey(),
            salesChannelId: (string) $this->world->desk->getKey(),
            branchId: (string) $this->world->branch->getKey(),
            currencyCode: 'USD',
            lines: [new ComposedLine(catalogueItemId: (string) $this->world->meal->getKey())],
            fulfilmentType: FulfilmentType::Pickup,
        ));
    } catch (PlacementRefused $refused) {
        /** @var list<array<string, mixed>> $refusal */
        $refusal = $refused->details['reasons'] ?? [];
    }

    expect($refusal)->not->toBeNull()
        ->and(array_column($refusal ?? [], 'reason'))->toContain('account_not_ready')
        // One order exists, and it is the desk's.
        ->and(Order::query()->count())->toBe(1);
});

it('replays one key onto one order rather than selling the same lunch twice', function (): void {
    $body = deskSaleBody($this);
    $headers = deskSaleHeaders($this, 'double-tap');

    $first = $this->postJson('/api/v1/catalogue/order-desk/orders', $body, $headers)->assertCreated();

    $second = $this->postJson('/api/v1/catalogue/order-desk/orders', $body, $headers)
        // The original status, not a downgrade to 200: the order genuinely was
        // created, and the header is what says which reply this is.
        ->assertCreated()
        ->assertHeader('Idempotency-Replayed', 'true');

    expect($second->json('data.order.id'))->toBe($first->json('data.order.id'))
        ->and(Order::query()->count())->toBe(1);
});

it('will not take a sale with no idempotency key at all', function (): void {
    // The middleware passes a keyless request straight through — right for the
    // many endpoints where a key is optional, wrong here — so the controller is
    // what refuses, exactly as the tenant-provisioning endpoint refuses one.
    $this->postJson('/api/v1/catalogue/order-desk/orders', deskSaleBody($this), $this->headers)
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'request.invalid')
        ->assertJsonPath('error.details.header', 'Idempotency-Key');

    expect(Order::query()->count())->toBe(0);
});

it('refuses a key already spent on a different basket', function (): void {
    $headers = deskSaleHeaders($this, 'reused-key');

    $this->postJson('/api/v1/catalogue/order-desk/orders', deskSaleBody($this), $headers)->assertCreated();

    $this->postJson('/api/v1/catalogue/order-desk/orders', deskSaleBody($this, [
        'lines' => [['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => 5]],
    ]), $headers)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'request.idempotency_key_reused');

    expect(Order::query()->count())->toBe(1);
});

it('writes one line for a customer who tapped the same article three times', function (): void {
    // `order_lines_one_row_per_article` is unique on
    // `(order_id, catalogue_item_id, catalogue_item_variant_id) NULLS NOT
    // DISTINCT`, so three rows naming one coffee is a raw 23505 from inside a
    // transaction rather than a bigger order.
    $this->postJson('/api/v1/catalogue/order-desk/orders', deskSaleBody($this, [
        'lines' => [
            ['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => 1],
            ['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => 1],
            ['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => 1],
        ],
    ]), deskSaleHeaders($this, 'three-taps'))
        ->assertCreated()
        ->assertJsonPath('data.order.line_count', 1)
        ->assertJsonPath('data.order.subtotal_minor', 7500);

    expect(Order::query()->sole()->lines()->count())->toBe(1);
});

it('refuses to sell for a kitchen that has no counter', function (): void {
    SalesChannel::withoutTenancy()
        ->where('organisation_id', $this->world->organisation->getKey())
        ->where('code', 'desk')
        ->delete();

    $this->postJson('/api/v1/catalogue/order-desk/orders', deskSaleBody($this), deskSaleHeaders($this, 'no-counter'))
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.sales_channel_code', 'desk');

    expect(Order::query()->count())->toBe(0);
});

it('refuses a sale to somebody who may read the book but not sell from it', function (): void {
    $reader = DeskWorld::agent($this->world, 'reader-only@desk.test', ['order.view_organisation']);

    $this->actingAs($reader);

    $this->postJson('/api/v1/catalogue/order-desk/orders', deskSaleBody($this), deskSaleHeaders($this, 'reader-attempt'))
        ->assertForbidden();

    // And the same person may still quote, which is the split the desk role is
    // built around: working out a total commits the kitchen to nothing.
    $this->postJson('/api/v1/catalogue/order-desk/quote', [
        'fulfilment_type' => 'counter',
        'lines' => [['catalogue_item_id' => (string) $this->world->meal->getKey(), 'quantity' => 1]],
    ], $this->headers)->assertOk();

    expect(Order::query()->count())->toBe(0);
});

it('keeps one kitchen desk agent out of another kitchen counter', function (): void {
    $other = DeskWorld::build('other-sale@kitchen.test');

    // The agent belongs to their own kitchen and holds every desk code there.
    // Naming somebody else's organisation is refused by the context middleware
    // before a controller sees it — there is no membership to resolve.
    //
    // Spread rather than `+`: the union operator keeps the *left* side's value
    // for a duplicate key, so `$this->headers + [...]` would have quietly sent
    // the agent's own organisation and passed for the wrong reason.
    $this->postJson(
        '/api/v1/catalogue/order-desk/orders',
        deskSaleBody($this),
        [
            ...deskSaleHeaders($this, 'cross-tenant'),
            'X-Organisation-Id' => (string) $other->organisation->getKey(),
        ],
    )->assertForbidden();

    expect(Order::query()->count())->toBe(0);
});

it('will not produce an order at another kitchen branch', function (): void {
    // The branch decides which cut-off applies and which branch-scoped delivery
    // zone wins, so an unchecked one would let a desk borrow a neighbour's
    // opening hours and a neighbour's delivery fee.
    $other = DeskWorld::build('other-branch@kitchen.test');

    $this->postJson('/api/v1/catalogue/order-desk/orders', deskSaleBody($this, [
        'branch_id' => (string) $other->branch->getKey(),
    ]), deskSaleHeaders($this, 'foreign-branch'))
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    expect(Order::query()->count())->toBe(0);
});

it('charges the quoted total when the quote is placed', function (): void {
    // The loop the quote suite leaves open. Two implementations of "what does
    // this cost" is how a quote and a receipt come to differ by a piastre while
    // the customer is still holding both.
    $body = deskSaleBody($this, [
        'fulfilment_type' => 'delivery',
        'payment_method' => 'cash_on_delivery',
        'customer_account_id' => (string) $this->world->customer->account->getKey(),
        'customer_address_id' => (string) $this->world->customer->address->getKey(),
    ]);

    $quote = $this->postJson('/api/v1/catalogue/order-desk/quote', $body, $this->headers)->assertOk();

    $placed = $this->postJson('/api/v1/catalogue/order-desk/orders', $body, deskSaleHeaders($this, 'quote-then-place'))
        ->assertCreated();

    expect($quote->json('data.quote.quotable'))->toBeTrue()
        ->and($placed->json('data.order.subtotal_minor'))->toBe($quote->json('data.quote.subtotal_minor'))
        ->and($placed->json('data.order.delivery_fee_minor'))->toBe($quote->json('data.quote.delivery_fee_minor'))
        ->and($placed->json('data.order.total_minor'))->toBe($quote->json('data.quote.total_minor'));
});
