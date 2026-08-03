<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Controllers;

use Healthy360\Subscriptions\Presenters\SubscriptionPresenter;
use Healthy360\Subscriptions\Services\SubscriptionLocator;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/me/subscriptions/{subscription} — one of the caller's own, with
 * its balance.
 *
 * Somebody else's subscription is **`resource.not_found`**, never 403. The row
 * carries a delivery address, a weekday pattern and a price somebody
 * negotiated, and confirming that a guessed identifier names a real standing
 * arrangement is a disclosure on its own.
 *
 * The balance is served here and not on the list, because it costs a query per
 * subscription — see `MySubscriptionIndexController`. It is the §1 view: what
 * is left, what was used, and what is coming, with `skipped_days` beside them
 * so a customer can see that skipping cost nothing.
 *
 * The response carries an `ETag`. Nothing requires the client to send it back —
 * see `ReadsOptionalPrecondition` for why the writes accept `If-Match` rather
 * than demanding it — but a client holding two tabs open should be able to
 * protect itself, and it cannot do that with a validator it was never given.
 */
final class MySubscriptionShowController
{
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

        return ApiResponse::data([
            'subscription' => $this->presenter->customer($record, $this->subscriptions->balance($record)),
        ])->withHeaders(['ETag' => '"'.$record->lock_version.'"']);
    }
}
