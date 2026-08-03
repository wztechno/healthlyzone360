<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Controllers;

use Healthy360\Subscriptions\Http\Concerns\ReadsOptionalPrecondition;
use Healthy360\Subscriptions\Http\Requests\CancelSubscriptionRequest;
use Healthy360\Subscriptions\Models\CreditMemo;
use Healthy360\Subscriptions\Presenters\SubscriptionLocale;
use Healthy360\Subscriptions\Presenters\SubscriptionPresenter;
use Healthy360\Subscriptions\Services\SubscriptionLocator;
use Healthy360\Subscriptions\Services\SubscriptionProjection;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/me/subscriptions/{subscription}/cancel — the terminal one.
 *
 * **The credit memo comes back in the same response, and that is the point of
 * the endpoint rather than a convenience.** §3 records the refund as an
 * obligation for manual settlement — no money moves — and a customer who
 * cancels twelve unused days of a plan they paid for is owed a number on the
 * screen at that moment. A client that had to make a second call for it would
 * render "cancelled" with nothing beside it, which reads as "and that is that".
 *
 * `credit_memo` is **null** when nothing is owed, and that is not the same as
 * an empty object. A zero memo would be an obligation somebody eventually tries
 * to settle, so `SubscriptionService::cancel()` declines to write one; the null
 * says "there was nothing left to refund" rather than "we have not worked it
 * out yet".
 *
 * The memo's shape carries `settlement: manual` explicitly — see
 * `SubscriptionPresenter::creditMemo()`. It is the one sentence a customer
 * needs, and a client left to infer it from the status vocabulary would
 * eventually render `recorded` as "refunded".
 *
 * There is no DELETE. A cancelled subscription keeps its captured price, its
 * balance and its history, because the memo multiplies the price it actually
 * paid and a deleted row could not explain the number.
 */
final class SubscriptionCancelController
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
    public function __invoke(CancelSubscriptionRequest $request, string $subscription): JsonResponse
    {
        $account = $this->locator->shopper($request);
        $record = $this->locator->subscription($account, $subscription);

        /** @var string|null $reason */
        $reason = $request->validated('reason');

        $result = $this->subscriptions->cancel(
            $record,
            $reason === null || trim($reason) === '' ? 'customer_request' : trim($reason),
            $this->optionalLockVersion($request),
        );

        $cancelled = $result['subscription'];
        $memo = $result['credit_memo'];

        return ApiResponse::data([
            'subscription' => $this->presenter->customer(
                $cancelled,
                $this->subscriptions->balance($cancelled),
                $this->projection->for($cancelled),
                SubscriptionLocale::from($request->header('Accept-Language')),
            ),
            // `refresh()` because `status` is the column's own default rather
            // than something the service assigns: a freshly inserted memo holds
            // no value for it in memory, and serving `null` where the contract
            // promises `recorded` would be a client rendering a blank badge on
            // the one screen that has to say what happens to the money.
            'credit_memo' => $memo instanceof CreditMemo ? $this->presenter->creditMemo($memo->refresh()) : null,
        ])->withHeaders(['ETag' => '"'.$cancelled->lock_version.'"']);
    }
}
