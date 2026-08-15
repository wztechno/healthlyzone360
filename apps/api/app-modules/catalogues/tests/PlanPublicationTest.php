<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| What stops a subscription plan reaching a customer
|--------------------------------------------------------------------------
|
| K1.6 adds four blockers to the shared publish gate, and every one of them has
| a test here for the reason K1.4 gives: a gate whose refusals are untested is a
| gate that quietly stops refusing.
|
| The price blocker — `plan_prices_incomplete` — is exercised from the pricing
| module's suite instead (`PlanPriceGateTest`), because proving it needs tariffs
| and the module dependency runs Pricing → Catalogues. It still *appears* in the
| refusals below, since nothing here is priced, so these tests assert the
| presence of the reason they are about rather than the exact set.
|
| Publishing a plan additionally needs `plan.publish_organisation`, checked in
| the action service because that is the only layer that has loaded the row and
| can therefore know it is a plan.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = CatalogueWorld::kitchen('publisher@plans.test');
    $this->headers = CatalogueWorld::headers($this->a);
    $this->plan = CatalogueWorld::plan($this->a);
    $this->combination = CatalogueWorld::combination($this->a->organisation, 'lunch-dinner');

    $this->actingAs($this->a->user);

    $this->publish = fn (CatalogueItem $item, string $lockVersion) => $this->postJson(
        '/api/v1/catalogue/items/'.$item->getKey().'/publish',
        [],
        $this->headers + ['If-Match' => '"'.$lockVersion.'"'],
    );
});

it('refuses a plan whose commercial terms nobody has written', function (): void {
    // No profile row means no decision has been made about how this is sold,
    // on what basis it is priced, or how late a subscriber may change a
    // delivery. A listing that answers none of those is not a listing.
    $reasons = ($this->publish)($this->plan, '0')
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'catalogue.publish_blocked')
        ->json('error.details.reasons');

    expect(collect($reasons)->pluck('reason')->all())->toContain('plan_profile_missing');

    expect(CatalogueItem::withoutTenancy()->whereKey($this->plan->getKey())->value('status'))
        ->toBe(CatalogueItemStatus::Draft);
});

it('refuses a plan with no active configuration, and says nothing about durations while it has none', function (): void {
    $reasons = ($this->publish)($this->plan, '0')->assertStatus(409)->json('error.details.reasons');

    $named = collect($reasons)->pluck('reason')->all();

    // Durations and prices are questions *about* configurations, so reporting
    // "no durations" beside "no configurations" would be two ways of saying
    // one missing thing.
    expect($named)->toContain('no_active_plan_configuration')
        ->and($named)->not->toContain('no_duration_assigned')
        ->and($named)->not->toContain('plan_prices_incomplete');
});

it('counts only active configurations, so an archived matrix is no matrix', function (): void {
    $this->putJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/variants', [
        'cells' => [['meal_combination_option_id' => (string) $this->combination->getKey(), 'meals_per_day' => 2]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $this->putJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/variants', [
        'cells' => [],
    ], $this->headers + ['If-Match' => '"1"'])->assertOk();

    $reasons = ($this->publish)($this->plan->refresh(), '2')->assertStatus(409)->json('error.details.reasons');

    expect(collect($reasons)->pluck('reason')->all())->toContain('no_active_plan_configuration');
});

it('refuses a plan nobody can buy for any length of time', function (): void {
    $this->putJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/profile', [], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $this->putJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/variants', [
        'cells' => [['meal_combination_option_id' => (string) $this->combination->getKey(), 'meals_per_day' => 2]],
    ], $this->headers + ['If-Match' => '"1"'])->assertOk();

    $reasons = ($this->publish)($this->plan->refresh(), '2')->assertStatus(409)->json('error.details.reasons');

    $named = collect($reasons)->pluck('reason')->all();

    // A plan is sold *for a period*, and the period is not implied.
    expect($named)->toContain('no_duration_assigned')
        ->and($named)->not->toContain('plan_profile_missing')
        ->and($named)->not->toContain('no_active_plan_configuration');
});

it('does not count a duration assignment that has been switched off', function (): void {
    $this->putJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/profile', [], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $this->putJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/variants', [
        'cells' => [['meal_combination_option_id' => (string) $this->combination->getKey(), 'meals_per_day' => 2]],
    ], $this->headers + ['If-Match' => '"1"'])->assertOk();

    CatalogueWorld::duration($this->a->organisation, 'days-20', 20);

    $this->putJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/variant-durations', [
        'assignments' => [['variant_code' => 'lunch-dinner-standard', 'duration_code' => 'days-20', 'is_available' => false]],
    ], $this->headers + ['If-Match' => '"2"'])->assertOk();

    $reasons = ($this->publish)($this->plan->refresh(), '3')->assertStatus(409)->json('error.details.reasons');

    expect(collect($reasons)->pluck('reason')->all())->toContain('no_duration_assigned');
});

it('names every unpriced configuration by code as well as by identifier', function (): void {
    $premiumBand = CatalogueWorld::energyBand($this->a->organisation, 'kcal-1500-1800');

    $this->putJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/profile', [], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $this->putJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/variants', [
        'cells' => [
            ['meal_combination_option_id' => (string) $this->combination->getKey(), 'meals_per_day' => 2],
            [
                'meal_combination_option_id' => (string) $this->combination->getKey(),
                'energy_band_id' => (string) $premiumBand->getKey(),
                'service_tier' => 'premium',
                'meals_per_day' => 2,
            ],
        ],
    ], $this->headers + ['If-Match' => '"1"'])->assertOk();

    CatalogueWorld::duration($this->a->organisation, 'days-20', 20);

    $this->putJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/variant-durations', [
        'assignments' => [['variant_code' => 'lunch-dinner-standard', 'duration_code' => 'days-20']],
    ], $this->headers + ['If-Match' => '"2"'])->assertOk();

    $reasons = ($this->publish)($this->plan->refresh(), '3')->assertStatus(409)->json('error.details.reasons');

    $gap = collect($reasons)->firstWhere('reason', 'plan_prices_incomplete');

    // Codes as well as identifiers: the person reading this refusal is looking
    // at a matrix labelled by code, and a list of UUIDs would send them back to
    // the API to find out which cells to price.
    expect($gap)->not->toBeNull()
        ->and($gap['configurations'])->toEqualCanonicalizing([
            'lunch-dinner-standard',
            'lunch-dinner-premium-kcal-1500-1800',
        ])
        ->and($gap['catalogue_item_variant_ids'])->toEqualCanonicalizing(
            CatalogueItemVariant::withoutTenancy()->where('catalogue_item_id', $this->plan->getKey())->pluck('id')->all(),
        );
});

it('refuses a plan publication to a caller who may publish everything else', function (): void {
    // Both seeded roles that may publish anything hold both codes, so nothing a
    // template role can do changes. What the extra code buys is that a bespoke
    // role can be given authority over products and meals without acquiring
    // authority over the commercial instrument a subscription is.
    $limited = CatalogueWorld::kitchen('nopublish@plans.test', array_values(array_diff(
        CatalogueWorld::FULL_PERMISSIONS,
        ['plan.publish_organisation'],
    )));

    $plan = CatalogueWorld::plan($limited);
    $product = CatalogueWorld::publishableProduct($limited);

    forgetResolvedGuards();
    $this->actingAs($limited->user);

    $headers = CatalogueWorld::headers($limited);

    $this->postJson('/api/v1/catalogue/items/'.$plan->getKey().'/publish', [], $headers + ['If-Match' => '"0"'])
        ->assertStatus(403)
        ->assertJsonPath('error.code', 'authz.permission_denied')
        ->assertJsonPath('error.details.permission', 'plan.publish_organisation');

    // And the same caller still publishes a product, so the new code has not
    // quietly become a second gate on everything.
    $this->postJson('/api/v1/catalogue/items/'.$product->getKey().'/publish', [], $headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.item.status', 'published');
});

it('leaves the product and meal gates exactly as K1.4 left them', function (): void {
    // A regression guard: the plan checks are inside an item-type branch, and
    // a slip there would start demanding profiles of jars of harissa.
    $product = CatalogueWorld::publishableProduct($this->a);

    ($this->publish)($product, '0')
        ->assertOk()
        ->assertJsonPath('data.item.status', 'published');
});
