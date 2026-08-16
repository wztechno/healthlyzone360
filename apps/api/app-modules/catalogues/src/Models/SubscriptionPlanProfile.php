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
 * **`menu_cycle_days` and `menu_cycle_anchor_date` are written by
 * `PlanMenuService` and by nothing else.** `PlanProfileService::put()` is a
 * whole-document PUT — every field it writes is `$attributes[…] ?? default` —
 * so the moment these two joined its field list, a client sending a profile
 * body written before the columns existed would silently unpublish a kitchen's
 * menu. They ride in `PUT /catalogue/plans/{item}/menu` with the entries they
 * describe, which is also the only place they can be validated against them.
 *
 * They are classified `Public` on this class's own precedent rather than by
 * analogy to anything else. What this file already calls `Public` is the set a
 * customer is *told*: `plan_type`, `pricing_basis`, the summaries, and
 * `change_cutoff_hours` — an operational number that is Public because a
 * subscriber is shown "change up to 24 hours before delivery". A menu cycle is
 * the same kind of fact and then some: "a 7-day rotating menu" is on the
 * listing, and the anchor is what turns it into the "what is for dinner on
 * Thursday" a plan page renders. The commercial column of this family — the
 * one thing a competitor would want — is `plan_variant_durations.
 * discount_percent`, and it is `Internal`; a cycle length is not that. The
 * three subscriber-rights booleans stay unclassified exactly as they were:
 * this edit adds a declaration, it does not revisit theirs.
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
 * @property int|null $menu_cycle_days
 * @property CarbonImmutable|null $menu_cycle_anchor_date
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Public, 'plan_type', 'pricing_basis', 'summary_en', 'summary_ar', 'change_cutoff_hours', 'menu_cycle_days', 'menu_cycle_anchor_date')]
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
            'menu_cycle_days' => 'integer',

            // `date`, not `datetime`: a cycle turns over at the kitchen's
            // midnight, and casting it as an instant would invite a timezone
            // question that "which day of the cycle is Thursday" does not have.
            'menu_cycle_anchor_date' => 'date',
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
