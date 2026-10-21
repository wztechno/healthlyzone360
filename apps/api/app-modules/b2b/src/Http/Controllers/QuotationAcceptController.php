<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\B2b\Http\Concerns\ReadsPrecondition;
use Healthy360\B2b\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\B2b\Http\Requests\AcceptQuotationRequest;
use Healthy360\B2b\Presenters\QuotationPresenter;
use Healthy360\B2b\Services\B2bLocator;
use Healthy360\B2b\Services\QuotationOrderPlacer;
use Healthy360\B2b\Services\QuotationService;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Customers\Services\ShopperResolver;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /b2b/quotations/{quotation}/accept — the buyer accepts the kitchen's
 * price and schedules the delivery, and the order is placed in the same step.
 *
 * `If-Match` is the lock version the buyer was shown: a quotation the kitchen
 * re-priced since is refused as stale, never an acceptance of prices nobody saw.
 */
final class QuotationAcceptController
{
    use ReadsPrecondition;
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly B2bLocator $locator,
        private readonly QuotationService $quotations,
        private readonly QuotationOrderPlacer $orders,
        private readonly ShopperResolver $shoppers,
        private readonly QuotationPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(AcceptQuotationRequest $request, string $quotation): JsonResponse
    {
        $record = $this->locator->quotation($quotation);
        $expected = $this->requiredLockVersion($request);
        $actor = $this->currentUser($request);
        $delivery = $request->delivery();

        $buyer = $this->shoppers->resolve();
        $address = CustomerAddress::query()
            ->whereKey($delivery['customer_address_id'])
            ->where('customer_account_id', $buyer->getKey())
            ->first();

        if (! $address instanceof CustomerAddress) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'This address is not one of your delivery addresses.',
                ['fields' => ['customer_address_id' => ['This address is not one of your delivery addresses.']]],
            );
        }

        $kitchenId = (string) $record->programme()->firstOrFail()->kitchen_organisation_id;
        $date = CarbonImmutable::createFromFormat('!Y-m-d', $delivery['requested_date']) ?: CarbonImmutable::today();

        $accepted = $this->quotations->accept(
            $record,
            $actor,
            $expected,
            fn (): string => $this->orders->place($record, $kitchenId, $buyer, $address, $date, $delivery['delivery_window_code']),
        );

        return ApiResponse::data(['quotation' => $this->presenter->quotation($accepted)])
            ->withHeaders(['ETag' => '"'.$accepted->lock_version.'"']);
    }
}
