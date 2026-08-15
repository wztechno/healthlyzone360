<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Healthy360\Recipes\Presenters\RecipeVersionPresenter;
use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/recipes/{recipe}/versions/{version}/allergens — the
 * frozen label.
 *
 * Both kinds of row, each labelled by `derivation`: what was computed from the
 * ingredients (`derived`, with the ingredient that caused it) and what a human
 * declared (`declared`). A screen that showed only one of them would either
 * hide the chef's shared-fryer warning or hide the sesame that the tahini
 * brings.
 *
 * `derivation_state` on the version says whether the label still matches the
 * mappings underneath it, which is why it is repeated in `meta` here: a label
 * read without that answer looks equally authoritative whether it is current
 * or three mapping edits old.
 */
final class RecipeVersionAllergenIndexController
{
    public function __construct(
        private readonly RecipeLocator $locator,
        private readonly RecipeVersionPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $recipe, string $version): JsonResponse
    {
        $record = $this->locator->version($this->locator->recipe($recipe), $version);

        $rows = RecipeVersionAllergen::query()
            ->where('recipe_version_id', $record->getKey())
            ->orderBy('allergen_code')
            ->get();

        return ApiResponse::data(
            $rows->map(fn (RecipeVersionAllergen $row): array => $this->presenter->allergen($row))->all(),
            [
                'count' => $rows->count(),
                'derivation_state' => $record->derivation_state->value,
                'derived_at' => $record->derived_at?->toIso8601String(),
            ],
        );
    }
}
