<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Illuminate\Support\Facades\Cache;
use PragmaRX\Google2FA\Google2FA;

/*
|--------------------------------------------------------------------------
| The foundation vertical slice over a cookie session — the Phase 4 gate
|--------------------------------------------------------------------------
|
| Login → hydration → organisation selection → branch selection → permission
| hydration → an organisation-scoped endpoint (plan §1), followed by the
| two-factor enrolment and challenge that the same session must support.
|
| The demonstration tenants are the fixture on purpose: the seeded catalogue
| is a contract, and this file is where it meets the HTTP API.
|
*/

beforeEach(function (): void {
    $this->seed();

    $this->withHeaders(firstPartyHeaders());

    $this->cedar = Organisation::query()->where('slug', 'cedar-clinic')->sole();
    $this->verdant = Organisation::query()->where('slug', 'verdant-kitchen')->sole();
    $this->hamra = OrganisationBranch::withoutTenancy()
        ->where('organisation_id', $this->cedar->getKey())
        ->where('name', 'Hamra')
        ->sole();
    $this->owner = User::query()->where('email', 'owner@cedar.test')->sole();
});

/**
 * Sign in as one of the demonstration accounts over a first-party session.
 */
function signIn(string $email): void
{
    test()->postJson('/api/v1/auth/login', ['email' => $email, 'password' => 'password'])
        ->assertOk()
        ->assertJsonPath('data.two_factor_required', false);
}

/**
 * The current one-time password for a shared secret.
 */
function currentOtp(string $secret): string
{
    return app(Google2FA::class)->getCurrentOtp($secret);
}

it('carries a person from login to an organisation-scoped endpoint', function (): void {
    signIn('owner@cedar.test');

    // Hydration: identity, profile, every workspace, no context yet.
    $me = $this->getJson('/api/v1/me')
        ->assertOk()
        ->assertJsonPath('data.user.email', 'owner@cedar.test')
        ->assertJsonPath('data.user.email_verified', true)
        ->assertJsonPath('data.user.two_factor_enabled', false)
        ->assertJsonPath('data.profile.given_name', 'Nadia')
        ->assertJsonPath('data.active_context', null)
        ->assertJsonStructure([
            'data' => [
                'user' => ['id', 'email', 'email_verified', 'two_factor_enabled'],
                'profile',
                'memberships' => [['id', 'status', 'branch_id', 'organisation' => ['id', 'slug', 'name', 'type', 'capabilities'], 'roles']],
                'active_context',
                'pending_consents',
            ],
            'meta' => ['correlation_id', 'permissions_version'],
        ]);

    expect($me->json('data.memberships.0.organisation.slug'))->toBe('cedar-clinic')
        ->and($me->json('data.memberships.0.roles'))->toBe(['organisation_owner'])
        ->and($me->json('data.memberships.0.organisation.capabilities'))->toBe(['clinic_services']);

    // Organisation and branch selection, validated server-side and
    // remembered on the profile.
    $this->putJson('/api/v1/me/context', [
        'organisation_id' => $this->cedar->getKey(),
        'branch_id' => $this->hamra->getKey(),
    ])
        ->assertOk()
        ->assertJsonPath('data.active_context.organisation.slug', 'cedar-clinic')
        ->assertJsonPath('data.active_context.branch.name', 'Hamra')
        ->assertJsonPath('data.active_context.entitlements', [])
        ->assertJsonFragment(['organisation.view_current']);

    $profile = UserProfile::query()->where('user_id', $this->owner->getKey())->sole();

    expect($profile->last_organisation_id)->toBe((string) $this->cedar->getKey())
        ->and($profile->last_branch_id)->toBe((string) $this->hamra->getKey());

    // The remembered context is the fallback when no headers are sent.
    $this->getJson('/api/v1/me')
        ->assertOk()
        ->assertJsonPath('data.active_context.organisation.slug', 'cedar-clinic')
        ->assertJsonPath('data.active_context.branch.name', 'Hamra');

    // Headers, membership and permission proven end to end.
    $this->getJson('/api/v1/organisations/current', [
        'X-Organisation-Id' => $this->cedar->getKey(),
        'X-Branch-Id' => $this->hamra->getKey(),
    ])
        ->assertOk()
        ->assertJsonPath('data.organisation.slug', 'cedar-clinic')
        ->assertJsonPath('data.branch.name', 'Hamra')
        ->assertHeader('X-Correlation-Id');
});

it('lists the workspaces a person may act under', function (): void {
    signIn('dietitian@cedar.test');

    $response = $this->getJson('/api/v1/me/memberships')
        ->assertOk()
        ->assertJsonPath('meta.count', 2);

    expect(collect($response->json('data'))->pluck('organisation.slug')->sort()->values()->all())
        ->toBe(['cedar-clinic', 'verdant-kitchen']);
});

it('refuses an organisation the person is not a member of', function (): void {
    signIn('owner@cedar.test');

    $this->getJson('/api/v1/organisations/current', ['X-Organisation-Id' => $this->verdant->getKey()])
        ->assertForbidden()
        ->assertJsonPath('error.code', 'context.organisation_forbidden');

    $this->putJson('/api/v1/me/context', ['organisation_id' => $this->verdant->getKey()])
        ->assertForbidden()
        ->assertJsonPath('error.code', 'context.organisation_forbidden');
});

it('refuses a branch outside the membership scope', function (): void {
    signIn('owner@cedar.test');

    $foreign = OrganisationBranch::withoutTenancy()
        ->where('organisation_id', $this->verdant->getKey())
        ->sole();

    $this->putJson('/api/v1/me/context', [
        'organisation_id' => $this->cedar->getKey(),
        'branch_id' => $foreign->getKey(),
    ])
        ->assertForbidden()
        ->assertJsonPath('error.code', 'context.branch_out_of_scope');
});

it('denies an active member whose roles do not grant the permission', function (): void {
    $patient = User::query()->where('email', 'patient@healthy360.test')->sole();

    $membership = OrganisationMembership::withoutTenancy()
        ->where('organisation_id', $this->cedar->getKey())
        ->where('user_id', $patient->getKey())
        ->sole();

    MembershipRole::withoutTenancy()->where('membership_id', $membership->getKey())->delete();

    signIn('patient@healthy360.test');

    $this->getJson('/api/v1/organisations/current', ['X-Organisation-Id' => $this->cedar->getKey()])
        ->assertForbidden()
        ->assertJsonPath('error.code', 'authz.permission_denied')
        ->assertJsonPath('error.details.reason', 'permission_not_granted')
        ->assertJsonPath('error.details.permission', 'organisation.view_current');
});

it('enrols two factor authentication and then requires it at the next login', function (): void {
    signIn('owner@cedar.test');

    $this->postJson('/api/v1/auth/two-factor-authentication')
        ->assertCreated()
        ->assertJsonPath('data.enabled', true)
        ->assertJsonPath('data.confirmed', false);

    $this->getJson('/api/v1/auth/two-factor-qr-code')
        ->assertOk()
        ->assertJsonStructure(['data' => ['svg', 'url']]);

    $secret = (string) $this->getJson('/api/v1/auth/two-factor-secret-key')
        ->assertOk()
        ->json('data.secret_key');

    // Not armed until the authenticator is proven to work.
    expect($this->owner->refresh()->hasEnabledTwoFactorAuthentication())->toBeFalse();

    $this->postJson('/api/v1/auth/confirmed-two-factor-authentication', ['code' => currentOtp($secret)])
        ->assertOk()
        ->assertJsonPath('data.confirmed', true);

    $recoveryCodes = $this->getJson('/api/v1/auth/two-factor-recovery-codes')
        ->assertOk()
        ->json('data.recovery_codes');

    expect($recoveryCodes)->toHaveCount(8);

    $this->postJson('/api/v1/auth/logout')
        ->assertOk()
        ->assertJsonPath('data.logged_out', true);

    // The 401 envelope itself is asserted in ErrorEnvelopeTest: within one
    // test process the resolved guards are cached, so the session state is
    // what proves the logout.
    $this->assertGuest('web');

    $this->postJson('/api/v1/auth/login', ['email' => 'owner@cedar.test', 'password' => 'password'])
        ->assertOk()
        ->assertJsonPath('data.two_factor_required', true);

    $this->postJson('/api/v1/auth/two-factor-challenge', ['code' => '000000'])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'auth.two_factor_invalid');

    // Fortify refuses a one-time password it has already accepted; the
    // enrolment code above is still inside its window.
    Cache::flush();

    $this->postJson('/api/v1/auth/two-factor-challenge', ['code' => currentOtp($secret)])
        ->assertOk()
        ->assertJsonPath('data.two_factor_required', false);

    $this->getJson('/api/v1/me')
        ->assertOk()
        ->assertJsonPath('data.user.two_factor_enabled', true);
});

it('requires a recent password confirmation before two factor authentication is switched off', function (): void {
    signIn('owner@cedar.test');

    $this->postJson('/api/v1/auth/two-factor-authentication')->assertCreated();

    $this->deleteJson('/api/v1/auth/two-factor-authentication')
        ->assertForbidden()
        ->assertJsonPath('error.code', 'auth.step_up_required')
        ->assertJsonPath('error.details.confirmation_endpoint', '/api/v1/auth/confirm-password');

    $this->getJson('/api/v1/auth/confirmed-password-status')
        ->assertOk()
        ->assertJsonPath('data.confirmed', false);

    $this->postJson('/api/v1/auth/confirm-password', ['password' => 'not-the-password'])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'auth.invalid_credentials');

    $this->postJson('/api/v1/auth/confirm-password', ['password' => 'password'])
        ->assertOk()
        ->assertJsonPath('data.confirmed', true);

    $this->deleteJson('/api/v1/auth/two-factor-authentication')
        ->assertOk()
        ->assertJsonPath('data.enabled', false);
});

it('sends a password reset link that points at the client application', function (): void {
    $this->postJson('/api/v1/auth/forgot-password', ['email' => 'owner@cedar.test'])
        ->assertStatus(202)
        ->assertJsonPath('data.sent', true);

    // An unknown address is answered identically: this endpoint must not
    // reveal which addresses have accounts.
    $this->postJson('/api/v1/auth/forgot-password', ['email' => 'nobody@example.test'])
        ->assertStatus(202)
        ->assertJsonPath('data.sent', true);
});

it('resets a password with a valid token and refuses an invalid one', function (): void {
    $token = app('auth.password.broker')->createToken($this->owner);

    $this->postJson('/api/v1/auth/reset-password', [
        'token' => 'not-a-token',
        'email' => 'owner@cedar.test',
        'password' => 'a-brand-new-password',
        'password_confirmation' => 'a-brand-new-password',
    ])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['token']]]]);

    $this->postJson('/api/v1/auth/reset-password', [
        'token' => $token,
        'email' => 'owner@cedar.test',
        'password' => 'a-brand-new-password',
        'password_confirmation' => 'a-brand-new-password',
    ])
        ->assertOk()
        ->assertJsonPath('data.password_reset', true);

    $this->postJson('/api/v1/auth/login', ['email' => 'owner@cedar.test', 'password' => 'a-brand-new-password'])
        ->assertOk()
        ->assertJsonPath('data.two_factor_required', false);
});
