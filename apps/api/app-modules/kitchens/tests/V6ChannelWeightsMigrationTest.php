<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
| An already-imported v6 catalogue gets what the importer now writes from the
| B2B/B2C weight and price columns: a meal sold by weight gets its packs and its
| importer prices move onto them, and the kitchen ingredient states the same
| prices per kilogram. Figures come from the committed v6-catalogue.json.
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
    $this->kitchen = CatalogueWorld::kitchen('v6-weights@kitchen.test');
});

function runV6WeightsMigration(): void
{
    $migration = require dirname(__DIR__).'/database/migrations/2026_10_07_000001_carry_v6_channel_weights_and_prices.php';
    $migration->up();
}

it('packs a meal sold by weight and moves the importer prices onto its packs', function (): void {
    $organisation = $this->kitchen->organisation;

    // PRD-005 Caramelised Onions: B2B 1 kg at $12.00, B2C 200 g at $3.00.
    $onions = CatalogueItem::factory()->create([
        'catalogue_id' => $this->kitchen->catalogue->getKey(),
        'organisation_id' => $organisation->getKey(),
        'item_type' => CatalogueItemType::Meal,
        'slug' => 'caramelised-onions',
        'source_system' => 'healthy360_workbook_v6',
        'source_ref' => 'PRD-005',
    ]);

    $shop = PricingWorld::channel($organisation, 'web-shop');
    $wholesale = PricingWorld::channel($organisation, 'wholesale');
    $desk = PricingWorld::channel($organisation, 'desk');

    foreach (['b2c' => [$shop, 300], 'b2b' => [$wholesale, 1200]] as $channel => [$salesChannel, $amount]) {
        $row = PricingWorld::price(PricingWorld::priceList($organisation, "v6-{$channel}"), $onions, null, $amount);
        $row->source_ref = "PRD-005/{$channel}";
        $row->save();

        ChannelCatalogueItem::withoutTenancy()->create([
            'organisation_id' => $organisation->getKey(),
            'sales_channel_id' => $salesChannel->getKey(),
            'catalogue_item_id' => $onions->getKey(),
            'is_available' => true,
        ]);
    }

    // The desk mirrors the shop at item level; it keeps offering the article as a whole.
    $deskOffer = ChannelCatalogueItem::withoutTenancy()->create([
        'organisation_id' => $organisation->getKey(),
        'sales_channel_id' => $desk->getKey(),
        'catalogue_item_id' => $onions->getKey(),
        'is_available' => true,
    ]);

    runV6WeightsMigration();
    runV6WeightsMigration();

    $packs = CatalogueItemVariant::withoutTenancy()->where('catalogue_item_id', $onions->getKey())->get()->keyBy('code');

    expect($packs->keys()->sort()->values()->all())->toBe(['b2b', 'b2c'])
        ->and($packs['b2c']->is_default)->toBeTrue()
        ->and($packs['b2b']->is_default)->toBeFalse()
        ->and(CatalogueItemPackVariant::sizeOf((string) $packs['b2c']->getKey()))->toBe(['size' => '0.2', 'unit' => 'kg'])
        ->and(CatalogueItemPackVariant::sizeOf((string) $packs['b2b']->getKey()))->toBe(['size' => '1', 'unit' => 'kg']);

    foreach (['b2c' => $shop, 'b2b' => $wholesale] as $channel => $salesChannel) {
        expect(PriceListItem::withoutTenancy()->where('source_ref', "PRD-005/{$channel}")->sole()->catalogue_item_variant_id)
            ->toBe((string) $packs[$channel]->getKey())
            ->and(ChannelCatalogueItem::withoutTenancy()->where('sales_channel_id', $salesChannel->getKey())->sole()->catalogue_item_variant_id)
            ->toBe((string) $packs[$channel]->getKey());
    }

    expect(ChannelCatalogueItem::withoutTenancy()->whereKey($deskOffer->getKey())->sole()->catalogue_item_variant_id)->toBeNull();
});

it('prices the kitchen ingredient per kilogram and never overwrites a typed price', function (): void {
    $organisation = $this->kitchen->organisation;

    // SAC-001 Aioli: B2B 1 kg at $5.00, B2C 300 g at $3.00.
    $aioli = Ingredient::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'source_system' => 'healthy360_workbook_v6',
        'source_ref' => 'SAC-001',
    ]);

    // SAC-002 Barbecue Dip, already priced by hand.
    $barbecue = Ingredient::factory()->create([
        'organisation_id' => $organisation->getKey(),
        'source_system' => 'healthy360_workbook_v6',
        'source_ref' => 'SAC-002',
        'b2b_price_amount' => '4.500000',
        'price_currency_code' => 'USD',
    ]);

    runV6WeightsMigration();

    $aioli = Ingredient::withoutTenancy()->whereKey($aioli->getKey())->sole();
    $barbecue = Ingredient::withoutTenancy()->whereKey($barbecue->getKey())->sole();

    expect($aioli->b2b_price_amount)->toBe('5.000000')
        ->and($aioli->b2c_price_amount)->toBe('10.000000')
        ->and($aioli->price_currency_code)->toBe('USD')
        ->and($barbecue->b2b_price_amount)->toBe('4.500000')
        ->and($barbecue->b2c_price_amount)->toBeNull();
});
