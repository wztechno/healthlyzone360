<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Http\Controllers;

use Healthy360\Pricing\Http\Requests\StorePriceListRequest;
use Healthy360\Pricing\Presenters\PriceListAdminPresenter;
use Healthy360\Pricing\Services\PriceListService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/price-lists.
 *
 * No `If-Match`: nothing existing is written. The list is created `draft` and
 * prices nothing until it is activated.
 */
final class PriceListStoreController
{
    public function __construct(
        private readonly PriceListService $lists,
        private readonly PriceListAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StorePriceListRequest $request): JsonResponse
    {
        $priceList = $this->lists->create($request->payload());

        return ApiResponse::data(['price_list' => $this->presenter->priceList($priceList)], status: 201)
            ->withHeaders(['ETag' => '"'.$priceList->lock_version.'"']);
    }
}
