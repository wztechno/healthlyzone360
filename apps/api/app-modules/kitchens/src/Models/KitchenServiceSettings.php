<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

/**
 * One kitchen's service timings, in minutes, and its refund limit. Read it through
 * `KitchenServiceSettingsLookup`, which creates the row on first read.
 *
 * The defaults live here and nowhere else: the columns have none.
 *
 * @property string $id
 * @property string $organisation_id
 * @property int $order_lead_minutes
 * @property int $alarm_after_minutes
 * @property int $manager_alert_after_minutes
 * @property int $owner_alert_after_minutes
 * @property int $refund_approval_above_minor
 * @property int|null $orders_per_window the most orders one window takes on one day; null means no limit
 * @property CarbonImmutable|null $paused_until new customer orders are refused until then
 * @property string|null $paused_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Internal, 'order_lead_minutes', 'alarm_after_minutes', 'manager_alert_after_minutes', 'owner_alert_after_minutes', 'refund_approval_above_minor', 'orders_per_window', 'paused_until', 'paused_by')]
class KitchenServiceSettings extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected $table = 'kitchen_service_settings';

    /**
     * @var array<string, int>
     */
    protected $attributes = [
        'order_lead_minutes' => 120,
        'alarm_after_minutes' => 5,
        'manager_alert_after_minutes' => 10,
        'owner_alert_after_minutes' => 20,
        'refund_approval_above_minor' => 5000,
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'order_lead_minutes' => 'integer',
            'alarm_after_minutes' => 'integer',
            'manager_alert_after_minutes' => 'integer',
            'owner_alert_after_minutes' => 'integer',
            'refund_approval_above_minor' => 'integer',
            'orders_per_window' => 'integer',
            'paused_until' => 'datetime',
        ];
    }
}
