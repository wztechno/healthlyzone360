<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\Catalogues\Services\DerivedAllergenService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/items/{item}/allergens — read-only, derived.
 *
 * There is no writer, and that is the point: an item's allergen set is never
 * authored here. It comes from a published recipe version's frozen label, or
 * from the union of the item's own listed ingredients' effective mappings, and
 * both are computed at read time from data somebody else is responsible for.
 * An endpoint that let a merchandiser type an allergen onto a listing would be
 * an endpoint that lets a merchandiser overrule a chef.
 *
 * `meta.basis` says which of the two answered — `recipe_version`,
 * `item_ingredients` or `none`. `none` is an empty set that explicitly means
 * "nobody has said", never "no allergens": silence is not a statement of
 * absence, and the publish gate refuses a meal that reaches this state.
 */
final class CatalogueItemAllergenIndexController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly DerivedAllergenService $allergens,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $item): JsonResponse
    {
        $record = $this->locator->item($item);
        $derived = $this->allergens->forItem($record);

        return ApiResponse::data(
            ['allergens' => $derived['allergens']],
            ['basis' => $derived['basis'], 'recipe_version_id' => $derived['recipe_version_id']],
        );
    }
}
