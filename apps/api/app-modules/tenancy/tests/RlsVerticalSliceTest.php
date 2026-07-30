<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Consent\Models\ConsentGrant;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Tenancy\Tests\Fixtures\RuntimeRole;

/*
|--------------------------------------------------------------------------
| The vertical slice with row-level security in force — the other half of
| the Phase 6 gate
|--------------------------------------------------------------------------
|
| RLS failing closed is only half the requirement; it must also not break the
| workflow that was already accepted. These tests drive the real HTTP stack
| with the connection switched to the runtime role, so every query the request
| makes is subject to the policies — exactly as it is behind
| http://localhost:8080, where the application authenticates as
| healthy360_app.
|
| The demonstration tenants are the fixture because the seeded catalogue is
| the contract the frontend is written against.
|
*/

uses()->group('rls');

beforeEach(function (): void {
    $this->seed();

    $this->withHeaders(firstPartyHeaders());

    $this->cedar = Organisation::query()->where('slug', 'cedar-clinic')->sole();
    $this->hamra = OrganisationBranch::withoutTenancy()
        ->where('organisation_id', $this->cedar->getKey())
        ->where('name', 'Hamra')
        ->sole();
    $this->owner = User::query()->where('email', 'owner@cedar.test')->sole();
});

it('registers, hydrates and reaches an organisation-scoped endpoint as the runtime role', function (): void {
    RuntimeRole::run(function (): void {
        // Registration writes consent_grants before anyone is authenticated:
        // the ledger has to declare the data subject to the session itself,
        // or the WITH CHECK fails and nobody can create an account.
        $this->postJson('/api/v1/auth/register', [
            'email' => 'rls@healthy360.test',
            'password' => 'Str0ng!Passphrase#7',
            'password_confirmation' => 'Str0ng!Passphrase#7',
            'given_name' => 'Rania',
            'family_name' => 'Saad',
            'accepts_terms' => true,
            'accepts_privacy' => true,
        ])->assertCreated();
    });

    $registered = User::query()->where('email', 'rls@healthy360.test')->sole();

    expect(ConsentGrant::withoutTenancy()->where('user_id', $registered->getKey())->count())->toBe(2);

    RuntimeRole::run(function (): void {
        $this->postJson('/api/v1/auth/login', ['email' => 'owner@cedar.test', 'password' => 'password'])
            ->assertOk();

        // /me runs on app.user_id alone until it resolves a context: the
        // person's own memberships and consents are readable, nothing else.
        $this->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('data.user.email', 'owner@cedar.test')
            ->assertJsonPath('data.active_context', null)
            ->assertJsonCount(1, 'data.memberships')
            ->assertJsonPath('data.memberships.0.organisation.slug', 'cedar-clinic')
            ->assertJsonPath('data.memberships.0.roles.0', 'organisation_owner');

        $this->putJson('/api/v1/me/context', [
            'organisation_id' => (string) $this->cedar->getKey(),
            'branch_id' => (string) $this->hamra->getKey(),
        ])->assertOk()
            ->assertJsonPath('data.active_context.organisation.slug', 'cedar-clinic')
            ->assertJsonPath('data.active_context.branch.name', 'Hamra');

        $this->withHeaders([
            'X-Organisation-Id' => (string) $this->cedar->getKey(),
            'X-Branch-Id' => (string) $this->hamra->getKey(),
        ])->getJson('/api/v1/organisations/current')
            ->assertOk()
            ->assertJsonPath('data.organisation.slug', 'cedar-clinic')
            ->assertJsonPath('data.branch.name', 'Hamra');
    });
});

it('lists both workspaces of a person who belongs to two organisations', function (): void {
    RuntimeRole::run(function (): void {
        $this->postJson('/api/v1/auth/login', ['email' => 'dietitian@cedar.test', 'password' => 'password'])
            ->assertOk();

        $slugs = $this->getJson('/api/v1/me/memberships')
            ->assertOk()
            ->json('data.*.organisation.slug');

        expect($slugs)->toEqualCanonicalizing(['cedar-clinic', 'verdant-kitchen']);
    });
});

it('still refuses an organisation the caller is not a member of', function (): void {
    $verdant = Organisation::query()->where('slug', 'verdant-kitchen')->sole();

    RuntimeRole::run(function () use ($verdant): void {
        $this->postJson('/api/v1/auth/login', ['email' => 'owner@cedar.test', 'password' => 'password'])
            ->assertOk();

        $this->withHeader('X-Organisation-Id', (string) $verdant->getKey())
            ->getJson('/api/v1/organisations/current')
            ->assertForbidden();
    });
});

it('records the organisation read as an audited classified access', function (): void {
    AuditLog::query()->delete();

    RuntimeRole::run(function (): void {
        $this->postJson('/api/v1/auth/login', ['email' => 'owner@cedar.test', 'password' => 'password'])
            ->assertOk();

        $this->withHeaders([
            'X-Organisation-Id' => (string) $this->cedar->getKey(),
            'X-Branch-Id' => (string) $this->hamra->getKey(),
        ])->getJson('/api/v1/organisations/current')->assertOk();
    });

    $access = AuditLog::query()->where('action', 'access.read')->sole();

    expect($access->purpose_of_use)->toBe('organisation_administration')
        ->and($access->subject_type)->toBe('organisation')
        ->and($access->subject_id)->toBe((string) $this->cedar->getKey())
        ->and($access->organisation_id)->toBe((string) $this->cedar->getKey())
        ->and($access->branch_id)->toBe((string) $this->hamra->getKey())
        ->and($access->actor_user_id)->toBe((string) $this->owner->getKey())
        ->and($access->metadata)->toMatchArray(['classification' => 'internal'])
        ->and($access->correlation_id)->not->toBeNull();
});

it('leaves no tenant context behind on the connection once the response has been sent', function (): void {
    RuntimeRole::run(function (): void {
        $this->postJson('/api/v1/auth/login', ['email' => 'owner@cedar.test', 'password' => 'password'])
            ->assertOk();

        $this->withHeaders([
            'X-Organisation-Id' => (string) $this->cedar->getKey(),
            'X-Branch-Id' => (string) $this->hamra->getKey(),
        ])->getJson('/api/v1/organisations/current')->assertOk();
    });

    expect(RuntimeRole::setting('app.user_id'))->toBe('')
        ->and(RuntimeRole::setting('app.organisation_id'))->toBe('')
        ->and(RuntimeRole::setting('app.branch_id'))->toBe('');
});
