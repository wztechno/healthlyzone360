<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\Kitchens\Models\KitchenServiceSettings;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Tenancy\TenantContext;
use Healthy360\Tenancy\Tests\Fixtures\RuntimeRole;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| staff_notifications and kitchen_service_settings under row-level security
|--------------------------------------------------------------------------
|
| A separate file from `RlsTest`, whose `rlsTenant()` builds the older protected
| tables and nothing else. Both tables here carry the plain
| `rls_organisation_scope` policy.
|
| Everything runs inside `SET ROLE healthy360_test`, because the suite connects
| as the schema owner and would otherwise bypass the policies by ownership.
|
*/

uses()->group('rls');

/**
 * Written as the schema owner, so the row exists whatever the policy decides.
 */
function staffAlertRow(string $organisationId, string $userId): string
{
    $id = (string) Str::uuid7();

    DB::table('staff_notifications')->insert(staffAlertColumns($id, $organisationId, $userId));

    return $id;
}

/**
 * @return array<string, mixed>
 */
function staffAlertColumns(string $id, string $organisationId, string $userId): array
{
    return [
        'id' => $id,
        'organisation_id' => $organisationId,
        'user_id' => $userId,
        'type' => 'order_not_accepted',
        'subject_type' => 'order',
        'subject_id' => (string) Str::uuid7(),
        'data' => '{}',
        'created_at' => now(),
    ];
}

/**
 * @return array<string, mixed>
 */
function kitchenSettingsColumns(string $organisationId): array
{
    return [
        'id' => (string) Str::uuid7(),
        'organisation_id' => $organisationId,
        'order_lead_minutes' => 120,
        'alarm_after_minutes' => 5,
        'manager_alert_after_minutes' => 10,
        'owner_alert_after_minutes' => 20,
        'created_at' => now(),
        'updated_at' => now(),
    ];
}

beforeEach(function (): void {
    app(TenantContext::class)->clear();

    $this->mine = Organisation::factory()->create();
    $this->theirs = Organisation::factory()->create();
    $this->user = User::factory()->create();
});

afterEach(function (): void {
    RuntimeRole::context();
});

it('hides another kitchen’s notifications from the runtime role', function (): void {
    $ours = staffAlertRow((string) $this->mine->getKey(), (string) $this->user->getKey());
    $stranger = staffAlertRow((string) $this->theirs->getKey(), (string) $this->user->getKey());

    RuntimeRole::context((string) $this->user->getKey(), (string) $this->mine->getKey());

    /** @var list<string> $visible */
    $visible = RuntimeRole::run(fn (): array => DB::table('staff_notifications')
        ->pluck('id')
        ->map(static fn (mixed $id): string => (string) $id)
        ->all());

    expect($visible)->toContain($ours)
        ->and($visible)->not->toContain($stranger);
});

it('shows no notification when the session carries no organisation', function (): void {
    staffAlertRow((string) $this->mine->getKey(), (string) $this->user->getKey());

    RuntimeRole::context();

    expect(RuntimeRole::run(fn (): int => DB::table('staff_notifications')->count()))->toBe(0);
});

it('refuses a notification written into somebody else’s organisation', function (): void {
    RuntimeRole::context((string) $this->user->getKey(), (string) $this->mine->getKey());

    // A savepoint, so the WITH CHECK violation does not abort the transaction
    // the test itself is running inside.
    $insert = fn () => DB::transaction(fn () => DB::table('staff_notifications')->insert(
        staffAlertColumns((string) Str::uuid7(), (string) $this->theirs->getKey(), (string) $this->user->getKey()),
    ));

    RuntimeRole::run(function () use ($insert): void {
        expect($insert)->toThrow(QueryException::class);
    });

    expect(DB::table('staff_notifications')->count())->toBe(0);
});

it('alerts one person about one subject once', function (): void {
    $row = staffAlertColumns((string) Str::uuid7(), (string) $this->mine->getKey(), (string) $this->user->getKey());

    DB::table('staff_notifications')->insert($row);

    $repeat = fn () => DB::transaction(fn () => DB::table('staff_notifications')->insert([...$row, 'id' => (string) Str::uuid7()]));

    expect($repeat)->toThrow(QueryException::class);
});

it('hides another kitchen’s settings from the runtime role', function (): void {
    DB::table('kitchen_service_settings')->insert([
        kitchenSettingsColumns((string) $this->mine->getKey()),
        kitchenSettingsColumns((string) $this->theirs->getKey()),
    ]);

    RuntimeRole::context((string) $this->user->getKey(), (string) $this->mine->getKey());

    /** @var list<string> $visible */
    $visible = RuntimeRole::run(fn (): array => DB::table('kitchen_service_settings')
        ->pluck('organisation_id')
        ->map(static fn (mixed $id): string => (string) $id)
        ->all());

    expect($visible)->toBe([(string) $this->mine->getKey()]);
});

it('shows no settings when the session carries no organisation', function (): void {
    DB::table('kitchen_service_settings')->insert(kitchenSettingsColumns((string) $this->mine->getKey()));

    RuntimeRole::context();

    expect(RuntimeRole::run(fn (): int => DB::table('kitchen_service_settings')->count()))->toBe(0);
});

it('creates a kitchen’s settings with the defaults on first read, once', function (): void {
    $organisationId = (string) $this->mine->getKey();
    $lookup = app(KitchenServiceSettingsLookup::class);

    RuntimeRole::context((string) $this->user->getKey(), $organisationId);

    [$first, $second] = RuntimeRole::run(fn (): array => [$lookup->for($organisationId), $lookup->for($organisationId)]);

    expect($first->order_lead_minutes)->toBe(120)
        ->and($first->alarm_after_minutes)->toBe(5)
        ->and($first->manager_alert_after_minutes)->toBe(10)
        ->and($first->owner_alert_after_minutes)->toBe(20)
        ->and($second->getKey())->toBe($first->getKey())
        ->and(KitchenServiceSettings::withoutTenancy()->where('organisation_id', $organisationId)->count())->toBe(1);
});
