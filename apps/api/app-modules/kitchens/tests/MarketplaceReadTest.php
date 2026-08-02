<?php

declare(strict_types=1);

use Database\Seeders\DatabaseSeeder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\Organisations\Models\Organisation;

/*
|--------------------------------------------------------------------------
| The public marketplace, end to end
|--------------------------------------------------------------------------
|
| One smoke test per endpoint family: it answers an anonymous caller, in the
| envelope, with the shape the consumer contract expects. The demonstration
| kitchen's three published meals are the world — seeded through the readiness
| evaluator, so a meal that reaches these assertions is a meal the publication
| gate agreed to.
|
| Deeper behaviour (filters, cursors, calendars) is covered by the phase's
| deferred-test list rather than here; what this file proves is that the whole
| stack — query, projector, presenter, envelope — is wired.
|
*/

beforeEach(function (): void {
    $this->seed(DatabaseSeeder::class);
});

it('lists the demonstration kitchen to an anonymous caller', function (): void {
    $response = $this->getJson('/api/v1/marketplace/kitchens')->assertOk();

    $kitchens = collect($response->json('data'));
    $verdant = $kitchens->firstWhere('slug', 'verdant-kitchen');

    expect($verdant)->not->toBeNull()
        ->and($verdant['name'])->toBe('Verdant Kitchen')
        ->and($verdant['country_code'])->toBe('AE')
        ->and($verdant['image_placeholder_id'])->toBe('kitchen-verdant-kitchen')

        // Derived from the kitchen's own active channels: a consumer web shop
        // and a wholesale desk, and nothing else claimed.
        ->and($verdant['channels']['b2c'])->toBeTrue()
        ->and($verdant['channels']['b2b'])->toBeTrue()
        ->and($verdant['channels']['marketplace'])->toBeFalse()
        ->and($verdant['branches'])->toHaveCount(1);

    $branch = $verdant['branches'][0];

    expect($branch['time_zone'])->toBe('Asia/Dubai')
        ->and($branch['opening_hours'])->toHaveCount(7)
        ->and($branch['delivery_zones'])->not->toBeEmpty()
        ->and($response->json('meta'))->toHaveKeys(['correlation_id', 'count', 'next_cursor', 'has_more', 'locale']);
});

it('reads one kitchen by slug', function (): void {
    $this->getJson('/api/v1/marketplace/kitchens/verdant-kitchen')
        ->assertOk()
        ->assertJsonPath('data.slug', 'verdant-kitchen')
        ->assertJsonPath('meta.locale', 'en');
});

it('lists the published menu with prices and derived allergens', function (): void {
    $response = $this->getJson('/api/v1/marketplace/meals')->assertOk();

    $meals = collect($response->json('data'));
    $slugs = $meals->pluck('slug')->all();

    expect($slugs)->toContain('grilled-chicken-freekeh', 'mezze-plate', 'red-lentil-soup')

        // The control: a draft meal with only a placeholder price, seeded to
        // prove the two exclusions rather than only to be excluded.
        ->and($slugs)->not->toContain('chicken-freekeh-bowl');

    $freekeh = $meals->firstWhere('slug', 'grilled-chicken-freekeh');

    expect($freekeh['price'])->toBe(['amount' => 4200, 'currency' => 'AED'])
        ->and($freekeh['kitchen_name'])->toBe('Verdant Kitchen')
        ->and($freekeh['allergens'])->toBe(['gluten'])
        ->and($freekeh['diet_classifications'])->toBe(['high_protein'])

        // Fourteen days of calendar, derived from the branch's operating week.
        ->and($freekeh['availability'])->toHaveCount(14)
        ->and($freekeh['nutrition'])->toBeNull()
        ->and($freekeh['serving'])->toBeNull();
});

it('reads one meal and localises its name', function (): void {
    $english = $this->getJson('/api/v1/marketplace/meals/mezze-plate')->assertOk();
    $arabic = $this->getJson('/api/v1/marketplace/meals/mezze-plate', ['Accept-Language' => 'ar-AE,ar;q=0.9'])->assertOk();

    expect($english->json('data.name'))->toBe('Mezze plate')
        ->and($arabic->json('data.name'))->toBe('صحن مقبلات')
        ->and($arabic->json('meta.locale'))->toBe('ar')
        ->and($english->json('data.allergens'))->toBe(['sesame']);
});

it('answers an empty page of subscription plans, because none is publishable', function (): void {
    // Not a gap: the demonstration plan's premium configuration carries no
    // confirmed price, which is exactly what the K1.6 publish gate refuses, and
    // the imported GreenLife world is draft by design.
    $this->getJson('/api/v1/marketplace/meal-plans')
        ->assertOk()
        ->assertJsonPath('data', [])
        ->assertJsonPath('meta.has_more', false);
});

it('names the filters the platform stores nothing for rather than ignoring them', function (): void {
    $this->getJson('/api/v1/marketplace/meals?energy_max=500&cuisines=levantine')
        ->assertOk()
        ->assertJsonPath('meta.unsupported_filters', ['cuisines', 'energy_max']);
});

it('answers 404 for a kitchen the platform has suspended', function (): void {
    Organisation::query()->where('slug', 'verdant-kitchen')->update(['status' => OrganisationStatus::Suspended->value]);

    $this->getJson('/api/v1/marketplace/kitchens/verdant-kitchen')->assertNotFound()
        ->assertJsonPath('error.code', 'resource.not_found');

    // And its meals go with it: a suspended tenant is absent, not greyed out.
    $this->getJson('/api/v1/marketplace/meals')->assertOk()->assertJsonPath('data', []);
});

it('withdraws a retired meal from the marketplace', function (): void {
    CatalogueItem::withoutTenancy()
        ->where('slug', 'mezze-plate')
        ->update(['status' => CatalogueItemStatus::Retired->value]);

    $this->getJson('/api/v1/marketplace/meals/mezze-plate')->assertNotFound();

    $slugs = collect($this->getJson('/api/v1/marketplace/meals')->assertOk()->json('data'))->pluck('slug')->all();

    expect($slugs)->not->toContain('mezze-plate');
});
