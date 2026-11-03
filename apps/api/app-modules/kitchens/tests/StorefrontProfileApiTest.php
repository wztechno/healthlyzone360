<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Kitchens\Presenters\MarketplaceKitchenPresenter;
use Healthy360\Kitchens\Tests\Fixtures\KitchenWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| A kitchen's storefront copy
|--------------------------------------------------------------------------
|
| Written on `catalogue.manage_organisation`, stored on `organisations`, and
| read by the anonymous marketplace in the request's language.
|
*/

const STOREFRONT_PROFILE = [
    'tagline_en' => 'Grilled, never fried',
    'tagline_ar' => 'مشوي لا مقلي',
    'description_en' => 'A Beirut kitchen cooking for the week.',
    'description_ar' => 'مطبخ في بيروت يطبخ للأسبوع.',
    'cuisines_en' => ['Lebanese', ' Grills ', '', 'Lebanese'],
    'cuisines_ar' => ['لبناني', 'مشاوي'],
];

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
});

/**
 * @param  list<string>  $permissions
 */
function storefrontCaller(object $test, string $email, array $permissions): object
{
    $kitchen = KitchenWorld::kitchen($email, $permissions);
    $test->actingAs($kitchen->user);
    $test->headers = KitchenWorld::headers($kitchen);

    return $kitchen;
}

/**
 * @param  array<string, mixed>  $columns
 * @return array<string, mixed>
 */
function storefrontProjection(array $columns, string $locale): array
{
    $kitchen = new Organisation(['name' => 'Verdant', 'slug' => 'verdant', 'country_code' => 'LB', ...$columns]);

    return (new MarketplaceKitchenPresenter)->kitchen($kitchen, $locale, [], [
        'b2c' => true, 'b2b' => false, 'marketplace' => true, 'pos' => false,
        'subscription' => false, 'delivery' => true, 'pickup' => false, 'corporate' => false,
    ], []);
}

it('reads an unset profile as empty strings and lists', function (): void {
    storefrontCaller($this, 'manage@kitchen.test', ['catalogue.manage_organisation']);

    $this->getJson('/api/v1/catalogue/storefront-profile', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.tagline_en', '')
        ->assertJsonPath('data.description_ar', '')
        ->assertJsonPath('data.cuisines_en', []);
});

it('saves the profile, tidies the cuisines and audits what changed', function (): void {
    $kitchen = storefrontCaller($this, 'manage@kitchen.test', ['catalogue.manage_organisation']);

    $this->putJson('/api/v1/catalogue/storefront-profile', STOREFRONT_PROFILE, $this->headers)
        ->assertOk()
        ->assertJsonPath('data.tagline_ar', 'مشوي لا مقلي')
        ->assertJsonPath('data.cuisines_en', ['Lebanese', 'Grills']);

    $stored = Organisation::query()->findOrFail($kitchen->organisation->getKey());

    expect($stored->description_en)->toBe('A Beirut kitchen cooking for the week.')
        ->and($stored->cuisines_ar)->toBe(['لبناني', 'مشاوي']);

    $log = AuditLog::query()->where('action', 'kitchen.storefront_profile_updated')->sole();

    expect($log->metadata['changed_fields'])->toEqualCanonicalizing(array_keys(STOREFRONT_PROFILE))
        ->and($log->metadata['values']['tagline_en'])->toEqual(['old' => null, 'new' => 'Grilled, never fried']);
});

it('clears a field sent empty', function (): void {
    $kitchen = storefrontCaller($this, 'manage@kitchen.test', ['catalogue.manage_organisation']);

    $this->putJson('/api/v1/catalogue/storefront-profile', STOREFRONT_PROFILE, $this->headers)->assertOk();
    $this->putJson('/api/v1/catalogue/storefront-profile', [...STOREFRONT_PROFILE, 'tagline_en' => '', 'cuisines_ar' => []], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.tagline_en', '')
        ->assertJsonPath('data.cuisines_ar', []);

    $stored = Organisation::query()->findOrFail($kitchen->organisation->getKey());

    expect($stored->tagline_en)->toBeNull()->and($stored->cuisines_ar)->toBeNull();
});

it('refuses a tagline longer than 160 characters', function (): void {
    storefrontCaller($this, 'manage@kitchen.test', ['catalogue.manage_organisation']);

    $this->putJson('/api/v1/catalogue/storefront-profile', [...STOREFRONT_PROFILE, 'tagline_en' => str_repeat('a', 161)], $this->headers)
        ->assertUnprocessable()
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['tagline_en']]]]);
});

it('refuses a reader and a writer without the catalogue permission', function (): void {
    storefrontCaller($this, 'orders@kitchen.test', ['order.manage_organisation', 'catalogue.view_organisation']);

    $this->getJson('/api/v1/catalogue/storefront-profile', $this->headers)
        ->assertForbidden()
        ->assertJsonPath('error.code', 'authz.permission_denied');
    $this->putJson('/api/v1/catalogue/storefront-profile', STOREFRONT_PROFILE, $this->headers)->assertForbidden();

    expect(AuditLog::query()->where('action', 'kitchen.storefront_profile_updated')->exists())->toBeFalse();
});

it('serves the marketplace the copy in the request language', function (string $locale, string $tagline, string $description, array $cuisines): void {
    $projected = storefrontProjection([
        'tagline_en' => 'Grilled, never fried',
        'tagline_ar' => 'مشوي لا مقلي',
        'description_en' => 'A Beirut kitchen.',
        'description_ar' => 'مطبخ في بيروت.',
        'cuisines_en' => ['Lebanese', 'Grills'],
        'cuisines_ar' => ['لبناني', 'مشاوي'],
    ], $locale);

    expect($projected['tagline'])->toBe($tagline)
        ->and($projected['description'])->toBe($description)
        ->and($projected['cuisines'])->toBe($cuisines);
})->with([
    'English' => ['en', 'Grilled, never fried', 'A Beirut kitchen.', ['Lebanese', 'Grills']],
    'Arabic' => ['ar', 'مشوي لا مقلي', 'مطبخ في بيروت.', ['لبناني', 'مشاوي']],
]);

it('falls back to English where the Arabic is unset', function (): void {
    $projected = storefrontProjection(['tagline_en' => 'Grilled, never fried', 'cuisines_en' => ['Lebanese']], 'ar');

    expect($projected['tagline'])->toBe('Grilled, never fried')
        ->and($projected['cuisines'])->toBe(['Lebanese']);
});

it('serves an unset profile as empty, in either language', function (string $locale): void {
    $projected = storefrontProjection([], $locale);

    expect($projected['tagline'])->toBe('')
        ->and($projected['description'])->toBe('')
        ->and($projected['cuisines'])->toBe([]);
})->with(['en', 'ar']);
