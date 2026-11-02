<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Presenters;

use Healthy360\Kitchens\Models\KitchenServiceSettings;

/**
 * The wire shape of a kitchen's service timings, in whole minutes, and its refund
 * limit in minor units.
 */
final class KitchenServiceSettingsPresenter
{
    /**
     * @return array{
     *     order_lead_minutes: int,
     *     alarm_after_minutes: int,
     *     manager_alert_after_minutes: int,
     *     owner_alert_after_minutes: int,
     *     refund_approval_above_minor: int
     * }
     */
    public function settings(KitchenServiceSettings $settings): array
    {
        return [
            'order_lead_minutes' => $settings->order_lead_minutes,
            'alarm_after_minutes' => $settings->alarm_after_minutes,
            'manager_alert_after_minutes' => $settings->manager_alert_after_minutes,
            'owner_alert_after_minutes' => $settings->owner_alert_after_minutes,
            'refund_approval_above_minor' => $settings->refund_approval_above_minor,
        ];
    }
}
