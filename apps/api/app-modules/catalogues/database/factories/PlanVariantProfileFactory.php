<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Database\Factories;

use Healthy360\Catalogues\Enums\ServiceTier;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\MealCombinationOption;
use Healthy360\Catalogues\Models\PlanVariantProfile;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<PlanVariantProfile>
 */
class PlanVariantProfileFactory extends Factory
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
            'catalogue_item_id' => fn (array $attributes): ?string => CatalogueItemVariant::withoutTenancy()
                ->whereKey($attributes['catalogue_item_variant_id'] ?? null)
                ->value('catalogue_item_id'),
            'meal_combination_option_id' => fn (array $attributes): string => (string) MealCombinationOption::factory()
                ->create(['organisation_id' => $attributes['organisation_id']])
                ->getKey(),
            'energy_band_id' => null,
            'service_tier' => ServiceTier::Standard,
            'includes_snacks' => false,
            'meals_per_day' => 2,
            'snacks_per_day' => 0,
        ];
    }

    public function premium(): static
    {
        return $this->state(fn (array $attributes): array => ['service_tier' => ServiceTier::Premium]);
    }
}
