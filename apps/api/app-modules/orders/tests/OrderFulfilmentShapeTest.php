<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Customers\Database\Factories\CustomerAccountFactory;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Orders\Enums\FulfilmentType;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\OrderDesk\Presenters\OrderDeskPresenter;
use Healthy360\Orders\Services\OrderSnapshotRedaction;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Identifiers\IdentifierService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| Three ways an order leaves, and what each one is required to carry
|--------------------------------------------------------------------------
|
| `orders_fulfilment_shape_check` is the constraint that lets one table hold a
| courier delivery, a collection and a walk-in sale without any of the three
| pretending to be one of the others. It is worth pinning at the database rather
| than trusting to a service for the reason the migration gives: the columns it
| governs are written by the placement service today, and will be written by a
| counter-sale path, an importer and a backfill before this table is old.
|
| The six assertions below are three pairs. Each fulfilment type is accepted in
| the shape it is supposed to have, and refused in the shape that would make it
| a lie:
|
|   * a **delivery** with no customer — nobody to deliver to;
|   * a **pickup** carrying an address — a courier instruction nobody will
|     follow;
|   * a **counter** sale carrying an address — the desk claiming to know where
|     somebody lives because they bought a sandwich.
|
| Every refusal is asserted by **SQLSTATE 23514** rather than by message text,
| which is what makes it survive a PostgreSQL upgrade rewording its errors and
| what distinguishes the shape CHECK refusing the row from a NOT NULL or a
| foreign key refusing it for an unrelated reason.
|
| The three tests after them are about the migration rather than the constraint:
| that the rows placed before this column existed became deliveries, that the
| factory's new states build rows the database will actually take, and that a
| member of staff can leave the company without taking an order's history with
| them.
|
| Every refusal runs inside `DB::transaction()`, so the savepoint takes the
| abort and the surrounding `RefreshDatabase` transaction survives to make the
| next assertion.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('fulfilment@kitchen.test', ['order.view_organisation']);
    $this->orgId = (string) $this->tenant->organisation->getKey();
    $this->channelId = (string) PricingWorld::channel($this->tenant->organisation, 'web-shop')->getKey();
    $this->customerId = (string) CustomerAccountFactory::new()->create()->getKey();
});

/**
 * An order as the database sees it, with every NOT NULL column filled, so that
 * a refusal can only be the constraint under test.
 *
 * A distinctively named function rather than a shared one, for the reason every
 * fixture in this codebase is a class: Pest loads the whole suite into one
 * process, and `OrderPaymentSchemaTest` already declares a row builder of its
 * own. Two files declaring `rawOrder()` would be a fatal redeclaration rather
 * than a test failure.
 *
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function fulfilmentRow(object $test, array $overrides = []): array
{
    return [
        'id' => app(IdentifierService::class)->generate(),
        'order_number' => 'ORD-'.strtoupper(bin2hex(random_bytes(5))),
        'organisation_id' => $test->orgId,
        'customer_account_id' => $test->customerId,
        'sales_channel_id' => $test->channelId,
        'status' => 'placed',
        'currency_code' => 'USD',
        'subtotal_minor' => 2500,
        'delivery_fee_minor' => null,
        'total_minor' => 2500,
        'delivery_line_one' => 'Rue Gouraud 12',
        'fulfilment_type' => 'delivery',
        'payment_method' => 'cash_on_delivery',
        'placed_at' => now(),
        'lock_version' => 0,
        'created_at' => now(),
        'updated_at' => now(),
        ...$overrides,
    ];
}

/**
 * Run a write the database is expected to refuse, and answer with the SQLSTATE
 * it refused it under.
 */
function fulfilmentRefusal(Closure $write): string
{
    try {
        DB::transaction($write);
    } catch (QueryException $exception) {
        return (string) $exception->getCode();
    }

    throw new RuntimeException('The database accepted a row it was supposed to refuse.');
}

it('takes a delivery that names both a customer and a door', function (): void {
    DB::table('orders')->insert(fulfilmentRow($this));

    expect(Order::query()->count())->toBe(1)
        ->and(Order::query()->sole()->fulfilment_type)->toBe(FulfilmentType::Delivery);
});

it('refuses a delivery with nobody to deliver to', function (): void {
    // The column is nullable now, which is exactly why this has to be asserted:
    // what used to be refused by NOT NULL is refused by the shape CHECK, and
    // only for the two arms where a customer is genuinely required.
    expect(fulfilmentRefusal(fn () => DB::table('orders')->insert(
        fulfilmentRow($this, ['customer_account_id' => null]),
    )))->toBe('23514');

    expect(Order::query()->count())->toBe(0);
});

it('takes a pickup that names a customer and no destination', function (): void {
    DB::table('orders')->insert(fulfilmentRow($this, [
        'fulfilment_type' => 'pickup',
        'delivery_line_one' => null,
        // The promised slot survives the missing address, which is the point of
        // the arm: "be here at six" is a promise whether or not the food
        // travels.
        'delivery_window_code' => 'evening',
        'requested_delivery_date' => now()->toDateString(),
    ]));

    $order = Order::query()->sole();

    expect($order->fulfilment_type)->toBe(FulfilmentType::Pickup)
        ->and($order->delivery_line_one)->toBeNull()
        ->and($order->customer_account_id)->toBe($this->customerId)
        ->and($order->delivery_window_code)->toBe('evening');
});

it('refuses a pickup carrying an address', function (): void {
    expect(fulfilmentRefusal(fn () => DB::table('orders')->insert(
        fulfilmentRow($this, ['fulfilment_type' => 'pickup']),
    )))->toBe('23514');

    expect(Order::query()->count())->toBe(0);
});

it('takes a counter sale with neither a customer nor an address', function (): void {
    DB::table('orders')->insert(fulfilmentRow($this, [
        'fulfilment_type' => 'counter',
        'customer_account_id' => null,
        'delivery_line_one' => null,
        'payment_method' => 'cash_at_counter',
    ]));

    $order = Order::query()->sole();

    expect($order->fulfilment_type)->toBe(FulfilmentType::Counter)
        ->and($order->customer_account_id)->toBeNull()
        ->and($order->delivery_line_one)->toBeNull();
});

it('takes a counter sale that names the regular who bought it', function (): void {
    // The asymmetry that makes `counter` its own arm rather than "pickup
    // without an account": the customer is *optional* here, never forbidden. A
    // regular is worth naming — it is what makes their order history and their
    // allergen profile reachable — and an address never is.
    DB::table('orders')->insert(fulfilmentRow($this, [
        'fulfilment_type' => 'counter',
        'delivery_line_one' => null,
        'payment_method' => 'cash_at_counter',
    ]));

    expect(Order::query()->sole()->customer_account_id)->toBe($this->customerId);
});

it('refuses a counter sale carrying an address', function (): void {
    expect(fulfilmentRefusal(fn () => DB::table('orders')->insert(
        fulfilmentRow($this, ['fulfilment_type' => 'counter', 'customer_account_id' => null]),
    )))->toBe('23514');

    expect(Order::query()->count())->toBe(0);
});

it('refuses a fourth way of leaving the kitchen', function (): void {
    // A raw insert, because the enum is what stops the application writing a
    // fourth value and the point of the CHECK is everything that is not the
    // application: an importer, a console session, a backfill.
    expect(fulfilmentRefusal(fn () => DB::table('orders')->insert(
        fulfilmentRow($this, ['fulfilment_type' => 'dine_in']),
    )))->toBe('23514');
});

it('made every order placed before the column existed a delivery', function (): void {
    // The backfill was the column default rather than an UPDATE, so this is the
    // mechanism that produced it, asserted directly: a writer that names every
    // other column and not this one — which is precisely what every row already
    // on the platform was when the migration ran, and what
    // `OrderPlacementService::persist()` still is — gets a delivery.
    //
    // A raw count rather than a model read, because the model now carries the
    // same default in `$attributes` and would answer for itself.
    $row = fulfilmentRow($this);
    unset($row['fulfilment_type']);

    DB::table('orders')->insert($row);
    DB::table('orders')->insert([...fulfilmentRow($this), 'fulfilment_type' => 'pickup', 'delivery_line_one' => null]);

    expect(DB::table('orders')->where('fulfilment_type', 'delivery')->count())->toBe(1)
        ->and(DB::table('orders')->whereNull('fulfilment_type')->count())->toBe(0)
        ->and(DB::table('orders')->count())->toBe(2);
});

it('builds a legal row from every factory state', function (): void {
    // The states move several columns at once because two constraints make them
    // move together — the shape CHECK and `orders_total_check` — so a state that
    // dropped the address and left the delivery fee behind would fail at the
    // database rather than in an assertion, which is the sort of failure that
    // gets read as a broken fixture.
    $seller = ['organisation_id' => $this->orgId, 'sales_channel_id' => $this->channelId];

    $delivery = Order::factory()->create([...$seller, 'customer_account_id' => $this->customerId]);
    $pickup = Order::factory()->pickup()->create([...$seller, 'customer_account_id' => $this->customerId]);
    $counter = Order::factory()->counter()->create($seller);

    expect($delivery->fulfilment_type)->toBe(FulfilmentType::Delivery)
        ->and($delivery->delivery_line_one)->not->toBeNull()
        ->and($pickup->fulfilment_type)->toBe(FulfilmentType::Pickup)
        ->and($pickup->delivery_line_one)->toBeNull()
        ->and($pickup->customer_account_id)->toBe($this->customerId)
        ->and($counter->fulfilment_type)->toBe(FulfilmentType::Counter)
        ->and($counter->customer_account_id)->toBeNull()
        ->and($counter->delivery_line_one)->toBeNull();

    // `cancelled()` still moves its own three fields together, unchanged by
    // this migration and asserted here so that the new states cannot quietly
    // have been built by rewriting it.
    $cancelled = Order::factory()->cancelled()->create([...$seller, 'customer_account_id' => $this->customerId]);

    expect($cancelled->cancelled_at)->not->toBeNull()
        ->and($cancelled->cancellation_reason)->not->toBeNull();
});

it('keeps the order when the member of staff who placed it leaves', function (): void {
    // `nullOnDelete` rather than `restrictOnDelete`, unlike a payment receipt's
    // `confirmed_by`: a receipt is an assertion whose asserter must stay named
    // or the claim becomes anonymous, whereas this is provenance. An order
    // placed by an employee who has since left is still an order, and the
    // alternative is a leaver nobody can remove.
    $agent = User::factory()->create(['email' => 'desk-agent@kitchen.test']);

    $order = Order::factory()->counter()->create([
        'organisation_id' => $this->orgId,
        'sales_channel_id' => $this->channelId,
        'placed_on_behalf_by' => $agent->getKey(),
    ]);

    expect($order->placed_on_behalf_by)->toBe((string) $agent->getKey());

    User::query()->whereKey($agent->getKey())->delete();

    expect($order->refresh()->placed_on_behalf_by)->toBeNull()
        ->and(Order::query()->whereKey($order->getKey())->exists())->toBeTrue();
});

it('redacts a closing customer without writing an address onto the orders that never had one', function (): void {
    // The interaction that would otherwise have taken a closure down. J2's
    // redaction overwrites `delivery_line_one` with a marker rather than
    // emptying it, because the column could not be null — and since this
    // migration it *is* null on exactly the orders that never carried an
    // address, where the shape CHECK refuses a marker outright. A customer who
    // has both a delivery and a collection in their history is an ordinary
    // customer, and one statement covers their whole history, so the write has
    // to be conditional or the erasure aborts with 23514 and the account never
    // closes.
    $seller = ['organisation_id' => $this->orgId, 'sales_channel_id' => $this->channelId, 'customer_account_id' => $this->customerId];

    $delivery = Order::factory()->create([...$seller, 'delivery_directions' => 'Green door past the pharmacy']);

    // The pickup carries the number to ring when the food is ready, which is
    // what makes it match the redaction's guard and makes the conditional write
    // load-bearing rather than theoretical: this row is *in* the statement, and
    // an unconditional marker would be written onto it.
    $pickup = Order::factory()->pickup()->create([
        ...$seller,
        'delivery_contact_point_id' => ContactPoint::factory()
            ->phone()
            ->verified()
            // The account-owned shape. `contact_points` has an exactly-one
            // CHECK across the two ownership columns, and the factory's default
            // is a user, so this state is what clears it.
            ->forCustomerAccount($this->customerId)
            ->create()
            ->getKey(),
    ]);

    // Nothing to erase on this one at all — no address, no note, no number — so
    // the guard excludes it and the count says so.
    $counter = Order::factory()->counter()->create([...$seller]);

    $redacted = app(OrderSnapshotRedaction::class)->anonymiseFor($this->customerId);

    expect($redacted)->toBe(2);

    expect($delivery->refresh()->delivery_line_one)->toBe(OrderSnapshotRedaction::REDACTED)
        ->and($delivery->delivery_directions)->toBeNull()
        // The two that never had a door keep their nulls, which is what the
        // shape CHECK demands and what is true.
        ->and($pickup->refresh()->delivery_line_one)->toBeNull()
        ->and($pickup->delivery_contact_point_id)->toBeNull()
        ->and($counter->refresh()->delivery_line_one)->toBeNull();

    // And it is still idempotent across all three shapes — a queue retry after
    // a timeout is the normal case, not the exceptional one.
    expect(app(OrderSnapshotRedaction::class)->anonymiseFor($this->customerId))->toBe(0);
});

it('carries the new fields onto a desk queue row without the desk presenter being touched', function (): void {
    // `OrderDeskPresenter::row()` starts from `OrderPresenter::kitchen()` and
    // only *adds* keys, which is why this commit changed one presenter and not
    // two. That is a claim about composition, and a claim about composition is
    // worth an assertion: the day somebody rebuilds the desk row by hand to add
    // a field, the queue silently stops serving whatever the order book gained
    // since — and every existing desk test would still pass, because they
    // assert the fields they were written for.
    $order = Order::factory()->counter()->create([
        'organisation_id' => $this->orgId,
        'sales_channel_id' => $this->channelId,
    ]);

    $row = app(OrderDeskPresenter::class)->row($order, [], now()->toIso8601String(), 0, false);

    expect($row)->toHaveKeys(['fulfilment_type', 'placed_on_behalf_by', 'delivery'])
        ->and($row['fulfilment_type'])->toBe('counter')
        ->and($row['placed_on_behalf_by'])->toBeNull()
        ->and($row['customer_account_id'])->toBeNull()
        ->and($row['delivery'])->toHaveKeys(['building', 'floor', 'apartment', 'directions', 'contact_point_id'])
        ->and($row['delivery']['line_one'])->toBeNull();
});

it('states the shape rule in the database rather than only in a service', function (): void {
    // The constraint by name, so that a migration that dropped it and re-added
    // it under a different one — or did not re-add it at all — fails here
    // rather than the first time an importer writes a pickup with an address.
    $constraints = DB::table('pg_constraint')
        ->whereIn('conname', ['orders_fulfilment_shape_check', 'orders_fulfilment_type_check'])
        ->pluck('conname')
        ->all();

    expect($constraints)->toHaveCount(2);
});
