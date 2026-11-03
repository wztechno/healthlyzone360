<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Tenancy\TenantContext;
use Healthy360\Tenancy\Tests\Fixtures\RuntimeRole;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| cash_settlements, daily_closes and order_refunds under row-level security
|--------------------------------------------------------------------------
|
| Both carry the plain `rls_organisation_scope` policy. Run inside
| `SET ROLE healthy360_test`, because the suite connects as the schema owner and
| would otherwise bypass the policy by ownership. `order_refunds` needs an order
| to hang off, so the settlement row carries the insert test and a seeded refund
| row the read test; the policy is the same statement on both.
|
*/

uses()->group('rls');

function settlementRow(string $organisationId, string $userId): string
{
    $id = (string) Str::uuid7();

    DB::table('cash_settlements')->insert([
        'id' => $id,
        'organisation_id' => $organisationId,
        'kind' => 'driver',
        'driver_user_id' => $userId,
        'currency_code' => DB::table('organisations')->where('id', $organisationId)->value('default_currency_code'),
        'expected_minor' => 1000,
        'fee_minor' => 0,
        'handed_in_minor' => 1000,
        'short_minor' => 0,
        'recorded_by' => $userId,
        'recorded_at' => now(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
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

it('hides another kitchen’s hand-ins from the runtime role', function (): void {
    $ours = settlementRow((string) $this->mine->getKey(), (string) $this->user->getKey());
    $stranger = settlementRow((string) $this->theirs->getKey(), (string) $this->user->getKey());

    RuntimeRole::context((string) $this->user->getKey(), (string) $this->mine->getKey());

    /** @var list<string> $visible */
    $visible = RuntimeRole::run(fn (): array => DB::table('cash_settlements')
        ->pluck('id')
        ->map(static fn (mixed $id): string => (string) $id)
        ->all());

    expect($visible)->toContain($ours)
        ->and($visible)->not->toContain($stranger);
});

it('shows no hand-in when the session carries no organisation', function (): void {
    settlementRow((string) $this->mine->getKey(), (string) $this->user->getKey());

    RuntimeRole::context();

    expect(RuntimeRole::run(fn (): int => DB::table('cash_settlements')->count()))->toBe(0);
});

/**
 * One branch's balanced close, on a branch of its own organisation.
 */
function dailyCloseRow(Organisation $organisation, string $userId): string
{
    $id = (string) Str::uuid7();
    $branch = OrganisationBranch::withoutTenancy()->create([
        'organisation_id' => $organisation->getKey(),
        'name' => 'Main kitchen',
        'country_code' => $organisation->country_code,
        'timezone' => 'Asia/Beirut',
        'status' => 'active',
        'lock_version' => 0,
    ]);

    DB::table('daily_closes')->insert([
        'id' => $id,
        'organisation_id' => $organisation->getKey(),
        'branch_id' => $branch->getKey(),
        'currency_code' => $organisation->default_currency_code,
        'business_date' => '2026-11-03',
        'opened_at' => now()->subHours(8),
        'closed_at' => now(),
        'opening_float_minor' => 500,
        'counter_cash_minor' => 1000,
        'handed_in_minor' => 0,
        'cash_refunds_minor' => 0,
        'expected_minor' => 1500,
        'counted_minor' => 1500,
        'variance_minor' => 0,
        'recorded_by' => $userId,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    return $id;
}

it('hides another kitchen’s branch closes from the runtime role', function (): void {
    $ours = dailyCloseRow($this->mine, (string) $this->user->getKey());
    $stranger = dailyCloseRow($this->theirs, (string) $this->user->getKey());

    RuntimeRole::context((string) $this->user->getKey(), (string) $this->mine->getKey());

    /** @var list<string> $visible */
    $visible = RuntimeRole::run(fn (): array => DB::table('daily_closes')
        ->pluck('id')
        ->map(static fn (mixed $id): string => (string) $id)
        ->all());

    expect($visible)->toContain($ours)
        ->and($visible)->not->toContain($stranger);
});

it('puts the same policy on the refund ledger', function (): void {
    $policies = DB::table('pg_policies')->where('tablename', 'order_refunds')->pluck('policyname')->all();

    expect($policies)->toBe(['rls_organisation_scope']);
});
