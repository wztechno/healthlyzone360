<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Database\Factories;

use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Enums\VariantType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CatalogueItemVariant>
 */
class CatalogueItemVariantFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'catalogue_item_id' => CatalogueItem::factory(),
            'organisation_id' => fn (array $attributes): ?string => CatalogueItem::withoutTenancy()
                ->whereKey($attributes['catalogue_item_id'] ?? null)
                ->value('organisation_id'),
            'variant_type' => VariantType::Pack,
            'code' => 'pack-'.fake()->unique()->numberBetween(1, 999999),
            'name_en' => null,
            'name_ar' => null,
            'is_default' => false,
            'status' => VariantStatus::Active,
            'lock_version' => 0,
        ];
    }

    public function planConfiguration(): static
    {
        return $this->state(fn (array $attributes): array => ['variant_type' => VariantType::PlanConfiguration]);
    }

    public function archived(): static
    {
        return $this->state(fn (array $attributes): array => ['status' => VariantStatus::Archived]);
    }
}
