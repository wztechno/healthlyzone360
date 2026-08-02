<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Concerns\ReadsPrecondition;
use Healthy360\Catalogues\Http\Requests\ReplaceCatalogueItemChannelsRequest;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\Catalogues\Services\ChannelAvailabilityService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/items/{item}/channels.
 *
 * Mirrors the admin contract's `setProductChannelAvailability`: the complete
 * availability list, lock-versioned, applied at once. "Web shop yes, wholesale
 * from March, marketplace no" is one decision, and applying half of it leaves
 * an offering nobody meant to make.
 */
final class CatalogueItemChannelReplaceController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly ChannelAvailabilityService $availability,
        private readonly CatalogueItemAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ReplaceCatalogueItemChannelsRequest $request, string $item): JsonResponse
    {
        $record = $this->locator->item($item);
        $updated = $this->availability->replace($record, $request->assignments(), $this->requiredLockVersion($request));

        $rows = ChannelCatalogueItem::query()
            ->where('catalogue_item_id', $updated->getKey())
            ->orderBy('sales_channel_id')
            ->get();

        return ApiResponse::data([
            'item' => $this->presenter->item($updated),
            'channels' => $rows->map(fn (ChannelCatalogueItem $row): array => $this->presenter->channelAssignment($row))->all(),
        ])->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
