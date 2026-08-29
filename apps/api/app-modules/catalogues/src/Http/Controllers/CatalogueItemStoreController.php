<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Requests\StoreCatalogueItemRequest;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Services\CatalogueItemService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/items.
 *
 * Creates a draft. Nothing is ever created published: publication is a
 * separate action, with a separate permission, behind a readiness gate.
 *
 * No `If-Match`: nothing existing is written.
 */
final class CatalogueItemStoreController
{
    public function __construct(
        private readonly CatalogueItemService $items,
        private readonly CatalogueItemAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreCatalogueItemRequest $request): JsonResponse
    {
        /** @var array{item_type: string, name_en: string} $attributes */
        $attributes = $request->validated();

        $item = $this->items->create($attributes);

        $item->load('category');

        return ApiResponse::data(['item' => $this->presenter->item($item)], status: 201)
            ->withHeaders(['ETag' => '"'.$item->lock_version.'"']);
    }
}
