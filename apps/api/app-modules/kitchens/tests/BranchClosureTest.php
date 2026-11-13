<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Kitchens\Models\BranchClosure;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Orders\Services\BranchScheduleLookup;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| A holiday closes a branch that its week says is open
|--------------------------------------------------------------------------
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('closure@kitchen.test', ['branch.view_current', 'branch.manage_current']);
    $this->orgId = (string) $this->tenant->organisation->getKey();
    $this->branch = OrganisationBranch::withoutTenancy()->create([
        'organisation_id' => $this->orgId,
        'name' => 'Main kitchen',
        'country_code' => 'LB',
        'city' => 'Beirut',
        'timezone' => 'Asia/Beirut',
        'status' => 'active',
        'lock_version' => 0,
    ]);

    foreach (range(1, 7) as $weekday) {
        BranchOpeningHour::withoutTenancy()->create([
            'organisation_id' => $this->orgId,
            'branch_id' => $this->branch->getKey(),
            'weekday' => $weekday,
            'opens_at' => '09:00:00',
            'closes_at' => '21:00:00',
        ]);
    }

    $this->headers = firstPartyHeaders() + ['X-Organisation-Id' => $this->orgId, 'X-Branch-Id' => (string) $this->branch->getKey()];
    $this->actingAs($this->tenant->user);
    $this->travelTo(CarbonImmutable::parse('2026-11-10 12:00:00', 'Asia/Beirut'));
});

it('refuses every date inside a closure, and the days around it stay open', function (): void {
    $this->postJson('/api/v1/kitchen/branch-closures', [
        'closed_from' => '2026-11-22',
        'closed_to' => '2026-11-23',
        'note' => 'Independence day',
    ], $this->headers)->assertCreated();

    $schedule = app(BranchScheduleLookup::class);
    $now = CarbonImmutable::now();
    $branchId = (string) $this->branch->getKey();

    expect($schedule->explain($branchId, CarbonImmutable::parse('2026-11-22'), $now)['reason'])->toBe('closed')
        ->and($schedule->explain($branchId, CarbonImmutable::parse('2026-11-23'), $now)['reason'])->toBe('closed')
        ->and($schedule->explain($branchId, CarbonImmutable::parse('2026-11-21'), $now)['accepted'])->toBeTrue()
        ->and($schedule->explain($branchId, CarbonImmutable::parse('2026-11-24'), $now)['accepted'])->toBeTrue();
});

it('stops the waiting-time clock across a closure', function (): void {
    BranchClosure::withoutTenancy()->create([
        'organisation_id' => $this->orgId,
        'branch_id' => $this->branch->getKey(),
        'closed_from' => '2026-11-10',
        'closed_to' => '2026-11-10',
    ]);

    $minutes = app(BranchScheduleLookup::class)->openMinutesSince(
        [(string) $this->branch->getKey()],
        CarbonImmutable::parse('2026-11-10 09:00:00', 'Asia/Beirut'),
        CarbonImmutable::parse('2026-11-10 12:00:00', 'Asia/Beirut'),
    );

    expect($minutes)->toBe(0);
});

it('lists what is coming and removes one', function (): void {
    $id = $this->postJson('/api/v1/kitchen/branch-closures', [
        'closed_from' => '2026-12-25',
        'closed_to' => '2026-12-25',
    ], $this->headers)->assertCreated()->json('data.id');

    $this->getJson('/api/v1/kitchen/branch-closures', $this->headers)->assertOk()->assertJsonPath('data.0.id', $id);
    $this->deleteJson("/api/v1/kitchen/branch-closures/{$id}", [], $this->headers)->assertNoContent();
    $this->getJson('/api/v1/kitchen/branch-closures', $this->headers)->assertOk()->assertJsonCount(0, 'data');
});

it('refuses a range that ends before it starts', function (): void {
    $this->postJson('/api/v1/kitchen/branch-closures', [
        'closed_from' => '2026-12-25',
        'closed_to' => '2026-12-24',
    ], $this->headers)->assertUnprocessable();
});

it('needs the branch code to write', function (): void {
    $reader = PricingWorld::kitchen('reader@kitchen.test', ['branch.view_current']);

    $this->actingAs($reader->user)
        ->postJson('/api/v1/kitchen/branch-closures', ['closed_from' => '2026-12-25', 'closed_to' => '2026-12-25'], firstPartyHeaders() + ['X-Organisation-Id' => (string) $reader->organisation->getKey()])
        ->assertForbidden();
});

it('opens a branch with the kitchen’s country and timezone', function (): void {
    $response = $this->postJson('/api/v1/kitchen/branches', ['name' => 'Jounieh', 'city' => 'Jounieh'], $this->headers)
        ->assertCreated()
        ->assertJsonPath('data.name', 'Jounieh');

    $branch = OrganisationBranch::withoutTenancy()->whereKey($response->json('data.id'))->sole();

    expect($branch->organisation_id)->toBe($this->orgId)
        ->and($branch->country_code)->toBe($this->tenant->organisation->country_code)
        ->and($branch->timezone)->not->toBe('');
});
