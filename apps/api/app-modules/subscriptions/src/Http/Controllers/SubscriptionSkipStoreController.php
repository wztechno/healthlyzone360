<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Subscriptions\Http\Concerns\ReadsOptionalPrecondition;
use Healthy360\Subscriptions\Http\Requests\StoreSubscriptionSkipRequest;
use Healthy360\Subscriptions\Presenters\SubscriptionPresenter;
use Healthy360\Subscriptions\Services\SubscriptionLocator;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/me/subscriptions/{subscription}/skips — "not this Tuesday".
 *
 * **A sub-collection rather than an action, because a skip is a thing that
 * exists afterwards.** `…/pause` changes the subscription; this creates a
 * `subscription_deliveries` row for the named day with
 * `status = skipped_customer` and `consumed = false`, which the ledger view
 * then shows. `201` for the same reason.
 *
 * **It costs nothing, and the response proves it.** The balance comes back
 * beside the created day so the screen can show `remaining_days` unchanged —
 * §1 in the one place a customer is most likely to doubt it.
 *
 * The row is written *before* the day is ever generated, which is what makes
 * the unique index on `(subscription_id, delivery_date)` the thing that stops
 * generation producing an order for a day the customer already skipped. Skipping
 * a day that has already been settled is `already_settled` rather than a
 * silent no-op: the food is coming and the customer needs to know.
 */
final class SubscriptionSkipStoreController
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
    public function __invoke(StoreSubscriptionSkipRequest $request, string $subscription): JsonResponse
    {
        $account = $this->locator->shopper($request);
        $record = $this->locator->subscription($account, $subscription);

        /** @var string $date */
        $date = $request->validated('date');

        $delivery = $this->subscriptions->skip(
            $record,
            CarbonImmutable::createFromFormat('Y-m-d', $date)->startOfDay(),
            $this->optionalLockVersion($request),
        );

        return ApiResponse::data([
            'delivery' => $this->presenter->delivery($delivery),
            'balance' => $this->subscriptions->balance($record->refresh()),
        ], status: 201);
    }
}
