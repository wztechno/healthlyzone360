<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Models;

use Carbon\CarbonImmutable;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Enums\PackagingBasis;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One packaging line of a recipe version — what the output goes out in.
 *
 * The sibling of {@see RecipeVersionLine}, and deliberately not a variant of
 * it. The two tables sum the same way and divide by the same yield, but they
 * point at different families: a formulation line references an `ingredient`
 * and contributes to the allergen rollup and the nutrition derivation, while
 * this references a `packaging_item` and contributes to neither. Collapsing
 * them would put bin liners into the allergen pipeline.
 *
 * `quantity` is derived for two of the three bases — see {@see PackagingBasis}
 * — but is *stored* rather than recomputed on read, because a technical sheet
 * is a document and a document whose numbers move when you open it is not one.
 *
 * Confidential for the same reason the formulation is: `unit_cost_amount` and
 * `line_cost_amount` are what this kitchen pays, and one leak of them into a
 * customer-facing projection is a leak of the margin. They travel only behind
 * `recipe.view_costs_organisation`.
 *
 * @property string $id
 * @property string $recipe_version_id
 * @property string $organisation_id
 * @property int $line_number
 * @property string $ingredient_id
 * @property PackagingBasis $basis
 * @property numeric-string $quantity
 * @property string|null $unit_id
 * @property numeric-string|null $unit_cost_amount
 * @property numeric-string|null $line_cost_amount
 * @property string|null $cost_currency_code
 * @property string|null $comment
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Confidential, 'quantity', 'unit_cost_amount', 'line_cost_amount', 'comment')]
class RecipeVersionPackaging extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /**
     * The table name, stated because Laravel would pluralise the class to
     * `recipe_version_packagings` — a word that is not one.
     */
    protected $table = 'recipe_version_packaging';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'basis' => PackagingBasis::class,
            'line_number' => 'integer',
            'quantity' => 'decimal:4',
            'unit_cost_amount' => 'decimal:6',
            'line_cost_amount' => 'decimal:6',
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
     * @return BelongsTo<Ingredient, $this>
     */
    public function packagingIngredient(): BelongsTo
    {
        return $this->belongsTo(Ingredient::class, 'ingredient_id');
    }

    /**
     * @return BelongsTo<MeasurementUnit, $this>
     */
    public function unit(): BelongsTo
    {
        return $this->belongsTo(MeasurementUnit::class, 'unit_id');
    }
}
