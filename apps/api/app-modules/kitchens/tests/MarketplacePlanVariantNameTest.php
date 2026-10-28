<?php

declare(strict_types=1);

use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Tests\SeedPreviewWorldOnce;

/*
|--------------------------------------------------------------------------
| A configuration with no name of its own is called by its energy band
|--------------------------------------------------------------------------
|
| The plan editor builds its grid from bands and meal combinations and never
| asks for a configuration name, so a plan made in the admin serves `name: ""`
| on every variant — and the customer's calorie-band choice was a row of empty
| pills. The band's own name is what the customer is choosing between.
|
*/

pest()->use(SeedPreviewWorldOnce::class);

it('names an unnamed configuration after its energy band', function (): void {
    $plan = CatalogueItem::withoutTenancy()
        ->where('item_type', CatalogueItemType::SubscriptionPlan->value)
        ->where('slug', 'balanced-week')
        ->sole();

    CatalogueItemVariant::withoutTenancy()
        ->where('catalogue_item_id', $plan->getKey())
        ->update(['name_en' => null, 'name_ar' => null]);

    $variants = $this->getJson('/api/v1/marketplace/meal-plans/'.$plan->slug)
        ->assertOk()
        ->json('data.variants');

    expect($variants)->not->toBeEmpty();

    foreach ($variants as $variant) {
        expect($variant['name'])->not->toBe('');
    }
});

it('names the sittings a customer fills for every configuration', function (): void {
    $plan = CatalogueItem::withoutTenancy()
        ->where('item_type', CatalogueItemType::SubscriptionPlan->value)
        ->where('slug', 'balanced-week')
        ->sole();

    $variants = $this->getJson('/api/v1/marketplace/meal-plans/'.$plan->slug)
        ->assertOk()
        ->json('data.variants');

    expect($variants)->not->toBeEmpty();

    foreach ($variants as $variant) {
        // One picker per meal and per snack, so the storefront never counts.
        expect($variant['sittings'])->toHaveCount($variant['meals_per_day'] + $variant['snacks_per_day']);
    }

    expect($plan)->not->toBeNull()
        ->and($this->getJson('/api/v1/marketplace/meal-plans/'.$plan->slug)->json('data'))->not->toHaveKey('sample_meal_ids');
});
