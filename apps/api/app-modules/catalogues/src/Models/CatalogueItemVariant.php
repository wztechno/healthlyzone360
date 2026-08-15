<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Database\Factories\CatalogueItemVariantFactory;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Enums\VariantType;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * The thing a price actually points at: one pack of a product, or one
 * configuration of a subscription plan.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $catalogue_item_id
 * @property VariantType $variant_type
 * @property string $code
 * @property string|null $name_en
 * @property string|null $name_ar
 * @property bool $is_default
 * @property VariantStatus $status
 * @property string|null $created_by
 * @property string|null $updated_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Public, 'code', 'name_en', 'name_ar')]
class CatalogueItemVariant extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<CatalogueItemVariantFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'variant_type' => VariantType::class,
            'status' => VariantStatus::class,
            'is_default' => 'boolean',
            'lock_version' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<CatalogueItem, $this>
     */
    public function item(): BelongsTo
    {
        return $this->belongsTo(CatalogueItem::class, 'catalogue_item_id');
    }

    /**
     * @return HasOne<CatalogueItemPackVariant, $this>
     */
    public function pack(): HasOne
    {
        return $this->hasOne(CatalogueItemPackVariant::class, 'catalogue_item_variant_id');
    }

    /**
     * The matrix cell this variant is, present only on a plan configuration —
     * the plan-side twin of `pack()`.
     *
     * @return HasOne<PlanVariantProfile, $this>
     */
    public function planProfile(): HasOne
    {
        return $this->hasOne(PlanVariantProfile::class, 'catalogue_item_variant_id');
    }

    /**
     * @return HasMany<PlanVariantDuration, $this>
     */
    public function planDurations(): HasMany
    {
        return $this->hasMany(PlanVariantDuration::class, 'catalogue_item_variant_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
