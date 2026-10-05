<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Database\Seeders\ProductCategorySeeder;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\ProductCategory;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
| Owner ruling 2026-10-05: the made-ahead rows of the v6 Meals sheet become frozen meals under
| Frozen. Only the ruled refs move, only while they are still meals.
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class, ProductCategorySeeder::class]);
    $this->kitchen = CatalogueWorld::kitchen('frozen-ruling@kitchen.test');
});

function v6Meal(object $tenant, string $ref, string $slug): CatalogueItem
{
    return CatalogueItem::factory()->create([
        'catalogue_id' => $tenant->catalogue->getKey(),
        'organisation_id' => $tenant->organisation->getKey(),
        'item_type' => CatalogueItemType::Meal,
        'slug' => $slug,
        'source_system' => 'healthy360_workbook_v6',
        'source_ref' => $ref,
    ]);
}

it('moves the ruled meals to frozen meals under Frozen and leaves the rest', function (): void {
    $nuggets = v6Meal($this->kitchen, 'PRD-011', 'chicken-nuggets');
    $tiramisu = v6Meal($this->kitchen, 'PRD-038', 'tiramisu');

    $migration = require dirname(__DIR__).'/database/migrations/2026_10_05_000001_move_made_ahead_meals_to_frozen.php';
    $migration->up();
    $migration->up();

    $frozen = ProductCategory::withoutTenancy()->whereNull('organisation_id')->where('code', 'frozen')->sole();
    $nuggets = CatalogueItem::withoutTenancy()->whereKey($nuggets->getKey())->sole();

    expect($nuggets->item_type)->toBe(CatalogueItemType::FrozenMeal)
        ->and($nuggets->product_category_id)->toBe((string) $frozen->getKey())
        ->and(CatalogueItem::withoutTenancy()->whereKey($tiramisu->getKey())->sole()->item_type)->toBe(CatalogueItemType::Meal);
});
