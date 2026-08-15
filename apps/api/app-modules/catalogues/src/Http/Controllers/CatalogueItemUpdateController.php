<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Concerns\ReadsPrecondition;
use Healthy360\Catalogues\Http\Requests\UpdateCatalogueItemRequest;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Services\CatalogueItemService;
use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/catalogue/items/{item} — behind `precondition`.
 *
 * A rename changes the names. It does not change the slug, and a request that
 * carries one is refused rather than ignored.
 */
final class CatalogueItemUpdateController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly CatalogueItemService $items,
        private readonly CatalogueItemAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(UpdateCatalogueItemRequest $request, string $item): JsonResponse
    {
        $record = $this->locator->item($item);
        $updated = $this->items->update($record, $request->payload(), $this->requiredLockVersion($request));

        return ApiResponse::data(['item' => $this->presenter->item($updated)])
            ->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
