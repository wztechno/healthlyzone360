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
 * POST /api/v1/me/subscriptions/{subscription}/pause — stop the deliveries,
 * keep the days.
 *
 * A POST sub-resource action, never a `PATCH status` (master plan v2 §4.15).
 * Pausing, resuming and cancelling are three decisions with three consequences,
 * three timestamps and three journal events; a status field would collapse them
 * into one write a client could aim anywhere, and `active → completed` would
 * become expressible by typing.
 *
 * **Nothing here consumes a balance day**, which is §1 stated as a property of
 * the code: the balance stretches into the future, it does not evaporate. The
 * response carries the balance so the screen can say so rather than implying
 * it.
 *
 * The refusal is `409 subscription.change_refused`, and the reason a customer
 * most often sees is `inside_cut_off` — the next delivery is nearer than the
 * plan's window allows, so it proceeds and the pause takes effect after it. The
 * refusal carries `cut_off_at` and `effective_from` so a client can say which
 * day is the earliest one they can still stop.
 */
final class SubscriptionPauseController
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

        $paused = $this->subscriptions->pause($record, $this->optionalLockVersion($request));

        return ApiResponse::data([
            'subscription' => $this->presenter->customer($paused, $this->subscriptions->balance($paused)),
        ])->withHeaders(['ETag' => '"'.$paused->lock_version.'"']);
    }
}
