<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Database\Factories;

use Healthy360\Organisations\Models\Organisation;
use Healthy360\Recipes\Enums\CostBasis;
use Healthy360\Recipes\Models\RecipeCostSnapshot;
use Healthy360\Recipes\Models\RecipeVersion;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<RecipeCostSnapshot>
 */
class RecipeCostSnapshotFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'recipe_version_id' => RecipeVersion::factory(),

            // Inherited from the version rather than from the tenant context:
            // a factory that needed an active organisation to work would be
            // unusable in exactly the suites that build two tenants at once.
            'organisation_id' => fn (array $attributes): ?string => RecipeVersion::withoutTenancy()
                ->whereKey($attributes['recipe_version_id'] ?? null)
                ->value('organisation_id'),

            // Inherited from the organisation, not hard-coded to 'USD': a
            // kitchen's costs are in the kitchen's own currency, and a literal
            // would be a foreign-key violation in any suite that builds
            // organisations from factories rather than seeding the currency
            // table (the `rls` group is exactly that suite).
            'currency_code' => fn (array $attributes): ?string => Organisation::query()
                ->whereKey($attributes['organisation_id'] ?? null)
                ->value('default_currency_code'),
            'basis' => CostBasis::Recalculated,
            'total_input_cost_amount' => '12.500000',
            'cost_per_yield_unit_amount' => null,
            'yield_unit_id' => null,
            'cost_per_piece_amount' => null,
            'waste_coefficient_percent' => '3.00',
            'cost_per_yield_unit_with_waste_amount' => null,
            'cost_per_piece_with_waste_amount' => null,
            'source_label' => null,
            'basis_mismatch' => false,
            'calculated_at' => now(),
        ];
    }

    /**
     * The importer's basis: a sheet's own arithmetic, stored verbatim, with the
     * sheet's own wording kept beside it.
     *
     * `basis_mismatch` defaults to true here because the interesting
     * `as_recorded` case *is* the contradictory one — appendix D findings #1
     * and #2, where a figure labelled "cost per kg" sits beside a piece count.
     * A state that only produced the tidy case would leave the flag untested.
     */
    public function asRecorded(string $label = 'Cost per kg', bool $mismatch = true): static
    {
        return $this->state(fn (array $attributes): array => [
            'basis' => CostBasis::AsRecorded,
            'source_label' => $label,
            'basis_mismatch' => $mismatch,
        ]);
    }

    /**
     * A snapshot that states what a kilogram of the output cost, waste
     * included.
     */
    public function perYieldUnit(string $unitId, string $amount = '2.500000', string $withWaste = '2.575000'): static
    {
        return $this->state(fn (array $attributes): array => [
            'yield_unit_id' => $unitId,
            'cost_per_yield_unit_amount' => $amount,
            'cost_per_yield_unit_with_waste_amount' => $withWaste,
        ]);
    }

    public function perPiece(string $amount = '1.250000', string $withWaste = '1.287500'): static
    {
        return $this->state(fn (array $attributes): array => [
            'cost_per_piece_amount' => $amount,
            'cost_per_piece_with_waste_amount' => $withWaste,
        ]);
    }
}
