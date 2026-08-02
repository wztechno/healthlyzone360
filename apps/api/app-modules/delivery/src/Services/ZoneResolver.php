<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Services;

use Healthy360\Delivery\Enums\DeliveryZoneStatus;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Delivery\Models\DeliveryZoneArea;

/**
 * The one place that answers "which of this kitchen's zones serves this
 * place?".
 *
 * It exists because the schema deliberately allows two zones to claim the same
 * area — an organisation-wide one and a branch-scoped one — and a precedence
 * that lives in two implementations is two precedences. J1's address
 * validation, C1's checkout quote and the admin surface all call this rather
 * than re-deriving the rule from the unique index.
 *
 * ## The rule
 *
 * **The more specific claim wins: a branch-scoped zone beats the
 * organisation-wide one.** A kitchen states a default map once, and one
 * location says "we also go there, but it costs more from here". The reverse
 * precedence would make a branch override unreachable, which would make the
 * branch column decorative.
 *
 * **With no branch in context, only the organisation-wide map is consulted.**
 * A quote given without knowing where the food comes from must not silently
 * pick one branch's terms; the honest answer is the organisation's own
 * statement, or none.
 *
 * **Only `active` zones serve.** An `inactive` zone keeps its area claims —
 * that is what makes a suspension reversible — but it does not deliver, so it
 * is not an answer. Crucially, a suspended branch zone does **not** fall back
 * to the organisation-wide zone underneath it: "we are not crossing the
 * mountain this week" is a statement about that area, and quietly serving it
 * from the default map at the default price would be the system overruling the
 * person who suspended it. The resolver returns the suspended zone's absence,
 * and `explain()` says which zone made that decision so a caller can tell "we
 * do not go there" from "we have paused going there".
 *
 * The queries are keyed on `(organisation_id, delivery_area_id)`, which the
 * table indexes, so both branches of the lookup are a single index probe.
 */
final class ZoneResolver
{
    /**
     * The zone that would serve this area, or null if none does.
     *
     * @param  string  $areaId  a `delivery_areas` identifier
     * @param  string|null  $branchId  the branch the order would be produced at
     */
    public function zoneFor(string $areaId, ?string $branchId = null): ?DeliveryZone
    {
        $claim = $this->claimFor($areaId, $branchId);

        if ($claim === null) {
            return null;
        }

        $zone = $claim->zone()->first();

        return $zone instanceof DeliveryZone && $zone->status->isServing() ? $zone : null;
    }

    /**
     * The same lookup, with the reasoning attached — for the surfaces that
     * have to explain a refusal rather than merely make one.
     *
     * `scope` says which claim won (`branch`, `organisation` or none);
     * `status` carries the winning zone's state even when it does not serve,
     * so "we have paused deliveries here" is distinguishable from "we have
     * never delivered here".
     *
     * @return array{zone: DeliveryZone|null, scope: 'branch'|'organisation'|null, status: string|null, serves: bool}
     */
    public function explain(string $areaId, ?string $branchId = null): array
    {
        $claim = $this->claimFor($areaId, $branchId);

        if ($claim === null) {
            return ['zone' => null, 'scope' => null, 'status' => null, 'serves' => false];
        }

        $zone = $claim->zone()->first();

        if (! $zone instanceof DeliveryZone) {
            return ['zone' => null, 'scope' => null, 'status' => null, 'serves' => false];
        }

        return [
            'zone' => $zone,
            'scope' => $claim->branch_id === null ? 'organisation' : 'branch',
            'status' => $zone->status->value,
            'serves' => $zone->status->isServing(),
        ];
    }

    /**
     * Every area this zone currently claims, as platform area identifiers.
     *
     * @return list<string>
     */
    public function areaIdsOf(DeliveryZone $zone): array
    {
        /** @var list<string> $ids */
        $ids = DeliveryZoneArea::query()
            ->where('delivery_zone_id', $zone->getKey())
            ->orderBy('delivery_area_id')
            ->pluck('delivery_area_id')
            ->all();

        return $ids;
    }

    /**
     * The winning claim: the branch's if there is one, otherwise the
     * organisation-wide one. Two probes rather than one ordered query,
     * because "branch beats org-wide" is a rule and `ORDER BY branch_id NULLS
     * LAST` is a coincidence of how NULLs sort.
     */
    private function claimFor(string $areaId, ?string $branchId): ?DeliveryZoneArea
    {
        if ($branchId !== null) {
            $branchClaim = DeliveryZoneArea::query()
                ->where('delivery_area_id', $areaId)
                ->where('branch_id', $branchId)
                ->first();

            if ($branchClaim instanceof DeliveryZoneArea) {
                return $branchClaim;
            }
        }

        $organisationClaim = DeliveryZoneArea::query()
            ->where('delivery_area_id', $areaId)
            ->whereNull('branch_id')
            ->first();

        return $organisationClaim instanceof DeliveryZoneArea ? $organisationClaim : null;
    }

    /**
     * Whether a zone in this state can be an answer at all — exposed so a
     * caller reading `explain()` does not have to re-import the enum to make
     * the same judgement.
     */
    public function serves(DeliveryZoneStatus $status): bool
    {
        return $status->isServing();
    }
}
