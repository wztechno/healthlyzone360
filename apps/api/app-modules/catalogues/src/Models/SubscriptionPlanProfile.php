<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Database\Factories\SubscriptionPlanProfileFactory;
use Healthy360\Catalogues\Enums\PlanPricingBasis;
use Healthy360\Catalogues\Enums\PlanType;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The commercial terms of one subscription plan. The catalogue item's
 * identifier is the primary key — a plan *is* the item, seen from the
 * commercial side — so the key is neither incrementing nor generated here.
 *
 * @property string $catalogue_item_id
 * @property string $organisation_id
 * @property PlanType $plan_type
 * @property PlanPricingBasis $pricing_basis
 * @property bool $allows_free_selection
 * @property bool $skip_allowed
 * @property bool $pause_allowed
 * @property int $change_cutoff_hours
 * @property string|null $summary_en
 * @property string|null $summary_ar
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Public, 'plan_type', 'pricing_basis', 'summary_en', 'summary_ar', 'change_cutoff_hours')]
class SubscriptionPlanProfile extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<SubscriptionPlanProfileFactory> */
    use HasFactory;

    /** @var string */
    protected $primaryKey = 'catalogue_item_id';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'plan_type' => PlanType::class,
            'pricing_basis' => PlanPricingBasis::class,
            'allows_free_selection' => 'boolean',
            'skip_allowed' => 'boolean',
            'pause_allowed' => 'boolean',
            'change_cutoff_hours' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<CatalogueItem, $this>
     */
    public function item(): BelongsTo
    {
        return $this->belongsTo(CatalogueItem::class, 'catalogue_item_id');
    }
}
