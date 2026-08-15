<?php

declare(strict_types=1);

namespace Healthy360\Customers\Models;

use Carbon\CarbonImmutable;
use Healthy360\Allergens\Models\Allergen;
use Healthy360\Customers\Database\Factories\CustomerAllergenDeclarationFactory;
use Healthy360\Customers\Enums\AllergenSeverity;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * "I react to this."
 *
 * Every column here is `SpecialCategory` — including the allergen code, which
 * is public reference data in isolation and health data the moment it is
 * attached to a person.
 *
 * @property string $id
 * @property string $customer_dietary_profile_id
 * @property string $allergen_code
 * @property AllergenSeverity $severity
 * @property string|null $notes
 * @property CarbonImmutable $declared_at
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read CustomerDietaryProfile|null $dietaryProfile
 * @property-read Allergen|null $allergen
 */
#[Classified(DataClassification::SpecialCategory, 'allergen_code', 'severity', 'notes')]
class CustomerAllergenDeclaration extends BaseModel
{
    /** @use HasFactory<CustomerAllergenDeclarationFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'severity' => AllergenSeverity::class,
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
     * @return BelongsTo<Allergen, $this>
     */
    public function allergen(): BelongsTo
    {
        return $this->belongsTo(Allergen::class, 'allergen_code', 'code');
    }
}
