<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Kitchens\Models\BranchClosure;
use Healthy360\Orders\Models\Order;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Subscriptions\Services\ChangeWindow;
use Healthy360\Subscriptions\Services\GenerationService;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Subscriptions\Tests\Fixtures\SubscriptionWorld;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Models\StaffNotification;
use Illuminate\Support\Facades\Mail;

/*
|--------------------------------------------------------------------------
| A closure date moves a standing delivery to the next open day
|--------------------------------------------------------------------------
|
| Owner, 3 Nov 2026: a subscription day on a holiday goes out on the next day
| the kitchen is open, and the managers get a bell alert so they can change it
| or tell the customer. A closure added over an order already generated moves
| it the same way. Every date is relative to the subscription's own first day,
| and the clock is frozen on it.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    Mail::fake();
    $this->withoutDefer();

    $this->world = SubscriptionWorld::build('closure-moves@kitchen.test', perDayMinor: 2000, days: 20);

    // The kitchen's user is its manager: the one who hears about a moved day.
    RolePermission::factory()->create([
        'organisation_id' => $this->world->organisation->getKey(),
        'role_id' => $this->world->tenant->role->getKey(),
        'permission_id' => Permission::query()->where('code', 'order.supervise_organisation')->sole()->getKey(),
    ]);

    $this->subscription = app(SubscriptionService::class)->create(SubscriptionWorld::request($this->world));
    $this->first = $this->subscription->next_generation_date->startOfDay();

    /** Shut the world's branch for these days, both ends inclusive. */
    $this->close = fn (CarbonImmutable $from, CarbonImmutable $to): BranchClosure => BranchClosure::withoutTenancy()->create([
        'organisation_id' => $this->world->organisation->getKey(),
        'branch_id' => $this->world->branch->getKey(),
        'closed_from' => $from->toDateString(),
        'closed_to' => $to->toDateString(),
    ]);

    /** Just past the first day's change cut-off, when generation makes it real. */
    $this->generateFirstDay = function (): array {
        CarbonImmutable::setTestNow(app(ChangeWindow::class)->deadlineFor($this->subscription->refresh(), $this->first)->addMinute());

        return app(GenerationService::class)->tick();
    };
});

afterEach(function (): void {
    CarbonImmutable::setTestNow();
});

function movedAlerts(): int
{
    return StaffNotification::withoutTenancy()->where('type', StaffAlertType::DeliveryMovedClosed->value)->count();
}

it('moves a subscription day on a closure to the next open day and alerts the managers once', function (): void {
    ($this->close)($this->first, $this->first->addDay());

    expect(($this->generateFirstDay)())->toMatchArray(['generated' => 1, 'skipped' => 0]);

    $order = Order::query()->sole();

    expect($order->requested_delivery_date->toDateString())->toBe($this->first->addDays(2)->toDateString())
        ->and($this->subscription->refresh()->balance_days_consumed)->toBe(1)
        ->and(movedAlerts())->toBe(1)
        ->and(StaffNotification::withoutTenancy()->where('subject_id', $order->getKey())->sole()->data['order_number'])->toBe($order->order_number);

    // A second tick on the same clock has nothing new to say.
    app(GenerationService::class)->tick();

    expect(movedAlerts())->toBe(1)
        ->and(Order::query()->count())->toBe(1);
});

it('leaves an open day where it is and says nothing', function (): void {
    ($this->close)($this->first->addDays(3), $this->first->addDays(3));

    ($this->generateFirstDay)();

    expect(Order::query()->sole()->requested_delivery_date->toDateString())->toBe($this->first->toDateString())
        ->and(movedAlerts())->toBe(0);
});

it('moves an order already generated when a closure is added over its day', function (): void {
    ($this->generateFirstDay)();

    $order = Order::query()->sole();
    $version = $order->lock_version;

    expect($order->requested_delivery_date->toDateString())->toBe($this->first->toDateString());

    ($this->close)($this->first, $this->first);

    $order->refresh();

    expect($order->requested_delivery_date->toDateString())->toBe($this->first->addDay()->toDateString())
        ->and($order->lock_version)->toBe($version + 1)
        ->and(movedAlerts())->toBe(1)
        ->and(AuditLog::query()->where('action', 'order.moved_off_closure')->where('subject_id', $order->getKey())->exists())->toBeTrue();
});

it('leaves an order the kitchen has started on its day', function (): void {
    ($this->generateFirstDay)();

    $order = Order::query()->sole();
    $order->forceFill(['preparing_at' => CarbonImmutable::now()])->save();

    ($this->close)($this->first, $this->first);

    expect($order->refresh()->requested_delivery_date->toDateString())->toBe($this->first->toDateString())
        ->and(movedAlerts())->toBe(0);
});

it('keeps the date and still alerts when nothing opens in two weeks', function (): void {
    ($this->close)($this->first, $this->first->addDays(30));

    ($this->generateFirstDay)();

    expect(StaffNotification::withoutTenancy()->where('type', StaffAlertType::DeliveryClosedUnmoved->value)->count())->toBe(1)
        ->and(movedAlerts())->toBe(0);
});
