<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

/*
|--------------------------------------------------------------------------
| An admin catalogue item carries its recipe's photo beside its own
|--------------------------------------------------------------------------
|
| The order desk's menu tiles read the admin listing, and a dish made from a
| recipe was photographed on the recipe. `recipe_photo_url` is that photo, kept
| apart from `photo_url` so the item's editor never shows the recipe's picture
| as the item's own.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = CatalogueWorld::kitchen('photos@catalogue.test');
});

/** A real 1×1 PNG — the API container has no GD, so `fake()->image()` cannot draw one. */
function recipePhotoPng(): UploadedFile
{
    return UploadedFile::fake()->createWithContent(
        'dish.png',
        (string) base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', true),
    );
}

it('lists and shows the recipe photo beside the item photo, never in its place', function (): void {
    Storage::fake('local');
    $this->actingAs($this->a->user);
    $headers = CatalogueWorld::headers($this->a);

    $recipe = Recipe::factory()->create(['organisation_id' => $this->a->organisation->getKey()]);
    $item = CatalogueWorld::publishedMeal($this->a, 'Guacamole');
    $item->forceFill(['recipe_id' => $recipe->getKey()])->save();
    $plain = CatalogueWorld::publishedMeal($this->a, 'Plain rice');

    $recipePhoto = $this->post('/api/v1/catalogue/recipes/'.$recipe->getKey().'/photo', ['photo' => recipePhotoPng()], $headers)
        ->assertOk()
        ->json('data.photo.url');

    $listed = fn (CatalogueItem $row): array => collect($this->getJson('/api/v1/catalogue/items?limit=100&item_type=meal', $headers)->assertOk()->json('data'))
        ->firstWhere('id', (string) $row->getKey());

    expect($listed($item))->toMatchArray(['photo_url' => null, 'recipe_photo_url' => $recipePhoto])
        ->and($listed($plain))->toMatchArray(['photo_url' => null, 'recipe_photo_url' => null])
        ->and($this->getJson('/api/v1/catalogue/items/'.$item->getKey(), $headers)->assertOk()->json('data.item'))
        ->toMatchArray(['photo_url' => null, 'recipe_photo_url' => $recipePhoto]);

    // The item's own photo takes `photo_url`; the recipe's stays where it was.
    $own = $this->post('/api/v1/catalogue/items/'.$item->getKey().'/photo', ['photo' => recipePhotoPng()], $headers)
        ->assertOk()
        ->json('data.photo.url');

    expect($listed($item))->toMatchArray(['photo_url' => $own, 'recipe_photo_url' => $recipePhoto]);
});
