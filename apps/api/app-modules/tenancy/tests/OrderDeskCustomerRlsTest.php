<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Orders\Models\Order;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Tenancy\TenantContext;
use Healthy360\Tenancy\Tests\Fixtures\RuntimeRole;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| The fourth arm on `rls_customer_account_select`
|--------------------------------------------------------------------------
|
| A separate file from `RlsTest` and not a fifth section of it, because the
| fixtures are different in kind: this needs an `orders` row, which drags in a
| sales channel and a currency, and `rlsTenant()` deliberately builds the eleven
| protected tables and nothing else. `RlsTest`'s pins — the eleven-table set and
| the three append-only ledgers — are untouched by this commit and stay where
| they are.
|
| **Why the arm exists.** The policy had three arms: the account's own user, the
| owning organisation, and ownerless rows. A kitchen session matches none of them
| for an ordinary registered customer, because a consumer account carries no
| `organisation_id` by design — the same person orders from four kitchens with
| one account. So `SELECT display_name` from a kitchen session returned no row
| at all, and the order desk queue served `display_name: null` for every
| registered customer it held an order for. The number was unaffected
| (`contact_points` carries no policy); the name simply was not there.
|
| **Why no ordinary test could have caught it.** The suite connects as the schema
| owner and bypasses row-level security by ownership, so every Feature test would
| have passed while production served nulls. That is the whole reason this file
| runs everything inside `SET ROLE healthy360_test` — a role that owns nothing
| and holds NOBYPASSRLS — exactly as `RlsTest` does.
|
| The three assertions are the arm's boundary: **an order makes the account
| readable**, **no order does not**, and **a staff-provisioned row was already
| readable** through the ownerless arm — which is the concession the migration
| docblock states rather than implies, and the reason the app-layer scoping rule
| in `DeskCustomerDirectory` is the real control.
|
*/

uses()->group('rls');

/**
 * One kitchen, and one registered consumer who may or may not have ordered from
 * it. Distinctively named: Pest loads the whole suite into one process, and
 * `RlsTest` already declares `rlsTenant()`.
 */
function deskRlsKitchen(string $code): object
{
    $organisation = Organisation::factory()->create();
    $user = User::factory()->create();

    $channel = SalesChannel::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'code' => $code,
    ]);

    return (object) compact('organisation', 'user', 'channel');
}

function deskRlsOrder(object $kitchen, CustomerAccount $account): Order
{
    return Order::query()->create([
        'order_number' => 'ORD-'.strtoupper(bin2hex(random_bytes(5))),
        'organisation_id' => $kitchen->organisation->getKey(),
        'customer_account_id' => $account->getKey(),
        'sales_channel_id' => $kitchen->channel->getKey(),
        'status' => 'placed',
        'currency_code' => $kitchen->organisation->default_currency_code,
        'subtotal_minor' => 2500,
        'total_minor' => 2500,
        'delivery_line_one' => 'Rue Gouraud 12',
        'fulfilment_type' => 'delivery',
        'payment_method' => 'cash_on_delivery',
        'placed_at' => now(),
        'lock_version' => 0,
    ]);
}

beforeEach(function (): void {
    app(TenantContext::class)->clear();

    $this->kitchen = deskRlsKitchen('desk-rls-a');
    $this->other = deskRlsKitchen('desk-rls-b');

    // A registered consumer: their own user, no organisation. The shape that
    // matched nothing at all from a kitchen session before the fourth arm.
    $this->registered = CustomerAccount::factory()->create(['display_name' => 'Ramy Haddad']);

    // A second one, identical except that this kitchen has never cooked for
    // them — the arm's other boundary.
    $this->unrelated = CustomerAccount::factory()->create(['display_name' => 'Nobody Here']);

    // A cold caller the desk wrote down: no user, no organisation, `staff`.
    $this->provisioned = CustomerAccount::factory()->create([
        'user_id' => null,
        'origin' => 'staff',
        'display_name' => 'Rita Aoun',
        'provisional_expires_at' => null,
    ]);
});

afterEach(function (): void {
    RuntimeRole::context();
});

it('lets a kitchen read the name of a registered customer it holds an order for', function (): void {
    deskRlsOrder($this->kitchen, $this->registered);

    // The kitchen's session: its own organisation, and a user who is not the
    // customer. Under the three-armed policy this read returned nothing.
    RuntimeRole::context((string) $this->kitchen->user->getKey(), (string) $this->kitchen->organisation->getKey());

    $visible = RuntimeRole::run(fn (): array => DB::table('customer_accounts')
        ->whereIn('id', [$this->registered->getKey(), $this->unrelated->getKey()])
        ->pluck('display_name', 'id')
        ->all());

    expect($visible)->toHaveKey((string) $this->registered->getKey())
        ->and($visible[(string) $this->registered->getKey()])->toBe('Ramy Haddad')
        // The arm is an order, not a role: a consumer this kitchen has never
        // cooked for stays exactly as invisible as they were.
        ->and($visible)->not->toHaveKey((string) $this->unrelated->getKey());
});

it('does not lend one kitchen the customers of another', function (): void {
    deskRlsOrder($this->kitchen, $this->registered);

    RuntimeRole::context((string) $this->other->user->getKey(), (string) $this->other->organisation->getKey());

    $visible = RuntimeRole::run(fn (): array => DB::table('customer_accounts')
        ->where('id', $this->registered->getKey())
        ->pluck('id')
        ->all());

    expect($visible)->toBe([]);
});

it('reads a staff-provisioned caller through the ownerless arm, and says so out loud', function (): void {
    // Not a new grant, and this test exists to record that. A staff-provisioned
    // account has no user and no organisation, which is precisely the shape the
    // guest arm (2026_08_07_001506) already admitted — so it is readable from
    // *every* kitchen session, including one that has never heard of this
    // caller. That is the concession `2026_08_16_003006` writes down, and the
    // reason `DeskCustomerDirectory`'s app-layer rule is the whole control
    // rather than a belt over a database brace.
    RuntimeRole::context((string) $this->other->user->getKey(), (string) $this->other->organisation->getKey());

    $visible = RuntimeRole::run(fn (): array => DB::table('customer_accounts')
        ->where('id', $this->provisioned->getKey())
        ->pluck('display_name')
        ->all());

    expect($visible)->toBe(['Rita Aoun']);
});

it('lets a kitchen see a customer it has an order for without letting it rewrite them', function (): void {
    // The arm is on SELECT alone. A kitchen may now read the name of somebody
    // who ordered from it; a fourth arm on UPDATE would have let it rewrite a
    // person's account because they bought a sandwich there once.
    deskRlsOrder($this->kitchen, $this->registered);

    RuntimeRole::context((string) $this->kitchen->user->getKey(), (string) $this->kitchen->organisation->getKey());

    $updated = RuntimeRole::run(fn (): int => DB::table('customer_accounts')
        ->where('id', $this->registered->getKey())
        ->update(['display_name' => 'Rewritten']));

    expect($updated)->toBe(0)
        ->and(CustomerAccount::query()->whereKey($this->registered->getKey())->value('display_name'))
        ->toBe('Ramy Haddad');
});

it('still fails closed when the session carries no organisation at all', function (): void {
    deskRlsOrder($this->kitchen, $this->registered);

    // A reset connection carries empty strings rather than unset variables, and
    // the fourth arm has to be indistinguishable from the other three about it:
    // no organisation identifier equals the empty string.
    RuntimeRole::context();

    $visible = RuntimeRole::run(fn (): int => DB::table('customer_accounts')
        ->where('id', $this->registered->getKey())
        ->count());

    expect($visible)->toBe(0);
});
