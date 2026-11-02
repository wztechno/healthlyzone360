<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Services\DishOptions;
use Healthy360\Orders\OrderDesk\Services\DeskBasket;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Support\Str;

/*
| Two teas, one with a note, are two lines; three plain taps are still one.
*/

it('merges plain taps and keeps a line made differently apart', function (): void {
    $item = (string) Str::uuid();

    $lines = app(DeskBasket::class)->aggregate([
        ['catalogue_item_id' => $item, 'quantity' => '1'],
        ['catalogue_item_id' => $item, 'quantity' => '1'],
        ['catalogue_item_id' => $item, 'quantity' => '1', 'note' => 'No ice'],
    ]);

    expect($lines)->toHaveCount(2)
        ->and((float) $lines[0]->quantity)->toBe(2.0)
        ->and($lines[1]->note)->toBe('No ice');
});

describe('a dish\'s options', function (): void {
    beforeEach(function (): void {
        $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);
        $this->tenant = PricingWorld::kitchen('options@kitchen.test');
        $this->actingAs($this->tenant->user);

        $catalogue = Catalogue::factory()->create(['organisation_id' => $this->tenant->organisation->getKey()]);
        $this->dish = CatalogueItem::factory()->create([
            'organisation_id' => $this->tenant->organisation->getKey(),
            'catalogue_id' => (string) $catalogue->getKey(),
            'item_type' => 'meal',
        ]);
        $this->options = app(DishOptions::class)->replace($this->dish, [
            ['kind' => 'remove', 'name_en' => 'Onions', 'name_ar' => 'بصل'],
            ['kind' => 'choice', 'group_en' => 'Sauce', 'group_ar' => 'صلصة', 'name_en' => 'Garlic', 'name_ar' => 'ثوم'],
            ['kind' => 'choice', 'group_en' => 'Sauce', 'group_ar' => 'صلصة', 'name_en' => 'Chilli', 'name_ar' => 'حار'],
        ]);
    });

    it('snapshots what was chosen', function (): void {
        $snapshot = app(DishOptions::class)->snapshot((string) $this->dish->getKey(), [$this->options[0]['id']]);

        expect($snapshot)->toHaveCount(1)
            ->and($snapshot[0]['name_en'])->toBe('Onions');
    });

    it('refuses two answers to one group, and an option that is not this dish\'s', function (): void {
        $dishId = (string) $this->dish->getKey();

        expect(app(DishOptions::class)->snapshot($dishId, [$this->options[1]['id'], $this->options[2]['id']]))->toBeNull()
            ->and(app(DishOptions::class)->snapshot($dishId, [(string) Str::uuid()]))->toBeNull();
    });

    it('keeps a row\'s id through a rename, so a basket still finds it', function (): void {
        $renamed = app(DishOptions::class)->replace($this->dish, [
            ['id' => $this->options[0]['id'], 'kind' => 'remove', 'name_en' => 'Red onions', 'name_ar' => 'بصل أحمر'],
        ]);

        expect($renamed)->toHaveCount(1)
            ->and($renamed[0]['id'])->toBe($this->options[0]['id'])
            ->and($renamed[0]['name_en'])->toBe('Red onions');
    });
});
