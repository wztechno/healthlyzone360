<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Healthy360\Audit\Enums\PurposeOfUse;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Services\DietaryProfileReader;
use Healthy360\Orders\OrderDesk\Services\DeskCustomerDirectory;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;

/**
 * GET /api/v1/catalogue/order-desk/customers/{account}/allergies — what the
 * customer the desk just chose has declared, so the agent can say it back before
 * a single dish is added.
 *
 * Asked once per chosen customer, never per search row: twenty names on a screen
 * are not twenty reasons to read twenty health records.
 *
 * `DietaryProfileReader` is the only way staff read a profile, so the purpose is
 * stated (`order_fulfilment`) and every read is recorded. Codes and severities
 * only, as the reader returns them. The free-text notes stay the customer's.
 *
 * `declared` is on the wire because "no allergens" and "never asked" are
 * different facts, and a desk that blurred them would tell somebody a dish is
 * safe on no evidence at all.
 *
 * Outside the desk's rule is a `404`, for the reason `isInScope()` gives.
 */
final class OrderDeskCustomerAllergyController
{
    public function __construct(
        private readonly OrderLocator $locator,
        private readonly DeskCustomerDirectory $directory,
        private readonly DietaryProfileReader $reader,
        private readonly TenantContext $context,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $account): JsonResponse
    {
        $customer = Str::isUuid($account) ? CustomerAccount::query()->whereKey($account)->first() : null;

        if (! $customer instanceof CustomerAccount || ! $this->directory->isInScope($this->locator->sellerId(), $customer)) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'That customer account could not be read.');
        }

        $profile = $this->reader->read($customer, PurposeOfUse::OrderFulfilment, $this->context->userId());

        return ApiResponse::data([
            'declared' => $profile['declared'],
            'declares_no_allergens' => $profile['declares_no_allergens'],
            'allergens' => $profile['allergens'],
        ]);
    }
}
