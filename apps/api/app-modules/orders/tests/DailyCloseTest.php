<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\DailyClose;
use Healthy360\Orders\Models\OrderPaymentReceipt;
use Healthy360\Orders\Tests\Fixtures\RunWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Models\StaffNotification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

/*
|--------------------------------------------------------------------------
| Daily close: float, count, variance
|--------------------------------------------------------------------------
|
| The expected figure is built from the rows the settlement and the cash report
| already read. These tests hold the ways that goes wrong: counting road cash at
| the door and again at the hand-in, and a day cut on the wrong clock.
|
*/

const CLOSES_URL = '/api/v1/catalogue/order-desk/closes';

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    Mail::fake();
    $this->withoutDefer();
    $this->travelTo(CarbonImmutable::parse('2026-11-03 12:00:00', 'UTC'));

    $this->world = RunWorld::build('close@kitchen.test', ['order.view_organisation', 'order.manage_organisation', 'order.supervise_organisation', 'order.settle_cash_organisation']);
    $this->orgId = (string) $this->world->tenant->organisation->getKey();
    $this->actingAs($this->world->tenant->user);
});

function counterCash(object $test, int $amountMinor, string $method = 'cash_at_counter', ?string $branchId = null): OrderPaymentReceipt
{
    $order = RunWorld::order($test->world, ['status' => OrderStatus::Fulfilled, 'subtotal_minor' => $amountMinor, 'delivery_fee_minor' => 0, 'total_minor' => $amountMinor, 'branch_id' => $branchId]);

    return OrderPaymentReceipt::factory()->create([
        'organisation_id' => $order->organisation_id,
        'order_id' => $order->getKey(),
        'method' => $method,
        'amount_minor' => $amountMinor,
        'currency_code' => $order->currency_code,
        'confirmed_by' => $test->world->tenant->user->getKey(),
        'confirmed_at' => now()->subMinutes(5),
    ]);
}

function closeTill(object $test, int $float, int $counted, ?string $reason = null, ?string $branchId = null): TestResponse
{
    return $test->postJson(CLOSES_URL, [
        'branch_id' => $branchId,
        'currency_code' => 'USD',
        'opening_float_minor' => $float,
        'counted_minor' => $counted,
        'variance_reason' => $reason,
    ], $test->world->headers + ['Idempotency-Key' => (string) Str::uuid()]);
}

it('closes a shift that balances, with nothing to sign', function (): void {
    counterCash($this, 3000);

    $this->getJson(CLOSES_URL, $this->world->headers)
        ->assertOk()
        ->assertJsonPath('data.open.0.counter_cash_minor', 3000);

    closeTill($this, 1000, 4000)
        ->assertCreated()
        ->assertJsonPath('data.close.expected_minor', 4000)
        ->assertJsonPath('data.close.variance_minor', 0);

    $this->travel(1)->minutes();

    $this->getJson(CLOSES_URL, $this->world->headers)
        ->assertJsonCount(0, 'data.open')
        ->assertJsonCount(1, 'data.closes');
});

it('leaves Whish out of the till, and refuses a shift with nothing in it', function (): void {
    counterCash($this, 3000, 'wish');

    closeTill($this, 500, 500)->assertConflict();
});

it('refuses a second press on a shift already closed', function (): void {
    counterCash($this, 3000);

    closeTill($this, 0, 3000)->assertCreated();
    $this->travel(1)->minutes();
    closeTill($this, 0, 3000)->assertConflict();
});

it('counts a driver\'s cash at the hand-in, not at the door', function (): void {
    $order = RunWorld::order($this->world, ['status' => OrderStatus::Fulfilled, 'total_minor' => 3000]);
    $driver = (string) $this->world->tenant->user->getKey();

    OrderPaymentReceipt::factory()->create([
        'organisation_id' => $order->organisation_id,
        'order_id' => $order->getKey(),
        'method' => 'cash_on_delivery',
        'amount_minor' => 3000,
        'currency_code' => $order->currency_code,
        'confirmed_by' => $driver,
        'confirmed_at' => now()->subMinutes(5),
    ]);
    $job = RunWorld::job($this->world, $order, [
        'driver_user_id' => $driver,
        'status' => 'delivered',
        'tracking_status' => 'delivered',
        'delivered_at' => now()->subMinutes(5),
    ]);

    $this->postJson('/api/v1/catalogue/order-desk/settlements', [
        'job_ids' => [(string) $job->getKey()],
        'handed_in_minor' => 2800,
        'short_reason' => 'Change',
    ], $this->world->headers + ['Idempotency-Key' => (string) Str::uuid()])->assertCreated();

    // The clock is frozen, and the close's window ends just before its own instant.
    $this->travel(1)->minutes();

    closeTill($this, 0, 2800)
        ->assertCreated()
        ->assertJsonPath('data.close.counter_cash_minor', 0)
        ->assertJsonPath('data.close.handed_in_minor', 2800)
        ->assertJsonPath('data.close.variance_minor', 0);
});

it('takes cash refunds out of the till, and leaves a Whish refund in', function (): void {
    $order = counterCash($this, 3000)->order_id;

    foreach (['cash_at_counter', 'wish'] as $method) {
        DB::table('order_refunds')->insert([
            'id' => (string) Str::uuid7(),
            'organisation_id' => $this->orgId,
            'order_id' => $order,
            'kind' => 'refund',
            'status' => 'completed',
            'method' => $method,
            'amount_minor' => 500,
            'currency_code' => 'USD',
            'reason' => 'Wrong dish',
            'requested_by' => $this->world->tenant->user->getKey(),
            'requested_at' => now()->subMinute(),
            'decided_by' => $this->world->tenant->user->getKey(),
            'decided_at' => now()->subMinute(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    closeTill($this, 0, 2500)->assertCreated()->assertJsonPath('data.close.cash_refunds_minor', 500);
});

it('needs a reason for a short close, alerts the managers and takes one sign-off', function (): void {
    counterCash($this, 3000);

    closeTill($this, 0, 2500)->assertUnprocessable();

    $id = closeTill($this, 0, 2500, 'Change given twice')
        ->assertCreated()
        ->assertJsonPath('data.close.variance_minor', -500)
        ->json('data.close.id');

    expect(StaffNotification::withoutTenancy()
        ->where('type', StaffAlertType::ShortClose->value)
        ->where('subject_id', $id)
        ->exists())->toBeTrue();

    $this->postJson(CLOSES_URL."/{$id}/sign-off", [], $this->world->headers)->assertOk();
    $this->postJson(CLOSES_URL."/{$id}/sign-off", [], $this->world->headers)->assertConflict();
});

it('writes down a count above expected, with nothing to sign', function (): void {
    counterCash($this, 3000);

    $id = closeTill($this, 0, 3200)->assertCreated()->assertJsonPath('data.close.variance_minor', 200)->json('data.close.id');

    $this->postJson(CLOSES_URL."/{$id}/sign-off", [], $this->world->headers)->assertConflict();
});

it('starts the next shift at the last close, on the kitchen\'s own day', function (): void {
    Organisation::query()->whereKey($this->orgId)->update(['timezone' => 'Asia/Beirut']);
    $this->travelTo(CarbonImmutable::parse('2026-11-03 22:30:00', 'UTC'));

    counterCash($this, 3000);
    closeTill($this, 0, 3000)->assertCreated()->assertJsonPath('data.close.business_date', '2026-11-04');

    $this->travel(1)->hours();
    counterCash($this, 1000);

    closeTill($this, 0, 1000)
        ->assertCreated()
        ->assertJsonPath('data.close.counter_cash_minor', 1000);

    expect(DailyClose::withoutTenancy()->count())->toBe(2);
});

it('is closed to a member without the code, and a sign-off to one without the manager code', function (): void {
    $id = closeTillAs($this);

    $other = RunWorld::build('no-cash@kitchen.test', ['order.view_organisation']);
    forgetResolvedGuards();
    $this->actingAs($other->tenant->user);

    $this->getJson(CLOSES_URL, $other->headers)->assertForbidden();
    $this->postJson(CLOSES_URL."/{$id}/sign-off", [], $other->headers)->assertForbidden();
});

/**
 * The kitchen's second branch, opened after the first, so the first stays first.
 */
function secondBranch(object $test): string
{
    $branch = CheckoutWorld::branch($test->world->organisation, 'Second kitchen');
    DB::table('organisation_branches')->where('id', $branch->getKey())->update(['created_at' => now()->addMinute()]);

    return (string) $branch->getKey();
}

it('closes two branches\' tills apart, and the kitchen total sums them', function (): void {
    $main = (string) $this->world->branch->getKey();
    $second = secondBranch($this);

    counterCash($this, 3000, branchId: $main);
    counterCash($this, 1000, branchId: $second);

    $open = $this->getJson(CLOSES_URL, $this->world->headers)
        ->assertOk()
        ->assertJsonCount(2, 'data.branches')
        ->assertJsonPath('data.branches.0.id', $main)
        ->json('data.open');

    expect(collect($open)->pluck('counter_cash_minor', 'branch_id')->all())->toEqual([$main => 3000, $second => 1000]);

    closeTill($this, 500, 3500, branchId: $main)
        ->assertCreated()
        ->assertJsonPath('data.close.branch_id', $main)
        ->assertJsonPath('data.close.branch_name', 'Main kitchen')
        ->assertJsonPath('data.close.counter_cash_minor', 3000)
        ->assertJsonPath('data.close.variance_minor', 0);

    $this->getJson(CLOSES_URL, $this->world->headers)
        ->assertJsonCount(1, 'data.open')
        ->assertJsonPath('data.open.0.branch_id', $second);

    closeTill($this, 200, 1100, 'Change given twice', $second)
        ->assertCreated()
        ->assertJsonPath('data.close.branch_id', $second)
        ->assertJsonPath('data.close.counter_cash_minor', 1000)
        ->assertJsonPath('data.close.variance_minor', -100);

    $this->travel(1)->minutes();

    $this->getJson(CLOSES_URL, $this->world->headers)
        ->assertJsonCount(0, 'data.open')
        ->assertJsonCount(1, 'data.totals')
        ->assertJsonPath('data.totals.0.business_date', '2026-11-03')
        ->assertJsonPath('data.totals.0.till_count', 2)
        ->assertJsonPath('data.totals.0.counter_cash_minor', 4000)
        ->assertJsonPath('data.totals.0.counted_minor', 4600)
        ->assertJsonPath('data.totals.0.variance_minor', -100);
});

it('counts an order with no branch in the kitchen\'s first branch\'s till', function (): void {
    $second = secondBranch($this);

    counterCash($this, 3000);

    $this->getJson(CLOSES_URL, $this->world->headers)
        ->assertJsonCount(1, 'data.open')
        ->assertJsonPath('data.open.0.branch_id', (string) $this->world->branch->getKey());

    closeTill($this, 0, 0, 'Nothing here', $second)->assertConflict();
    closeTill($this, 0, 3000)
        ->assertCreated()
        ->assertJsonPath('data.close.branch_id', (string) $this->world->branch->getKey());
});

it('refuses another kitchen\'s branch as the till', function (): void {
    counterCash($this, 3000);
    $stranger = CheckoutWorld::branch(Organisation::factory()->create(['country_code' => $this->world->organisation->country_code]), 'Elsewhere');

    closeTill($this, 0, 3000, branchId: (string) $stranger->getKey())->assertUnprocessable();
});

function closeTillAs(object $test): string
{
    counterCash($test, 3000);

    return (string) closeTill($test, 0, 2500, 'Change')->json('data.close.id');
}
