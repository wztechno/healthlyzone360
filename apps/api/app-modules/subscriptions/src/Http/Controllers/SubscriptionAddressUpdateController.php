<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Controllers;

use Healthy360\Subscriptions\Http\Concerns\ReadsOptionalPrecondition;
use Healthy360\Subscriptions\Http\Requests\UpdateSubscriptionAddressRequest;
use Healthy360\Subscriptions\Presenters\SubscriptionPresenter;
use Healthy360\Subscriptions\Services\SubscriptionLocator;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/me/subscriptions/{subscription}/address — where the food goes
 * from now on.
 *
 * **A `PUT` on a named sub-resource rather than a `PATCH` on the subscription**,
 * and the three of address, window and weekdays are separated for the same
 * reason the three lifecycle actions are: each one asks a different question of
 * the world. Changing the address re-runs the delivery map — the kitchen may
 * not go to the new area at all — while changing the window asks nothing of it.
 * A single `PATCH` accepting all three would have to run every check on every
 * call, and a client changing a delivery slot would be refused because it moved
 * house into an unserved district in the same body.
 *
 * **The subscription follows the customer; the orders already placed do not.**
 * `subscriptions.customer_address_id` is a foreign key and each generated order
 * snapshots the address at placement, which is the C1 pattern: somebody who
 * moves wants tomorrow's delivery to follow them, and last week's must still
 * say where it went.
 *
 * `area_not_served` and `zone_suspended` are the refusals worth rendering
 * distinctly — the first means nobody delivers there, the second means this
 * kitchen's zone is suspended and somebody else might.
 */
final class SubscriptionAddressUpdateController
{
    use ReadsOptionalPrecondition;

    public function __construct(
        private readonly SubscriptionLocator $locator,
        private readonly SubscriptionService $subscriptions,
        private readonly SubscriptionPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(UpdateSubscriptionAddressRequest $request, string $subscription): JsonResponse
    {
        $account = $this->locator->shopper($request);
        $record = $this->locator->subscription($account, $subscription);

        /** @var string $addressId */
        $addressId = $request->validated('customer_address_id');

        $updated = $this->subscriptions->changeAddress(
            $record,
            $this->locator->address($account, $addressId),
            $this->optionalLockVersion($request),
        );

        return ApiResponse::data([
            'subscription' => $this->presenter->customer($updated),
        ])->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
