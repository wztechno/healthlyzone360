<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Controllers;

use Healthy360\Subscriptions\Http\Concerns\ReadsOptionalPrecondition;
use Healthy360\Subscriptions\Http\Requests\UpdateSubscriptionWeekdaysRequest;
use Healthy360\Subscriptions\Presenters\SubscriptionLocale;
use Healthy360\Subscriptions\Presenters\SubscriptionPresenter;
use Healthy360\Subscriptions\Services\SubscriptionLocator;
use Healthy360\Subscriptions\Services\SubscriptionProjection;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/me/subscriptions/{subscription}/weekdays — the weekly selection
 * (§7).
 *
 * A replacement rather than a merge: dropping Wednesday means no longer wanting
 * Wednesday, and a merge cannot express a removal.
 *
 * **The cursor is recomputed, and the response is where a client sees it.** The
 * old `next_generation_date` may name a day the subscription no longer delivers
 * on, and a cursor pointing at a day that will never come is a subscription
 * that silently stops. `next_delivery_date` in the response is the recomputed
 * one, so a screen can show "your next delivery is now Thursday" instead of
 * leaving somebody to discover it.
 *
 * **The balance does not change.** Fewer weekdays means the same number of days
 * spread over more calendar time, not fewer days — §1 again, and the reason
 * this is a change to a pattern rather than a purchase.
 */
final class SubscriptionWeekdaysUpdateController
{
    use ReadsOptionalPrecondition;

    public function __construct(
        private readonly SubscriptionLocator $locator,
        private readonly SubscriptionService $subscriptions,
        private readonly SubscriptionPresenter $presenter,
        private readonly SubscriptionProjection $projection,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(UpdateSubscriptionWeekdaysRequest $request, string $subscription): JsonResponse
    {
        $account = $this->locator->shopper($request);
        $record = $this->locator->subscription($account, $subscription);

        /** @var list<int> $weekdays */
        $weekdays = $request->validated('weekdays');

        $updated = $this->subscriptions->changeWeekdays(
            $record,
            array_map(intval(...), $weekdays),
            $this->optionalLockVersion($request),
        );

        return ApiResponse::data([
            'subscription' => $this->presenter->customer(
                $updated,
                $this->subscriptions->balance($updated),
                $this->projection->for($updated),
                SubscriptionLocale::from($request->header('Accept-Language')),
            ),
        ])->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
