<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Presenters;

use Healthy360\Kitchens\Models\KitchenServiceSettings;

/**
 * The wire shape of a kitchen's service timings, all in whole minutes.
 */
final class KitchenServiceSettingsPresenter
{
    /**
     * @return array{
     *     order_lead_minutes: int,
     *     alarm_after_minutes: int,
     *     manager_alert_after_minutes: int,
     *     owner_alert_after_minutes: int
     * }
     */
    public function settings(KitchenServiceSettings $settings): array
    {
        return [
            'order_lead_minutes' => $settings->order_lead_minutes,
            'alarm_after_minutes' => $settings->alarm_after_minutes,
            'manager_alert_after_minutes' => $settings->manager_alert_after_minutes,
            'owner_alert_after_minutes' => $settings->owner_alert_after_minutes,
        ];
    }
}
