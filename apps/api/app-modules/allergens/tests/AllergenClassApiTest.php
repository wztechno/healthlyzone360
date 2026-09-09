<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Allergens\Models\Allergen;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;

/*
|--------------------------------------------------------------------------
| The allergen vocabulary — public to read, platform-only to write
|--------------------------------------------------------------------------
|
| Two things this file proves that nothing else can. First, the list is
| readable with no credential at all: an allergy filter that needs a sign-in
| is not an allergy filter. Second, the write path needs BOTH a platform
| workspace and a platform permission, so a tenant that somehow acquired the
| permission still cannot edit a vocabulary every other tenant depends on.
|
*/

beforeEach(function (): void {
    $this->seed();

    $this->platform = Organisation::query()->where('slug', 'healthy360-operations')->sole();
    $this->ops = User::query()->where('email', 'ops@healthy360.test')->sole();
});

/**
 * @return array<string, string>
 */
function opsHeaders(Organisation $organisation): array
{
    return firstPartyHeaders() + ['X-Organisation-Id' => (string) $organisation->getKey()];
}

it('serves the fourteen classes to an anonymous caller in English by default', function (): void {
    $response = $this->getJson('/api/v1/reference/allergen-classes')
        ->assertOk()
        ->assertJsonPath('meta.count', 14)
        ->assertJsonPath('meta.locale', 'en');

    $first = $response->json('data.0');

    expect($first['code'])->toBe('gluten')
        ->and($first['name'])->toBe('Cereals containing gluten')
        ->and($first['regulatory_ref'])->toBe('ALG-01')
        // One localised name, never both language columns (master plan §4.18).
        ->and($first)->not->toHaveKeys(['name_en', 'name_ar', 'is_active'])
        ->and(collect($response->json('data'))->pluck('code')->all())
        ->toBe(['gluten', 'crustaceans', 'egg', 'fish', 'peanut', 'soy', 'milk', 'tree_nut', 'sesame', 'celery', 'mustard', 'sulphites', 'lupin', 'mollusc']);
});

it('serves Arabic when Arabic is asked for', function (string $header, string $expectedLocale, string $expectedName): void {
    $this->getJson('/api/v1/reference/allergen-classes', ['Accept-Language' => $header])
        ->assertOk()
        ->assertJsonPath('meta.locale', $expectedLocale)
        ->assertJsonPath('data.0.name', $expectedName);
})->with([
    'plain arabic' => ['ar', 'ar', 'الغلوتين'],
    'regional arabic' => ['ar-LB', 'ar', 'الغلوتين'],
    'weighted list preferring arabic' => ['ar-LB,ar;q=0.9,en;q=0.5', 'ar', 'الغلوتين'],
    'english' => ['en-GB', 'en', 'Cereals containing gluten'],
    // A header nobody serves must not produce an error page in front of an
    // allergy list; it falls back to English.
    'unserved language' => ['fr-FR', 'en', 'Cereals containing gluten'],
]);

it('carries the market metadata the two regimes differ on', function (): void {
    $classes = collect($this->getJson('/api/v1/reference/allergen-classes')->json('data'))->keyBy('code');

    expect($classes['sulphites']['us_declaration_required'])->toBeTrue()
        ->and($classes['sulphites']['us_threshold_ppm'])->toBe(10)
        ->and($classes['sulphites']['is_us_big_9'])->toBeFalse()
        ->and($classes['milk']['is_us_big_9'])->toBeTrue()
        ->and($classes['milk']['us_threshold_ppm'])->toBeNull()
        ->and(collect($classes)->where('is_us_big_9', false)->keys()->sort()->values()->all())
        ->toBe(['celery', 'lupin', 'mollusc', 'mustard', 'sulphites'])
        ->and(collect($classes)->where('is_eu_14', false)->keys()->all())->toBe([]);
});

it('hides a deactivated class from the public list while the code still resolves', function (): void {
    Allergen::query()->whereKey('lupin')->update(['is_active' => false]);

    $codes = collect($this->getJson('/api/v1/reference/allergen-classes')->assertOk()->json('data'))->pluck('code')->all();

    expect($codes)->not->toContain('lupin')
        ->and(count($codes))->toBe(13)
        ->and(Allergen::query()->whereKey('lupin')->exists())->toBeTrue();
});

it('lets a platform operator create, edit and deactivate a class', function (): void {
    $this->actingAs($this->ops);
    $headers = opsHeaders($this->platform);

    $this->postJson('/api/v1/reference/allergen-classes', [
        'code' => 'buckwheat',
        'name_en' => 'Buckwheat',
        'name_ar' => 'الحنطة السوداء',
        'regulatory_ref' => 'ALG-15',
        'is_eu_14' => false,
        'is_us_big_9' => false,
    ], $headers)
        ->assertCreated()
        ->assertJsonPath('data.allergen_class.code', 'buckwheat')
        ->assertJsonPath('data.allergen_class.is_active', true)
        // Admin shapes carry both languages and ignore Accept-Language.
        ->assertJsonPath('data.allergen_class.name_en', 'Buckwheat')
        ->assertJsonPath('data.allergen_class.name_ar', 'الحنطة السوداء');

    $this->patchJson('/api/v1/reference/allergen-classes/buckwheat', [
        'name_en' => 'Buckwheat (soba)',
        'is_us_big_9' => true,
    ], $headers)
        ->assertOk()
        ->assertJsonPath('data.allergen_class.name_en', 'Buckwheat (soba)')
        ->assertJsonPath('data.allergen_class.is_us_big_9', true);

    $this->postJson('/api/v1/reference/allergen-classes/buckwheat/deactivate', [], $headers)
        ->assertOk()
        ->assertJsonPath('data.allergen_class.is_active', false);

    $this->postJson('/api/v1/reference/allergen-classes/buckwheat/deactivate', [], $headers)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');

    expect(AuditLog::query()->whereIn('action', [
        'reference.allergen_class_created',
        'reference.allergen_class_updated',
        'reference.allergen_class_deactivated',
    ])->count())->toBe(3);
});

it('refuses to rename a canonical code', function (): void {
    $this->actingAs($this->ops);

    $this->patchJson('/api/v1/reference/allergen-classes/gluten', [
        'code' => 'cereals_gluten',
        'name_en' => 'Cereals',
    ], opsHeaders($this->platform))
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['code']]]]);

    expect(Allergen::query()->whereKey('gluten')->exists())->toBeTrue()
        ->and(Allergen::query()->whereKey('cereals_gluten')->exists())->toBeFalse()
        ->and(Allergen::query()->whereKey('gluten')->value('name_en'))->toBe('Cereals containing gluten');
});

it('refuses a duplicate code', function (): void {
    $this->actingAs($this->ops);

    $this->postJson('/api/v1/reference/allergen-classes', [
        'code' => 'milk',
        'name_en' => 'Milk again',
        'name_ar' => 'حليب',
        'regulatory_ref' => 'ALG-99',
        'is_eu_14' => true,
        'is_us_big_9' => true,
    ], opsHeaders($this->platform))
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');
});

it('exposes no delete route at all', function (): void {
    $this->actingAs($this->ops);

    $this->deleteJson('/api/v1/reference/allergen-classes/lupin', [], opsHeaders($this->platform))
        ->assertStatus(405);
});

it('denies a tenant workspace even when the member holds the platform permission', function (): void {
    // The grant is real: a bespoke role inside an ordinary kitchen carrying
    // reference.manage_platform. Only the organisation type stands in the way,
    // and that is the point of the second gate.
    $kitchen = Organisation::query()->where('slug', 'verdant-kitchen')->sole();
    $user = User::factory()->create();

    $membership = OrganisationMembership::factory()->create([
        'organisation_id' => $kitchen->getKey(),
        'user_id' => $user->getKey(),
    ]);

    $role = Role::factory()->create(['organisation_id' => $kitchen->getKey()]);

    RolePermission::factory()->create([
        'organisation_id' => $kitchen->getKey(),
        'role_id' => $role->getKey(),
        'permission_id' => Permission::query()->where('code', 'reference.manage_platform')->sole()->getKey(),
    ]);

    MembershipRole::factory()->create([
        'organisation_id' => $kitchen->getKey(),
        'membership_id' => $membership->getKey(),
        'role_id' => $role->getKey(),
    ]);

    $this->actingAs($user);

    $this->patchJson('/api/v1/reference/allergen-classes/gluten', ['name_en' => 'Hijacked'], opsHeaders($kitchen))
        ->assertForbidden()
        ->assertJsonPath('error.code', 'authz.permission_denied')
        ->assertJsonPath('error.details.reason', 'policy_denied')
        ->assertJsonPath('error.details.permission', 'platform.context');

    expect(Allergen::query()->whereKey('gluten')->value('name_en'))->toBe('Cereals containing gluten');
});

it('denies a platform member who does not hold the platform permission', function (): void {
    $user = User::factory()->create();

    OrganisationMembership::factory()->create([
        'organisation_id' => $this->platform->getKey(),
        'user_id' => $user->getKey(),
    ]);

    $this->actingAs($user);

    $this->patchJson('/api/v1/reference/allergen-classes/gluten', ['name_en' => 'Hijacked'], opsHeaders($this->platform))
        ->assertForbidden()
        ->assertJsonPath('error.details.reason', 'permission_not_granted');
});

it('requires a credential for the write path', function (): void {
    $this->patchJson('/api/v1/reference/allergen-classes/gluten', ['name_en' => 'Hijacked'], firstPartyHeaders())
        ->assertUnauthorized()
        ->assertJsonPath('error.code', 'auth.unauthenticated');
});
