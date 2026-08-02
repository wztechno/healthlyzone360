<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Database\Factories;

use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Enums\RecipeCompleteness;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<RecipeVersion>
 */
class RecipeVersionFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'recipe_id' => Recipe::factory(),

            // Inherited from the recipe rather than from the tenant context:
            // a factory that needed an active organisation to work would be
            // unusable in exactly the suites that build two tenants at once.
            'organisation_id' => fn (array $attributes): ?string => Recipe::withoutTenancy()
                ->whereKey($attributes['recipe_id'] ?? null)
                ->value('organisation_id'),
            'version_number' => 1,
            'status' => RecipeVersionStatus::Draft,
            'completeness' => RecipeCompleteness::Indicative,
            'yield_quantity' => null,
            'yield_unit_id' => null,
            'yield_piece_count' => null,
            'input_quantity_total' => null,
            'waste_coefficient_percent' => 3,
            'derivation_state' => DerivationState::Stale,
            'derived_at' => null,
            'derived_input_hash' => null,
            'published_at' => null,
            'published_by' => null,
            'review_reason' => null,
            'notes' => null,
            'lock_version' => 0,
        ];
    }

    /**
     * The quarantine state (master plan v2 §4.7) — editable, and as
     * unpublishable as a draft.
     */
    public function quarantined(string $reason = 'Allergen determination contradicts the source.'): static
    {
        return $this->state(fn (array $attributes): array => [
            'status' => RecipeVersionStatus::ReviewRequired,
            'review_reason' => $reason,
        ]);
    }

    public function published(): static
    {
        return $this->state(fn (array $attributes): array => [
            'status' => RecipeVersionStatus::Published,
            'published_at' => now(),
            'derivation_state' => DerivationState::Current,
            'derived_at' => now(),
        ]);
    }

    public function retired(): static
    {
        return $this->state(fn (array $attributes): array => ['status' => RecipeVersionStatus::Retired]);
    }
}
