<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Concerns\ReadsPrecondition;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\Catalogues\Services\DerivedAllergenService;
use Healthy360\Catalogues\Services\PublishCatalogueItem;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/catalogue/items/{item}/publish.
 *
 * Its own route, its own permission (`catalogue.publish_organisation`) and its
 * own audit action — never a `PATCH status` (master plan v2 §4.15). Deciding
 * what the kitchen sells is a different authority from editing a listing, and
 * the permission registry is where that separation has to be real.
 *
 * Refusals are structured, not prose: `catalogue.publish_blocked` carries
 * every reason at once, so a kitchen fixes them in one pass.
 *
 * The response includes the derived allergen set, because "what did I just
 * tell a diner this contains" is the only question worth asking immediately
 * afterwards.
 */
final class CatalogueItemPublishController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly PublishCatalogueItem $publication,
        private readonly DerivedAllergenService $allergens,
        private readonly CatalogueItemAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $item): JsonResponse
    {
        $record = $this->locator->item($item);
        $published = $this->publication->publish($record, $this->requiredLockVersion($request));

        return ApiResponse::data([
            'item' => $this->presenter->item($published),
            'allergens' => $this->allergens->forItem($published),
        ])->withHeaders(['ETag' => '"'.$published->lock_version.'"']);
    }
}
