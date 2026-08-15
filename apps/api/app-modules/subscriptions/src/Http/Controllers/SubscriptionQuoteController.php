<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Subscriptions\Exceptions\SubscriptionRefused;
use Healthy360\Subscriptions\Http\Requests\SubscriptionQuoteRequest;
use Healthy360\Subscriptions\Services\PlanQuote;
use Healthy360\Subscriptions\Services\StorefrontQuoting;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/subscriptions/quote — what this configuration would cost, and
 * when it would arrive.
 *
 * **A quote and not a hold.** Nothing is reserved, nothing is written, and the
 * number is only guaranteed for as long as the tariff behind it stands.
 * `POST /subscriptions` re-resolves it and captures *that* answer, which is the
 * one the customer is grandfathered at — so a client must never send a price
 * back, and there is no field for it to send one in.
 *
 * **Reachable from what the storefront publishes.** The endpoint used to demand
 * a `sales_channel_id` and a `plan_duration_id`, neither of which a shopper can
 * obtain: channels are a tenant surface and the public plan read publishes
 * durations without identifiers. Both are now resolved server-side from the
 * plan itself (`StorefrontQuoting`), which is what makes this the one read a
 * configurator needs rather than a well-formed endpoint nobody could call.
 *
 * **`available_weekdays` is the point of the enrichment.** Until it existed a
 * configurator discovered which days a plan delivers on by pricing the same
 * subscription seven times, once per weekday, and reading which answers carried
 * a warning. That was honest and it was seven round trips for a fact the
 * platform already holds. It is one field now, and it travels beside
 * `allows_free_selection` and `change_cutoff_hours` because a configurator that
 * knows the price but not the cut-off can draw a control it cannot honour.
 *
 * **A refusal is a 409, not an empty 200.** `unpriced`, `duration_not_offered`,
 * `duration_ambiguous`, `duration_not_fixed`, `plan_not_subscription` and
 * `pricing_basis_unsupported` are the reasons, and every one of them is a fact
 * about the world rather than about the request's shape — the same argument
 * `order.placement_refused` makes. `pricing_basis_unsupported` in particular
 * has to name itself: a per-week plan is refused on principle (a weekly price
 * divided by seven charges a three-day-a-week customer for four days they never
 * receive), and collapsing it into "unpriced" would send a kitchen hunting for
 * a missing tariff row that is not missing.
 */
final class SubscriptionQuoteController
{
    public function __construct(private readonly StorefrontQuoting $storefront) {}

    /**
     * @throws ApiException
     */
    public function __invoke(SubscriptionQuoteRequest $request): JsonResponse
    {
        $payload = $request->payload();

        $result = $this->storefront->quote(
            $payload['catalogue_item_id'],
            $payload['catalogue_item_variant_id'],
            $payload['plan_duration_days'],
            CarbonImmutable::now(),
        );

        $quote = $result['quote'];

        if (! $quote instanceof PlanQuote) {
            throw new SubscriptionRefused($result['reasons']);
        }

        $duration = $result['duration'];

        return ApiResponse::data([
            // The purchase path still needs identifiers the quote object deliberately
            // omits from the customer's screen. They are resolved here, once, by the
            // same logic that priced the run — not invented by a client that cannot
            // see sales channels or duration rows.
            'plan_duration_id' => $duration === null ? null : (string) $duration->getKey(),
            'sales_channel_id' => $result['sales_channel_id'],
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
                // The run that was actually resolved, echoed so a configurator
                // can show the kitchen's own wording for it rather than the day
                // count it asked with.
                'duration_code' => $duration?->code,
                'duration_kind' => $duration?->duration_kind->value,
                // The seven-probe hack's replacement.
                'available_weekdays' => $result['available_weekdays'],
                'allows_free_selection' => $result['allows_free_selection'],
                'change_cutoff_hours' => $result['change_cutoff_hours'],
                // Deliberately absent: `price_list_id` and `price_list_item_id`.
                // They are the provenance the *capture* keeps so a price stays
                // explainable years later, and on a customer's screen they name
                // a kitchen's tariff structure to the person being charged by
                // it — the same pair `OrderPresenter` withholds.
            ],
        ]);
    }
}
