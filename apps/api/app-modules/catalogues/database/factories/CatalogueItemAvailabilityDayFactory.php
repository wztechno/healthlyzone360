<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Database\Factories;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemAvailabilityDay;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CatalogueItemAvailabilityDay>
 */
class CatalogueItemAvailabilityDayFactory extends Factory
{
    protected $model = CatalogueItemAvailabilityDay::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'catalogue_item_id' => CatalogueItem::factory()->meal(),
            'organisation_id' => fn (array $attributes): ?string => CatalogueItem::withoutTenancy()
                ->whereKey($attributes['catalogue_item_id'] ?? null)
                ->value('organisation_id'),
            'date' => now()->toDateString(),
            'is_available' => true,
            'remaining_portions' => null,
            'order_cut_off_at' => '18:00:00',
        ];
    }
}
