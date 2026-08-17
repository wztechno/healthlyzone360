<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Customers\Database\Factories\CustomerAccountFactory;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderPaymentReceipt;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Testing\TestResponse;

/*
|--------------------------------------------------------------------------
| Recording that money arrived, and the four ways it refuses
|--------------------------------------------------------------------------
|
| `OrderPaymentSchemaTest` proves what the database will accept; this proves
| what the endpoint will. The two are not the same set, and every gap between
| them is deliberate:
|
| * **The column CHECK admits a zero amount and the endpoint does not.** A row
|   asserting that no money changed hands is not evidence, and it would sit in a
|   day's takings as a payment event worth nothing.
| * **The schema does not constrain a receipt's method to the order's, and
|   neither does this.** An order taken for cash at the counter and settled by
|   WISH is a real evening; recording the divergence is the point of holding two
|   columns rather than one.
| * **Over-payment is permitted at both layers.** Change comes out of the till,
|   not out of this table.
|
| The refusals are four and they are four different answers. A missing `If-Match`
| is `428` — the client never entered a race. A stale one is `409
| resource.conflict`. A cancelled order is also `409`, with `details.status`
| naming what it actually is, because nobody records money arriving for an order
| that no longer exists commercially. Another kitchen's order is `404`, and it is
| a 404 rather than a 403 for `OrderLocator`'s stated reason: confirming that an
| identifier exists but is somebody else's is a disclosure.
|
| The idempotency test is the one that matters most operationally. Two genuine
| receipts for the same amount against one order are exactly what a deposit and a
| balance look like, so no constraint on the table can tell a retry apart from a
| second payment — the key is the whole of the defence, and a replay must return
| the original receipt rather than write a second row.
|
| Orders are built through the factory rather than through placement: this file
| is about money arriving against an order, and going through
| `OrderPlacementService` would drag a priced channel, a served zone and an
| eligible customer into a suite that asserts none of them.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('receipts@kitchen.test', [
        'order.view_organisation',
        'order.manage_organisation',
    ]);

    $this->orgId = (string) $this->tenant->organisation->getKey();
    $this->channelId = (string) PricingWorld::channel($this->tenant->organisation, 'web-shop')->getKey();
    $this->customerId = (string) CustomerAccountFactory::new()->create()->getKey();

    $this->headers = firstPartyHeaders() + ['X-Organisation-Id' => $this->orgId];

    $this->actingAs($this->tenant->user);
});

/**
 * An order on this kitchen's book. Totals 3000 minor units, from the factory.
 *
 * @param  array<string, mixed>  $attributes
 */
function receiptedOrder(object $test, array $attributes = []): Order
{
    return Order::factory()->create([
        'organisation_id' => $test->orgId,
        'customer_account_id' => $test->customerId,
        'sales_channel_id' => $test->channelId,
        ...$attributes,
    ]);
}

/**
 * @param  array<string, mixed>  $body
 * @param  array<string, string>  $extraHeaders
 */
function payFor(object $test, Order $order, array $body, ?int $ifMatch = null, array $extraHeaders = []): TestResponse
{
    $headers = $test->headers + $extraHeaders;

    if ($ifMatch !== null) {
        $headers += ['If-Match' => '"'.$ifMatch.'"'];
    }

    return $test->postJson('/api/v1/catalogue/orders/'.$order->getKey().'/payments', $body, $headers);
}

it('records a receipt against the order, in the order\'s own currency, under the name of whoever confirmed it', function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-05-10 09:30:00', 'UTC'));

    $order = receiptedOrder($this);

    $response = payFor($this, $order, [
        'method' => 'cash_at_counter',
        'amount_minor' => 3000,
        'reference' => null,
        'notes' => 'Paid at the counter, exact.',
    ], $order->lock_version)->assertCreated();

    $receipt = OrderPaymentReceipt::query()->sole();

    expect($receipt->order_id)->toBe((string) $order->getKey())
        ->and($receipt->organisation_id)->toBe($this->orgId)
        ->and($receipt->method)->toBe(PaymentMethod::CashAtCounter)
        ->and($receipt->amount_minor)->toBe(3000)
        // Never from the request — the body carries no currency at all, because
        // a receipt in another currency is not a receipt for this order.
        ->and($receipt->currency_code)->toBe($order->currency_code)
        ->and($receipt->confirmed_by)->toBe((string) $this->tenant->user->getKey())
        ->and($receipt->confirmed_at)->not->toBeNull()
        ->and($receipt->notes)->toBe('Paid at the counter, exact.');

    $response
        ->assertJsonPath('data.receipt.id', (string) $receipt->getKey())
        ->assertJsonPath('data.receipt.order_id', (string) $order->getKey())
        ->assertJsonPath('data.receipt.method', 'cash_at_counter')
        ->assertJsonPath('data.receipt.amount_minor', 3000)
        ->assertJsonPath('data.receipt.currency_code', 'USD')
        ->assertJsonPath('data.receipt.reference', null)
        ->assertJsonPath('data.receipt.confirmed_by', (string) $this->tenant->user->getKey())
        ->assertJsonPath('data.receipt.confirmed_at', fn (mixed $at): bool => is_string($at))
        // The derived position, beside the row that moved it. `method` here is
        // the order's *intent* — cash on delivery from the factory — and the
        // receipt above says what actually arrived.
        ->assertJsonPath('data.payment.method', 'cash_on_delivery')
        ->assertJsonPath('data.payment.received_minor', 3000)
        ->assertJsonPath('data.payment.receipted', true);

    // The order row is untouched, `lock_version` included. Nothing about the
    // order changed, and a validator that moved would invalidate every screen
    // holding it for no reason anybody could see.
    $fresh = $order->fresh();

    expect($fresh->lock_version)->toBe($order->lock_version)
        ->and($fresh->status)->toBe($order->status)
        ->and($fresh->updated_at?->toIso8601String())->toBe($order->updated_at?->toIso8601String());

    // Audited here rather than by `OrderLifecycle`, which audits transitions and
    // this is not one. The subject is the order, so an order's whole trail is
    // one query.
    $audit = AuditLog::query()->where('action', 'order.payment_recorded')->sole();

    expect($audit->subject_type)->toBe('order')
        ->and($audit->subject_id)->toBe((string) $order->getKey())
        ->and($audit->actor_user_id)->toBe((string) $this->tenant->user->getKey())
        ->and($audit->metadata['receipt_id'])->toBe((string) $receipt->getKey())
        ->and($audit->metadata['method'])->toBe('cash_at_counter')
        ->and($audit->metadata['amount_minor'])->toBe(3000)
        // `currency`, not `currency_code`: the audit redactor blanks any key
        // containing `code`, and a redacted currency is a row that cannot say
        // what was paid.
        ->and($audit->metadata['currency'])->toBe('USD');
});

it('sums two part payments and flips receipted at exactly the total', function (): void {
    $order = receiptedOrder($this);

    // A deposit. Real money, and the order is not settled by it.
    payFor($this, $order, ['method' => 'wish', 'amount_minor' => 1200, 'reference' => 'WSH-DEPOSIT-1'], $order->lock_version)
        ->assertCreated()
        ->assertJsonPath('data.payment.received_minor', 1200)
        ->assertJsonPath('data.payment.receipted', false);

    // The balance, landing the sum on the total exactly. `>=` and `>` differ on
    // precisely this row.
    payFor($this, $order, ['method' => 'cash_on_delivery', 'amount_minor' => 1800], $order->lock_version)
        ->assertCreated()
        ->assertJsonPath('data.payment.received_minor', 3000)
        ->assertJsonPath('data.payment.receipted', true);

    expect(OrderPaymentReceipt::query()->where('order_id', $order->getKey())->count())->toBe(2);
});

it('permits an over-payment, because change comes out of the till and not out of this table', function (): void {
    $order = receiptedOrder($this);

    payFor($this, $order, ['method' => 'cash_at_counter', 'amount_minor' => 5000], $order->lock_version)
        ->assertCreated()
        ->assertJsonPath('data.receipt.amount_minor', 5000)
        ->assertJsonPath('data.payment.received_minor', 5000)
        ->assertJsonPath('data.payment.receipted', true);
});

it('records money that arrived by a different route from the one the order intended', function (): void {
    // Taken for cash on delivery; the customer transferred instead while the
    // driver waited. Both facts survive, under their own names.
    $order = receiptedOrder($this, ['payment_method' => PaymentMethod::CashOnDelivery]);

    payFor($this, $order, [
        'method' => 'wish',
        'amount_minor' => 3000,
        'reference' => 'WSH-77213',
    ], $order->lock_version)
        ->assertCreated()
        ->assertJsonPath('data.receipt.method', 'wish')
        ->assertJsonPath('data.receipt.reference', 'WSH-77213')
        ->assertJsonPath('data.payment.method', 'cash_on_delivery');

    expect($order->fresh()->payment_method)->toBe(PaymentMethod::CashOnDelivery);
});

it('refuses a zero amount, which the column would have accepted', function (): void {
    $order = receiptedOrder($this);

    // The CHECK admits `amount_minor >= 0`; this endpoint does not, because a
    // receipt is evidence and nobody paying nothing is not evidence of a
    // payment. `validation.failed`, not a conflict: the body is wrong, the
    // world is fine.
    payFor($this, $order, ['method' => 'cash_at_counter', 'amount_minor' => 0], $order->lock_version)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    payFor($this, $order, ['method' => 'card', 'amount_minor' => 3000], $order->lock_version)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    expect(OrderPaymentReceipt::query()->count())->toBe(0);
});

it('answers a missing validator differently from a stale one', function (): void {
    $order = receiptedOrder($this);

    // Never entered the race: 428, and the answer names the header to send.
    payFor($this, $order, ['method' => 'cash_at_counter', 'amount_minor' => 3000])
        ->assertStatus(428)
        ->assertJsonPath('error.code', 'request.precondition_required');

    // Entered and lost. The order moved under the caller — somebody confirmed
    // it — so the view the payment button was rendered from is stale.
    $order->lock_version = $order->lock_version + 1;
    $order->save();

    payFor($this, $order, ['method' => 'cash_at_counter', 'amount_minor' => 3000], 0)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.current_lock_version', $order->lock_version);

    expect(OrderPaymentReceipt::query()->count())->toBe(0);
});

it('refuses a receipt against a cancelled order', function (): void {
    $order = receiptedOrder($this);

    // Through the factory's own state, because `orders_cancellation_check`
    // makes a status-only cancelled row illegal: the status, the timestamp and
    // the reason are one fact and have to move together.
    $cancelled = Order::factory()->cancelled()->create([
        'organisation_id' => $this->orgId,
        'customer_account_id' => $this->customerId,
        'sales_channel_id' => $this->channelId,
    ]);

    // Nobody records money arriving for an order that no longer exists
    // commercially: the kitchen is not cooking it and the figure would
    // reconcile against nothing. If it really was paid for, what happened is a
    // refund, and refunds are the payments module's act.
    payFor($this, $cancelled, ['method' => 'cash_at_counter', 'amount_minor' => 3000], $cancelled->lock_version)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.status', 'cancelled')
        ->assertJsonPath('error.details.current_lock_version', $cancelled->lock_version)
        ->assertJsonPath('error.details.allowed_statuses', ['placed', 'confirmed', 'fulfilled']);

    // The refusal is about the state, not about the endpoint: the same body
    // against a live order goes straight through.
    payFor($this, $order, ['method' => 'cash_at_counter', 'amount_minor' => 3000], $order->lock_version)->assertCreated();

    expect(OrderPaymentReceipt::query()->count())->toBe(1);
});

it('accepts a receipt against a fulfilled order, because cash on delivery arrives after the food does', function (): void {
    $order = Order::factory()->fulfilled()->create([
        'organisation_id' => $this->orgId,
        'customer_account_id' => $this->customerId,
        'sales_channel_id' => $this->channelId,
    ]);

    payFor($this, $order, ['method' => 'cash_on_delivery', 'amount_minor' => 3000], $order->lock_version)
        ->assertCreated()
        ->assertJsonPath('data.payment.receipted', true);
});

it('replays an idempotent retry with the original receipt rather than writing a second row', function (): void {
    $order = receiptedOrder($this);

    $body = ['method' => 'cash_at_counter', 'amount_minor' => 3000];
    $key = ['Idempotency-Key' => 'desk-till-2026-05-10-0007'];

    $first = payFor($this, $order, $body, $order->lock_version, $key)->assertCreated();

    // The same key and the same body: the original envelope, the original
    // status, and the header that says which it was. Nothing else on this table
    // could tell the retry apart from a second payment — a deposit and a
    // balance are two identical rows by design.
    payFor($this, $order, $body, $order->lock_version, $key)
        ->assertCreated()
        ->assertHeader('Idempotency-Replayed', 'true')
        ->assertJsonPath('data.receipt.id', $first->json('data.receipt.id'))
        ->assertJsonPath('data.payment.received_minor', 3000);

    expect(OrderPaymentReceipt::query()->count())->toBe(1);

    // A different amount under the same key is a key that already means
    // something else, and the fix is a new key rather than a reload.
    payFor($this, $order, ['method' => 'cash_at_counter', 'amount_minor' => 1500], $order->lock_version, $key)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'request.idempotency_key_reused');

    // A new key writes the second receipt it names.
    payFor($this, $order, ['method' => 'cash_at_counter', 'amount_minor' => 1500], $order->lock_version, [
        'Idempotency-Key' => 'desk-till-2026-05-10-0008',
    ])->assertCreated();

    expect(OrderPaymentReceipt::query()->count())->toBe(2);
});

it('never lets one kitchen receipt another kitchen\'s order', function (): void {
    $neighbour = PricingWorld::kitchen('neighbour-receipts@kitchen.test', ['order.manage_organisation']);

    $theirs = Order::factory()->create([
        'organisation_id' => $neighbour->organisation->getKey(),
        'customer_account_id' => CustomerAccountFactory::new()->create()->getKey(),
        'sales_channel_id' => PricingWorld::channel($neighbour->organisation, 'web-shop')->getKey(),
    ]);

    // A 404 rather than a 403: confirming that an identifier exists but belongs
    // to somebody else is a disclosure, and an order number is printed on a
    // receipt that passes through a courier's hands.
    payFor($this, $theirs, ['method' => 'cash_at_counter', 'amount_minor' => 3000], $theirs->lock_version)
        ->assertStatus(404)
        ->assertJsonPath('error.code', 'resource.not_found');

    expect(OrderPaymentReceipt::query()->count())->toBe(0);
});
