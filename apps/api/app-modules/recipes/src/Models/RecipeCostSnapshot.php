<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Models;

use Carbon\CarbonImmutable;
use Healthy360\Recipes\Database\Factories\RecipeCostSnapshotFactory;
use Healthy360\Recipes\Enums\CostBasis;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * What one version of a recipe cost, at one moment, on one basis.
 *
 * **Append-only.** `UPDATED_AT = null` is not a convenience — there is no
 * `updated_at` column to write, and the runtime database roles have lost
 * `UPDATE` and `DELETE` on this table entirely (see the paired
 * row-level-security migration). Superseding a snapshot means writing a newer
 * one; `latestFor()` is how the newest is read back.
 *
 * Every amount is a **major-unit decimal** with six places (master plan v2
 * §4.4) and is cast as a string, deliberately. A float cannot represent
 * `0.1 + 0.2` and a cost model that rounds differently on two machines is
 * worse than no cost model; the arithmetic happens in `RecipeCostingService`
 * over bcmath strings and lands here as a string too.
 *
 * @property string $id
 * @property string $recipe_version_id
 * @property string $organisation_id
 * @property string $currency_code
 * @property CostBasis $basis
 * @property string $total_input_cost_amount
 * @property string|null $cost_per_yield_unit_amount
 * @property string|null $yield_unit_id
 * @property string|null $cost_per_piece_amount
 * @property string $waste_coefficient_percent
 * @property string|null $cost_per_yield_unit_with_waste_amount
 * @property string|null $cost_per_piece_with_waste_amount
 * @property string|null $source_label
 * @property bool $basis_mismatch
 * @property CarbonImmutable $calculated_at
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 */
#[Classified(
    DataClassification::Confidential,
    'total_input_cost_amount',
    'cost_per_yield_unit_amount',
    'cost_per_piece_amount',
    'cost_per_yield_unit_with_waste_amount',
    'cost_per_piece_with_waste_amount',
    'waste_coefficient_percent',
)]
class RecipeCostSnapshot extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<RecipeCostSnapshotFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'basis' => CostBasis::class,
            'total_input_cost_amount' => 'decimal:6',
            'cost_per_yield_unit_amount' => 'decimal:6',
            'cost_per_piece_amount' => 'decimal:6',
            'cost_per_yield_unit_with_waste_amount' => 'decimal:6',
            'cost_per_piece_with_waste_amount' => 'decimal:6',
            'waste_coefficient_percent' => 'decimal:2',
            'basis_mismatch' => 'boolean',
            'calculated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<RecipeVersion, $this>
     */
    public function version(): BelongsTo
    {
        return $this->belongsTo(RecipeVersion::class, 'recipe_version_id');
    }

    /**
     * @return BelongsTo<MeasurementUnit, $this>
     */
    public function yieldUnit(): BelongsTo
    {
        return $this->belongsTo(MeasurementUnit::class, 'yield_unit_id');
    }

    /**
     * The newest snapshot of one basis for one version.
     *
     * Ordered by `calculated_at` then `id`, never by `calculated_at` alone:
     * an import writes several snapshots inside one transaction and `now()`
     * is the same instant for all of them, so a tie-break that is not stable
     * would make "the latest" a coin toss.
     */
    public static function latestFor(string $recipeVersionId, CostBasis $basis): ?self
    {
        return self::query()
            ->where('recipe_version_id', $recipeVersionId)
            ->where('basis', $basis->value)
            ->orderByDesc('calculated_at')
            ->orderByDesc('id')
            ->first();
    }
}
