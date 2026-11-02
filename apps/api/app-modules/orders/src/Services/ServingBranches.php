<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Organisations\Enums\BranchStatus;
use Healthy360\Organisations\Models\OrganisationBranch;

/**
 * Which branches could make this order — for the checks only.
 *
 * A customer basket usually names no branch, and "no branch" used to mean "ask
 * nothing": a kitchen closed all week took orders for the whole of it. The
 * answer is resolved in order of how specifically the order points at a kitchen:
 * the branch it names, the branch its delivery zone belongs to, and otherwise
 * every active branch of the organisation.
 *
 * **What this resolves is never written to the order.** `orders.branch_id` stays
 * exactly what the caller stated, because the kitchen display and the stock
 * deduction both read a null there as "organisation-wide".
 *
 * An empty answer is a kitchen with no active branch, which `OrderTimingRules`
 * refuses as `kitchen_closed`.
 */
final readonly class ServingBranches
{
    /**
     * @return list<string> the first is the one a refusal is reported from
     */
    public function for(string $organisationId, ?string $branchId, ?DeliveryZone $zone): array
    {
        if ($branchId !== null) {
            return [$branchId];
        }

        if ($zone instanceof DeliveryZone && $zone->branch_id !== null) {
            return [$zone->branch_id];
        }

        return OrganisationBranch::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('status', BranchStatus::Active->value)
            ->orderBy('created_at')
            ->orderBy('id')
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();
    }
}
