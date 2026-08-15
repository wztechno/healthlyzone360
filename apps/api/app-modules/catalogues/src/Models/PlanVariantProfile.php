<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Database\Factories\PlanVariantProfileFactory;
use Healthy360\Catalogues\Enums\ServiceTier;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One cell of a plan's availability matrix. The variant identifier is the
 * primary key: a cell *is* the variant, seen from the commercial side.
 *
 * @property string $catalogue_item_variant_id
 * @property string $organisation_id
 * @property string $catalogue_item_id
 * @property string $meal_combination_option_id
 * @property string|null $energy_band_id
 * @property ServiceTier $service_tier
 * @property bool $includes_snacks
 * @property int $meals_per_day
 * @property int $snacks_per_day
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Public, 'service_tier', 'includes_snacks', 'meals_per_day', 'snacks_per_day')]
class PlanVariantProfile extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<PlanVariantProfileFactory> */
    use HasFactory;

    /** @var string */
    protected $primaryKey = 'catalogue_item_variant_id';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'service_tier' => ServiceTier::class,
            'includes_snacks' => 'boolean',
            'meals_per_day' => 'integer',
            'snacks_per_day' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<CatalogueItemVariant, $this>
     */
    public function variant(): BelongsTo
    {
        return $this->belongsTo(CatalogueItemVariant::class, 'catalogue_item_variant_id');
    }

    /**
     * @return BelongsTo<CatalogueItem, $this>
     */
    public function item(): BelongsTo
    {
        return $this->belongsTo(CatalogueItem::class, 'catalogue_item_id');
    }

    /**
     * @return BelongsTo<MealCombinationOption, $this>
     */
    public function combination(): BelongsTo
    {
        return $this->belongsTo(MealCombinationOption::class, 'meal_combination_option_id');
    }

    /**
     * @return BelongsTo<EnergyBand, $this>
     */
    public function energyBand(): BelongsTo
    {
        return $this->belongsTo(EnergyBand::class, 'energy_band_id');
    }
}
