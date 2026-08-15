<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for moving a subscription to another of the caller's addresses.
 *
 * No `exists:` rule, for the reason the whole customer journey gives: the row
 * must be *this customer's*, `SubscriptionLocator` scopes it and answers 404,
 * and a bare rule would accept a stranger's address — a confidential row named
 * by somebody who does not hold it.
 *
 * Whether a kitchen actually delivers there is `SubscriptionService`'s
 * question, asked through the same `ZoneResolver` and `AreaServiceLookup` a
 * checkout asks, and answered as `area_not_served` or `zone_suspended` rather
 * than as a field error. A customer moving house needs to be told which of
 * those it is.
 */
class UpdateSubscriptionAddressRequest extends FormRequest
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
            'customer_address_id' => ['required', 'uuid'],
        ];
    }
}
