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
 * POST /api/v1/catalogue/price-lists/{priceList}/publish — draft → active.
 *
 * Its own route, its own audit action, never a `PATCH status` (master plan v2
 * §4.15). Gated by `catalogue.publish_organisation` rather than a pricing code
 * of its own: activating a tariff is the same kind of decision as putting an
 * item on sale, made by the same people, and a third publish permission would
 * be bookkeeping rather than authority.
 *
 * Refusals are structured, not prose: `catalogue.publish_blocked` carries
 * every reason at once, so a kitchen fixes them in one pass.
 *
 * Note what does **not** block: placeholder and market-priced rows are welcome
 * on an active list. A kitchen with forty confirmed prices and eight owed
 * should trade on the forty, and the eight stay honest about being unpriced —
 * the public projection is what keeps them out of a customer's sight, not a
 * refusal here that would only encourage somebody to invent the numbers.
 */
final class PriceListPublishController
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
        $published = $this->lists->publish($record, $this->requiredLockVersion($request));

        return ApiResponse::data(['price_list' => $this->presenter->priceList($published)])
            ->withHeaders(['ETag' => '"'.$published->lock_version.'"']);
    }
}
