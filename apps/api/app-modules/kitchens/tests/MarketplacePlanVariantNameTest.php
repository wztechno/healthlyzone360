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
