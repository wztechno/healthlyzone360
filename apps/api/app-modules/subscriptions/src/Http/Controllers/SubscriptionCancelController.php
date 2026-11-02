<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Controllers;

use Healthy360\Subscriptions\Http\Concerns\ReadsOptionalPrecondition;
use Healthy360\Subscriptions\Http\Requests\CancelSubscriptionRequest;
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
 * Nothing comes back beside the subscription. It is paid per delivery, so no money
 * is held and there is nothing to credit.
 *
 * There is no DELETE. A cancelled subscription keeps its captured price, its
 * balance and its history.
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

        $cancelled = $this->subscriptions->cancel(
            $record,
            $reason === null || trim($reason) === '' ? 'customer_request' : trim($reason),
            $this->optionalLockVersion($request),
        );

        return ApiResponse::data([
            'subscription' => $this->presenter->customer(
                $cancelled,
                $this->subscriptions->balance($cancelled),
                $this->projection->for($cancelled),
                SubscriptionLocale::from($request->header('Accept-Language')),
            ),
        ])->withHeaders(['ETag' => '"'.$cancelled->lock_version.'"']);
    }
}
