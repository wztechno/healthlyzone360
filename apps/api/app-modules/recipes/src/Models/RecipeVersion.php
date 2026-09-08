<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Recipes\Database\Factories\RecipeVersionFactory;
use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Enums\RecipeCompleteness;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
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
 * One version of a recipe: the unit that is edited, quarantined, published and
 * frozen.
 *
 * The model carries no publication logic. `publish()` is a service operation
 * because it evaluates readiness across ingredients and allergen mappings,
 * writes a frozen label, demotes the incumbent and audits — none of which
 * belongs on a model that a factory can call into existence.
 *
 * @property string $id
 * @property string $recipe_id
 * @property string $organisation_id
 * @property int $version_number
 * @property RecipeVersionStatus $status
 * @property RecipeCompleteness $completeness
 * @property string|null $yield_quantity
 * @property string|null $yield_unit_id
 * @property int|null $yield_piece_count
 * @property string|null $input_quantity_total
 * @property string $waste_coefficient_percent
 * @property string $packaging_waste_percent
 * @property string|null $b2b_price_amount
 * @property string|null $b2c_price_amount
 * @property string|null $price_currency_code
 * @property DerivationState $derivation_state
 * @property CarbonImmutable|null $derived_at
 * @property string|null $derived_input_hash
 * @property CarbonImmutable|null $published_at
 * @property string|null $published_by
 * @property string|null $review_reason
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
/*
 * `b2b_price_amount` and `b2c_price_amount` are deliberately **not** in the
 * declaration below, and their omission is the claim rather than an oversight.
 * Everything named there is an input to what the kitchen paid — a yield, a
 * waste coefficient, a note on the method — and reading it backwards tells a
 * competitor what a recipe costs to make. A list price is the opposite kind of
 * figure: the B2C one is printed on a menu, and the B2B one is quoted to the
 * buyer it names. Classifying them Confidential would make the eventual
 * consumer projection have to argue its way past its own model, which is the
 * wrong shape of argument to have to make. `ingredients` classifies neither of
 * its two price columns for the same reason.
 */
#[Classified(DataClassification::Confidential, 'notes', 'review_reason', 'yield_quantity', 'input_quantity_total', 'waste_coefficient_percent', 'packaging_waste_percent')]
class RecipeVersion extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<RecipeVersionFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => RecipeVersionStatus::class,
            'completeness' => RecipeCompleteness::class,
            'derivation_state' => DerivationState::class,
            'version_number' => 'integer',
            'yield_quantity' => 'decimal:4',
            'yield_piece_count' => 'integer',
            'input_quantity_total' => 'decimal:4',
            'waste_coefficient_percent' => 'decimal:2',
            'packaging_waste_percent' => 'decimal:2',
            'b2b_price_amount' => 'decimal:6',
            'b2c_price_amount' => 'decimal:6',
            'derived_at' => 'immutable_datetime',
            'published_at' => 'immutable_datetime',
            'seeded_at' => 'immutable_datetime',
            'lock_version' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Recipe, $this>
     */
    public function recipe(): BelongsTo
    {
        return $this->belongsTo(Recipe::class);
    }

    /**
     * @return HasMany<RecipeVersionLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(RecipeVersionLine::class)->orderBy('line_number');
    }

    /**
     * @return HasMany<RecipeVersionOutput, $this>
     */
    public function outputs(): HasMany
    {
        return $this->hasMany(RecipeVersionOutput::class);
    }

    /**
     * @return HasMany<RecipeVersionStep, $this>
     */
    public function steps(): HasMany
    {
        return $this->hasMany(RecipeVersionStep::class)->orderBy('step_number');
    }

    /**
     * @return HasMany<RecipeVersionAllergen, $this>
     */
    public function allergens(): HasMany
    {
        return $this->hasMany(RecipeVersionAllergen::class)->orderBy('allergen_code');
    }

    /**
     * @return BelongsTo<MeasurementUnit, $this>
     */
    public function yieldUnit(): BelongsTo
    {
        return $this->belongsTo(MeasurementUnit::class, 'yield_unit_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function publisher(): BelongsTo
    {
        return $this->belongsTo(User::class, 'published_by');
    }

    public function isEditable(): bool
    {
        return $this->status->isEditable();
    }
}
