<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Database\Factories;

use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CatalogueItemPackVariant>
 */
class CatalogueItemPackVariantFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'catalogue_item_variant_id' => CatalogueItemVariant::factory(),
            'organisation_id' => fn (array $attributes): ?string => CatalogueItemVariant::withoutTenancy()
                ->whereKey($attributes['catalogue_item_variant_id'] ?? null)
                ->value('organisation_id'),
            'pack_quantity' => '1.0000',
            'pack_unit_id' => fn (): string => (string) (MeasurementUnit::query()->where('code', 'kg')->value('id')
                ?? MeasurementUnit::factory()->create()->getKey()),
            'pack_piece_count' => null,
            'pack_format' => null,
            'net_weight_grams' => null,
        ];
    }
}
