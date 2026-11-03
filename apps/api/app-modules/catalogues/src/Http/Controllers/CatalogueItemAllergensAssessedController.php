<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Services\AllergenAssessment;
use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/items/{item}/allergens-assessed.
 *
 * "Assessed: contains none of these". The way an item nothing else can vouch for
 * goes back on sale, and an audited statement by a named member of staff.
 */
final class CatalogueItemAllergensAssessedController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly AllergenAssessment $assessment,
        private readonly CatalogueItemAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $item): JsonResponse
    {
        $assessed = $this->assessment->markNoneContained($this->locator->item($item));

        return ApiResponse::data(['item' => $this->presenter->item($assessed)])
            ->withHeaders(['ETag' => '"'.$assessed->lock_version.'"']);
    }
}
