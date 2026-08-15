<?php

declare(strict_types=1);

namespace Healthy360\Customers\Models;

use Carbon\CarbonImmutable;
use Healthy360\Customers\Database\Factories\CustomerDietaryProfileFactory;
use Healthy360\ReferenceData\Models\DietClassification;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * What a customer eats — the D2C subset, not a clinical record.
 *
 * `religious_requirement` is `SpecialCategory`, which is not decoration: the
 * classification is what `DataClassification::requiresPurposeOfUse()` keys on,
 * and `DietaryProfileReader` is the only staff-facing path that reads this
 * table for exactly that reason.
 *
 * @property string $id
 * @property string $customer_account_id
 * @property CarbonImmutable|null $declared_at
 * @property bool $declares_no_allergens
 * @property string|null $diet_classification_id
 * @property string|null $religious_requirement
 * @property string|null $notes
 * @property string|null $created_by
 * @property string|null $updated_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read CustomerAccount|null $customerAccount
 * @property-read Collection<int, CustomerAllergenDeclaration> $allergenDeclarations
 * @property-read Collection<int, CustomerFoodExclusion> $foodExclusions
 */
#[Classified(DataClassification::SpecialCategory, 'religious_requirement', 'notes')]
class CustomerDietaryProfile extends BaseModel
{
    /** @use HasFactory<CustomerDietaryProfileFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'declared_at' => 'datetime',
            'declares_no_allergens' => 'boolean',
            'lock_version' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<CustomerAccount, $this>
     */
    public function customerAccount(): BelongsTo
    {
        return $this->belongsTo(CustomerAccount::class);
    }

    /**
     * @return BelongsTo<DietClassification, $this>
     */
    public function dietClassification(): BelongsTo
    {
        return $this->belongsTo(DietClassification::class);
    }

    /**
     * @return HasMany<CustomerAllergenDeclaration, $this>
     */
    public function allergenDeclarations(): HasMany
    {
        return $this->hasMany(CustomerAllergenDeclaration::class);
    }

    /**
     * @return HasMany<CustomerFoodExclusion, $this>
     */
    public function foodExclusions(): HasMany
    {
        return $this->hasMany(CustomerFoodExclusion::class);
    }

    /**
     * Whether the allergy question has been answered at all.
     *
     * The activation evaluator's gate, and the reason `declared_at` is a
     * timestamp rather than a boolean: an unanswered question and a confident
     * "none" must be distinguishable, and only one of them may activate an
     * account.
     */
    public function hasDeclared(): bool
    {
        return $this->declared_at !== null;
    }
}
