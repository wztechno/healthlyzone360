<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Models;

use Carbon\CarbonImmutable;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Database\Factories\RecipeVersionLineFactory;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One raw-material line of a recipe version — the formulation itself.
 *
 * The cost attributes are on the model because the importer writes them; no
 * presenter in K1.2 reads them. `RecipeVersionPresenter` omits them
 * deliberately and says so: the cost surface arrives in K1.3 behind
 * `recipe.view_costs_organisation`, and until that permission exists the
 * safest projection is the one that cannot leak.
 *
 * The amounts are **major currency units** (master plan v2 §4.4) — `3.9` is
 * three dollars ninety — which is why they are named `*_amount` and never
 * `*_minor`.
 *
 * @property string $id
 * @property string $recipe_version_id
 * @property string $organisation_id
 * @property int $line_number
 * @property string $ingredient_id
 * @property string|null $quantity
 * @property string|null $unit_id
 * @property string|null $unit_cost_amount
 * @property string|null $line_cost_amount
 * @property string|null $cost_currency_code
 * @property string|null $source_designation
 * @property string|null $comment
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Confidential, 'quantity', 'unit_cost_amount', 'line_cost_amount', 'source_designation', 'comment')]
class RecipeVersionLine extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<RecipeVersionLineFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
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
    public function ingredient(): BelongsTo
    {
        return $this->belongsTo(Ingredient::class);
    }

    /**
     * @return BelongsTo<MeasurementUnit, $this>
     */
    public function unit(): BelongsTo
    {
        return $this->belongsTo(MeasurementUnit::class, 'unit_id');
    }
}
