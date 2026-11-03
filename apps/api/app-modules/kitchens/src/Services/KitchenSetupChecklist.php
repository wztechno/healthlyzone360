<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Services;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneWindow;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Pricing\Models\PriceList;

/**
 * What a kitchen needs before it can take a customer's order, read off the records
 * themselves so a step cannot be ticked and untrue.
 *
 * Team is the one step that does not hold back going live: a kitchen of one is a
 * real kitchen.
 */
final readonly class KitchenSetupChecklist
{
    public function __construct(private KitchenServiceSettingsLookup $settings) {}

    /**
     * @return array{is_live: bool, steps: list<array{key: string, done: bool, required: bool}>}
     */
    public function for(string $organisationId): array
    {
        $zones = DeliveryZone::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('status', 'active')
            ->select('id');

        $steps = [
            'hours' => BranchOpeningHour::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->whereNotNull('opens_at')
                ->exists(),
            'delivery' => DeliveryZoneWindow::withoutTenancy()->whereIn('delivery_zone_id', $zones)->exists(),
            'menu' => CatalogueItem::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->where('status', 'published')
                ->exists(),
            'prices' => PriceList::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->where('status', 'active')
                ->exists(),
            'team' => OrganisationMembership::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->where('status', MembershipStatus::Active)
                ->count() > 1,
        ];

        return [
            'is_live' => ! $this->settings->for($organisationId)->not_open_yet,
            'steps' => array_map(
                static fn (string $key, bool $done): array => ['key' => $key, 'done' => $done, 'required' => $key !== 'team'],
                array_keys($steps),
                array_values($steps),
            ),
        ];
    }
}
