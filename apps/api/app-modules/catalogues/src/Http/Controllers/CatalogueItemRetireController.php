<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Concerns\ReadsPrecondition;
use Healthy360\Catalogues\Http\Requests\RetireCatalogueItemRequest;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\Catalogues\Services\PublishCatalogueItem;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/items/{item}/retire.
 *
 * The only withdrawal a sellable item has. There is no archive action here and
 * no delete anywhere: an order or a price snapshot may point at a row forever,
 * so a retired item keeps its history and disappears from every consumer read.
 */
final class CatalogueItemRetireController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly PublishCatalogueItem $publication,
        private readonly CatalogueItemAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(RetireCatalogueItemRequest $request, string $item): JsonResponse
    {
        $record = $this->locator->item($item);

        $reason = $request->validated('reason');

        $retired = $this->publication->retire(
            $record,
            $this->requiredLockVersion($request),
            is_string($reason) ? $reason : null,
        );

        return ApiResponse::data(['item' => $this->presenter->item($retired)])
            ->withHeaders(['ETag' => '"'.$retired->lock_version.'"']);
    }
}
