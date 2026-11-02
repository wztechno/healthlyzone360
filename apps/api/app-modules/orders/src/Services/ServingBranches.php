<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Orders\Models\Order;
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
 * An empty answer is a kitchen with no active branch, or a named branch that has
 * closed, which `OrderTimingRules` refuses as `kitchen_closed`.
 */
final readonly class ServingBranches
{
    /**
     * @return list<string> the first is the one a refusal is reported from
     */
    public function for(string $organisationId, ?string $branchId, ?DeliveryZone $zone): array
    {
        return $this->among($this->activeBranches($organisationId), $branchId ?? $zone?->branch_id);
    }

    /**
     * The same answer for a whole list, in one statement rather than one per order.
     * Each order's `deliveryZone` should be eager-loaded.
     *
     * @param  iterable<array-key, Order>  $orders
     * @return array<string, list<string>> keyed by order id
     */
    public function forOrders(string $organisationId, iterable $orders): array
    {
        $active = $this->activeBranches($organisationId);
        $serving = [];

        foreach ($orders as $order) {
            $serving[(string) $order->getKey()] = $this->among($active, $order->branch_id ?? $order->deliveryZone?->branch_id);
        }

        return $serving;
    }

    /**
     * @param  list<string>  $active
     * @return list<string>
     */
    private function among(array $active, ?string $named): array
    {
        return $named === null ? $active : array_values(array_intersect($active, [$named]));
    }

    /**
     * @return list<string>
     */
    private function activeBranches(string $organisationId): array
    {
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
