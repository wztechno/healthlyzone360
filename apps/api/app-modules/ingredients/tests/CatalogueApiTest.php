<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAlias;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\ReferenceData\Models\MeasurementUnit;

/*
|--------------------------------------------------------------------------
| The ingredient catalogue over HTTP — the K1.1 gate
|--------------------------------------------------------------------------
|
| Two tenants and the platform library exist in every test. What has to hold:
| a kitchen sees its own rows and the platform's and nobody else's; it may
| write only its own; every write is optimistically locked; every mutation is
| audited; and the pagination survives being walked while rows exist beyond
| one page.
|
*/

/**
 * A kitchen organisation built on the seeded reference data.
 *
 * Not `Organisation::factory()` unadorned: that factory invents a country, a
 * currency and a language, and inventing an ISO code on top of the 249 the
 * seeder already wrote is a primary-key collision waiting to happen.
 */
function catalogueOrganisation(): Organisation
{
    return Organisation::factory()->create([
        'organisation_type_id' => OrganisationType::query()->where('code', 'kitchen')->sole()->getKey(),
        'country_code' => 'LB',
        'default_currency_code' => 'USD',
        'default_language_code' => 'en',
    ]);
}

/**
 * A tenant with a user who holds the catalogue permissions.
 */
function catalogueTenant(string $email): object
{
    $organisation = catalogueOrganisation();
    $user = User::factory()->create(['email' => $email]);

    $membership = OrganisationMembership::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'user_id' => $user->getKey(),
    ]);

    $role = Role::factory()->create(['organisation_id' => $organisation->getKey()]);

    foreach (['catalogue.view_organisation', 'catalogue.manage_organisation'] as $code) {
        RolePermission::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'role_id' => $role->getKey(),
            'permission_id' => Permission::query()->where('code', $code)->sole()->getKey(),
        ]);
    }

    MembershipRole::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'membership_id' => $membership->getKey(),
        'role_id' => $role->getKey(),
    ]);

    return (object) compact('organisation', 'user');
}

/**
 * The platform operator: same catalogue permissions, an organisation whose
 * *type* is `platform_operator`.
 *
 * The type is what the write guard reads, not the permission — a tenant that
 * somehow held `catalogue.manage_organisation` on a bespoke role still is not
 * the platform, and must not be able to rewrite the library every kitchen
 * inherits.
 */
function platformCatalogueOperator(string $email): object
{
    $organisation = Organisation::factory()->create([
        'organisation_type_id' => OrganisationType::query()->where('code', 'platform_operator')->sole()->getKey(),
        'country_code' => 'LB',
        'default_currency_code' => 'USD',
        'default_language_code' => 'en',
    ]);

    $user = User::factory()->create(['email' => $email]);

    $membership = OrganisationMembership::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'user_id' => $user->getKey(),
    ]);

    $role = Role::factory()->create(['organisation_id' => $organisation->getKey()]);

    foreach (['catalogue.view_organisation', 'catalogue.manage_organisation'] as $code) {
        RolePermission::factory()->create([
            'organisation_id' => $organisation->getKey(),
            'role_id' => $role->getKey(),
            'permission_id' => Permission::query()->where('code', $code)->sole()->getKey(),
        ]);
    }

    MembershipRole::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'membership_id' => $membership->getKey(),
        'role_id' => $role->getKey(),
    ]);

    return (object) compact('organisation', 'user');
}

/**
 * @return array<string, string>
 */
function catalogueHeaders(object $tenant): array
{
    return firstPartyHeaders() + ['X-Organisation-Id' => (string) $tenant->organisation->getKey()];
}

function gramsId(): string
{
    return (string) MeasurementUnit::query()->where('code', 'g')->sole()->getKey();
}

beforeEach(function (): void {
    $this->seed();

    $this->a = catalogueTenant('chef-a@kitchen.test');
    $this->b = catalogueTenant('chef-b@kitchen.test');
});

it('creates an ingredient as an active, unverified tenant row', function (): void {
    $this->actingAs($this->a->user);

    $response = $this->postJson('/api/v1/catalogue/ingredients', [
        'name_en' => 'House Za\'atar Blend',
        'name_ar' => 'خلطة الزعتر',
        'default_unit_id' => gramsId(),
    ], catalogueHeaders($this->a))
        ->assertCreated()
        ->assertJsonPath('data.ingredient.slug', 'house-zaatar-blend')
        ->assertJsonPath('data.ingredient.status', 'active')
        ->assertJsonPath('data.ingredient.verification_status', 'unverified')
        ->assertJsonPath('data.ingredient.is_platform', false)
        ->assertJsonPath('data.ingredient.lock_version', 0)
        ->assertHeader('ETag', '"0"');

    $id = $response->json('data.ingredient.id');

    expect(Ingredient::withoutTenancy()->whereKey($id)->value('organisation_id'))
        ->toBe((string) $this->a->organisation->getKey());

    $audit = AuditLog::query()->where('action', 'catalogue.ingredient_created')->sole();

    expect($audit->subject_type)->toBe('ingredient')
        ->and($audit->subject_id)->toBe($id)
        ->and($audit->organisation_id)->toBe((string) $this->a->organisation->getKey());
});

it('serves the platform library and the tenants own rows, and nothing of another tenant', function (): void {
    $mine = Ingredient::factory()->create(['organisation_id' => $this->a->organisation->getKey(), 'name_en' => 'Mine']);
    $theirs = Ingredient::factory()->create(['organisation_id' => $this->b->organisation->getKey(), 'name_en' => 'Theirs']);
    $platform = Ingredient::withoutTenancy()->whereNull('organisation_id')->where('slug', 'chickpeas')->sole();

    $this->actingAs($this->a->user);

    $ids = collect($this->getJson('/api/v1/catalogue/ingredients?limit=100&query=chickpeas', catalogueHeaders($this->a))
        ->assertOk()
        ->json('data'))->pluck('id')->all();

    expect($ids)->toContain((string) $platform->getKey());

    $mineIds = collect($this->getJson('/api/v1/catalogue/ingredients?limit=100&query=Mine', catalogueHeaders($this->a))
        ->assertOk()
        ->json('data'))->pluck('id')->all();

    expect($mineIds)->toBe([(string) $mine->getKey()]);

    // Another tenant's row is not merely hidden from the list — it is
    // unreachable by identifier, and indistinguishable from one that never
    // existed.
    $this->getJson('/api/v1/catalogue/ingredients/'.$theirs->getKey(), catalogueHeaders($this->a))
        ->assertNotFound()
        ->assertJsonPath('error.code', 'resource.not_found');
});

it('refuses to write a platform row and says why', function (): void {
    $platform = Ingredient::withoutTenancy()->whereNull('organisation_id')->where('slug', 'chickpeas')->sole();

    $this->actingAs($this->a->user);

    // Readable...
    $this->getJson('/api/v1/catalogue/ingredients/'.$platform->getKey(), catalogueHeaders($this->a))
        ->assertOk()
        ->assertJsonPath('data.ingredient.is_platform', true);

    // ...and not writable, as a policy denial rather than a 404.
    $this->patchJson('/api/v1/catalogue/ingredients/'.$platform->getKey(), ['name_en' => 'Hijacked'],
        catalogueHeaders($this->a) + ['If-Match' => '"0"'])
        ->assertForbidden()
        ->assertJsonPath('error.code', 'authz.permission_denied')
        ->assertJsonPath('error.details.reason', 'policy_denied');

    $this->postJson('/api/v1/catalogue/ingredients/'.$platform->getKey().'/archive', [],
        catalogueHeaders($this->a) + ['If-Match' => '"0"'])
        ->assertForbidden()
        ->assertJsonPath('error.details.reason', 'policy_denied');

    expect(Ingredient::withoutTenancy()->whereKey($platform->getKey())->value('name_en'))->toBe('Chickpeas');
});

it('tells a kitchen a platform row is not editable by it', function (): void {
    $platform = Ingredient::withoutTenancy()->whereNull('organisation_id')->where('slug', 'chickpeas')->sole();

    $this->actingAs($this->a->user);

    // The pair a client gates on: which library the row is in, and whether
    // *this* caller may write it. They differ for exactly this row.
    $this->getJson('/api/v1/catalogue/ingredients/'.$platform->getKey(), catalogueHeaders($this->a))
        ->assertOk()
        ->assertJsonPath('data.ingredient.is_platform', true)
        ->assertJsonPath('data.ingredient.is_editable', false);
});

it('lets the platform operator write the library every kitchen reads', function (): void {
    $platform = Ingredient::withoutTenancy()->whereNull('organisation_id')->where('slug', 'chickpeas')->sole();
    $operator = platformCatalogueOperator('catalogue-ops@platform.test');

    $this->actingAs($operator->user);

    // Same row, different caller, opposite answer — which is the whole reason
    // `is_editable` exists beside `is_platform`.
    $this->getJson('/api/v1/catalogue/ingredients/'.$platform->getKey(), catalogueHeaders($operator))
        ->assertOk()
        ->assertJsonPath('data.ingredient.is_platform', true)
        ->assertJsonPath('data.ingredient.is_editable', true);

    $this->patchJson('/api/v1/catalogue/ingredients/'.$platform->getKey(),
        ['b2b_price_amount' => '4.50', 'b2c_price_amount' => '6.00', 'price_currency_code' => 'USD'],
        catalogueHeaders($operator) + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.ingredient.b2b_price_amount', '4.500000')
        ->assertJsonPath('data.ingredient.b2c_price_amount', '6.000000');

    $stored = Ingredient::withoutTenancy()->whereKey($platform->getKey())->sole();
    expect((string) $stored->b2b_price_amount)->toBe('4.500000')
        ->and((string) $stored->b2c_price_amount)->toBe('6.000000')
        ->and($stored->price_currency_code)->toBe('USD');
});

it('carries the allergen declaration on the list as well as the record', function (): void {
    $platform = Ingredient::withoutTenancy()->whereNull('organisation_id')->where('slug', 'chickpeas')->sole();

    IngredientAllergen::factory()->create([
        'ingredient_id' => $platform->getKey(),
        'organisation_id' => null,
        'allergen_code' => 'gluten',
        'containment' => 'may_contain',
    ]);

    $this->actingAs($this->a->user);

    // On the collection, because a list that had to fetch a sub-resource per
    // row could not afford to draw the column at all — and drew "none
    // declared" on every row instead, including the ones carrying gluten.
    $listed = collect($this->getJson('/api/v1/catalogue/ingredients?query=chickpeas', catalogueHeaders($this->a))
        ->assertOk()
        ->json('data'))
        ->firstWhere('id', (string) $platform->getKey());

    expect($listed)->not->toBeNull()
        ->and($listed['allergens'])->toHaveCount(1)
        ->and($listed['allergens'][0]['allergen_code'])->toBe('gluten')
        ->and($listed['allergens'][0]['containment'])->toBe('may_contain')
        ->and($listed['allergens'][0]['layer'])->toBe('platform_baseline');

    // And on the single resource, so one shape answers both.
    $this->getJson('/api/v1/catalogue/ingredients/'.$platform->getKey(), catalogueHeaders($this->a))
        ->assertOk()
        ->assertJsonPath('data.ingredient.allergens.0.allergen_code', 'gluten');
});

it('reports an empty allergen set as empty rather than as absent', function (): void {
    $this->actingAs($this->a->user);

    $created = $this->postJson('/api/v1/catalogue/ingredients', [
        'name_en' => 'Rock salt',
        'default_unit_id' => gramsId(),
    ], catalogueHeaders($this->a))->assertCreated()->json('data.ingredient.id');

    // "Declares none" and "nobody loaded them" are different answers, and a
    // regulated field must not render the second as the first.
    $this->getJson('/api/v1/catalogue/ingredients/'.$created, catalogueHeaders($this->a))
        ->assertOk()
        ->assertJsonPath('data.ingredient.allergens', []);
});

it('demands a precondition, refuses a stale one and accepts the current one', function (): void {
    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'name_en' => 'Tahini',
    ]);

    $this->actingAs($this->a->user);
    $headers = catalogueHeaders($this->a);
    $url = '/api/v1/catalogue/ingredients/'.$ingredient->getKey();

    // Absent: 428, with a new code of its own — the client has not lost a
    // race, it never entered one.
    $this->patchJson($url, ['name_en' => 'Tahini (light)'], $headers)
        ->assertStatus(428)
        ->assertJsonPath('error.code', 'request.precondition_required')
        ->assertJsonPath('error.details.required_headers', ['If-Match']);

    // The validator the GET hands out.
    $etag = $this->getJson($url, $headers)->assertOk()->assertHeader('ETag', '"0"')->headers->get('ETag');

    $this->patchJson($url, ['name_en' => 'Tahini (light)'], $headers + ['If-Match' => (string) $etag])
        ->assertOk()
        ->assertJsonPath('data.ingredient.name_en', 'Tahini (light)')
        ->assertJsonPath('data.ingredient.lock_version', 1)
        ->assertHeader('ETag', '"1"');

    // Replaying the same validator is now stale, and the response says what
    // to reload against.
    $this->patchJson($url, ['name_en' => 'Tahini (dark)'], $headers + ['If-Match' => (string) $etag])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.current_lock_version', 1);

    expect(Ingredient::withoutTenancy()->whereKey($ingredient->getKey())->value('name_en'))->toBe('Tahini (light)');
});

it('rejects a validator that is not an ETag this API issued', function (): void {
    $ingredient = Ingredient::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);

    $this->actingAs($this->a->user);

    $this->patchJson('/api/v1/catalogue/ingredients/'.$ingredient->getKey(), ['name_en' => 'Nope'],
        catalogueHeaders($this->a) + ['If-Match' => '"not-a-version"'])
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'request.invalid');
});

it('archives through its own action and records its own audit event', function (): void {
    $ingredient = Ingredient::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);

    $this->actingAs($this->a->user);

    $this->postJson('/api/v1/catalogue/ingredients/'.$ingredient->getKey().'/archive', [],
        catalogueHeaders($this->a) + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.ingredient.status', 'archived')
        ->assertHeader('ETag', '"1"');

    // Already archived is a conflict, not a silent success.
    $this->postJson('/api/v1/catalogue/ingredients/'.$ingredient->getKey().'/archive', [],
        catalogueHeaders($this->a) + ['If-Match' => '"1"'])
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');

    expect(AuditLog::query()->where('action', 'catalogue.ingredient_archived')->count())->toBe(1)
        ->and(Ingredient::withoutTenancy()->whereKey($ingredient->getKey())->sole()->status)
        ->toBe(IngredientStatus::Archived);
});

it('hides archived rows from the default list and shows them when asked', function (): void {
    $archived = Ingredient::factory()->archived()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'name_en' => 'Discontinued Powder',
    ]);

    $this->actingAs($this->a->user);
    $headers = catalogueHeaders($this->a);

    expect(collect($this->getJson('/api/v1/catalogue/ingredients?limit=100&query=Discontinued', $headers)->json('data'))->pluck('id')->all())
        ->toBe([])
        ->and(collect($this->getJson('/api/v1/catalogue/ingredients?limit=100&query=Discontinued&status=archived', $headers)->json('data'))->pluck('id')->all())
        ->toBe([(string) $archived->getKey()]);

    $this->getJson('/api/v1/catalogue/ingredients?status=vanished', $headers)
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'request.invalid');
});

it('walks a cursor-paginated catalogue with no gaps and no duplicates', function (): void {
    $this->actingAs($this->a->user);
    $headers = catalogueHeaders($this->a);

    // 30 tenant rows on top of the seeded platform library: more than the
    // default page and more than one page at the size used here.
    Ingredient::factory()->count(30)->create(['organisation_id' => $this->a->organisation->getKey()]);

    $expected = Ingredient::withoutTenancy()
        ->where('organisation_id', $this->a->organisation->getKey())
        ->orderBy('created_at')
        ->orderBy('id')
        ->pluck('id')
        ->all();

    $seen = [];
    $cursor = null;
    $pages = 0;

    do {
        $url = '/api/v1/catalogue/ingredients?limit=7&query='
            .urlencode('')
            .($cursor === null ? '' : '&cursor='.urlencode($cursor));

        // Restrict to this tenant's rows by filtering out the platform
        // library after the fact: the walk is what is under test, not the
        // filter.
        $response = $this->getJson($url, $headers)->assertOk();

        foreach ($response->json('data') as $item) {
            if ($item['is_platform'] === false) {
                $seen[] = $item['id'];
            }
        }

        $cursor = $response->json('meta.next_cursor');
        $pages++;

        expect($pages)->toBeLessThan(60, 'The cursor walk did not terminate.');
    } while ($response->json('meta.has_more') === true);

    expect($seen)->toBe($expected)
        ->and(count($seen))->toBe(count(array_unique($seen)));
});

it('refuses a cursor it did not issue', function (): void {
    $this->actingAs($this->a->user);

    $this->getJson('/api/v1/catalogue/ingredients?cursor=not-a-cursor', catalogueHeaders($this->a))
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'request.invalid')
        ->assertJsonPath('error.details.parameter', 'cursor');
});

it('adds and removes aliases, and refuses a duplicate', function (): void {
    $ingredient = Ingredient::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);

    $this->actingAs($this->a->user);
    $headers = catalogueHeaders($this->a);
    $base = '/api/v1/catalogue/ingredients/'.$ingredient->getKey().'/aliases';

    $aliasId = $this->postJson($base, ['alias' => '  Sesame   PASTE '], $headers)
        ->assertCreated()
        ->assertJsonPath('data.alias.alias_normalised', 'sesame paste')
        ->json('data.alias.id');

    // Same designation, different spacing and case: still a duplicate.
    $this->postJson($base, ['alias' => 'sesame paste'], $headers)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');

    $this->getJson($base, $headers)->assertOk()->assertJsonPath('meta.count', 1);

    $this->deleteJson($base.'/'.$aliasId, [], $headers)->assertNoContent();

    expect(IngredientAlias::query()->where('ingredient_id', $ingredient->getKey())->count())->toBe(0);
});

it('creates categories and refuses one that shadows a platform code', function (): void {
    $this->actingAs($this->a->user);
    $headers = catalogueHeaders($this->a);

    $this->postJson('/api/v1/catalogue/ingredient-categories', [
        'code' => 'house-blends',
        'name_en' => 'House blends',
    ], $headers)
        ->assertCreated()
        ->assertJsonPath('data.category.code', 'house-blends')
        ->assertJsonPath('data.category.is_platform', false);

    $this->postJson('/api/v1/catalogue/ingredient-categories', [
        'code' => 'herb-spice',
        'name_en' => 'My herbs',
    ], $headers)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');

    $platform = IngredientCategory::withoutTenancy()->whereNull('organisation_id')->where('code', 'herb-spice')->sole();

    $this->patchJson('/api/v1/catalogue/ingredient-categories/'.$platform->getKey(), ['name_en' => 'Hijacked'], $headers)
        ->assertForbidden()
        ->assertJsonPath('error.details.reason', 'policy_denied');
});

it('denies a member without the catalogue permission', function (): void {
    $stranger = User::factory()->create();

    OrganisationMembership::factory()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'user_id' => $stranger->getKey(),
    ]);

    $this->actingAs($stranger);

    $this->getJson('/api/v1/catalogue/ingredients', catalogueHeaders($this->a))
        ->assertForbidden()
        ->assertJsonPath('error.code', 'authz.permission_denied')
        ->assertJsonPath('error.details.reason', 'permission_not_granted');
});

it('never writes an audit metadata key the redactor would blank', function (): void {
    $ingredient = Ingredient::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);

    $this->actingAs($this->a->user);
    $headers = catalogueHeaders($this->a);

    $this->patchJson('/api/v1/catalogue/ingredients/'.$ingredient->getKey(), ['name_en' => 'Renamed'],
        $headers + ['If-Match' => '"0"'])->assertOk();

    $this->postJson('/api/v1/catalogue/ingredients', ['name_en' => 'Another', 'default_unit_id' => gramsId()], $headers)
        ->assertCreated();

    $events = AuditLog::query()->where('action', 'like', 'catalogue.%')->get();

    expect($events)->not->toBeEmpty();

    foreach ($events as $event) {
        foreach (array_keys($event->metadata ?? []) as $key) {
            // The redactor matches `code` as a substring, so any key ending
            // in `_code` would be persisted as "[redacted]" (OQ-036).
            expect(str_ends_with((string) $key, '_code'))
                ->toBeFalse("Audit metadata key [{$key}] would be redacted by the substring match.");
        }

        expect($event->metadata)->not->toContain('[redacted]');
    }
});

/*
|--------------------------------------------------------------------------
| Numbered pages
|--------------------------------------------------------------------------
|
| The kitchen catalogue is the one family allowed offset pagination, for the
| reasons `docs/api/conventions.md` and `OffsetPage` both set out: it is edited
| by one kitchen occasionally rather than written continuously, and a cook
| hunting through nine hundred ingredients needs to jump rather than press Next
| thirty times.
|
| What these pin is that the two modes are genuinely independent — asking for a
| page must not disturb the keyset walk above, and a client that has never heard
| of `page` must see exactly what it saw before.
*/

it('serves numbered pages that partition the collection exactly once', function (): void {
    $this->actingAs($this->a->user);
    $headers = catalogueHeaders($this->a);

    Ingredient::factory()->count(30)->create(['organisation_id' => $this->a->organisation->getKey()]);

    $first = $this->getJson('/api/v1/catalogue/ingredients?page=1&per_page=10', $headers)->assertOk();

    $total = $first->json('meta.total_count');
    $totalPages = $first->json('meta.total_pages');

    expect($first->json('meta.page'))->toBe(1)
        ->and($first->json('meta.per_page'))->toBe(10)
        ->and($totalPages)->toBe((int) ceil($total / 10));

    // Every page collected, then compared with the collection walked in the
    // same order. Offset can skip and repeat — that is the whole reason it is
    // fenced to this family — so the assertion is that it did neither here.
    $seen = [];

    for ($page = 1; $page <= $totalPages; $page++) {
        $response = $this->getJson("/api/v1/catalogue/ingredients?page={$page}&per_page=10", $headers)->assertOk();

        foreach ($response->json('data') as $item) {
            $seen[] = $item['id'];
        }
    }

    expect(count($seen))->toBe($total)
        ->and(count(array_unique($seen)))->toBe($total);
});

it('leaves the cursor walk untouched when no page is asked for', function (): void {
    $this->actingAs($this->a->user);
    $headers = catalogueHeaders($this->a);

    Ingredient::factory()->count(5)->create(['organisation_id' => $this->a->organisation->getKey()]);

    $response = $this->getJson('/api/v1/catalogue/ingredients?limit=3', $headers)->assertOk();

    // The keyset meta, and none of the numbered-page meta: the `COUNT` that
    // `total_pages` needs is only paid for by a caller that asked for a page.
    expect($response->json('meta.has_more'))->toBeTrue()
        ->and($response->json('meta.next_cursor'))->not->toBeNull()
        ->and($response->json('meta'))->not->toHaveKey('total_pages')
        ->and($response->json('meta'))->not->toHaveKey('page');
});

it('refuses a page past the end, and a page size outside the range', function (): void {
    $this->actingAs($this->a->user);
    $headers = catalogueHeaders($this->a);

    $this->getJson('/api/v1/catalogue/ingredients?page=9999&per_page=10', $headers)
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'request.invalid')
        ->assertJsonPath('error.details.parameter', 'page');

    $this->getJson('/api/v1/catalogue/ingredients?page=1&per_page=101', $headers)
        ->assertStatus(400)
        ->assertJsonPath('error.details.parameter', 'per_page');

    $this->getJson('/api/v1/catalogue/ingredients?page=0', $headers)
        ->assertStatus(400)
        ->assertJsonPath('error.details.parameter', 'page');
});

it('answers page 1 of an empty collection rather than refusing it', function (): void {
    $this->actingAs($this->a->user);

    // A filter nothing matches: "you have none yet" is a legitimate answer to a
    // legitimate request, not a 400.
    $response = $this->getJson(
        '/api/v1/catalogue/ingredients?page=1&query='.urlencode('zzz-no-such-ingredient'),
        catalogueHeaders($this->a),
    )->assertOk();

    expect($response->json('data'))->toBe([])
        ->and($response->json('meta.total_count'))->toBe(0)
        ->and($response->json('meta.total_pages'))->toBe(0);
});

/**
 * Prices and the sale flag.
 *
 * The B2B/B2C columns shipped with no coverage at all, which is how the
 * currency CHECK stayed a 500 waiting to happen rather than a 422. These
 * assert the contract the database actually enforces: an amount is never
 * stored without the currency it is quoted in, and the flag is a real column
 * rather than a value the presenter invents.
 */
it('round-trips the three prices and the sale flag on create', function (): void {
    $this->actingAs($this->a->user);

    $response = $this->postJson('/api/v1/catalogue/ingredients', [
        'name_en' => 'Sesame Paste',
        'default_unit_id' => gramsId(),
        'unit_price_amount' => 3.5,
        'b2b_price_amount' => 4.2,
        'b2c_price_amount' => 6.9,
        'price_currency_code' => 'USD',
        'is_sellable' => true,
    ], catalogueHeaders($this->a))
        ->assertCreated()
        ->assertJsonPath('data.ingredient.unit_price_amount', '3.500000')
        ->assertJsonPath('data.ingredient.b2b_price_amount', '4.200000')
        ->assertJsonPath('data.ingredient.b2c_price_amount', '6.900000')
        ->assertJsonPath('data.ingredient.price_currency_code', 'USD')
        ->assertJsonPath('data.ingredient.is_sellable', true);

    $id = $response->json('data.ingredient.id');

    expect(Ingredient::withoutTenancy()->whereKey($id)->value('unit_price_amount'))->toBe('3.500000')
        ->and(Ingredient::withoutTenancy()->whereKey($id)->value('is_sellable'))->toBeTrue();
});

it('defaults an ingredient to not for sale', function (): void {
    $this->actingAs($this->a->user);

    // A raw material until somebody says otherwise: omitting the flag must not
    // put the row on sale.
    $this->postJson('/api/v1/catalogue/ingredients', [
        'name_en' => 'Plain Flour',
        'default_unit_id' => gramsId(),
    ], catalogueHeaders($this->a))
        ->assertCreated()
        ->assertJsonPath('data.ingredient.is_sellable', false);
});

it('refuses a price with no currency rather than letting the database refuse it', function (): void {
    $this->actingAs($this->a->user);

    // Without `required_with` naming the new column, this would reach the CHECK
    // and come back as a 500.
    $this->postJson('/api/v1/catalogue/ingredients', [
        'name_en' => 'Unpriced',
        'default_unit_id' => gramsId(),
        'unit_price_amount' => 3.5,
    ], catalogueHeaders($this->a))
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');
});

it('updates the unit price and the sale flag behind the lock', function (): void {
    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'name_en' => 'Olive Oil',
    ]);

    $this->actingAs($this->a->user);
    $headers = catalogueHeaders($this->a);
    $url = '/api/v1/catalogue/ingredients/'.$ingredient->getKey();

    $etag = $this->getJson($url, $headers)->assertOk()->headers->get('ETag');

    $this->patchJson($url, [
        'unit_price_amount' => 12.75,
        'price_currency_code' => 'USD',
        'is_sellable' => true,
    ], $headers + ['If-Match' => (string) $etag])
        ->assertOk()
        ->assertJsonPath('data.ingredient.unit_price_amount', '12.750000')
        ->assertJsonPath('data.ingredient.is_sellable', true)
        ->assertJsonPath('data.ingredient.lock_version', 1);

    expect(Ingredient::withoutTenancy()->whereKey($ingredient->getKey())->value('unit_price_amount'))
        ->toBe('12.750000');
});

/**
 * Sub-category integrity.
 *
 * Both columns point at the same self-referencing table, so `Rule::exists` on
 * either proves only that the row is *a* category. Nothing stopped an
 * ingredient being filed under one branch with a leaf from another — and the
 * client reads the pair back together, so the mismatch would surface later as a
 * category that appeared to change on its own.
 */
it('accepts a sub-category that belongs to the category, and refuses one that does not', function (): void {
    $herbs = IngredientCategory::withoutTenancy()->whereNull('organisation_id')->where('code', 'herb-spice')->sole();
    $spice = IngredientCategory::withoutTenancy()->whereNull('organisation_id')->where('code', 'herb-spice-spice')->sole();
    $starch = IngredientCategory::withoutTenancy()->whereNull('organisation_id')->where('code', 'baking-starch-starch')->sole();

    $this->actingAs($this->a->user);
    $headers = catalogueHeaders($this->a);

    $this->postJson('/api/v1/catalogue/ingredients', [
        'name_en' => 'Sumac',
        'default_unit_id' => gramsId(),
        'ingredient_category_id' => $herbs->getKey(),
        'ingredient_subcategory_id' => $spice->getKey(),
    ], $headers)
        ->assertCreated()
        ->assertJsonPath('data.ingredient.ingredient_subcategory_id', (string) $spice->getKey());

    // A leaf from another branch.
    $this->postJson('/api/v1/catalogue/ingredients', [
        'name_en' => 'Mismatched',
        'default_unit_id' => gramsId(),
        'ingredient_category_id' => $herbs->getKey(),
        'ingredient_subcategory_id' => $starch->getKey(),
    ], $headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    // A leaf with no branch at all.
    $this->postJson('/api/v1/catalogue/ingredients', [
        'name_en' => 'Orphaned',
        'default_unit_id' => gramsId(),
        'ingredient_subcategory_id' => $spice->getKey(),
    ], $headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');
});

it('checks a partial sub-category move against the stored category', function (): void {
    $herbs = IngredientCategory::withoutTenancy()->whereNull('organisation_id')->where('code', 'herb-spice')->sole();
    $starch = IngredientCategory::withoutTenancy()->whereNull('organisation_id')->where('code', 'baking-starch-starch')->sole();

    $ingredient = Ingredient::factory()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'ingredient_category_id' => $herbs->getKey(),
    ]);

    $this->actingAs($this->a->user);
    $headers = catalogueHeaders($this->a);
    $url = '/api/v1/catalogue/ingredients/'.$ingredient->getKey();

    $etag = $this->getJson($url, $headers)->assertOk()->headers->get('ETag');

    // The PATCH names only the leaf, so the parent it must belong to is the one
    // already stored.
    $this->patchJson($url, [
        'ingredient_subcategory_id' => $starch->getKey(),
    ], $headers + ['If-Match' => (string) $etag])
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');
});
