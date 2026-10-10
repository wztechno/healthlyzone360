<?php

declare(strict_types=1);

use Healthy360\AccessAdministration\Tests\Fixtures\AccessWorld;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Database\QueryException;

/*
|--------------------------------------------------------------------------
| Signing in with a name instead of an address
|--------------------------------------------------------------------------
|
| A kitchen hand has a phone and a first name, not a work mailbox. The feature
| that answers that is deliberately the smallest one available: the *client*
| composes `ahmad.khalil` plus the kitchen's own domain into an ordinary email
| address, and Fortify, Sanctum, the token endpoint and password reset all stay
| exactly as they were. The alternative — a `username` column and a login that
| accepts either — grows a branch in every one of those, and an identity system
| with two ways to name the same person has two ways to get it wrong.
|
| What this file pins is the anonymous endpoint that makes the picker
| renderable, and the three ways it is deliberately narrow.
|
*/

beforeEach(function (): void {
    $this->seed(ReferenceDataSeeder::class);
    $this->seed(OrganisationTypeSeeder::class);
    $this->seed(AccessControlSeeder::class);
});

it('serves the domains anonymously, because the sign-in screen has nobody to be', function (): void {
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $tenant->organisation->forceFill([
        'name' => 'Verdant Kitchen',
        'status' => OrganisationStatus::Active,
        'staff_email_domain' => 'verdant.h360.test',
    ])->save();

    $this->getJson('/api/v1/auth/staff-domains')
        ->assertOk()
        ->assertJsonPath('data.domains.0.organisation_name', 'Verdant Kitchen')
        ->assertJsonPath('data.domains.0.domain', 'verdant.h360.test');
});

it('lists only organisations that opted in by setting a domain', function (): void {
    // Appearing here is an act somebody took deliberately. A kitchen that never
    // set a domain has no staff sign-in to offer, and listing it would be
    // publishing a tenant for no reason.
    AccessWorld::kitchen('admin@quiet.test');

    $this->getJson('/api/v1/auth/staff-domains')
        ->assertOk()
        ->assertJsonPath('data.domains', []);
});

it('drops an organisation that is not trading', function (): void {
    // A suspended tenant's staff cannot sign in, so offering the option would
    // be an invitation to a refusal.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $tenant->organisation->forceFill([
        'status' => OrganisationStatus::Suspended,
        'staff_email_domain' => 'verdant.h360.test',
    ])->save();

    $this->getJson('/api/v1/auth/staff-domains')
        ->assertOk()
        ->assertJsonPath('data.domains', []);
});

it('serves a name and a domain, and nothing else about a tenant', function (): void {
    // The picker needs a label and a suffix. An identifier, a slug, a status or
    // a count would be answering questions about a tenant to anybody who asked.
    $tenant = AccessWorld::kitchen('admin@verdant.test');
    $tenant->organisation->forceFill([
        'status' => OrganisationStatus::Active,
        'staff_email_domain' => 'verdant.h360.test',
    ])->save();

    $row = $this->getJson('/api/v1/auth/staff-domains')->assertOk()->json('data.domains.0');

    expect(array_keys($row))->toEqualCanonicalizing(['organisation_name', 'domain']);
});

it('refuses a domain that is not a domain', function (): void {
    // Enforced in the database rather than only in a form request, because a
    // seeder and a console both write this column — and an address composed
    // from a malformed domain fails at sign-in, the furthest possible point
    // from where the mistake was made.
    $tenant = AccessWorld::kitchen('admin@verdant.test');

    expect(fn () => $tenant->organisation->forceFill(['staff_email_domain' => 'not a domain'])->save())
        ->toThrow(QueryException::class);
});

it('keeps one domain to one kitchen', function (): void {
    // The domain *is* the disambiguator: two kitchens sharing one would make
    // `ahmad@shared` ambiguous in the only field meant to resolve it, and the
    // collision would surface as somebody signing into the wrong kitchen
    // rather than as an error.
    $first = AccessWorld::kitchen('admin@verdant.test');
    $second = AccessWorld::kitchen('admin@rival.test');

    $first->organisation->forceFill(['staff_email_domain' => 'shared.h360.test'])->save();

    expect(fn () => $second->organisation->forceFill(['staff_email_domain' => 'shared.h360.test'])->save())
        ->toThrow(QueryException::class);
});
