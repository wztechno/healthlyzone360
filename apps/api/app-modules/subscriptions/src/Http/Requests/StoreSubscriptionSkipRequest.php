<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for skipping one delivery day.
 *
 * One field, and it is a date rather than a delivery identifier. A day a
 * customer wants to skip usually does not exist as a row yet — that is the
 * point of §4's one-day-ahead generation — so an endpoint keyed on a
 * `subscription_deliveries` id could only ever skip the one day that had
 * already been created, which is the one day it is nearly too late to skip.
 *
 * `after_or_equal:today` is the shape check and nothing more. Whether the day
 * is one the subscription delivers on, and whether it is still outside the
 * plan's change window, are `SubscriptionService`'s to answer — the second
 * needs the branch's timezone and the kitchen's stored `change_cutoff_hours`,
 * neither of which a validation rule can see, and both of which the refusal has
 * to explain rather than merely fail.
 */
class StoreSubscriptionSkipRequest extends FormRequest
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
            'date' => ['required', 'date_format:Y-m-d', 'after_or_equal:today'],
        ];
    }
}
