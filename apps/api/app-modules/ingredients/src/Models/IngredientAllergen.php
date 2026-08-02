<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Allergens\Models\Allergen;
use Healthy360\Ingredients\Database\Factories\IngredientAllergenFactory;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Enums\AllergenMappingSource;
use Healthy360\Ingredients\Enums\AllergenMarketScope;
use Healthy360\Ingredients\Enums\AllergenVerificationStatus;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One allergen statement about one ingredient, in one market, from one layer.
 *
 * organisation_id NULL is the platform baseline; a tenant identifier is that
 * kitchen's overlay. Both layers are visible in a tenant context (the `roles`
 * pattern) because a kitchen needs to see the baseline it may not weaken.
 *
 * The model lives in the ingredients module even though the table is created
 * by the allergens module's migration: every write goes through
 * `AllergenMappingService`, which is an ingredients service, and the
 * dependency edge runs Ingredients → Allergens, never back.
 *
 * @property string $id
 * @property string $ingredient_id
 * @property string $allergen_code
 * @property string|null $organisation_id null = platform baseline
 * @property AllergenContainment $containment
 * @property AllergenMarketScope $market_scope
 * @property AllergenMappingSource $source
 * @property AllergenVerificationStatus $verification_status
 * @property string|null $evidence
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Internal, 'evidence')]
#[Classified(DataClassification::Public, 'allergen_code', 'containment', 'market_scope')]
class IngredientAllergen extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<IngredientAllergenFactory> */
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
            'containment' => AllergenContainment::class,
            'market_scope' => AllergenMarketScope::class,
            'source' => AllergenMappingSource::class,
            'verification_status' => AllergenVerificationStatus::class,
        ];
    }

    /**
     * @return BelongsTo<Ingredient, $this>
     */
    public function ingredient(): BelongsTo
    {
        return $this->belongsTo(Ingredient::class);
    }

    /**
     * @return BelongsTo<Allergen, $this>
     */
    public function allergen(): BelongsTo
    {
        return $this->belongsTo(Allergen::class, 'allergen_code', 'code');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function isPlatformBaseline(): bool
    {
        return $this->organisation_id === null;
    }
}
