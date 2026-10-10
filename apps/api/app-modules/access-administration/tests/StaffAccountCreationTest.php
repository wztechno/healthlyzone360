<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessAdministration\Tests\Fixtures\AccessWorld;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| Opening an account for somebody standing in front of you
|--------------------------------------------------------------------------
|
| The one path on this platform where a member of staff creates an identity
| *about* somebody else, and it exists because the alternative for a kitchen
| hand with no email address is no account at all.
|
| Three departures from `CreateNewUser` are asserted here rather than left to be
| noticed: the account is created email-verified (a staff area demands it, and a
| provisioned address often receives no mail), it must change its password at
| first sign-in (so what the administrator knows is good for one sign-in), and
| it collects no consent (a kitchen cannot accept terms on an employee's
| behalf).
|
*/

beforeEach(function (): void {
    $this->seed(ReferenceDataSeeder::class);
    $this->seed(OrganisationTypeSeeder::class);
    $this->seed(AccessControlSeeder::class);
});

/** Step-up is a recent password confirmation; in a session test that is one key. */
function steppedUp(): void
{
    session()->put('auth.password_confirmed_at', time());
}

function staffBody(array $overrides = []): array
{
    return array_merge([
        'email' => 'ahmad.khalil@verdant.test',
        'given_name' => 'Ahmad',
        'family_name' => 'Khalil',
        'password' => 'correct horse battery staple',
        'role_ids' => [],
        'branch_id' => null,
    ], $overrides);
}

it('creates the account, the profile, the contact point, the membership and the role at once', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $role = AccessWorld::role($tenant->organisation, 'line_cook', ['recipe.view_organisation']);
    steppedUp();

    $response = $this->actingAs($tenant->user)
        ->postJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/staff",
            staffBody(['role_ids' => [(string) $role->getKey()]]),
            AccessWorld::headers($tenant),
        )
        ->assertCreated()
        ->assertJsonPath('data.membership.email', 'ahmad.khalil@verdant.test')
        ->assertJsonPath('data.membership.given_name', 'Ahmad')
        ->assertJsonPath('data.membership.status', 'active')
        ->assertJsonPath('data.membership.permissions', ['recipe.view_organisation']);

    $user = User::query()->where('email', 'ahmad.khalil@verdant.test')->sole();

    expect($user->profile)->not->toBeNull()
        ->and($user->profile->given_name)->toBe('Ahmad')
        // The administrator vouches, and the row records who: this identity did
        // not create itself.
        ->and((string) $user->profile->created_by)->toBe((string) $tenant->user->getKey());

    $contact = ContactPoint::query()->where('user_id', $user->getKey())->sole();

    expect($contact->is_login_identity)->toBeTrue()
        // `staff`, the only durable record of *how* this identity came to
        // exist — what a later review reads to tell a self-registered account
        // from a provisioned one.
        ->and($contact->source)->toBe('staff')
        ->and($contact->verified_at)->not->toBeNull();

    $membership = OrganisationMembership::withoutTenancy()->where('user_id', $user->getKey())->sole();

    expect(MembershipRole::withoutTenancy()->where('membership_id', $membership->getKey())->count())->toBe(1);
});

it('creates the account email-verified so it can enter the workspace it was made for', function (): void {
    // A staff area requires a verified address, and a provisioned address
    // frequently receives no mail — so waiting for a link would create an
    // account that can never enter the workspace it exists for.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    steppedUp();

    $this->actingAs($tenant->user)
        ->postJson("/api/v1/organisations/{$tenant->organisation->getKey()}/staff", staffBody(), AccessWorld::headers($tenant))
        ->assertCreated();

    expect(User::query()->where('email', 'ahmad.khalil@verdant.test')->sole()->hasVerifiedEmail())->toBeTrue();
});

it('obliges the new account to replace the password it was handed', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    steppedUp();

    $this->actingAs($tenant->user)
        ->postJson("/api/v1/organisations/{$tenant->organisation->getKey()}/staff", staffBody(), AccessWorld::headers($tenant))
        ->assertCreated();

    $user = User::query()->where('email', 'ahmad.khalil@verdant.test')->sole();

    expect($user->must_change_password)->toBeTrue();

    forgetResolvedGuards();

    // And `/me` says so, because that is where the client reads it.
    $this->actingAs($user)->getJson('/api/v1/me')
        ->assertOk()
        ->assertJsonPath('data.user.must_change_password', true);
});

it('returns the password exactly once, and never writes it anywhere readable', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    steppedUp();

    $response = $this->actingAs($tenant->user)
        ->postJson("/api/v1/organisations/{$tenant->organisation->getKey()}/staff", staffBody(), AccessWorld::headers($tenant))
        ->assertCreated()
        ->assertJsonPath('data.initial_password', 'correct horse battery staple');

    $membershipId = $response->json('data.membership.membership_id');

    // Not on the read that follows it. The model is
    // `InvitationService::issue()`, which returns its plaintext once and drops
    // it — the reason a database read cannot be turned into a credential.
    $this->actingAs($tenant->user)
        ->getJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/memberships/{$membershipId}",
            AccessWorld::headers($tenant),
        )
        ->assertOk()
        ->assertJsonMissingPath('data.initial_password');

    // And nowhere in the audit trail. Read straight off the connection rather
    // than through the model, so the assertion cannot be satisfied by a scope
    // hiding the row that would have failed it.
    $audit = collect(DB::connection('pgsql_migrations')->table('audit_logs')->get())
        ->map(static fn (object $row): string => json_encode($row) ?: '')
        ->implode(' ');

    expect($audit)->not->toContain('correct horse battery staple');
});

it('composes the address from a sign-in name and the kitchen’s own domain', function (): void {
    // The whole reason the feature exists: a kitchen hand types `ahmad.khalil`
    // and never has to remember the rest.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $tenant->organisation->forceFill(['staff_email_domain' => 'verdant.h360.test'])->save();
    steppedUp();

    $this->actingAs($tenant->user)
        ->postJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/staff",
            staffBody(['email' => null, 'local_part' => 'ahmad.khalil']),
            AccessWorld::headers($tenant),
        )
        ->assertCreated()
        ->assertJsonPath('data.membership.email', 'ahmad.khalil@verdant.h360.test');
});

it('refuses a sign-in name when the kitchen has no domain to compose against', function (): void {
    // It never guesses. A generated address nobody chose is an address nobody
    // can be told, and the first person to discover it would be somebody locked
    // out of their own account.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    steppedUp();

    $this->actingAs($tenant->user)
        ->postJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/staff",
            staffBody(['email' => null, 'local_part' => 'ahmad.khalil']),
            AccessWorld::headers($tenant),
        )
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');
});

it('refuses a body carrying both an address and a sign-in name', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    steppedUp();

    $this->actingAs($tenant->user)
        ->postJson(
            "/api/v1/organisations/{$tenant->organisation->getKey()}/staff",
            staffBody(['local_part' => 'ahmad.khalil']),
            AccessWorld::headers($tenant),
        )
        ->assertStatus(422);
});

it('refuses an address somebody already signs in with', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    User::factory()->create(['email' => 'ahmad.khalil@verdant.test']);
    steppedUp();

    $this->actingAs($tenant->user)
        ->postJson("/api/v1/organisations/{$tenant->organisation->getKey()}/staff", staffBody(), AccessWorld::headers($tenant))
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');
});

it('replays an idempotency key without creating a second person', function (): void {
    // A role has a natural key and a person does not: an administrator who does
    // not know whether a password was issued must either create a second
    // account or leave somebody unable to sign in.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    steppedUp();

    $headers = AccessWorld::headers($tenant) + ['Idempotency-Key' => 'staff-create-once'];

    $first = $this->actingAs($tenant->user)
        ->postJson("/api/v1/organisations/{$tenant->organisation->getKey()}/staff", staffBody(), $headers)
        ->assertCreated();

    $second = $this->actingAs($tenant->user)
        ->postJson("/api/v1/organisations/{$tenant->organisation->getKey()}/staff", staffBody(), $headers)
        ->assertCreated();

    expect($second->json('data.membership.membership_id'))->toBe($first->json('data.membership.membership_id'))
        ->and(User::query()->where('email', 'ahmad.khalil@verdant.test')->count())->toBe(1);
});

it('demands the authority to invite as well as the authority to create a login', function (): void {
    // Minting a login and granting it a seat are two decisions, and a kitchen
    // may want somebody who can do the second without the first.
    $tenant = AccessWorld::kitchen('limited@verdant.test', [
        'organisation.view_current',
        'membership.view_organisation',
        'role.view_organisation',
        'user.manage_organisation',
    ]);
    steppedUp();

    $this->actingAs($tenant->user)
        ->postJson("/api/v1/organisations/{$tenant->organisation->getKey()}/staff", staffBody(), AccessWorld::headers($tenant))
        ->assertForbidden()
        ->assertJsonPath('error.details.required_permission', 'membership.invite_organisation');
});

it('demands a recent password confirmation', function (): void {
    // A hijacked session minting itself a second, permanently-privileged
    // account is exactly what step-up exists for.
    $tenant = AccessWorld::kitchen('admin@verdant.test');

    $this->actingAs($tenant->user)
        ->postJson("/api/v1/organisations/{$tenant->organisation->getKey()}/staff", staffBody(), AccessWorld::headers($tenant))
        ->assertForbidden()
        ->assertJsonPath('error.code', 'auth.step_up_required');
});

it('lets the new person sign in and clears the flag when they choose their own password', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    steppedUp();

    $this->actingAs($tenant->user)
        ->postJson("/api/v1/organisations/{$tenant->organisation->getKey()}/staff", staffBody(), AccessWorld::headers($tenant))
        ->assertCreated();

    $staff = User::query()->where('email', 'ahmad.khalil@verdant.test')->sole();

    // The administrator's session has to go, not just the resolved guard: the
    // Fortify routes resolve a session user through Sanctum's stateful path,
    // so a surviving cookie would keep answering as the person who created
    // this account rather than the person who now holds it.
    $this->flushSession();
    forgetResolvedGuards();

    // `actingAs(..., 'sanctum')`: the Fortify routes are grouped under
    // `config('fortify.middleware')`, which is `api` without `statefulApi()`,
    // so the guard has to be named rather than inferred. The idiom
    // `ErrorEnvelopeTest` uses for the same reason.
    $this->actingAs($staff, 'sanctum')
        ->putJson('/api/v1/auth/user/password', [
            // Required even on a forced first change: a session is not a
            // password, and one exercisable from an abandoned session would
            // hand the credential to the wrong person.
            'current_password' => 'correct horse battery staple',
            'password' => 'a quite different passphrase',
            'password_confirmation' => 'a quite different passphrase',
        ], firstPartyHeaders())
        ->assertOk()
        ->assertJsonPath('data.must_change_password', false);

    expect($staff->refresh()->must_change_password)->toBeFalse();
});

it('refuses a password change that cannot name the current password', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    steppedUp();

    $this->actingAs($tenant->user)
        ->postJson("/api/v1/organisations/{$tenant->organisation->getKey()}/staff", staffBody(), AccessWorld::headers($tenant))
        ->assertCreated();

    $staff = User::query()->where('email', 'ahmad.khalil@verdant.test')->sole();

    // The administrator's session has to go, not just the resolved guard: the
    // Fortify routes resolve a session user through Sanctum's stateful path,
    // so a surviving cookie would keep answering as the person who created
    // this account rather than the person who now holds it.
    $this->flushSession();
    forgetResolvedGuards();

    // `actingAs(..., 'sanctum')`: the Fortify routes are grouped under
    // `config('fortify.middleware')`, which is `api` without `statefulApi()`,
    // so the guard has to be named rather than inferred. The idiom
    // `ErrorEnvelopeTest` uses for the same reason.
    $this->actingAs($staff, 'sanctum')
        ->putJson('/api/v1/auth/user/password', [
            'current_password' => 'not the password',
            'password' => 'a quite different passphrase',
            'password_confirmation' => 'a quite different passphrase',
        ], firstPartyHeaders())
        ->assertStatus(422);

    expect($staff->refresh()->must_change_password)->toBeTrue();
});
