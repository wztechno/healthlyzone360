<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Database\Factories;

use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CatalogueItem>
 */
class CatalogueItemFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $name = ucfirst(fake()->unique()->word().' '.fake()->word());

        return [
            'catalogue_id' => Catalogue::factory(),

            // Inherited from the catalogue rather than from the tenant
            // context: a factory that needed an active organisation to work
            // would be unusable in exactly the suites that build two tenants
            // at once (the K1.2 rationale, unchanged).
            'organisation_id' => fn (array $attributes): ?string => Catalogue::withoutTenancy()
                ->whereKey($attributes['catalogue_id'] ?? null)
                ->value('organisation_id'),
            'item_type' => CatalogueItemType::Product,
            'slug' => str($name)->slug()->value().'-'.fake()->unique()->numberBetween(1, 999999),
            'name_en' => $name,
            'name_ar' => 'صنف '.fake()->word(),
            'description_en' => null,
            'description_ar' => null,
            'product_category_id' => null,
            'production_mode' => null,
            'recipe_id' => null,
            'ingredient_id' => null,
            'purchasing_unit_id' => null,
            'usage_unit_id' => null,
            'is_market_priced' => false,
            'is_assorted' => false,
            'status' => CatalogueItemStatus::Draft,
            'review_reason' => null,
            'image_placeholder_id' => null,
            'nutrition_facts' => null,
            'data_quality_flags' => null,
            'lock_version' => 0,
        ];
    }

    public function meal(): static
    {
        return $this->state(fn (array $attributes): array => ['item_type' => CatalogueItemType::Meal]);
    }

    public function subscriptionPlan(): static
    {
        return $this->state(fn (array $attributes): array => ['item_type' => CatalogueItemType::SubscriptionPlan]);
    }

    /**
     * The untranslated state the publish gate refuses. Empty, not null: the
     * column is NOT NULL and "" is what "nobody has written the Arabic yet"
     * looks like.
     */
    public function untranslated(): static
    {
        return $this->state(fn (array $attributes): array => ['name_ar' => '']);
    }

    /**
     * The quarantine state (master plan v2 §4.7) — editable, and as
     * unpublishable as a draft.
     */
    public function quarantined(string $reason = 'Allergen determination contradicts the source.'): static
    {
        return $this->state(fn (array $attributes): array => [
            'status' => CatalogueItemStatus::ReviewRequired,
            'review_reason' => $reason,
        ]);
    }

    public function published(): static
    {
        return $this->state(fn (array $attributes): array => ['status' => CatalogueItemStatus::Published]);
    }

    public function retired(): static
    {
        return $this->state(fn (array $attributes): array => ['status' => CatalogueItemStatus::Retired]);
    }
}
