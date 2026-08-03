<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Subscriptions\Http\Requests\StoreSubscriptionRequest;
use Healthy360\Subscriptions\Presenters\SubscriptionPresenter;
use Healthy360\Subscriptions\Services\NewSubscription;
use Healthy360\Subscriptions\Services\SubscriptionLocator;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/subscriptions — buying twenty days of food.
 *
 * **Not under `/me`, and the asymmetry with `GET /me/subscriptions` is the one
 * `/carts` and `/me/orders` already draw.** A creation names no existing
 * resource of the caller's, so there is nothing for the prefix to scope; a list
 * of somebody's own standing arrangements is a *collection of mine*, the same
 * shape as `/me/devices`. The route name follows the resource rather than the
 * prefix.
 *
 * **`Idempotency-Key`, exactly as `POST /orders` carries it.** This is the
 * platform's second genuinely non-idempotent command and it is the more
 * expensive of the two: a double tap on a slow connection produces a second
 * standing arrangement, and the customer finds out when twice the food starts
 * arriving every morning. The key is optional for the reason the order
 * endpoint's is — refusing unkeyed requests would break every caller that has
 * ever worked, to protect them from a risk they may not have — and the
 * middleware answers a replay with the stored envelope, `201` again, with
 * `Idempotency-Replayed: true`.
 *
 * Unlike placement there is no second guard inside the service: `SubscriptionService::create()`
 * claims no key, so a subscription started by a queued job or a console command
 * has no replay protection at all. That is a real gap and it is smaller than it
 * looks — nothing but this endpoint creates one today — but it is stated rather
 * than left to be discovered, and `OrderIdempotency` is the shape to copy when
 * something else starts creating subscriptions.
 *
 * Refusals are `409 subscription.refused` carrying **every** reason at once.
 * `SubscriptionRefused` gives the argument: a plan is a longer, more considered
 * purchase than a single order, and telling somebody one problem per attempt —
 * the plan is not published, now the duration is not offered, now nobody
 * delivers to your address — is three round trips through a form they have
 * already filled in.
 */
final class SubscriptionStoreController
{
    public function __construct(
        private readonly SubscriptionLocator $locator,
        private readonly SubscriptionService $subscriptions,
        private readonly SubscriptionPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreSubscriptionRequest $request): JsonResponse
    {
        $payload = $request->payload();

        $account = $this->locator->shopper($request);
        $address = $this->locator->address($account, $payload['customer_address_id']);

        $startFrom = $payload['start_from'] ?? null;

        $subscription = $this->subscriptions->create(new NewSubscription(
            account: $account,
            address: $address,
            salesChannelId: $payload['sales_channel_id'],
            branchId: $payload['branch_id'] ?? null,
            catalogueItemId: $payload['catalogue_item_id'],
            catalogueItemVariantId: $payload['catalogue_item_variant_id'],
            planDurationId: $payload['plan_duration_id'],
            weekdays: array_map(intval(...), $payload['weekdays']),
            deliveryWindowCode: $payload['delivery_window_code'] ?? null,
            noSubstitutions: (bool) ($payload['no_substitutions'] ?? false),
            startFrom: $startFrom === null ? null : CarbonImmutable::createFromFormat('Y-m-d', $startFrom)->startOfDay(),
        ));

        return ApiResponse::data(
            ['subscription' => $this->presenter->customer($subscription, $this->subscriptions->balance($subscription))],
            status: 201,
        );
    }
}
