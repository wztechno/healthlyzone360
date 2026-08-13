<?php

declare(strict_types=1);

use App\Models\User;
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
        ->and($verdant['branches'])->toHaveCount(1)
        ->and($verdant['delivery_windows'])->not->toBeEmpty();

    $morning = collect($verdant['delivery_windows'])->firstWhere('code', 'morning');

    expect($morning)->not->toBeNull()
        ->and($morning['starts_at'])->toBe('09:00')
        ->and($morning['ends_at'])->toBe('12:00');

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

it('lists published products beside meals and filters by item type', function (): void {
    $all = collect($this->getJson('/api/v1/marketplace/meals')->assertOk()->json('data'));

    expect($all->pluck('slug')->all())->toContain('grilled-chicken-freekeh', 'mezze-plate', 'red-lentil-soup')
        ->and($all->count())->toBeGreaterThan(3);

    $products = collect($this->getJson('/api/v1/marketplace/meals?item_types=product')->assertOk()->json('data'));

    expect($products)->not->toBeEmpty()
        ->and($products->every(static fn (array $row): bool => $row['item_type'] === 'product'))->toBeTrue()
        ->and($products->pluck('slug')->all())->not->toContain('mezze-plate');

    $mealsOnly = collect($this->getJson('/api/v1/marketplace/meals?item_types=meal')->assertOk()->json('data'));

    expect($mealsOnly->every(static fn (array $row): bool => $row['item_type'] === 'meal'))->toBeTrue()
        ->and($mealsOnly->pluck('slug')->all())->toContain('mezze-plate')
        ->and($mealsOnly->where('item_type', 'product'))->toBeEmpty();

    $sample = $products->first();
    expect($sample['price'])->toHaveKeys(['amount', 'currency'])
        ->and($sample['price']['amount'])->toBeGreaterThan(0);

    $this->getJson('/api/v1/marketplace/meals/'.$sample['slug'])
        ->assertOk()
        ->assertJsonPath('data.item_type', 'product');

    $this->getJson('/api/v1/marketplace/meals?item_types=plan')
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'request.invalid');
});

it('surfaces seeded Verdant products on the wholesale B2B catalogue at B2B amounts', function (): void {
    $buyer = User::query()->where('email', 'buyer@acme-wellness.test')->sole();
    $org = Organisation::query()->where('slug', 'acme-wellness')->sole();

    $response = $this->actingAs($buyer)
        ->getJson('/api/v1/b2b/catalogue/items', firstPartyHeaders() + [
            'X-Organisation-Id' => (string) $org->getKey(),
        ])
        ->assertOk();

    $items = collect($response->json('data.items'));
    $products = $items->where('item_type', 'product');

    expect($products->count())->toBeGreaterThan(0);

    // Honey Mustard: B2B $5 / B2C $3 on dual packs — public list must show the
    // retail bottle amount, not vanish because the kilo pack is is_default.
    $public = collect($this->getJson('/api/v1/marketplace/meals?item_types=product')->assertOk()->json('data'))
        ->firstWhere('name', 'Honey Mustard Sauce');

    expect($public)->not->toBeNull()
        ->and($public['price']['amount'])->toBe(300);

    $wholesale = $products->firstWhere('name', 'Honey Mustard Sauce');
    expect($wholesale)->not->toBeNull()
        ->and($wholesale['price']['amount_minor'])->toBe(500);
});

it('lists the published menu with prices, derived allergens and preview nutrition', function (): void {
    $response = $this->getJson('/api/v1/marketplace/meals?item_types=meal&limit=50')->assertOk();

    $meals = collect($response->json('data'));
    $slugs = $meals->pluck('slug')->all();

    expect($slugs)->toContain('grilled-chicken-freekeh', 'mezze-plate', 'red-lentil-soup')

        // The demonstration kitchen's own fourteen. The other twenty-six
        // photographed preview meals belong to the five preview kitchens, which
        // `DatabaseSeeder` keeps out of PHPUnit — `MarketplacePreviewWorldTest`
        // seeds them and pins the forty-meal customer catalogue there.
        ->and($meals)->toHaveCount(14)

        // The control: a draft meal with only a placeholder price, seeded to
        // prove the two exclusions rather than only to be excluded.
        ->and($slugs)->not->toContain('chicken-freekeh-bowl');

    $freekeh = $meals->firstWhere('slug', 'grilled-chicken-freekeh');
    $energy = collect($freekeh['nutrition']['amounts'])->firstWhere('nutrient_id', 'energy');
    $serving = $freekeh['serving'];

    expect($freekeh['price'])->toBe(['amount' => 4200, 'currency' => 'USD'])
        ->and($freekeh['kitchen_name'])->toBe('Verdant Kitchen')
        ->and($freekeh['allergens'])->toBe(['gluten'])
        ->and($freekeh['diet_classifications'])->toBe(['high_protein'])

        // Fourteen days of calendar, derived from the branch's operating week.
        ->and($freekeh['availability'])->toHaveCount(14)
        ->and($freekeh['nutrition']['basis'])->toBe('per_serving')
        ->and($freekeh['nutrition']['source']['kind'])->toBe('synthetic_prototype');

    expect($energy)
        ->toBeArray()
        ->and($energy['nutrient_id'])->toBe('energy')
        ->and($energy['unit'])->toBe('kcal')
        ->and($energy['value'])->toBe(500)
        ->and($energy['kind'])->toBe('planned')
        ->and($energy['tolerance'])->toBeNull();

    expect($serving)
        ->toBeArray()
        ->and($serving['label'])->toBe('1 bowl')
        ->and($serving['quantity'])->toBe(1)
        ->and($serving['unit'])->toBe('portion')
        ->and($serving['grams'])->toBe(340)
        ->and($serving['millilitres'])->toBeNull()
        ->and($serving['household_measure'])->toBeNull();
});

it('reads one meal and localises its name', function (): void {
    $english = $this->getJson('/api/v1/marketplace/meals/mezze-plate')->assertOk();
    $arabic = $this->getJson('/api/v1/marketplace/meals/mezze-plate', ['Accept-Language' => 'ar-AE,ar;q=0.9'])->assertOk();

    expect($english->json('data.name'))->toBe('Mezze plate')
        ->and($arabic->json('data.name'))->toBe('صحن مقبلات')
        ->and($arabic->json('meta.locale'))->toBe('ar')
        ->and($english->json('data.allergens'))->toBe(['sesame']);
});

it('lists published subscription plans from the demonstration kitchen', function (): void {
    $this->getJson('/api/v1/marketplace/meal-plans')
        ->assertOk()
        ->assertJsonPath('meta.has_more', false);

    $slugs = collect($this->getJson('/api/v1/marketplace/meal-plans')->json('data'))->pluck('slug')->all();

    expect($slugs)->toContain('balanced-week')
        ->and($slugs)->not->toContain('balanced-plan');
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
