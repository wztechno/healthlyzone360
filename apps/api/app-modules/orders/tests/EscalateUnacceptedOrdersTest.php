<?php

declare(strict_types=1);

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Customers\Database\Factories\CustomerAccountFactory;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Orders\Contracts\OrderSchedulingLookup;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Jobs\EscalateUnacceptedOrders;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Services\BranchScheduleLookup;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Models\StaffNotification;
use Healthy360\Tenancy\Tests\Fixtures\RuntimeRole;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Mail;

/*
|--------------------------------------------------------------------------
| Nothing chased an unaccepted order
|--------------------------------------------------------------------------
|
| The clock is pinned throughout: every figure here is a number of minutes.
|
| Pest connects as the migrator, which row-level security does not bind, so a job
| that forgot its tenant context would still pass everything below except the
| test wrapped in `RuntimeRole::run`. That one is the real shape of production,
| the application role with no context, where a policy answers zero rows and no
| error.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    Mail::fake();
    $this->withoutDefer();

    // A Monday, 12:00 in Beirut.
    $this->noon = CarbonImmutable::parse('2026-05-11 12:00:00', 'Asia/Beirut');
    $this->travelTo($this->noon);

    $this->tenant = PricingWorld::kitchen('escalate@kitchen.test', ['order.view_organisation']);
    $this->organisation = $this->tenant->organisation;
    $this->orgId = (string) $this->organisation->getKey();
    $this->channelId = (string) PricingWorld::channel($this->organisation, 'web-shop')->getKey();
    $this->customerId = (string) CustomerAccountFactory::new()->create()->getKey();

    $this->branch = OrganisationBranch::withoutTenancy()->create([
        'organisation_id' => $this->orgId,
        'name' => 'Main kitchen',
        'country_code' => 'LB',
        'city' => 'Beirut',
        'timezone' => 'Asia/Beirut',
        'status' => 'active',
        'lock_version' => 0,
    ]);

    $this->manager = escalationMember($this->orgId, 'duty_manager', ['order.supervise_organisation']);
    $this->owner = escalationMember($this->orgId, 'organisation_owner');
});

/**
 * @param  list<string>  $permissions
 */
function escalationMember(string $organisationId, string $roleCode, array $permissions = []): User
{
    $user = User::factory()->create();
    $role = Role::factory()->create(['organisation_id' => $organisationId, 'code' => $roleCode]);

    foreach ($permissions as $code) {
        RolePermission::factory()->create([
            'organisation_id' => $organisationId,
            'role_id' => $role->getKey(),
            'permission_id' => Permission::query()->where('code', $code)->sole()->getKey(),
        ]);
    }

    $membership = OrganisationMembership::factory()->create([
        'organisation_id' => $organisationId,
        'user_id' => $user->getKey(),
    ]);

    MembershipRole::factory()->create([
        'membership_id' => $membership->getKey(),
        'organisation_id' => $organisationId,
        'role_id' => $role->getKey(),
    ]);

    return $user;
}

function escalationOpenNineToSix(object $test): void
{
    foreach ([1, 2, 3, 4, 5, 6, 7] as $weekday) {
        BranchOpeningHour::withoutTenancy()->create([
            'organisation_id' => $test->orgId,
            'branch_id' => $test->branch->getKey(),
            'weekday' => $weekday,
            'opens_at' => '09:00:00',
            'closes_at' => '18:00:00',
        ]);
    }
}

function escalationHours(OrganisationBranch $branch, int $weekday, ?string $opens, ?string $closes): void
{
    BranchOpeningHour::withoutTenancy()->create([
        'organisation_id' => $branch->organisation_id,
        'branch_id' => $branch->getKey(),
        'weekday' => $weekday,
        'opens_at' => $opens,
        'closes_at' => $closes,
    ]);
}

/**
 * @param  array<string, mixed>  $attributes
 */
function escalationOrder(object $test, CarbonImmutable $placedAt, array $attributes = []): Order
{
    return Order::factory()->create([
        'organisation_id' => $test->orgId,
        'customer_account_id' => $test->customerId,
        'sales_channel_id' => $test->channelId,
        'placed_at' => $placedAt,
        ...$attributes,
    ]);
}

/**
 * @return list<string> the recipients of this alert about this order
 */
function escalated(Order $order, StaffAlertType $type): array
{
    /** @var list<string> $recipients */
    $recipients = StaffNotification::withoutTenancy()
        ->where('subject_id', $order->getKey())
        ->where('type', $type->value)
        ->pluck('user_id')
        ->all();

    return $recipients;
}

it('tells nobody before ten minutes', function (): void {
    escalationOpenNineToSix($this);
    $order = escalationOrder($this, $this->noon->subMinutes(9));

    EscalateUnacceptedOrders::dispatchSync();

    expect(escalated($order, StaffAlertType::UnacceptedManager))->toBe([])
        ->and(escalated($order, StaffAlertType::UnacceptedOwner))->toBe([]);
});

it('tells the managers at ten minutes and not yet the owner', function (): void {
    escalationOpenNineToSix($this);
    $order = escalationOrder($this, $this->noon->subMinutes(10));

    EscalateUnacceptedOrders::dispatchSync();

    expect(escalated($order, StaffAlertType::UnacceptedManager))->toBe([$this->manager->getKey()])
        ->and(escalated($order, StaffAlertType::UnacceptedOwner))->toBe([]);
});

it('tells the owner at twenty minutes', function (): void {
    escalationOpenNineToSix($this);
    $order = escalationOrder($this, $this->noon->subMinutes(20));

    EscalateUnacceptedOrders::dispatchSync();

    expect(escalated($order, StaffAlertType::UnacceptedManager))->toBe([$this->manager->getKey()])
        ->and(escalated($order, StaffAlertType::UnacceptedOwner))->toBe([$this->owner->getKey()]);
});

it('sends nothing new on a repeat run', function (): void {
    escalationOpenNineToSix($this);
    escalationOrder($this, $this->noon->subMinutes(30));

    EscalateUnacceptedOrders::dispatchSync();
    EscalateUnacceptedOrders::dispatchSync();

    expect(StaffNotification::withoutTenancy()->count())->toBe(2);
});

it('starts counting an order placed at 02:00 at opening time', function (): void {
    escalationOpenNineToSix($this);
    $order = escalationOrder($this, $this->noon->setTime(2, 0));

    $this->travelTo($this->noon->setTime(9, 9));
    EscalateUnacceptedOrders::dispatchSync();

    expect(escalated($order, StaffAlertType::UnacceptedManager))->toBe([]);

    $this->travelTo($this->noon->setTime(9, 10));
    EscalateUnacceptedOrders::dispatchSync();

    expect(escalated($order, StaffAlertType::UnacceptedManager))->toBe([$this->manager->getKey()]);
});

it('counts around the clock for a kitchen with no opening hours', function (): void {
    $order = escalationOrder($this, $this->noon->setTime(2, 0));

    $this->travelTo($this->noon->setTime(2, 10));
    EscalateUnacceptedOrders::dispatchSync();

    expect(escalated($order, StaffAlertType::UnacceptedManager))->toBe([$this->manager->getKey()]);
});

it('leaves a confirmed order alone', function (): void {
    $order = escalationOrder($this, $this->noon->subHours(2), [
        'status' => OrderStatus::Confirmed,
        'confirmed_at' => $this->noon->subHour(),
    ]);

    EscalateUnacceptedOrders::dispatchSync();

    expect(StaffNotification::withoutTenancy()->where('subject_id', $order->getKey())->count())->toBe(0);
});

it('applies the kitchen\'s own limits', function (): void {
    escalationOpenNineToSix($this);
    app(KitchenServiceSettingsLookup::class)->for($this->orgId)
        ->forceFill(['manager_alert_after_minutes' => 3, 'owner_alert_after_minutes' => 4])
        ->save();

    $order = escalationOrder($this, $this->noon->subMinutes(4));

    EscalateUnacceptedOrders::dispatchSync();

    expect(escalated($order, StaffAlertType::UnacceptedManager))->toBe([$this->manager->getKey()])
        ->and(escalated($order, StaffAlertType::UnacceptedOwner))->toBe([$this->owner->getKey()]);
});

it('skips a suspended kitchen', function (): void {
    $order = escalationOrder($this, $this->noon->subHour());
    $this->organisation->forceFill(['status' => OrganisationStatus::Suspended])->save();

    EscalateUnacceptedOrders::dispatchSync();

    expect(StaffNotification::withoutTenancy()->where('subject_id', $order->getKey())->count())->toBe(0);
});

it('works as the application role with no context, one kitchen\'s policy at a time', function (): void {
    escalationOpenNineToSix($this);
    $order = escalationOrder($this, $this->noon->subMinutes(10));

    RuntimeRole::context();
    RuntimeRole::run(fn () => EscalateUnacceptedOrders::dispatchSync());

    expect(escalated($order, StaffAlertType::UnacceptedManager))->toBe([$this->manager->getKey()]);
});

it('reports one bad kitchen and carries on to the next', function (): void {
    Exceptions::fake();

    $next = PricingWorld::kitchen('next-escalate@kitchen.test', ['order.view_organisation']);
    $nextId = (string) $next->organisation->getKey();
    $nextManager = escalationMember($nextId, 'duty_manager', ['order.supervise_organisation']);

    $bad = escalationOrder($this, $this->noon->subHour());
    $good = Order::factory()->create([
        'organisation_id' => $nextId,
        'customer_account_id' => $this->customerId,
        'sales_channel_id' => PricingWorld::channel($next->organisation, 'web-shop')->getKey(),
        'placed_at' => $this->noon->subHour(),
    ]);

    // One kitchen's sweep throws, in whichever order the two come up.
    $this->mock(OrderSchedulingLookup::class)
        ->shouldReceive('openMinutesForEach')
        ->andReturnUsing(function (array $spans) use ($bad): array {
            throw_if(array_key_exists((string) $bad->getKey(), $spans), RuntimeException::class, 'A kitchen in a bad state.');

            return array_map(static fn (): int => 60, $spans);
        });

    EscalateUnacceptedOrders::dispatchSync();

    expect(escalated($bad, StaffAlertType::UnacceptedManager))->toBe([])
        ->and(escalated($good, StaffAlertType::UnacceptedManager))->toBe([$nextManager->getKey()]);

    Exceptions::assertReported(RuntimeException::class);
});

describe('the open-minutes clock', function (): void {
    beforeEach(function (): void {
        $this->schedule = app(BranchScheduleLookup::class);
        $this->second = OrganisationBranch::withoutTenancy()->create([
            'organisation_id' => $this->orgId,
            'name' => 'Second kitchen',
            'country_code' => 'LB',
            'city' => 'Dubai',
            'timezone' => 'Asia/Dubai',
            'status' => 'active',
            'lock_version' => 0,
        ]);
    });

    it('reads each branch on its own clock and never counts a minute twice', function (): void {
        // Monday. Beirut (UTC+3) 09:00–10:00 is 06:00–07:00 UTC; Dubai (UTC+4) 10:30–11:30 is
        // 06:30–07:30 UTC. Together, 06:00–07:30 UTC.
        escalationHours($this->branch, 1, '09:00:00', '10:00:00');
        escalationHours($this->second, 1, '10:30:00', '11:30:00');
        foreach ([$this->branch, $this->second] as $branch) {
            foreach ([2, 3, 4, 5, 6, 7] as $weekday) {
                escalationHours($branch, $weekday, null, null);
            }
        }

        $minutes = $this->schedule->openMinutesSince(
            [(string) $this->branch->getKey(), (string) $this->second->getKey()],
            CarbonImmutable::parse('2026-05-11 05:00:00', 'UTC'),
            CarbonImmutable::parse('2026-05-11 12:00:00', 'UTC'),
        );

        expect($minutes)->toBe(90);
    });

    it('treats a row with no hours as closed, and a day with no row as unconfigured', function (): void {
        escalationHours($this->branch, 1, null, null);

        $id = (string) $this->branch->getKey();

        expect($this->schedule->openMinutesSince(
            [$id],
            CarbonImmutable::parse('2026-05-11 08:00:00', 'Asia/Beirut'),
            CarbonImmutable::parse('2026-05-11 12:00:00', 'Asia/Beirut'),
        ))->toBe(0)
            // Tuesday has no row at all: a missing setting cannot silence an alarm.
            ->and($this->schedule->openMinutesSince(
                [$id],
                CarbonImmutable::parse('2026-05-12 01:00:00', 'Asia/Beirut'),
                CarbonImmutable::parse('2026-05-12 02:00:00', 'Asia/Beirut'),
            ))->toBe(60);
    });

    it('counts every minute with no branch to read', function (): void {
        expect($this->schedule->openMinutesSince(
            [],
            CarbonImmutable::parse('2026-05-11 01:00:00', 'UTC'),
            CarbonImmutable::parse('2026-05-11 02:00:00', 'UTC'),
        ))->toBe(60);
    });

    it('answers a batch by key, the same as one at a time', function (): void {
        $id = (string) $this->branch->getKey();
        escalationHours($this->branch, 1, '09:00:00', '18:00:00');

        $answers = $this->schedule->openMinutesForEach([
            'a' => ['branch_ids' => [$id], 'from' => $this->noon->subMinutes(5)],
            'b' => ['branch_ids' => [$id], 'from' => $this->noon->subHours(6)],
        ], $this->noon);

        expect($answers)->toBe(['a' => 5, 'b' => 180]);
    });

    it('keeps counting across a midnight clock change', function (): void {
        // Beirut's clocks go forward at midnight on the last Sunday of March.
        $id = (string) $this->branch->getKey();
        foreach ([1, 2, 3, 4, 5, 6, 7] as $weekday) {
            escalationHours($this->branch, $weekday, '09:00:00', '10:00:00');
        }

        expect($this->schedule->openMinutesSince(
            [$id],
            CarbonImmutable::parse('2026-03-28 00:00:00', 'Asia/Beirut'),
            CarbonImmutable::parse('2026-03-31 00:00:00', 'Asia/Beirut'),
        ))->toBe(180);
    });
});
