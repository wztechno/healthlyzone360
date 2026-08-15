<?php

declare(strict_types=1);

use Database\Seeders\DatabaseSeeder;
use Database\Seeders\MarketplaceKitchensSeeder;
use Database\Seeders\MarketplacePlansSeeder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;

/*
|--------------------------------------------------------------------------
| The photographed preview world, served by the API
|--------------------------------------------------------------------------
|
| The customer app shipped a TypeScript fixture: six kitchens, eight plans and
| forty meals, each with a bundled photograph keyed by slug. Deleting that mock
| means the API has to answer with the same world, or an API-mode build shows
| a different marketplace from the one every screen was designed against.
|
| This file is where "the same world" is a test rather than an intention. It
| pins the slugs, the counts and the per-kitchen split, because those are what
| the photographs are keyed to — a meal that moves kitchens loses its picture.
|
| `DatabaseSeeder` keeps the preview seeders out of PHPUnit (~115 test cases
| seed that graph and only this one reads it), so they are called explicitly
| here. Everything they write goes through the same readiness gate the demo
| kitchen's menu does: a listing that reaches these assertions is one the
| publication gate agreed to.
|
*/

beforeEach(function (): void {
    $this->seed(DatabaseSeeder::class);
    $this->seed(MarketplaceKitchensSeeder::class);
    $this->seed(MarketplacePlansSeeder::class);
});

/** The six kitchens the customer prototype's photographs are keyed to. */
const PREVIEW_KITCHENS = [
    'verdant-kitchen',
    'the-daily-pot',
    'riverstone-meal-works',
    'saffron-and-sea',
    'olive-terrace-counter',
    'northwind-provisions',
];

/** The eight subscription plans the fixture names, whichever kitchen sells them. */
const PREVIEW_PLANS = [
    'balanced-week',
    'plant-forward',
    'desk-lunch-club',
    'coastal-light',
    'mediterranean-reset',
    'everyday-family-box',
    'strength-build',
    'lean-cut',
];

it('lists exactly the six preview kitchens, each keyed to its photograph', function (): void {
    $kitchens = collect($this->getJson('/api/v1/marketplace/kitchens?limit=50')->assertOk()->json('data'));

    expect($kitchens->pluck('slug')->all())->toEqualCanonicalizing(PREVIEW_KITCHENS);

    foreach ($kitchens as $kitchen) {
        expect($kitchen['image_placeholder_id'])->toBe('kitchen-'.$kitchen['slug'])
            ->and($kitchen['branches'])->not->toBeEmpty();

        // Fourteen days of orderable calendar is derived from
        // `branch_opening_hours` alone, so a branch with no week publishes a
        // fortnight of "unavailable" and the kitchen looks shut. Seven rows a
        // branch is therefore mandatory rather than decorative.
        foreach ($kitchen['branches'] as $branch) {
            expect($branch['opening_hours'])->toHaveCount(7);
        }
    }
});

it('lists exactly the eight preview plans, each priced by the week over four runs', function (): void {
    $response = $this->getJson('/api/v1/marketplace/meal-plans?limit=50')->assertOk();

    $plans = collect($response->json('data'));

    expect($plans->pluck('slug')->all())->toEqualCanonicalizing(PREVIEW_PLANS)
        ->and($response->json('meta.has_more'))->toBeFalse();

    foreach ($plans as $plan) {
        $variants = collect($plan['variants']);

        expect($plan['image_placeholder_id'])->toBe('plan-'.$plan['slug'])
            ->and($variants)->not->toBeEmpty()
            ->and($plan['durations'])->not->toBeEmpty();

        foreach ($variants as $variant) {
            expect($variant['price_per_week'])->toBeArray()
                ->and($variant['price_per_week']['currency'])->toBe('USD')
                ->and($variant['price_per_week']['amount'])->toBeGreaterThan(0);
        }
    }

    // The plan the API demo carried under its own slug is the fixture's, and
    // `balanced-plan` stays unpublishable as the gate demo it was written to be.
    $balanced = $plans->firstWhere('slug', 'balanced-week');

    expect($balanced)->not->toBeNull()
        ->and(collect($balanced['variants'])->pluck('name')->all())
        ->toEqualCanonicalizing(['Light', 'Standard', 'Generous'])
        ->and($plans->pluck('slug')->all())->not->toContain('balanced-plan');
});

it('serves the forty photographed meals under the kitchens that cook them', function (): void {
    $meals = collect($this->getJson('/api/v1/marketplace/meals?item_types=meal&limit=100')->assertOk()->json('data'));

    expect($meals)->toHaveCount(40);

    foreach ($meals as $meal) {
        expect($meal['image_placeholder_id'])->toBe('meal-'.$meal['slug']);
    }

    expect($meals->countBy('kitchen_name')->sortKeys()->all())->toBe([
        'Riverstone Meal Works' => 8,
        'Saffron and Sea' => 6,
        'The Daily Pot' => 12,
        'Verdant Kitchen' => 14,
    ]);
});

it('lists a wholesale-only kitchen with no menu and no diets to summarise', function (): void {
    $northwind = $this->getJson('/api/v1/marketplace/kitchens/northwind-provisions')
        ->assertOk()
        ->json('data');

    // A depot is a kitchen a customer may discover and may not buy from. Both
    // halves are the point: it is listed, and its menu is empty, because no
    // channel of a listing kind offers anything through it.
    expect($northwind['channels']['b2b'])->toBeTrue()
        ->and($northwind['channels']['corporate'])->toBeTrue()
        ->and($northwind['channels']['b2c'])->toBeFalse()
        ->and($northwind['channels']['marketplace'])->toBeFalse()
        ->and($northwind['diet_classifications'])->toBe([])
        ->and($northwind['branches'])->toHaveCount(2);

    $listed = collect($this->getJson('/api/v1/marketplace/meals?limit=100')->assertOk()->json('data'));

    $ownedByNorthwind = CatalogueItem::withoutTenancy()
        ->where('organisation_id', Organisation::query()->where('slug', 'northwind-provisions')->sole()->getKey())
        ->count();

    expect($listed)->not->toBeEmpty()
        ->and($listed->pluck('kitchen_name')->unique()->all())->not->toContain('Northwind Provisions')

        // Nothing was seeded under it at all — the emptiness is in the data,
        // not only in what the listing query filters out.
        ->and($ownedByNorthwind)->toBe(0);
});

it('lists a counter-only kitchen with one branch and no delivery map', function (): void {
    $olive = $this->getJson('/api/v1/marketplace/kitchens/olive-terrace-counter')
        ->assertOk()
        ->json('data');

    expect($olive['channels']['pos'])->toBeTrue()
        ->and($olive['channels']['b2c'])->toBeFalse()
        ->and($olive['branches'])->toHaveCount(1)

        // A till has no delivery map, and an empty list is what that looks
        // like rather than an invented zone over the branch's own area.
        ->and($olive['branches'][0]['delivery_zones'])->toBe([])
        ->and($olive['delivery_windows'])->not->toBeEmpty();
});

it('keeps the other kitchens selling when the demonstration kitchen is suspended', function (): void {
    Organisation::query()
        ->where('slug', 'verdant-kitchen')
        ->update(['status' => OrganisationStatus::Suspended->value]);

    $meals = collect($this->getJson('/api/v1/marketplace/meals?item_types=meal&limit=100')->assertOk()->json('data'));

    // Suspension withdraws one tenant, not the marketplace: the twenty-six
    // meals the other kitchens cook are still on sale.
    expect($meals)->toHaveCount(26)
        ->and($meals->pluck('kitchen_name')->unique()->all())->not->toContain('Verdant Kitchen');

    $this->getJson('/api/v1/marketplace/kitchens/verdant-kitchen')->assertNotFound();
});

it('leaves nothing it ported sitting in draft', function (): void {
    /** @var list<array<string, mixed>> $mealFixtures */
    $mealFixtures = require database_path('seeders/fixtures/prototype_marketplace_meals.php');

    $ported = array_map(static fn (array $meal): string => (string) $meal['slug'], $mealFixtures);

    $drafts = CatalogueItem::withoutTenancy()
        ->whereIn('slug', [...$ported, ...PREVIEW_PLANS])
        ->where('status', CatalogueItemStatus::Draft->value)
        ->pluck('slug')
        ->all();

    expect($drafts)->toBe([]);

    // The twenty-six relocated meals were once seeded under Verdant. The
    // legacy sweep retires those rows rather than deleting them — a price list
    // item points at each with `restrictOnDelete` — so no dish appears twice
    // under two kitchens' names.
    $verdant = Organisation::query()->where('slug', 'verdant-kitchen')->sole();

    $relocated = array_values(array_map(
        static fn (array $meal): string => (string) $meal['slug'],
        array_filter($mealFixtures, static fn (array $meal): bool => $meal['kitchen_slug'] !== 'verdant-kitchen'),
    ));

    $stale = CatalogueItem::withoutTenancy()
        ->where('organisation_id', $verdant->getKey())
        ->whereIn('slug', $relocated)
        ->where('status', '!=', CatalogueItemStatus::Retired->value)
        ->count();

    expect($stale)->toBe(0);
});

it('converges instead of duplicating when the preview seeders run a second time', function (): void {
    $counts = static fn (): array => [
        Organisation::query()->count(),
        OrganisationBranch::withoutTenancy()->count(),
        BranchOpeningHour::withoutTenancy()->count(),
        SalesChannel::withoutTenancy()->count(),
        DeliveryZone::withoutTenancy()->count(),
        DeliveryZoneArea::withoutTenancy()->count(),
        DeliveryWindow::withoutTenancy()->count(),
        CatalogueItem::withoutTenancy()->count(),
        CatalogueItemVariant::withoutTenancy()->count(),
        PriceList::withoutTenancy()->count(),
        PriceListItem::withoutTenancy()->count(),
    ];

    $before = $counts();

    $this->seed(MarketplaceKitchensSeeder::class);
    $this->seed(MarketplacePlansSeeder::class);

    expect($counts())->toBe($before);
});
