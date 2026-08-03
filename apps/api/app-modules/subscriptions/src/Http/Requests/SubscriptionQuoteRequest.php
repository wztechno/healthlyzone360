<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for the price of a plan configuration, before anybody commits.
 *
 * The same four coordinates `SubscriptionPricing::quote()` takes, as query
 * parameters rather than a body, because the endpoint is a `GET` on a
 * computation with no side effects — a client re-quotes on every change to the
 * duration selector, and a `POST` would make that uncacheable and unlinkable.
 *
 * **Authenticated and verified, not anonymous**, and the reason is what the
 * number is. `price_list_items` is the one catalogue table with a row-level
 * security policy, on the stated ground that a negotiated price says what a
 * kitchen will accept and from whom; an agreement list quotes one customer's
 * position. The marketplace's own plan pages carry the *published consumer*
 * price through `PublicProjection`, which is a different number arrived at a
 * different way. Serving this resolver anonymously would hand anybody a probe
 * for every tariff a kitchen has ever attached to a channel.
 */
class SubscriptionQuoteRequest extends FormRequest
{
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
            'sales_channel_id' => ['required', 'uuid'],
            'catalogue_item_id' => ['required', 'uuid'],
            'catalogue_item_variant_id' => ['required', 'uuid'],
            'plan_duration_id' => ['required', 'uuid'],
        ];
    }

    /**
     * @return array{
     *     sales_channel_id: string,
     *     catalogue_item_id: string,
     *     catalogue_item_variant_id: string,
     *     plan_duration_id: string,
     * }
     */
    public function payload(): array
    {
        /** @var array{sales_channel_id: string, catalogue_item_id: string, catalogue_item_variant_id: string, plan_duration_id: string} $validated */
        $validated = $this->validated();

        return $validated;
    }
}
