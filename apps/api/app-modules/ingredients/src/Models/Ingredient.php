<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Ingredients\Database\Factories\IngredientFactory;
use Healthy360\Ingredients\Enums\AvailabilityTier;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Enums\IngredientVerificationStatus;
use Healthy360\Ingredients\Services\PackagingBranch;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * An ingredient — either a row of the platform library (organisation_id NULL,
 * visible to every tenant, writable by none of them) or a kitchen's own.
 *
 * Internal classification: an ingredient master is operational tenant
 * configuration. What reaches a diner is the allergen declaration, not this
 * row; public projections are a separate presenter, never this model.
 *
 * @property string $id
 * @property string|null $organisation_id null = platform library
 * @property string $slug
 * @property string $name_en
 * @property string $name_ar
 * @property string|null $ingredient_category_id
 * @property string|null $ingredient_subcategory_id
 * @property string $default_unit_id
 * @property string|null $purchase_unit_id
 * @property string|null $composition
 * @property string|null $items_per_unit
 * @property array<string, mixed>|null $nutrition_per_100g
 * @property string|null $b2b_price_amount
 * @property string|null $b2c_price_amount
 * @property string|null $unit_price_amount
 * @property string|null $price_currency_code
 * @property bool $is_sellable
 * @property string $yield_factor
 * @property string|null $forked_from_ingredient_id
 * @property AvailabilityTier|null $availability_tier
 * @property IngredientStatus $status
 * @property IngredientVerificationStatus $verification_status
 * @property string|null $notes
 * @property string|null $source_system
 * @property string|null $source_ref
 * @property CarbonImmutable|null $seeded_at
 * @property string|null $created_by
 * @property string|null $updated_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Internal, 'slug', 'name_en', 'name_ar', 'notes', 'source_system', 'source_ref')]
class Ingredient extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<IngredientFactory> */
    use HasFactory;

    public function organisationScopeAllowsNull(): bool
    {
        return true;
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'availability_tier' => AvailabilityTier::class,
            'status' => IngredientStatus::class,
            'verification_status' => IngredientVerificationStatus::class,
            'seeded_at' => 'immutable_datetime',
            'lock_version' => 'integer',
            'yield_factor' => 'decimal:4',
            'items_per_unit' => 'decimal:2',
            'nutrition_per_100g' => 'array',
            'b2b_price_amount' => 'decimal:6',
            'b2c_price_amount' => 'decimal:6',
            'unit_price_amount' => 'decimal:6',
            'is_sellable' => 'boolean',
            // Packaging's two figures. Null on food, and null is a real answer on packaging
            // too — "nobody has measured this", as against a `0` that says there is none.
            'waste_percent' => 'decimal:2',
            'capacity_quantity' => 'decimal:4',
        ];
    }

    /**
     * @return BelongsTo<IngredientCategory, $this>
     */
    public function category(): BelongsTo
    {
        return $this->belongsTo(IngredientCategory::class, 'ingredient_category_id');
    }

    /**
     * @return BelongsTo<IngredientCategory, $this>
     */
    public function subcategory(): BelongsTo
    {
        return $this->belongsTo(IngredientCategory::class, 'ingredient_subcategory_id');
    }

    /**
     * @return BelongsTo<MeasurementUnit, $this>
     */
    public function defaultUnit(): BelongsTo
    {
        return $this->belongsTo(MeasurementUnit::class, 'default_unit_id');
    }

    /**
     * @return BelongsTo<MeasurementUnit, $this>
     */
    public function purchaseUnit(): BelongsTo
    {
        return $this->belongsTo(MeasurementUnit::class, 'purchase_unit_id');
    }

    /**
     * Everything but packaging — the food half of the catalogue.
     *
     * Applied explicitly rather than as a global scope, deliberately. A global default would make
     * every query that legitimately *wants* packaging — goods receipts, receipt costing, stock
     * derivation, a kitchen buying bin liners — opt out of something it never opted into, and an
     * opt-out is invisible in review in a way an opt-in is not. Both scopes are one call and
     * greppable; a query that names neither is a query somebody has to think about, which is the
     * right outcome.
     *
     * A database whose taxonomy carries no packaging branch narrows nothing, because there is
     * nothing to narrow — not because the filter was dropped. That distinction is the whole
     * lesson of the split; see {@see PackagingBranch}.
     *
     * @param  Builder<Ingredient>  $query
     */
    public function scopeExcludingPackaging(Builder $query): void
    {
        $ids = app(PackagingBranch::class)->categoryIds();

        if ($ids === []) {
            return;
        }

        /*
         * Both halves spell out the NULL case, and that is not defensive noise.
         *
         * SQL's `NOT IN` is three-valued: `NULL NOT IN (…)` evaluates to NULL, not true, so a bare
         * `whereNotIn` on a nullable column silently drops every row that has no value — here,
         * every uncategorised ingredient. A filter meant to hide thirty-three boxes would have
         * hidden them and an unknown number of foodstuffs with them, and the list would simply
         * have been short rather than wrong-looking.
         */
        $query->where(fn (Builder $inner) => $inner
            ->whereNull('ingredient_category_id')
            ->orWhereNotIn('ingredient_category_id', $ids))
            ->where(fn (Builder $inner) => $inner
                ->whereNull('ingredient_subcategory_id')
                ->orWhereNotIn('ingredient_subcategory_id', $ids));
    }

    /**
     * Only packaging — the one surface that asks for the branch by name.
     *
     * An unseeded taxonomy yields nothing here rather than everything, which is the mirror of the
     * rule above and the failure the separate table was created to prevent.
     *
     * @param  Builder<Ingredient>  $query
     */
    public function scopeOnlyPackaging(Builder $query): void
    {
        $ids = app(PackagingBranch::class)->categoryIds();

        if ($ids === []) {
            $query->whereRaw('1 = 0');

            return;
        }

        $query->where(fn (Builder $inner) => $inner
            ->whereIn('ingredient_category_id', $ids)
            ->orWhereIn('ingredient_subcategory_id', $ids));
    }

    /**
     * The unit {@see $capacity_quantity} is counted in.
     *
     * Same-unit arithmetic on purpose: a 300 cc bottle records `0.3 kg`, the unit the recipe
     * consuming it works in, rather than the container's nominal volume. A nominal volume would
     * need a density to become a mass, and a missing density is the kind of gap that silently
     * produces a plausible wrong number.
     *
     * @return BelongsTo<MeasurementUnit, $this>
     */
    public function capacityUnit(): BelongsTo
    {
        return $this->belongsTo(MeasurementUnit::class, 'capacity_unit_id');
    }

    /**
     * @return BelongsTo<Ingredient, $this>
     */
    public function forkedFrom(): BelongsTo
    {
        return $this->belongsTo(self::class, 'forked_from_ingredient_id');
    }

    /**
     * @return HasMany<IngredientAlias, $this>
     */
    public function aliases(): HasMany
    {
        return $this->hasMany(IngredientAlias::class);
    }

    /**
     * Every allergen mapping on this ingredient — both the platform baseline
     * and any tenant overlay. Callers that need one layer filter explicitly;
     * a relation that quietly returned one of them would be the easiest way
     * to lose a baseline warning.
     *
     * @return HasMany<IngredientAllergen, $this>
     */
    public function allergenMappings(): HasMany
    {
        return $this->hasMany(IngredientAllergen::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    public function isPlatformRow(): bool
    {
        return $this->organisation_id === null;
    }
}
