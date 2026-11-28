<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Http\Controllers;

use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\Pricing\Services\ItemPacksService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/items/{item}/packs — the item's packs, their
 * packaging and prices, and where it sells, as the Packs & prices tab shows them.
 */
final class ItemPacksShowController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly ItemPacksService $packs,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $item): JsonResponse
    {
        $record = $this->locator->item($item);

        return ApiResponse::data([
            'item_id' => (string) $record->getKey(),
            'lock_version' => (int) $record->lock_version,
            ...$this->packs->read($record),
        ])->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }
}
