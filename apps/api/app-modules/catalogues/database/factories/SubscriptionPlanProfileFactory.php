<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Database\Factories;

use Healthy360\Catalogues\Enums\PlanPricingBasis;
use Healthy360\Catalogues\Enums\PlanType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<SubscriptionPlanProfile>
 */
class SubscriptionPlanProfileFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'catalogue_item_id' => CatalogueItem::factory()->subscriptionPlan(),
            'organisation_id' => fn (array $attributes): ?string => CatalogueItem::withoutTenancy()
                ->whereKey($attributes['catalogue_item_id'] ?? null)
                ->value('organisation_id'),
            'plan_type' => PlanType::Both,
            'pricing_basis' => PlanPricingBasis::PerDay,
            'allows_free_selection' => false,
            'skip_allowed' => true,
            'pause_allowed' => true,
            'change_cutoff_hours' => 24,
            'summary_en' => null,
            'summary_ar' => null,
        ];
    }
}
