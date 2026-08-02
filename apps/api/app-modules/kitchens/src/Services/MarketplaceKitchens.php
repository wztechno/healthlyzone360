<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Services;

use Healthy360\Delivery\Enums\DeliveryZoneStatus;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneArea;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Organisations\Enums\BranchStatus;
use Healthy360\Organisations\Enums\OrganisationStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\ReferenceData\Models\DeliveryArea;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Database\Eloquent\Builder;

/**
 * Which organisations are kitchens a customer can see, and everything hanging
 * off one.
 *
 * ## What makes a kitchen public
 *
 * Three conditions, all structural, all applied in SQL:
 *
 * 1. **Its type is `kitchen`.** A clinic is an organisation too.
 * 2. **Its own status is `active`.** A suspended kitchen disappears from the
 *    marketplace entirely — not greyed out, *absent*. Suspension is the
 *    platform withdrawing a tenant, and a listing that survived it would be the
 *    platform continuing to sell on behalf of somebody it has stopped.
 * 3. **It has at least one active branch.** A kitchen with no open location has
 *    no address, no operating week and therefore no calendar; listing it would
 *    offer food nobody can produce.
 *
 * ## On the tenant scope
 *
 * Every query runs `withoutTenancy()` and filters on the organisation
 * explicitly, for the reason `PriceResolver` already records: the caller has no
 * membership anywhere, so the ambient scope would throw or be the wrong tenant.
 *
 * `organisation_branches` **is** one of the row-level-security tables, so the
 * application-layer filter is not the only gate: under the runtime role the
 * policy needs `app.organisation_id` to be the kitchen being read. Every branch
 * read here therefore happens inside `DatabaseTenantContext::during()`, scoped
 * to that one kitchen and restored afterwards. This is the anonymous read the
 * pricing module's note anticipated — "an anonymous read still runs with
 * `app.organisation_id` set to the kitchen being browsed" — and it means a page
 * of ten kitchens sets the session ten times rather than reading ten kitchens'
 * branches under one scope, which is the point: there is no moment at which two
 * tenants' rows are inside the same policy window.
 */
final readonly class MarketplaceKitchens
{
    public function __construct(private DatabaseTenantContext $tenantContext) {}

    /**
     * The base query: every kitchen a customer may see, unordered.
     *
     * @return Builder<Organisation>
     */
    public function visible(): Builder
    {
        return Organisation::query()
            ->where('status', OrganisationStatus::Active->value)
            ->whereIn(
                'organisation_type_id',
                OrganisationType::query()->where('code', 'kitchen')->select('id'),
            )
            ->whereExists(
                fn ($query) => $query->from('organisation_branches')
                    ->whereColumn('organisation_branches.organisation_id', 'organisations.id')
                    ->where('organisation_branches.status', BranchStatus::Active->value),
            );
    }

    /**
     * Free-text over the kitchen's name. `ILIKE` rather than a search index:
     * the corpus is one row per tenant, and a search service for that would be
     * apparatus without a problem.
     *
     * @param  Builder<Organisation>  $query
     */
    public function whereNameMatches(Builder $query, string $term): void
    {
        $escaped = str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $term);

        $query->where('name', 'ilike', '%'.$escaped.'%');
    }

    /**
     * Kitchens that currently deliver to a named platform area.
     *
     * "Currently" is the whole content of the filter: only `active` zones
     * serve, so a kitchen that has suspended a zone stops appearing for that
     * area while keeping its claim on it — the reversibility `ZoneResolver`
     * documents, applied to discovery.
     *
     * The area is named by its platform `code` rather than its identifier: a
     * customer's client walked the public gazetteer, which publishes both, and
     * a code survives being written into a link.
     *
     * @param  Builder<Organisation>  $query
     */
    public function whereDeliversToArea(Builder $query, string $areaCode, ?string $countryCode): void
    {
        $areas = DeliveryArea::query()
            ->where('code', $areaCode)
            ->where('is_active', true)
            ->when($countryCode !== null, fn (Builder $scoped) => $scoped->where('country_code', $countryCode))
            ->select('id');

        $query->whereExists(
            fn ($existing) => $existing->from('delivery_zone_areas')
                ->join('delivery_zones', 'delivery_zones.id', '=', 'delivery_zone_areas.delivery_zone_id')
                ->whereColumn('delivery_zone_areas.organisation_id', 'organisations.id')
                ->whereIn('delivery_zone_areas.delivery_area_id', $areas)
                ->where('delivery_zones.status', DeliveryZoneStatus::Active->value),
        );
    }

    /**
     * Kitchens running at least one active channel of one of these kinds.
     *
     * @param  Builder<Organisation>  $query
     * @param  list<string>  $kinds
     */
    public function whereRunsChannelKind(Builder $query, array $kinds): void
    {
        if ($kinds === []) {
            // An empty set is not "no constraint": the caller asked for
            // kitchens on channels the platform has no kind for, and no
            // kitchen is on one.
            $query->whereRaw('false');

            return;
        }

        $query->whereExists(
            fn ($existing) => $existing->from('sales_channels')
                ->whereColumn('sales_channels.organisation_id', 'organisations.id')
                ->where('sales_channels.status', 'active')
                ->whereIn('sales_channels.channel_kind', $kinds),
        );
    }

    /**
     * One kitchen's active branches, read under its own database scope.
     *
     * @return list<OrganisationBranch>
     */
    public function branchesOf(Organisation $kitchen): array
    {
        return $this->tenantContext->during(null, (string) $kitchen->getKey(), null, function () use ($kitchen): array {
            return array_values(OrganisationBranch::withoutTenancy()
                ->where('organisation_id', $kitchen->getKey())
                ->where('status', BranchStatus::Active->value)
                ->orderBy('created_at')
                ->orderBy('id')
                ->get()
                ->all());
        });
    }

    /**
     * The configured operating days of the given branches.
     *
     * @param  list<OrganisationBranch>  $branches
     * @return list<BranchOpeningHour>
     */
    public function openingHoursOf(Organisation $kitchen, array $branches): array
    {
        if ($branches === []) {
            return [];
        }

        $branchIds = array_map(static fn (OrganisationBranch $branch): string => (string) $branch->getKey(), $branches);

        return array_values(BranchOpeningHour::withoutTenancy()
            ->where('organisation_id', $kitchen->getKey())
            ->whereIn('branch_id', $branchIds)
            ->orderBy('branch_id')
            ->orderBy('weekday')
            ->get()
            ->all());
    }

    /**
     * The active delivery zones that apply to each branch, keyed by branch.
     *
     * A zone with no branch is the organisation's default map and therefore
     * applies to **every** branch; a branch-scoped zone applies only to its
     * own. Both are listed against a branch here rather than resolved against
     * each other, because `ZoneResolver`'s precedence answers a different
     * question — "which zone serves this address" — and a customer reading a
     * kitchen's page is entitled to see the whole map, not the winner of a
     * lookup they have not made yet.
     *
     * @param  list<OrganisationBranch>  $branches
     * @return array<string, list<array{zone: DeliveryZone, areas: list<DeliveryArea>}>>
     */
    public function deliveryZonesOf(Organisation $kitchen, array $branches): array
    {
        if ($branches === []) {
            return [];
        }

        $zones = DeliveryZone::withoutTenancy()
            ->where('organisation_id', $kitchen->getKey())
            ->where('status', DeliveryZoneStatus::Active->value)
            ->orderBy('created_at')
            ->orderBy('id')
            ->get();

        if ($zones->isEmpty()) {
            return [];
        }

        $claims = DeliveryZoneArea::withoutTenancy()
            ->where('organisation_id', $kitchen->getKey())
            ->whereIn('delivery_zone_id', $zones->modelKeys())
            ->get();

        $areas = DeliveryArea::query()
            ->whereIn('id', $claims->pluck('delivery_area_id')->unique()->all())
            ->where('is_active', true)
            ->orderBy('display_order')
            ->orderBy('code')
            ->get()
            ->keyBy(static fn (DeliveryArea $area): string => (string) $area->getKey());

        /** @var array<string, list<DeliveryArea>> $areasByZone */
        $areasByZone = [];

        foreach ($areas as $area) {
            foreach ($claims as $claim) {
                if ($claim->delivery_area_id === (string) $area->getKey()) {
                    $areasByZone[$claim->delivery_zone_id][] = $area;
                }
            }
        }

        $byBranch = [];

        foreach ($branches as $branch) {
            $branchId = (string) $branch->getKey();
            $byBranch[$branchId] = [];

            foreach ($zones as $zone) {
                if ($zone->branch_id !== null && $zone->branch_id !== $branchId) {
                    continue;
                }

                $byBranch[$branchId][] = [
                    'zone' => $zone,
                    'areas' => $areasByZone[(string) $zone->getKey()] ?? [],
                ];
            }
        }

        return $byBranch;
    }
}
