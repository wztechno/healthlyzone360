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
     *     refund_approval_above_minor: int,
     *     price_approval_above_percent: int|null,
     *     dish_margin_target_percent: int|null,
     *     orders_per_window: int|null,
     *     paused_until: string|null
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
            'price_approval_above_percent' => $settings->price_approval_above_percent,
            'dish_margin_target_percent' => $settings->dish_margin_target_percent,
            'orders_per_window' => $settings->orders_per_window,
            // A pause that has run out is no pause, whatever the column still holds.
            'paused_until' => $settings->paused_until?->isFuture() === true ? $settings->paused_until->toIso8601String() : null,
        ];
    }
}
