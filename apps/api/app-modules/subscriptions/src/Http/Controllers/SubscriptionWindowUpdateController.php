<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Controllers;

use Healthy360\Subscriptions\Http\Concerns\ReadsOptionalPrecondition;
use Healthy360\Subscriptions\Http\Requests\UpdateSubscriptionWindowRequest;
use Healthy360\Subscriptions\Presenters\SubscriptionLocale;
use Healthy360\Subscriptions\Presenters\SubscriptionPresenter;
use Healthy360\Subscriptions\Services\SubscriptionLocator;
use Healthy360\Subscriptions\Services\SubscriptionProjection;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/me/subscriptions/{subscription}/window — which slot the food
 * arrives in.
 *
 * The lightest of the three replacements: it asks nothing of the delivery map
 * and nothing of the plan's rights, only whether the next delivery is still
 * changeable. See `SubscriptionAddressUpdateController` for why the three are
 * separate endpoints rather than one `PATCH`.
 *
 * `null` is a legal value and means "no preference" — the request declares the
 * field `present` and `nullable` so that both saying and unsaying are
 * expressible.
 *
 * The code is not checked against the branch's configured windows. Which slots
 * a kitchen offers on which weekdays is scheduling data that changes without
 * reference to standing subscriptions, and validating here would turn a kitchen
 * retiring a slot into a refusal on somebody else's unrelated edit. Whether the
 * slot can actually be honoured on a given day is asked at generation, which is
 * the moment it can be answered.
 */
final class SubscriptionWindowUpdateController
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
    public function __invoke(UpdateSubscriptionWindowRequest $request, string $subscription): JsonResponse
    {
        $account = $this->locator->shopper($request);
        $record = $this->locator->subscription($account, $subscription);

        /** @var string|null $code */
        $code = $request->validated('delivery_window_code');

        $updated = $this->subscriptions->changeWindow(
            $record,
            $code === null || trim($code) === '' ? null : trim($code),
            $this->optionalLockVersion($request),
        );

        return ApiResponse::data([
            'subscription' => $this->presenter->customer(
                $updated,
                null,
                $this->projection->for($updated),
                SubscriptionLocale::from($request->header('Accept-Language')),
            ),
        ])->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
