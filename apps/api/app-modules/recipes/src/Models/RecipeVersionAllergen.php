<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Models;

use Carbon\CarbonImmutable;
use Healthy360\Allergens\Models\Allergen;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Database\Factories\RecipeVersionAllergenFactory;
use Healthy360\Recipes\Enums\AllergenDerivation;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One row of a version's frozen allergen label.
 *
 * Classified `Public`: unlike everything else about a version, this is the
 * part that is meant to reach a diner. `source_note` is the exception — a
 * provenance note may quote an internal supplier declaration — and is
 * classified separately.
 *
 * `AllergenContainment` is reused from the ingredients module rather than
 * redeclared: "contains" and "may_contain" are the same two legal claims
 * wherever they appear, and two enums with the same values are two things to
 * keep in step.
 *
 * @property string $id
 * @property string $recipe_version_id
 * @property string $organisation_id
 * @property string $allergen_code
 * @property AllergenContainment $containment
 * @property AllergenDerivation $derivation
 * @property string|null $source_ingredient_id
 * @property string|null $source_note
 * @property CarbonImmutable|null $created_at
 */
#[Classified(DataClassification::Public, 'allergen_code', 'containment', 'derivation')]
#[Classified(DataClassification::Internal, 'source_note')]
class RecipeVersionAllergen extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<RecipeVersionAllergenFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'containment' => AllergenContainment::class,
            'derivation' => AllergenDerivation::class,
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
     * @return BelongsTo<Allergen, $this>
     */
    public function allergen(): BelongsTo
    {
        return $this->belongsTo(Allergen::class, 'allergen_code', 'code');
    }

    /**
     * @return BelongsTo<Ingredient, $this>
     */
    public function sourceIngredient(): BelongsTo
    {
        return $this->belongsTo(Ingredient::class, 'source_ingredient_id');
    }
}
