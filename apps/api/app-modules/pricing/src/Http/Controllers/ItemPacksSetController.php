<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Http\Controllers;

use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\Pricing\Http\Concerns\ReadsPrecondition;
use Healthy360\Pricing\Http\Requests\SetItemPacksRequest;
use Healthy360\Pricing\Services\ItemPacksService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/items/{item}/packs — replace the item's packs, their
 * packaging, their prices and where it sells, in one write.
 *
 * `If-Match` carries the **item's** lock version, as on `/channel-prices`. The
 * response is the statement as it now stands.
 */
final class ItemPacksSetController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly ItemPacksService $packs,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(SetItemPacksRequest $request, string $item): JsonResponse
    {
        $record = $this->locator->item($item);
        $updated = $this->packs->write($record, $request->statement(), $this->requiredLockVersion($request));

        return ApiResponse::data([
            'item_id' => (string) $updated->getKey(),
            'lock_version' => (int) $updated->lock_version,
            ...$this->packs->read($updated),
        ])->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
