<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Database\Factories;

use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Catalogues\Models\PlanVariantDuration;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<PlanVariantDuration>
 */
class PlanVariantDurationFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'catalogue_item_variant_id' => CatalogueItemVariant::factory()->planConfiguration(),
            'organisation_id' => fn (array $attributes): ?string => CatalogueItemVariant::withoutTenancy()
                ->whereKey($attributes['catalogue_item_variant_id'] ?? null)
                ->value('organisation_id'),
            'plan_duration_id' => fn (array $attributes): string => (string) PlanDuration::factory()
                ->create(['organisation_id' => $attributes['organisation_id']])
                ->getKey(),

            // NULL by default, and that is the point: a fixture that invented a
            // discount would make "nobody has stated one" the unusual case in
            // every test that used it.
            'discount_percent' => null,
            'is_available' => true,
        ];
    }
}
