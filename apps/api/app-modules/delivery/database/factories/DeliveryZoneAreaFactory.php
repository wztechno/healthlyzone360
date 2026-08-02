<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Database\Factories;

use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DeliveryZoneArea>
 */
class DeliveryZoneAreaFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organisation_id' => Organisation::factory(),
            'delivery_zone_id' => DeliveryZone::factory(),
            'delivery_area_id' => DeliveryArea::factory(),
            'branch_id' => null,
        ];
    }
}
