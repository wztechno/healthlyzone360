<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Models;

use Carbon\CarbonImmutable;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Database\Factories\RecipeVersionOutputFactory;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * What a version produces (master plan v2 §4.2).
 *
 * An ingredient with a row here is what the design used to call an
 * "intermediate"; there is no kind column anywhere, because being an
 * intermediate is a fact about some version's outputs and not a property of
 * the ingredient.
 *
 * `UPDATED_AT` is null: an output row is replaced, never edited in place, so
 * the column would only ever repeat `created_at`.
 *
 * @property string $id
 * @property string $recipe_version_id
 * @property string $organisation_id
 * @property string $ingredient_id
 * @property string $output_quantity
 * @property string $unit_id
 * @property bool $is_primary
 * @property CarbonImmutable|null $created_at
 */
#[Classified(DataClassification::Confidential, 'output_quantity')]
class RecipeVersionOutput extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<RecipeVersionOutputFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'output_quantity' => 'decimal:4',
            'is_primary' => 'boolean',
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
