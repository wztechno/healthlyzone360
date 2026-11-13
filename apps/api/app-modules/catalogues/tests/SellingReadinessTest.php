<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Contracts\SellingPlaceRegistry;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Services\SellingReadiness;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
| Whether a sold item can be bought: a pack, a place, and a price on every
| place it is offered. Places and prices are pricing's answer, asked through
| the SellingPlaceRegistry port; here the port is stubbed so the rule is tested
| on its own.
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = CatalogueWorld::kitchen('selling-readiness@catalogue.test');
    $this->meal = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);

    $this->places = function (array $offered, array $priced): void {
        app()->instance(SellingPlaceRegistry::class, new class($offered, $priced) implements SellingPlaceRegistry
        {
            public function __construct(private array $offered, private array $priced) {}

            public function placesOf(CatalogueItem $item): array
            {
                return ['offered' => $this->offered, 'priced' => $this->priced];
            }
        });
    };

    $this->codes = fn (): array => array_map(
        static fn (array $reason): string => $reason['code'].(isset($reason['context']['place']) ? ':'.$reason['context']['place'] : ''),
        app(SellingReadiness::class)->reasons($this->meal),
    );
});

it('reports no pack and no selling place on an item with neither', function (): void {
    ($this->places)([], []);

    expect(($this->codes)())->toBe(['no_pack', 'no_selling_place']);
});

it('names each offered place no pack is priced on', function (): void {
    CatalogueItemVariant::withoutTenancy()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'catalogue_item_id' => $this->meal->getKey(),
        'variant_type' => 'pack',
        'code' => 'bottle',
        'is_default' => true,
        'status' => 'active',
        'lock_version' => 0,
    ]);

    ($this->places)(['home', 'business', 'counter'], ['home', 'counter']);

    expect(($this->codes)())->toBe(['place_unpriced:business']);

    ($this->places)(['home'], ['home']);

    expect(($this->codes)())->toBe([]);
});

it('ignores an archived pack', function (): void {
    CatalogueItemVariant::withoutTenancy()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'catalogue_item_id' => $this->meal->getKey(),
        'variant_type' => 'pack',
        'code' => 'bottle',
        'is_default' => false,
        'status' => 'archived',
        'lock_version' => 0,
    ]);

    ($this->places)(['home'], []);

    expect(($this->codes)())->toBe(['no_pack', 'place_unpriced:home']);
});
