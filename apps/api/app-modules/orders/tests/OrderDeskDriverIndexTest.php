<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The driver picker: who a kitchen may send out with its food
|--------------------------------------------------------------------------
|
| The list behind the Assign dialog. `POST /delivery/jobs/{job}/assign` refuses
| any `driver_user_id` that is not an **active** member of the organisation, and
| this is where a dispatcher legitimately obtains one — so the two have to apply
| the same predicate to the same table, or the dialog fails on its submit button
| for somebody the list offered.
|
| The predicate is the point of most of this file. `organisation_memberships`
| carries four statuses and only one of them is somebody a kitchen can send out:
| an invitation nobody accepted, a suspension and an ended employment are all
| rows, and all three read as "works here" to a query that checks only for the
| row's existence. Each is pinned separately rather than as one "not active"
| case, because the failure they guard against is a predicate that checks the
| wrong one.
|
| Names are why the endpoint exists at all, so the naming is pinned too — from
| `user_profiles`, not from `users`, which deliberately carries no name; and
| **nullable**, because a member with no profile yet is still a member and
| refusing to list them would leave a dispatcher unable to assign a job to
| somebody demonstrably on the payroll.
|
| The isolation test matters more than it looks: memberships are the one table
| here that is genuinely organisation-scoped, and the endpoint leans on the
| model's global scope rather than on a hand-written predicate. A test is the
| only thing that proves the lean was safe.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('dispatch@kitchen.test', ['order.manage_organisation']);
    $this->organisation = $this->tenant->organisation;
    $this->orgId = (string) $this->organisation->getKey();

    $this->headers = firstPartyHeaders() + ['X-Organisation-Id' => $this->orgId];

    $this->actingAs($this->tenant->user);
});

/**
 * Somebody on a kitchen's payroll, with a name if they have got round to
 * having one.
 *
 * The profile is separate from the user because the platform keeps it that way:
 * `users` holds an identity and `user_profiles` holds a person. A member with no
 * profile row is the state this fixture can produce on purpose, because it is a
 * state the endpoint has to answer for.
 */
function driverMember(
    string $organisationId,
    string $email,
    MembershipStatus $status = MembershipStatus::Active,
    ?string $givenName = null,
    ?string $familyName = null,
): User {
    $user = User::factory()->create(['email' => $email]);

    OrganisationMembership::factory()->create([
        'organisation_id' => $organisationId,
        'user_id' => $user->getKey(),
        'status' => $status,
    ]);

    if ($givenName !== null) {
        UserProfile::query()->create([
            'user_id' => $user->getKey(),
            'given_name' => $givenName,
            'family_name' => (string) $familyName,
            'preferred_language_code' => 'en',
            'timezone' => 'UTC',
            'numbering_system' => 'latn',
            'lock_version' => 0,
        ]);
    }

    return $user;
}

/**
 * A member holding exactly the named codes, so a permission test differs from
 * its neighbours in one thing only.
 *
 * @param  list<string>  $permissions
 */
function driverAgent(string $organisationId, string $email, array $permissions): User
{
    $user = User::factory()->create(['email' => $email]);

    $membership = OrganisationMembership::factory()->create([
        'organisation_id' => $organisationId,
        'user_id' => $user->getKey(),
    ]);

    $role = Role::factory()->create(['organisation_id' => $organisationId]);

    foreach ($permissions as $code) {
        RolePermission::factory()->create([
            'organisation_id' => $organisationId,
            'role_id' => $role->getKey(),
            'permission_id' => Permission::query()->where('code', $code)->sole()->getKey(),
        ]);
    }

    MembershipRole::factory()->create([
        'organisation_id' => $organisationId,
        'membership_id' => $membership->getKey(),
        'role_id' => $role->getKey(),
    ]);

    return $user;
}

it('lists every active member by name, alphabetically', function (): void {
    $zaher = driverMember($this->orgId, 'zaher@kitchen.test', givenName: 'Zaher', familyName: 'Haddad');
    $amal = driverMember($this->orgId, 'amal@kitchen.test', givenName: 'Amal', familyName: 'Nasr');

    $response = $this->getJson('/api/v1/catalogue/order-desk/drivers', $this->headers)->assertOk();

    // The kitchen's own owner is a member too, and comes from `PricingWorld`
    // without a profile — so the list is the three of them, named ones first.
    expect($response->json('data.0'))->toBe([
        'user_id' => (string) $amal->getKey(),
        'display_name' => 'Amal Nasr',
    ])
        ->and($response->json('data.1'))->toBe([
            'user_id' => (string) $zaher->getKey(),
            'display_name' => 'Zaher Haddad',
        ])
        ->and($response->json('meta.count'))->toBe(3)
        ->and($response->json('meta.limit'))->toBe(100);
});

it('lists a member with no profile, last and with a null name', function (): void {
    driverMember($this->orgId, 'named@kitchen.test', givenName: 'Amal', familyName: 'Nasr');
    $nameless = driverMember($this->orgId, 'nameless@kitchen.test');

    $response = $this->getJson('/api/v1/catalogue/order-desk/drivers', $this->headers)->assertOk();

    $rows = $response->json('data');

    // Two nameless members — the owner and this one — and both sort after the
    // named one. A fabricated name would be worse than a null: a dispatcher
    // reading "Unknown" twice cannot tell the two apart, and a null tells the
    // screen to render the em dash it renders for every other unknown.
    expect($rows[0]['display_name'])->toBe('Amal Nasr')
        ->and(array_column(array_slice($rows, 1), 'display_name'))->toBe([null, null])
        ->and(array_column($rows, 'user_id'))->toContain((string) $nameless->getKey());
});

it('leaves out everybody whose membership is not active', function (): void {
    $active = driverMember($this->orgId, 'active@kitchen.test', givenName: 'Active', familyName: 'Member');

    driverMember($this->orgId, 'invited@kitchen.test', MembershipStatus::Invited, 'Invited', 'Member');
    driverMember($this->orgId, 'suspended@kitchen.test', MembershipStatus::Suspended, 'Suspended', 'Member');
    driverMember($this->orgId, 'ended@kitchen.test', MembershipStatus::Ended, 'Ended', 'Member');

    $response = $this->getJson('/api/v1/catalogue/order-desk/drivers', $this->headers)->assertOk();

    $ids = $response->json('data.*.user_id');

    expect($ids)->toContain((string) $active->getKey())
        // The owner plus the one active member, and none of the other three.
        ->and($response->json('meta.count'))->toBe(2);
});

it('shows one kitchen nothing of another kitchen\'s staff', function (): void {
    $mine = driverMember($this->orgId, 'mine@kitchen.test', givenName: 'Mine', familyName: 'Member');

    $neighbour = PricingWorld::kitchen('neighbour@kitchen.test', ['order.manage_organisation']);
    $neighbourOrgId = (string) $neighbour->organisation->getKey();

    $theirs = driverMember($neighbourOrgId, 'theirs@kitchen.test', givenName: 'Theirs', familyName: 'Member');

    expect($this->getJson('/api/v1/catalogue/order-desk/drivers', $this->headers)->assertOk()->json('data.*.user_id'))
        ->toContain((string) $mine->getKey())
        ->not->toContain((string) $theirs->getKey());

    // Both directions: a filter that returned nothing to anybody would pass a
    // one-sided test.
    forgetResolvedGuards();
    $this->actingAs($neighbour->user);

    $ids = $this->getJson('/api/v1/catalogue/order-desk/drivers', firstPartyHeaders() + [
        'X-Organisation-Id' => $neighbourOrgId,
    ])->assertOk()->json('data.*.user_id');

    expect($ids)->toContain((string) $theirs->getKey())
        ->not->toContain((string) $mine->getKey());
});

it('refuses a caller who may read the book but not manage it', function (): void {
    $reader = driverAgent($this->orgId, 'reader@kitchen.test', ['order.view_organisation']);

    forgetResolvedGuards();
    $this->actingAs($reader);

    $this->getJson('/api/v1/catalogue/order-desk/drivers', $this->headers)->assertForbidden();
});

it('stops at a hundred rows', function (): void {
    // A hundred and five members, so the cap has something to cut. Names are
    // zero-padded so that alphabetical order is also numeric order and the
    // hundred that survive are provably the first hundred rather than an
    // arbitrary hundred.
    for ($index = 1; $index <= 105; $index++) {
        driverMember(
            $this->orgId,
            'driver'.$index.'@kitchen.test',
            givenName: 'Driver',
            familyName: str_pad((string) $index, 3, '0', STR_PAD_LEFT),
        );
    }

    $response = $this->getJson('/api/v1/catalogue/order-desk/drivers', $this->headers)->assertOk();

    expect($response->json('meta.count'))->toBe(100)
        ->and($response->json('meta.limit'))->toBe(100)
        ->and($response->json('data.0.display_name'))->toBe('Driver 001')
        ->and($response->json('data.99.display_name'))->toBe('Driver 100');
});
