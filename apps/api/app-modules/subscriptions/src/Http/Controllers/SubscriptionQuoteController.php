<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Subscriptions\Exceptions\SubscriptionRefused;
use Healthy360\Subscriptions\Http\Requests\SubscriptionQuoteRequest;
use Healthy360\Subscriptions\Services\PlanQuote;
use Healthy360\Subscriptions\Services\SubscriptionPricing;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/subscriptions/quote — what this configuration would cost.
 *
 * **A quote and not a hold.** Nothing is reserved, nothing is written, and the
 * number is only guaranteed for as long as the tariff behind it stands.
 * `POST /subscriptions` re-resolves it and captures *that* answer, which is the
 * one the customer is grandfathered at — so a client must never send a price
 * back, and there is no field for it to send one in.
 *
 * **Authenticated and verified rather than anonymous**, which is the one thing
 * about this endpoint worth arguing over. `price_list_items` is the single
 * catalogue table with a row-level security policy, on the ground that a
 * negotiated price says what a kitchen will accept and from whom; an
 * `agreement` list is one customer's position. The marketplace's plan pages
 * already carry a *published consumer* price through `PublicProjection`, which
 * is a different number reached a different way. Serving this resolver
 * anonymously would hand anybody a probe for every tariff a kitchen has ever
 * attached to a channel, one configuration at a time.
 *
 * **A refusal is a 409, not an empty 200.** `unpriced`,
 * `duration_not_offered`, `duration_not_fixed` and `pricing_basis_unsupported`
 * are the reasons, and every one of them is a fact about the world rather than
 * about the request's shape — the same argument `order.placement_refused`
 * makes. `pricing_basis_unsupported` in particular has to name itself: a
 * per-week plan is refused on principle (a weekly price divided by seven
 * charges a three-day-a-week customer for four days they never receive), and
 * collapsing it into "unpriced" would send a kitchen hunting for a missing
 * tariff row that is not missing.
 */
final class SubscriptionQuoteController
{
    public function __construct(private readonly SubscriptionPricing $pricing) {}

    /**
     * @throws ApiException
     */
    public function __invoke(SubscriptionQuoteRequest $request): JsonResponse
    {
        $payload = $request->payload();

        [$quote, $reasons] = $this->pricing->quote(
            $payload['sales_channel_id'],
            $payload['catalogue_item_id'],
            $payload['catalogue_item_variant_id'],
            $payload['plan_duration_id'],
            CarbonImmutable::now(),
        );

        if (! $quote instanceof PlanQuote) {
            throw new SubscriptionRefused($reasons);
        }

        return ApiResponse::data([
            'quote' => [
                'currency_code' => $quote->currencyCode,
                'days' => $quote->days,
                // All three numbers, because the discount is the reason
                // somebody chose the longer run and a screen showing only the
                // final figure cannot say what it saved them.
                'list_price_minor' => $quote->listPriceMinor,
                'discount_percent' => $quote->discountPercent,
                'per_day_minor' => $quote->perDayMinor,
                'total_minor' => $quote->perDayMinor * $quote->days,
                // Deliberately absent: `price_list_id` and `price_list_item_id`.
                // They are the provenance the *capture* keeps so a price stays
                // explainable years later, and on a customer's screen they name
                // a kitchen's tariff structure to the person being charged by
                // it — the same pair `OrderPresenter` withholds.
            ],
        ]);
    }
}
