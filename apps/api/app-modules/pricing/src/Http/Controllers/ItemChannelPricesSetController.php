<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Http\Controllers;

use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\Pricing\Http\Concerns\ReadsPrecondition;
use Healthy360\Pricing\Http\Requests\SetItemChannelPricesRequest;
use Healthy360\Pricing\Services\ChannelPackPriceService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/items/{item}/channel-prices — set the article's B2B
 * and/or B2C pack weight and price in one write.
 *
 * `If-Match` carries the **item's** lock version, because the packs are the
 * item's; the prices land on the channels' own lists through the price list's
 * history rules. The response is the offer as it now stands.
 */
final class ItemChannelPricesSetController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly ChannelPackPriceService $prices,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(SetItemChannelPricesRequest $request, string $item): JsonResponse
    {
        $record = $this->locator->item($item);
        $updated = $this->prices->write($record, $request->channels(), $this->requiredLockVersion($request));

        return ApiResponse::data([
            'item_id' => (string) $updated->getKey(),
            'lock_version' => (int) $updated->lock_version,
            'channels' => $this->prices->read($updated),
        ])->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
