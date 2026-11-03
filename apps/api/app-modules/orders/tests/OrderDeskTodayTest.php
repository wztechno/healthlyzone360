<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Cart\Tests\Fixtures\CheckoutWorld;
use Healthy360\Orders\Enums\CancellationDisposition;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Enums\PaymentMethod;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderPaymentReceipt;
use Healthy360\Orders\Tests\Fixtures\RunWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| The kitchen home's Today card
|--------------------------------------------------------------------------
|
| Sales per currency, cash expected and counted, late and past due, and
| cancellations, all on the kitchen's local day. The world's branch is in
| Beirut, UTC+3 in May.
|
*/

const TODAY_URL = '/api/v1/catalogue/order-desk/today';

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->travelTo(CarbonImmutable::parse('2026-05-10 12:00:00', 'UTC'));

    $this->world = RunWorld::build('today@kitchen.test', ['order.view_organisation', 'order.manage_organisation']);
    $this->orgId = (string) $this->world->organisation->getKey();
    $this->mainId = (string) $this->world->branch->getKey();
    $this->actingAs($this->world->tenant->user);
});

/**
 * An order of this kitchen, placed at a UTC instant.
 *
 * @param  array<string, mixed>  $attributes
 */
function todayOrder(object $test, string $placedAt, int $totalMinor, array $attributes = []): Order
{
    return RunWorld::order($test->world, [
        'status' => OrderStatus::Fulfilled,
        'branch_id' => $test->mainId,
        'subtotal_minor' => $totalMinor,
        'delivery_fee_minor' => 0,
        'total_minor' => $totalMinor,
        'placed_at' => CarbonImmutable::parse($placedAt, 'UTC'),
        ...$attributes,
    ]);
}

it('reads the day per currency: sales, cash, late orders and cancellations', function (): void {
    $other = (string) DB::table('currencies')->where('code', '<>', 'USD')->orderBy('code')->value('code');

    $paid = todayOrder($this, '2026-05-10 08:00:00', 3000);
    todayOrder($this, '2026-05-10 09:00:00', 5000, ['currency_code' => $other]);
    // Open, due at placing: 11:00 is past the 30-minute grace, 11:45 only past due.
    todayOrder($this, '2026-05-10 11:00:00', 1000, ['status' => OrderStatus::Confirmed]);
    todayOrder($this, '2026-05-10 11:45:00', 1000, ['status' => OrderStatus::Confirmed]);
    // Yesterday's sale is not today's.
    todayOrder($this, '2026-05-09 08:00:00', 9000);

    $cancelledToday = ['status' => OrderStatus::Cancelled, 'cancelled_at' => CarbonImmutable::parse('2026-05-10 10:00:00', 'UTC')];
    todayOrder($this, '2026-05-10 07:00:00', 400, [...$cancelledToday, 'cancellation_disposition' => CancellationDisposition::Returned]);
    todayOrder($this, '2026-05-10 07:00:00', 400, [...$cancelledToday, 'cancellation_disposition' => CancellationDisposition::Wasted]);
    todayOrder($this, '2026-05-10 07:00:00', 400, $cancelledToday);
    todayOrder($this, '2026-05-09 07:00:00', 400, ['status' => OrderStatus::Cancelled, 'cancelled_at' => CarbonImmutable::parse('2026-05-09 10:00:00', 'UTC')]);

    // A close at 06:00 counted 1200 on a 500 float; 3000 came over the counter since.
    DB::table('daily_closes')->insert([
        'id' => (string) Str::uuid7(),
        'organisation_id' => $this->orgId,
        'branch_id' => $this->mainId,
        'currency_code' => 'USD',
        'business_date' => '2026-05-10',
        'opened_at' => CarbonImmutable::parse('2026-05-09 21:00:00', 'UTC'),
        'closed_at' => CarbonImmutable::parse('2026-05-10 06:00:00', 'UTC'),
        'opening_float_minor' => 500,
        'counter_cash_minor' => 700,
        'handed_in_minor' => 0,
        'cash_refunds_minor' => 0,
        'expected_minor' => 1200,
        'counted_minor' => 1200,
        'variance_minor' => 0,
        'recorded_by' => $this->world->tenant->user->getKey(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);
    OrderPaymentReceipt::factory()->create([
        'organisation_id' => $this->orgId,
        'order_id' => $paid->getKey(),
        'method' => PaymentMethod::CashAtCounter,
        'amount_minor' => 3000,
        'currency_code' => 'USD',
        'confirmed_by' => $this->world->tenant->user->getKey(),
        'confirmed_at' => CarbonImmutable::parse('2026-05-10 08:30:00', 'UTC'),
    ]);

    $data = $this->getJson(TODAY_URL, $this->world->headers)->assertOk()->json('data');

    $sales = collect($data['sales'])->pluck('amount_minor', 'currency_code')->all();

    expect($data['day'])->toBe('2026-05-10')
        ->and($data['timezone'])->toBe('Asia/Beirut')
        ->and($sales)->toEqual(['USD' => 5000, $other => 5000])
        ->and($data['orders'])->toBe(4)
        ->and($data['cash_expected'])->toBe([['currency_code' => 'USD', 'amount_minor' => 3500]])
        ->and($data['cash_counted'])->toBe([['currency_code' => 'USD', 'amount_minor' => 1200]])
        ->and($data['past_due'])->toBe(2)
        ->and($data['overdue'])->toBe(1)
        ->and($data['cancelled'])->toBe(['returned' => 1, 'wasted' => 1, 'other' => 1]);
});

it('leaves out another branch when one is named', function (): void {
    $marina = (string) CheckoutWorld::branch($this->world->organisation, 'Marina')->getKey();
    // The clock is frozen, so Marina is pushed later: the first branch is the oldest.
    DB::table('organisation_branches')->where('id', $marina)->update(['created_at' => now()->addMinute()]);

    todayOrder($this, '2026-05-10 08:00:00', 3000);
    todayOrder($this, '2026-05-10 08:00:00', 7000, ['branch_id' => $marina]);
    todayOrder($this, '2026-05-10 11:00:00', 1000, ['branch_id' => $marina, 'status' => OrderStatus::Confirmed]);
    // Branchless and late: the first branch's till, and late there, never nowhere.
    todayOrder($this, '2026-05-10 10:00:00', 2000, ['branch_id' => null, 'status' => OrderStatus::Confirmed]);

    $main = $this->getJson(TODAY_URL.'?branch_id='.$this->mainId, $this->world->headers)->assertOk();

    expect($main->json('data.sales'))->toBe([['currency_code' => 'USD', 'amount_minor' => 5000]])
        ->and($main->json('data.orders'))->toBe(2)
        ->and($main->json('data.past_due'))->toBe(1)
        ->and($main->json('data.overdue'))->toBe(1)
        ->and($main->json('meta.branch_id'))->toBe($this->mainId);

    $atMarina = $this->getJson(TODAY_URL.'?branch_id='.$marina, $this->world->headers)->assertOk();

    expect($atMarina->json('data.sales'))->toBe([['currency_code' => 'USD', 'amount_minor' => 8000]])
        ->and($atMarina->json('data.orders'))->toBe(2)
        ->and($atMarina->json('data.past_due'))->toBe(1)
        ->and($atMarina->json('data.overdue'))->toBe(1);

    $this->getJson(TODAY_URL.'?branch_id='.Str::uuid(), $this->world->headers)
        ->assertUnprocessable();
});

it('counts a 23:30 Beirut order on the Beirut day', function (): void {
    // 23:45 in Beirut on the tenth.
    $this->travelTo(CarbonImmutable::parse('2026-05-10 20:45:00', 'UTC'));

    todayOrder($this, '2026-05-10 20:30:00', 3000); // 23:30 on the tenth
    todayOrder($this, '2026-05-09 21:30:00', 3000); // 00:30 on the tenth
    todayOrder($this, '2026-05-09 20:30:00', 3000); // 23:30 on the ninth

    foreach (['', '?branch_id='.$this->mainId] as $query) {
        $data = $this->getJson(TODAY_URL.$query, $this->world->headers)->assertOk()->json('data');

        expect($data['day'])->toBe('2026-05-10')
            ->and($data['timezone'])->toBe('Asia/Beirut')
            ->and($data['orders'])->toBe(2)
            ->and($data['sales'])->toBe([['currency_code' => 'USD', 'amount_minor' => 6000]]);
    }
});

it('refuses a member without order.manage_organisation', function (): void {
    $viewer = RunWorld::member($this->orgId, 'today_viewer');

    forgetResolvedGuards();
    $this->actingAs($viewer);

    $this->getJson(TODAY_URL, $this->world->headers)->assertForbidden();
});
