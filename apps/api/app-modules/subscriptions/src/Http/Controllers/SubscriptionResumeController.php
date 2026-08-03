<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Controllers;

use Healthy360\Subscriptions\Http\Concerns\ReadsOptionalPrecondition;
use Healthy360\Subscriptions\Presenters\SubscriptionPresenter;
use Healthy360\Subscriptions\Services\SubscriptionLocator;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/me/subscriptions/{subscription}/resume — start again from the
 * first day a change can still reach.
 *
 * The response's `next_delivery_date` is the whole answer and is why this is
 * not a `PATCH status`: resuming does not restart from tomorrow, it restarts
 * from the first weekday the subscription delivers on that is still outside the
 * plan's change window — because a resume that produced a delivery the customer
 * had no chance to stop would be worse than one that waited a day.
 *
 * `exhausted` is the refusal worth knowing about: a spent balance cannot be
 * resumed, and the answer is a renewal rather than a change.
 */
final class SubscriptionResumeController
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
    public function __invoke(Request $request, string $subscription): JsonResponse
    {
        $account = $this->locator->shopper($request);
        $record = $this->locator->subscription($account, $subscription);

        $resumed = $this->subscriptions->resume($record, $this->optionalLockVersion($request));

        return ApiResponse::data([
            'subscription' => $this->presenter->customer($resumed, $this->subscriptions->balance($resumed)),
        ])->withHeaders(['ETag' => '"'.$resumed->lock_version.'"']);
    }
}
