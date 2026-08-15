<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Contracts\ConfirmedPriceRegistry;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Services\PriceListConfirmedPriceRegistry;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| A plan nobody has priced cannot go on sale
|--------------------------------------------------------------------------
|
| The K1.6 blocker that reaches outside the catalogue, tested from the pricing
| side because that is where the dependency edge legitimately runs (Pricing →
| Catalogues) and because proving it needs real tariffs.
|
| It is the mechanism behind reviewer point 15 and decision OD-2: a plan
| imported with placeholder prices stays unpublishable until somebody supplies
| the numbers. A placeholder is a row that says "we have not priced this", and a
| plan page rendering one — as a blank, as a zero, as anything — is the failure
| the placeholder design exists to prevent.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = PricingWorld::kitchen('plan-prices@kitchen.test');
    $this->headers = PricingWorld::headers($this->a);

    $this->plan = CatalogueWorld::plan($this->a);
    $this->combination = CatalogueWorld::combination($this->a->organisation, 'lunch-dinner');

    $this->actingAs($this->a->user);

    // The smallest plan the gate is otherwise happy with: terms, one active
    // configuration, one available duration. What is left is the price.
    $this->putJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/profile', [], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $this->putJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/variants', [
        'cells' => [['meal_combination_option_id' => (string) $this->combination->getKey(), 'meals_per_day' => 2]],
    ], $this->headers + ['If-Match' => '"1"'])->assertOk();

    CatalogueWorld::duration($this->a->organisation, 'days-20', 20);

    $this->putJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/variant-durations', [
        'assignments' => [['variant_code' => 'lunch-dinner-standard', 'duration_code' => 'days-20']],
    ], $this->headers + ['If-Match' => '"2"'])->assertOk();

    $this->configuration = CatalogueItemVariant::withoutTenancy()
        ->where('catalogue_item_id', $this->plan->getKey())
        ->sole();

    $this->publish = fn (string $lockVersion) => $this->postJson(
        '/api/v1/catalogue/items/'.$this->plan->getKey().'/publish',
        [],
        $this->headers + ['If-Match' => '"'.$lockVersion.'"'],
    );
});

it('refuses to publish a plan whose only price is a placeholder, and publishes it when a real one lands', function (): void {
    $tariff = PricingWorld::priceList($this->a->organisation, 'plans-usd', active: true);

    PricingWorld::price($tariff, $this->plan, $this->configuration, null, null, PriceStatus::Placeholder);

    $reasons = ($this->publish)('3')
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.publish_blocked')
        ->json('error.details.reasons');

    // The only thing wrong with this plan is that nobody has priced it.
    expect(collect($reasons)->pluck('reason')->all())->toBe(['plan_prices_incomplete'])
        ->and(collect($reasons)->firstWhere('reason', 'plan_prices_incomplete')['configurations'])
        ->toBe(['lunch-dinner-standard']);

    // The flip. Supersede the placeholder with a confirmed row through the
    // ordinary pricing endpoint — no fixture surgery — and the same plan
    // becomes publishable.
    $this->putJson('/api/v1/catalogue/price-lists/'.$tariff->getKey().'/entries', [
        'entries' => [[
            'catalogue_item_id' => (string) $this->plan->getKey(),
            'catalogue_item_variant_id' => (string) $this->configuration->getKey(),
            'price_status' => 'confirmed',
            'unit_amount_minor' => 5500,
        ]],
    ], $this->headers + ['If-Match' => '"'.$tariff->lock_version.'"'])->assertOk();

    ($this->publish)('3')
        ->assertOk()
        ->assertJsonPath('data.item.status', 'published');
});

it('does not count a confirmed price on a draft tariff', function (): void {
    // A draft list prices nothing — that is what draft means — so a plan
    // priced only there is a plan whose numbers nobody has agreed to yet.
    $draft = PricingWorld::priceList($this->a->organisation, 'draft-usd');

    PricingWorld::price($draft, $this->plan, $this->configuration, 5500);

    $reasons = ($this->publish)('3')->assertStatus(409)->json('error.details.reasons');

    expect(collect($reasons)->pluck('reason')->all())->toBe(['plan_prices_incomplete']);
});

it('does not count a price that has been closed', function (): void {
    $tariff = PricingWorld::priceList($this->a->organisation, 'plans-usd', active: true);

    PricingWorld::price(
        $tariff, $this->plan, $this->configuration, 5500,
        from: now()->subMonths(2)->startOfDay()->toImmutable(),
        to: now()->subMonth()->startOfDay()->toImmutable(),
    );

    $reasons = ($this->publish)('3')->assertStatus(409)->json('error.details.reasons');

    expect(collect($reasons)->pluck('reason')->all())->toBe(['plan_prices_incomplete']);
});

it('does not count an item-level price as a price for every configuration', function (): void {
    // The variant rule, applied to the gate: a plan priced "as itself" with no
    // configuration named has not priced any particular configuration, and a
    // subscription is always bought as one.
    $tariff = PricingWorld::priceList($this->a->organisation, 'plans-usd', active: true);

    PricingWorld::price($tariff, $this->plan, null, 5500);

    $reasons = ($this->publish)('3')->assertStatus(409)->json('error.details.reasons');

    expect(collect($reasons)->pluck('reason')->all())->toBe(['plan_prices_incomplete']);
});

it('never lets one kitchens tariff price another kitchens plan', function (): void {
    $b = PricingWorld::kitchen('other-plan-prices@kitchen.test');
    $theirTariff = PricingWorld::priceList($b->organisation, 'theirs-usd', active: true);

    // A row that names my configuration from their list — the shape a
    // cross-tenant mistake would take. The gate asks about *my* organisation,
    // so it does not see it.
    PricingWorld::price($theirTariff, $this->plan, $this->configuration, 5500);

    $reasons = ($this->publish)('3')->assertStatus(409)->json('error.details.reasons');

    expect(collect($reasons)->pluck('reason')->all())->toBe(['plan_prices_incomplete']);
});

it('answers the catalogues confirmed-price question with the pricing implementation', function (): void {
    // The container-level proof, mirroring the ingredient-registry test in the
    // catalogues suite. A broken binding would fall back to the fail-closed
    // null object and make every plan permanently unpublishable — loudly,
    // which is the point of choosing that direction.
    expect(app(ConfirmedPriceRegistry::class))->toBeInstanceOf(PriceListConfirmedPriceRegistry::class);

    $tariff = PricingWorld::priceList($this->a->organisation, 'plans-usd', active: true);

    PricingWorld::price($tariff, $this->plan, $this->configuration, 5500);

    $registry = app(ConfirmedPriceRegistry::class);
    $variantId = (string) $this->configuration->getKey();

    expect($registry->pricedVariantIds($this->a->organisation->getKey(), [$variantId]))->toBe([$variantId])
        ->and($registry->pricedVariantIds($this->a->organisation->getKey(), []))->toBe([]);
});
