<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validation for a kitchen's service timings, in whole minutes.
 *
 * The lead may be nothing, for a kitchen that takes an order up to the moment a
 * window opens; an alarm at zero minutes would ring for every order placed.
 * Managers hear before the owner, or the escalation is not one. A week is the
 * ceiling: past that, a typing mistake has silenced the alert. A refund limit of
 * nothing sends every refund to the owner.
 */
class UpdateKitchenServiceSettingsRequest extends FormRequest
{
    private const int MAX_MINUTES = 10080;

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $max = 'max:'.self::MAX_MINUTES;

        return [
            'order_lead_minutes' => ['required', 'integer', 'min:0', $max],
            'alarm_after_minutes' => ['required', 'integer', 'min:1', $max],
            'manager_alert_after_minutes' => ['required', 'integer', 'min:1', $max, 'lt:owner_alert_after_minutes'],
            'owner_alert_after_minutes' => ['required', 'integer', 'min:1', $max],
            'refund_approval_above_minor' => ['required', 'integer', 'min:0'],
            'orders_per_window' => ['nullable', 'integer', 'min:1', 'max:1000'],
        ];
    }
}
