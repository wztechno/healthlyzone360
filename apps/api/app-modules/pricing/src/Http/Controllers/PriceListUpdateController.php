<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Http\Controllers;

use Healthy360\Pricing\Http\Concerns\ReadsPrecondition;
use Healthy360\Pricing\Http\Requests\UpdatePriceListRequest;
use Healthy360\Pricing\Presenters\PriceListAdminPresenter;
use Healthy360\Pricing\Services\PriceListLocator;
use Healthy360\Pricing\Services\PriceListService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/catalogue/price-lists/{priceList} — behind `precondition`.
 *
 * A rename changes the names. It does not change the code, and a request that
 * carries one is refused rather than ignored. The currency may still be
 * changed while the list holds no prices, and is a `409` afterwards.
 */
final class PriceListUpdateController
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
    public function __invoke(UpdatePriceListRequest $request, string $priceList): JsonResponse
    {
        $record = $this->locator->priceList($priceList);
        $updated = $this->lists->update($record, $request->payload(), $this->requiredLockVersion($request));

        return ApiResponse::data(['price_list' => $this->presenter->priceList($updated)])
            ->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
