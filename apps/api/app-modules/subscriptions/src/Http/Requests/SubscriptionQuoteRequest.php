<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for the price of a plan configuration, before anybody commits.
 *
 * Query parameters rather than a body, because the endpoint is a `GET` on a
 * computation with no side effects — a client re-quotes on every change to the
 * duration selector, and a `POST` would make that uncacheable and unlinkable.
 *
 * ## Three coordinates, and the two that used to be here
 *
 * **`sales_channel_id` is gone.** It was a tenant identifier the *shopper* had
 * to supply, and a shopper has no way to learn one: sales channels live behind
 * `/catalogue/sales-channels`, which needs an organisation context a customer
 * does not have. Worse, accepting it meant the party being charged could name
 * the tariff they were charged through. The channel is now resolved from the
 * plan's own kitchen, restricted to its *consumer* channels
 * (`StorefrontQuoting`), which is both reachable and narrower than the
 * validator that preceded it — `b2b`, `corporate` and `insurance` channels can
 * no longer be quoted at all.
 *
 * **`plan_duration_id` became `plan_duration_days`**, for the same reason: the
 * public plan projection publishes durations as `{code, kind, days}` with no
 * identifier, so a shopper never held the id. Days rather than the code because
 * the code is a kitchen-authored slug (`4w`, `28d`, `monthly`) and the number
 * of days is the fact — the rule the client's own duration mapper has applied
 * since M1. Nothing was added to the public projection to make this work, which
 * is why it was preferred to publishing identifiers.
 *
 * The bound is the platform's longest published run with room to spare; a
 * `duration_days` no kitchen offers is a `409 duration_not_offered`, which is a
 * fact about the world rather than about the request's shape.
 *
 * **Still authenticated and verified, not anonymous.** Nothing here changes
 * that: `price_list_items` carries a row-level security policy on the ground
 * that a negotiated price says what a kitchen will accept and from whom, and
 * serving this resolver anonymously would hand anybody a probe for every tariff
 * a kitchen has attached to a channel. Restricting the reachable channels to
 * the consumer kinds narrows that surface further; it does not open it.
 */
class SubscriptionQuoteRequest extends FormRequest
{
    /** The longest run this endpoint will price, in delivery days. */
    public const int MAX_DURATION_DAYS = 400;

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'catalogue_item_id' => ['required', 'uuid'],
            'catalogue_item_variant_id' => ['required', 'uuid'],
            'plan_duration_days' => ['required', 'integer', 'min:1', 'max:'.self::MAX_DURATION_DAYS],
        ];
    }

    /**
     * The validated coordinates, with the day count as a number.
     *
     * Cast here rather than trusted: a query parameter arrives as a string
     * whatever the `integer` rule proved about it, and the only alternative to
     * casting once at the boundary is every caller downstream widening its own
     * signature to `int|string`.
     *
     * @return array{
     *     catalogue_item_id: string,
     *     catalogue_item_variant_id: string,
     *     plan_duration_days: int,
     * }
     */
    public function payload(): array
    {
        /** @var array{catalogue_item_id: string, catalogue_item_variant_id: string, plan_duration_days: int|string} $validated */
        $validated = $this->validated();

        return [
            'catalogue_item_id' => $validated['catalogue_item_id'],
            'catalogue_item_variant_id' => $validated['catalogue_item_variant_id'],
            'plan_duration_days' => (int) $validated['plan_duration_days'],
        ];
    }
}
