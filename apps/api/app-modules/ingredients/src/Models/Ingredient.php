<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Ingredients\Database\Factories\IngredientFactory;
use Healthy360\Ingredients\Enums\AvailabilityTier;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Enums\IngredientVerificationStatus;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
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
