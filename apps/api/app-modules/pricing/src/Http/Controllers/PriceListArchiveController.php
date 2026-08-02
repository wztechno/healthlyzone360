<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Http\Controllers;

use Healthy360\Pricing\Http\Concerns\ReadsPrecondition;
use Healthy360\Pricing\Presenters\PriceListAdminPresenter;
use Healthy360\Pricing\Services\PriceListLocator;
use Healthy360\Pricing\Services\PriceListService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/catalogue/price-lists/{priceList}/archive.
 *
 * Refused while any channel still names the list, with `409 resource.conflict`
 * carrying `reason: channel_assignments_active` and the channels holding it.
 * Detaching is the act that actually withdraws a tariff; archiving a list a
 * channel still quotes from would be a label that changed nothing.
 *
 * Nothing is deleted. Entries, history and supersession chains all survive, so
 * an order placed last spring can still be explained.
 */
final class PriceListArchiveController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly PriceListLocator $locator,
        private readonly PriceListService $lists,
        private readonly PriceListAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $priceList): JsonResponse
    {
        $record = $this->locator->priceList($priceList);
        $archived = $this->lists->archive($record, $this->requiredLockVersion($request));

        return ApiResponse::data(['price_list' => $this->presenter->priceList($archived)])
            ->withHeaders(['ETag' => '"'.$archived->lock_version.'"']);
    }
}
