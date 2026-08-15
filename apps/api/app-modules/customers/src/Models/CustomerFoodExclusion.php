<?php

declare(strict_types=1);

namespace Healthy360\Customers\Models;

use Carbon\CarbonImmutable;
use Healthy360\Customers\Database\Factories\CustomerFoodExclusionFactory;
use Healthy360\Customers\Enums\FoodExclusionKind;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\ReferenceData\Models\DietClassification;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * "Not this, please."
 *
 * `SpecialCategory`, because a prohibition is frequently a belief: "no pork"
 * and "no beef" say something about a person that the platform must handle as
 * carefully as it handles an allergy, even though nobody's airway depends on
 * it.
 *
 * @property string $id
 * @property string $customer_dietary_profile_id
 * @property FoodExclusionKind $kind
 * @property string|null $ingredient_id
 * @property string|null $diet_classification_id
 * @property string|null $free_text
 * @property CarbonImmutable $declared_at
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read CustomerDietaryProfile|null $dietaryProfile
 */
#[Classified(DataClassification::SpecialCategory, 'kind', 'ingredient_id', 'diet_classification_id', 'free_text')]
class CustomerFoodExclusion extends BaseModel
{
    /** @use HasFactory<CustomerFoodExclusionFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'kind' => FoodExclusionKind::class,
            'declared_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<CustomerDietaryProfile, $this>
     */
    public function dietaryProfile(): BelongsTo
    {
        return $this->belongsTo(CustomerDietaryProfile::class, 'customer_dietary_profile_id');
    }

    /**
     * @return BelongsTo<Ingredient, $this>
     */
    public function ingredient(): BelongsTo
    {
        return $this->belongsTo(Ingredient::class);
    }

    /**
     * @return BelongsTo<DietClassification, $this>
     */
    public function dietClassification(): BelongsTo
    {
        return $this->belongsTo(DietClassification::class);
    }

    /**
     * How this exclusion names its subject, for a caller that has to render it
     * without knowing which of the three columns is set.
     */
    public function subjectKind(): string
    {
        return match (true) {
            $this->ingredient_id !== null => 'ingredient',
            $this->diet_classification_id !== null => 'diet_classification',
            default => 'free_text',
        };
    }
}
