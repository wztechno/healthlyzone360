<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Subscriptions\Exceptions\SubscriptionRefused;
use Healthy360\Subscriptions\Http\Requests\StoreSubscriptionRequest;
use Healthy360\Subscriptions\Presenters\SubscriptionLocale;
use Healthy360\Subscriptions\Presenters\SubscriptionPresenter;
use Healthy360\Subscriptions\Services\NewSubscription;
use Healthy360\Subscriptions\Services\PlanQuote;
use Healthy360\Subscriptions\Services\StorefrontQuoting;
use Healthy360\Subscriptions\Services\SubscriptionLocator;
use Healthy360\Subscriptions\Services\SubscriptionProjection;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/subscriptions — buying twenty days of food.
 *
 * Accepts either integrator UUIDs (`sales_channel_id` + `plan_duration_id`) or
 * the storefront shape (`plan_duration_days`), which is resolved through
 * {@see StorefrontQuoting} exactly as the quote is.
 */
final class SubscriptionStoreController
{
    public function __construct(
        private readonly SubscriptionLocator $locator,
        private readonly SubscriptionService $subscriptions,
        private readonly SubscriptionPresenter $presenter,
        private readonly SubscriptionProjection $projection,
        private readonly StorefrontQuoting $storefront,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreSubscriptionRequest $request): JsonResponse
    {
        $payload = $request->payload();

        $account = $this->locator->shopper($request);
        $address = $this->locator->address($account, $payload['customer_address_id']);

        [$salesChannelId, $planDurationId] = $this->resolvePurchaseCoordinates($payload);

        $startFrom = $payload['start_from'] ?? null;

        $subscription = $this->subscriptions->create(new NewSubscription(
            account: $account,
            address: $address,
            salesChannelId: $salesChannelId,
            branchId: $payload['branch_id'] ?? null,
            catalogueItemId: $payload['catalogue_item_id'],
            catalogueItemVariantId: $payload['catalogue_item_variant_id'],
            planDurationId: $planDurationId,
            weekdays: array_map(intval(...), $payload['weekdays']),
            deliveryWindowCode: $payload['delivery_window_code'] ?? null,
            noSubstitutions: (bool) ($payload['no_substitutions'] ?? false),
            startFrom: $startFrom === null ? null : CarbonImmutable::createFromFormat('Y-m-d', $startFrom)->startOfDay(),
        ));

        return ApiResponse::data(
            ['subscription' => $this->presenter->customer(
                $subscription,
                $this->subscriptions->balance($subscription),
                $this->projection->for($subscription),
                SubscriptionLocale::from($request->header('Accept-Language')),
            )],
            status: 201,
        );
    }

    /**
     * @param  array{
     *     sales_channel_id?: string,
     *     catalogue_item_id: string,
     *     catalogue_item_variant_id: string,
     *     plan_duration_id?: string,
     *     plan_duration_days?: int,
     * }  $payload
     * @return array{0: string, 1: string}
     *
     * @throws ApiException
     */
    private function resolvePurchaseCoordinates(array $payload): array
    {
        if (isset($payload['sales_channel_id'], $payload['plan_duration_id'])) {
            return [$payload['sales_channel_id'], $payload['plan_duration_id']];
        }

        $days = $payload['plan_duration_days'] ?? null;
        if ($days === null) {
            throw new SubscriptionRefused([['reason' => 'duration_not_offered']]);
        }

        $result = $this->storefront->quote(
            $payload['catalogue_item_id'],
            $payload['catalogue_item_variant_id'],
            $days,
            CarbonImmutable::now(),
        );

        $quote = $result['quote'];
        $duration = $result['duration'] ?? null;
        $channelId = $result['sales_channel_id'] ?? null;

        if (! $quote instanceof PlanQuote || ! $duration instanceof PlanDuration || ! is_string($channelId)) {
            throw new SubscriptionRefused($result['reasons']);
        }

        return [$channelId, (string) $duration->getKey()];
    }
}
