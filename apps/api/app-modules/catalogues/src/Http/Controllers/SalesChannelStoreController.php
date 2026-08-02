<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Requests\StoreSalesChannelRequest;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Services\SalesChannelService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/sales-channels.
 *
 * No `If-Match`: nothing existing is written.
 */
final class SalesChannelStoreController
{
    public function __construct(
        private readonly SalesChannelService $channels,
        private readonly CatalogueItemAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreSalesChannelRequest $request): JsonResponse
    {
        /** @var array{code: string, channel_kind: string, name_en: string} $attributes */
        $attributes = $request->validated();

        $channel = $this->channels->create($attributes);

        return ApiResponse::data(['sales_channel' => $this->presenter->salesChannel($channel)], status: 201)
            ->withHeaders(['ETag' => '"'.$channel->lock_version.'"']);
    }
}
