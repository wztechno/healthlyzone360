<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Customers\Database\Factories\CustomerAccountFactory;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderPaymentReceipt;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Identifiers\IdentifierService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| The payment schema: what the database will and will not accept
|--------------------------------------------------------------------------
|
| `OrderArchitectureTest` asserts that `orders_payment_method_check` exists and
| that the enum has exactly three cases. This file asserts what the constraint
| actually *does*, which is the half a name and a count cannot prove: that all
| three values go in, that a fourth does not, and that the widening did not
| quietly become "any string a writer fancies".
|
| It matters because the vocabulary is now open to two writers that are not the
| placement service — the desk's payment endpoint and, one day, a WISH
| reconciliation — and because a CHECK that was dropped and re-added is exactly
| the kind of thing that gets re-added wrong.
|
| The receipts assertions are the same argument one table over. `amount_minor`
| is the number a kitchen's takings are summed from, and a negative one would
| be a refund wearing a receipt's clothes; `restrictOnDelete` on the order is
| what stops a receipt outliving the thing it is evidence of.
|
| Every refusal runs inside `DB::transaction()`, so the savepoint takes the
| abort and the surrounding test transaction survives to make the next
| assertion.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('payments@kitchen.test', ['order.view_organisation']);
    $this->orgId = (string) $this->tenant->organisation->getKey();
    $this->channelId = (string) PricingWorld::channel($this->tenant->organisation, 'web-shop')->getKey();
    $this->customerId = (string) CustomerAccountFactory::new()->create()->getKey();
});

/**
 * An order on this kitchen's book, paid for however the caller says.
 *
 * @param  array<string, mixed>  $attributes
 */
function payableOrder(object $test, array $attributes = []): Order
{
    return Order::factory()->create([
        'organisation_id' => $test->orgId,
        'customer_account_id' => $test->customerId,
        'sales_channel_id' => $test->channelId,
        ...$attributes,
    ]);
}

/**
 * Run a write the database is expected to refuse, and answer with the SQLSTATE
 * it refused it under.
 *
 * The `DB::transaction()` wrapper is the load-bearing part: PostgreSQL aborts
 * the whole transaction block on a failed statement, and this suite runs inside
 * the one `RefreshDatabase` opened. A savepoint keeps the refusal local.
 */
function refusalState(Closure $write): string
{
    try {
        DB::transaction($write);
    } catch (QueryException $exception) {
        return (string) $exception->getCode();
    }

    throw new RuntimeException('The database accepted a row it was supposed to refuse.');
}

it('admits all three ways of paying and refuses a fourth', function (): void {
    payableOrder($this, ['payment_method' => PaymentMethod::CashOnDelivery]);
    payableOrder($this, ['payment_method' => PaymentMethod::CashAtCounter]);
    $wish = payableOrder($this, ['payment_method' => PaymentMethod::Wish]);

    expect(Order::query()->count())->toBe(3);

    // A raw insert, because the enum is what stops the application writing a
    // fourth value and the point of the CHECK is everything that is not the
    // application: an importer, a console session, a backfill. The row is a
    // clone of a legal one, so the only thing under test is the method.
    /** @var array<string, mixed> $clone */
    $clone = (array) DB::table('orders')->where('id', $wish->getKey())->first();
    $clone['id'] = app(IdentifierService::class)->generate();
    $clone['order_number'] = 'ORD-BADPAYMETHOD';
    $clone['payment_method'] = 'card';

    // 23514 is `check_violation`. Asserting the SQLSTATE rather than the
    // message is what makes this survive a PostgreSQL upgrade rewording its
    // errors, and what distinguishes the CHECK refusing the value from a column
    // length or a NOT NULL refusing the row for an unrelated reason.
    expect(refusalState(fn () => DB::table('orders')->insert($clone)))->toBe('23514')
        ->and(Order::query()->count())->toBe(3);
});

it('holds the same vocabulary on a receipt, because how money arrived is its own fact', function (): void {
    $order = payableOrder($this, ['payment_method' => PaymentMethod::CashAtCounter]);

    // The intent said counter cash; the money turned up by WISH. That is a real
    // evening at a desk and the schema has to allow it — the two columns are
    // deliberately not constrained to agree.
    $receipt = OrderPaymentReceipt::factory()->wish()->create([
        'organisation_id' => $this->orgId,
        'order_id' => $order->getKey(),
        'confirmed_by' => $this->tenant->user->getKey(),
    ]);

    expect($receipt->method)->toBe(PaymentMethod::Wish)
        ->and($receipt->reference)->toStartWith('WSH-')
        ->and($receipt->amount_minor)->toBe(3000)
        ->and($receipt->confirmed_at)->not->toBeNull();

    expect(refusalState(fn () => DB::table('order_payment_receipts')->insert(
        rawReceipt($this, $order, ['method' => 'voucher']),
    )))->toBe('23514');
});

it('refuses a negative amount, because giving money back is not a receipt', function (): void {
    $order = payableOrder($this);

    expect(refusalState(fn () => DB::table('order_payment_receipts')->insert(
        rawReceipt($this, $order, ['amount_minor' => -1]),
    )))->toBe('23514');

    // Zero is legal, and the asymmetry is the point: settling a nil balance is
    // a thing a desk does, taking money off an order is not.
    DB::table('order_payment_receipts')->insert(rawReceipt($this, $order, ['amount_minor' => 0]));

    expect(OrderPaymentReceipt::query()->where('order_id', $order->getKey())->count())->toBe(1);
});

it('will not let an order be deleted out from under its own receipt', function (): void {
    $order = payableOrder($this);

    OrderPaymentReceipt::factory()->cashAtCounter()->create([
        'organisation_id' => $this->orgId,
        'order_id' => $order->getKey(),
        'confirmed_by' => $this->tenant->user->getKey(),
    ]);

    // 23001 is `restrict_violation`, which is a stronger thing to pin than the
    // generic 23503: PostgreSQL raises it for `ON DELETE RESTRICT` and raises
    // `foreign_key_violation` for `NO ACTION`, so this proves the reference was
    // written the way the migration says rather than merely that some key
    // stood in the way. A receipt is the record that money arrived; an order it
    // points at going missing would leave a takings figure nobody can explain.
    expect(refusalState(fn () => Order::query()->whereKey($order->getKey())->delete()))->toBe('23001');

    expect(Order::query()->whereKey($order->getKey())->exists())->toBeTrue();
});

it('will not let the person who confirmed a payment be deleted either', function (): void {
    // The whole control on a WISH receipt is that somebody named said the money
    // arrived. An assertion whose asserter can be removed is an anonymous
    // claim, which is exactly what `restrictOnDelete` on `confirmed_by` refuses
    // to let it become.
    $confirmer = User::factory()->create(['email' => 'desk-confirmer@kitchen.test']);

    OrderPaymentReceipt::factory()->create([
        'organisation_id' => $this->orgId,
        'order_id' => payableOrder($this)->getKey(),
        'confirmed_by' => $confirmer->getKey(),
    ]);

    expect(fn () => DB::transaction(fn () => User::query()->whereKey($confirmer->getKey())->delete()))
        ->toThrow(QueryException::class, 'order_payment_receipts');
});

/**
 * A receipt as the database sees it — every NOT NULL column filled, so a
 * refusal can only be the constraint under test.
 *
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function rawReceipt(object $test, Order $order, array $overrides = []): array
{
    return [
        'id' => app(IdentifierService::class)->generate(),
        'organisation_id' => $test->orgId,
        'order_id' => (string) $order->getKey(),
        'method' => 'cash_at_counter',
        'amount_minor' => 2500,
        'currency_code' => 'USD',
        'reference' => null,
        'confirmed_by' => (string) $test->tenant->user->getKey(),
        'confirmed_at' => now(),
        'notes' => null,
        ...$overrides,
    ];
}
