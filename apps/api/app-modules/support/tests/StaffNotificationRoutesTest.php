<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Kitchens\Tests\Fixtures\KitchenWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Support\Models\StaffNotification;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| The bell's three routes
|--------------------------------------------------------------------------
|
| Two colleagues in one kitchen, both allowed a bell. The organisation policy
| lets each see the other's rows, so everything here is about `user_id`: the
| list, the single read and read-all each reach the caller's own rows only.
|
*/

/**
 * @param  list<string>  $permissions
 */
function bellMember(string $organisationId, array $permissions): User
{
    $user = User::factory()->create();

    $role = Role::factory()->create([
        'organisation_id' => $organisationId,
        'code' => 'bell_'.Str::lower(Str::random(6)),
    ]);

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

/**
 * @param  array<string, mixed>  $overrides
 */
function bellRow(User $user, string $organisationId, array $overrides = []): StaffNotification
{
    return StaffNotification::withoutTenancy()->create([
        'organisation_id' => $organisationId,
        'user_id' => $user->getKey(),
        'type' => 'allergy_order',
        'subject_type' => 'order',
        'subject_id' => (string) Str::uuid7(),
        'data' => ['order_number' => 'H-1001', 'total_minor' => 2500, 'currency_code' => 'USD', 'severe' => true],
        'created_at' => now(),
        ...$overrides,
    ]);
}

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->organisationId = (string) KitchenWorld::organisation()->getKey();
    $this->headers = firstPartyHeaders() + ['X-Organisation-Id' => $this->organisationId];
    $this->me = bellMember($this->organisationId, ['order.supervise_organisation']);
    $this->colleague = bellMember($this->organisationId, ['order.supervise_organisation']);

    $this->actingAs($this->me);
});

it('lists the caller\'s own rows, newest first, with their unread count', function (): void {
    $older = bellRow($this->me, $this->organisationId, ['created_at' => now()->subHour()]);
    $newer = bellRow($this->me, $this->organisationId, ['read_at' => now()]);
    bellRow($this->colleague, $this->organisationId);

    $this->getJson('/api/v1/catalogue/staff-notifications', $this->headers)
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.id', $newer->getKey())
        ->assertJsonPath('data.1.id', $older->getKey())
        ->assertJsonPath('data.1.type', 'allergy_order')
        ->assertJsonPath('data.1.order_id', $older->subject_id)
        ->assertJsonPath('data.1.order_number', 'H-1001')
        ->assertJsonPath('data.1.severe', true)
        ->assertJsonPath('data.1.read_at', null)
        ->assertJsonPath('meta.unread_count', 1);
});

it('counts every unread row, not only those on the page', function (): void {
    foreach (range(1, 31) as $ignored) {
        bellRow($this->me, $this->organisationId);
    }

    $this->getJson('/api/v1/catalogue/staff-notifications', $this->headers)
        ->assertOk()
        ->assertJsonCount(30, 'data')
        ->assertJsonPath('meta.unread_count', 31);
});

it('serves no money from the row', function (): void {
    bellRow($this->me, $this->organisationId);

    $body = $this->getJson('/api/v1/catalogue/staff-notifications', $this->headers)->assertOk()->json('data.0');

    expect($body)->not->toHaveKeys(['data', 'total_minor', 'currency_code']);
});

it('marks the caller\'s own row read, and keeps the first time', function (): void {
    $row = bellRow($this->me, $this->organisationId);

    $this->postJson("/api/v1/catalogue/staff-notifications/{$row->getKey()}/read", [], $this->headers)->assertNoContent();

    $first = $row->refresh()->read_at;
    expect($first)->not->toBeNull();

    $this->travel(5)->minutes();

    $this->postJson("/api/v1/catalogue/staff-notifications/{$row->getKey()}/read", [], $this->headers)->assertNoContent();

    expect($row->refresh()->read_at->equalTo($first))->toBeTrue();
});

it('answers 404 for a colleague\'s row and leaves it unread', function (): void {
    $theirs = bellRow($this->colleague, $this->organisationId);

    $this->postJson("/api/v1/catalogue/staff-notifications/{$theirs->getKey()}/read", [], $this->headers)
        ->assertNotFound()
        ->assertJsonPath('error.code', 'resource.not_found');

    expect($theirs->refresh()->read_at)->toBeNull();
});

it('answers 404 for an identifier that is not one', function (): void {
    $this->postJson('/api/v1/catalogue/staff-notifications/not-a-uuid/read', [], $this->headers)->assertNotFound();
});

it('marks all of the caller\'s rows read and none of a colleague\'s', function (): void {
    $mine = [bellRow($this->me, $this->organisationId), bellRow($this->me, $this->organisationId)];
    $theirs = bellRow($this->colleague, $this->organisationId);

    $this->postJson('/api/v1/catalogue/staff-notifications/read-all', [], $this->headers)->assertNoContent();

    expect($mine[0]->refresh()->read_at)->not->toBeNull()
        ->and($mine[1]->refresh()->read_at)->not->toBeNull()
        ->and($theirs->refresh()->read_at)->toBeNull();
});

it('refuses all three routes without the supervise permission', function (): void {
    $row = bellRow($this->me, $this->organisationId);
    $this->actingAs(bellMember($this->organisationId, ['order.manage_organisation']));

    $this->getJson('/api/v1/catalogue/staff-notifications', $this->headers)->assertForbidden();
    $this->postJson("/api/v1/catalogue/staff-notifications/{$row->getKey()}/read", [], $this->headers)->assertForbidden();
    $this->postJson('/api/v1/catalogue/staff-notifications/read-all', [], $this->headers)->assertForbidden();

    expect($row->refresh()->read_at)->toBeNull();
});
