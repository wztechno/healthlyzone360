<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for the weekly selection (§7).
 *
 * A `PUT` because the set is replaced whole: a customer dropping Wednesday
 * means they no longer want Wednesday, and a merge-shaped write cannot say so —
 * the same argument `/me/dietary-profile` makes about an allergy somebody no
 * longer has.
 *
 * `min:1` restates the table's own CHECK. A subscription with no delivery
 * weekdays would generate nothing forever and look like a platform fault rather
 * than like the contradiction it is, so the empty array is refused at the door
 * with a field error a form can attach to the right control.
 */
class UpdateSubscriptionWeekdaysRequest extends FormRequest
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
            'weekdays' => ['required', 'array', 'min:1', 'max:7'],
            'weekdays.*' => ['integer', 'between:1,7'],
        ];
    }
}
