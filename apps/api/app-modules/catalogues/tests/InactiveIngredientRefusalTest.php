<?php

declare(strict_types=1);

use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Services\CatalogueItemService;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Services\RecipeVersionService;
use Healthy360\ReferenceData\Database\Seeders\MeasurementUnitSeeder;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;

/*
|--------------------------------------------------------------------------
| Inactive is "do not use this", enforced at the writes
|--------------------------------------------------------------------------
|
| The v6 source marks two rows Status-less, and they land `inactive`: still
| visible (greyed) in the kitchen tables, but nothing new may be built on
| them. Archived was always refused; these pin that inactive is refused the
| same way at every write that names an ingredient — a recipe line, a
| catalogue item's ingredient list, and the item's own ingredient link.
|
*/

beforeEach(function (): void {
    $this->seed(MeasurementUnitSeeder::class);

    $this->organisation = Organisation::factory()->create();

    app(TenantContext::class)->restore(['organisation_id' => (string) $this->organisation->getKey()]);
    app(DatabaseTenantContext::class)->apply(null, (string) $this->organisation->getKey(), null);

    $this->inactive = Ingredient::factory()
        ->for($this->organisation)
        ->create(['status' => IngredientStatus::Inactive]);

    $this->active = Ingredient::factory()
        ->for($this->organisation)
        ->create(['status' => IngredientStatus::Active]);
});

afterEach(function (): void {
    app(TenantContext::class)->clear();
    app(DatabaseTenantContext::class)->reset();
});

it('refuses an inactive ingredient on a recipe line', function (): void {
    $recipe = Recipe::factory()->for($this->organisation)->create();
    $version = RecipeVersion::factory()->for($recipe)->create([
        'organisation_id' => $this->organisation->getKey(),
    ]);

    $service = app(RecipeVersionService::class);

    $service->setLines($version, [
        ['ingredient_id' => (string) $this->active->getKey(), 'quantity' => 1],
    ], $version->lock_version);

    expect(fn () => $service->setLines($version->refresh(), [
        ['ingredient_id' => (string) $this->inactive->getKey(), 'quantity' => 1],
    ], $version->refresh()->lock_version))
        ->toThrow(ApiException::class, 'inactive');
});

it('refuses an inactive ingredient on a catalogue item, as member and as link', function (): void {
    $catalogue = Catalogue::factory()->for($this->organisation)->create();
    $item = CatalogueItem::factory()
        ->for($this->organisation)
        ->for($catalogue)
        ->create();

    $service = app(CatalogueItemService::class);

    $service->setIngredients($item, [
        ['ingredient_id' => (string) $this->active->getKey()],
    ], $item->lock_version);

    expect(fn () => $service->setIngredients($item->refresh(), [
        ['ingredient_id' => (string) $this->inactive->getKey()],
    ], $item->refresh()->lock_version))->toThrow(ApiException::class, 'inactive');

    expect(fn () => $service->update($item->refresh(), [
        'ingredient_id' => (string) $this->inactive->getKey(),
    ], $item->refresh()->lock_version))->toThrow(ApiException::class, 'inactive');
});
