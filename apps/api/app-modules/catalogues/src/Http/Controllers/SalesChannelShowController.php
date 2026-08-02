<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/sales-channels/{channel}.
 *
 * Returns `ETag: "<lock_version>"`. Addressable by identifier or by code, for
 * the same reason a catalogue item is: a client that walked the list holds
 * identifiers, and a human holds "wholesale".
 */
final class SalesChannelShowController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly CatalogueItemAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $channel): JsonResponse
    {
        $record = $this->locator->channel($channel);

        return ApiResponse::data(['sales_channel' => $this->presenter->salesChannel($record)])
            ->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }
}
