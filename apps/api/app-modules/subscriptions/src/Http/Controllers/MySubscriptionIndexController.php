<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Controllers;

use Healthy360\Subscriptions\Models\Subscription;
use Healthy360\Subscriptions\Presenters\SubscriptionPresenter;
use Healthy360\Subscriptions\Services\SubscriptionLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/me/subscriptions — every standing arrangement the caller holds.
 *
 * **Unpaginated, and unlike `/me/orders` that is not a shortcut.** A person
 * holds one subscription, or two, or a handful across kitchens; the collection
 * has a natural ceiling that order history does not. A cursor on a list nobody
 * can fill would be a parameter to document, version and test in exchange for
 * nothing — the same trade `/me/orders` refuses in the other direction when it
 * declines to grow filters.
 *
 * **Live ones first, then the rest by recency.** Somebody opening this screen
 * is nearly always looking at what is running now; a cancelled plan from March
 * is history and sorts with the history. The order is a property of the
 * endpoint rather than a query parameter, for the reason `/me/orders` gives
 * about direction: one sort means one answer everybody can rely on.
 *
 * **No `balance` on the list rows.** `SubscriptionService::balance()` counts
 * skipped days per subscription, which is a query per row — the N+1 the order
 * index takes care to avoid. The list carries `remaining_days` and
 * `next_delivery_date` from columns the row already holds, which is what a card
 * renders; `GET /me/subscriptions/{subscription}` carries the full balance for
 * the screen that shows one.
 */
final class MySubscriptionIndexController
{
    public function __construct(
        private readonly SubscriptionLocator $locator,
        private readonly SubscriptionPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $account = $this->locator->shopper($request);

        $subscriptions = Subscription::query()
            ->where('customer_account_id', $account->getKey())
            // `active` and `paused` are the two live states; the ordering puts
            // them ahead of `cancelled` and `completed` without naming either,
            // so a future terminal state sorts with the history by default.
            ->orderByRaw("case when status in ('active', 'paused') then 0 else 1 end")
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->get();

        return ApiResponse::data(
            $subscriptions->map(fn (Subscription $subscription): array => $this->presenter->customer($subscription))->all(),
            ['count' => $subscriptions->count()],
        );
    }
}
