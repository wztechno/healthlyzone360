<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Http\Controllers;

use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\Pricing\Services\ChannelPackPriceService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/items/{item}/channel-prices — the article's B2B and B2C
 * weight and price, as the item editor's block shows them.
 */
final class ItemChannelPricesShowController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly ChannelPackPriceService $prices,
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
            'channels' => $this->prices->read($record),
        ])->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }
}
