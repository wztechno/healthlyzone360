<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Http\Concerns\ReadsPrecondition;
use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Healthy360\Recipes\Presenters\RecipeVersionPresenter;
use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Recipes\Services\RecipeVersionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/catalogue/recipes/{recipe}/versions/{version}/publish.
 *
 * Its own route, its own permission (`recipe.publish_organisation`) and its own
 * audit action — never a `PATCH status` (master plan v2 §4.15). Publishing
 * freezes an allergen label that reaches a diner and withdraws whatever was
 * live before; that is a different authority from editing a draft, and the
 * permission registry makes the difference real.
 *
 * Refusals are structured, not prose: `catalogue.publish_blocked` carries
 * every reason at once, and `catalogue.allergen_unmapped` names the
 * ingredients whose allergen determination is missing.
 *
 * The response includes the frozen label, because "what did I just publish" is
 * the only question worth asking immediately afterwards.
 */
final class RecipeVersionPublishController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly RecipeLocator $locator,
        private readonly RecipeVersionService $versions,
        private readonly RecipeVersionPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $recipe, string $version): JsonResponse
    {
        $record = $this->locator->version($this->locator->recipe($recipe), $version);

        $published = $this->versions->publish($record, $this->requiredLockVersion($request));

        $allergens = RecipeVersionAllergen::query()
            ->where('recipe_version_id', $published->getKey())
            ->orderBy('allergen_code')
            ->get();

        return ApiResponse::data([
            'version' => $this->presenter->version($published),
            'allergens' => $allergens->map(fn (RecipeVersionAllergen $row): array => $this->presenter->allergen($row))->all(),
        ])->withHeaders(['ETag' => '"'.$published->lock_version.'"']);
    }
}
