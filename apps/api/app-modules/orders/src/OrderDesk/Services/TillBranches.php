<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Services;

use Healthy360\Organisations\Enums\BranchStatus;
use Healthy360\Organisations\Models\OrganisationBranch;

/**
 * Which branch's till a sum of cash belongs to. One till per branch.
 *
 * Cash belongs to the branch of its order: the branch the order names, else the
 * branch its delivery zone belongs to, else the kitchen's first branch, the
 * oldest active one, as `ServingBranches` orders them. The same first branch takes
 * the hand-ins and closes written before tills were per branch, whose branch is
 * null. A kitchen with no branch at all has one till, with a null branch.
 *
 * A hand-in carries its branch, written when it settles, because one hand-in
 * covers one branch's runs.
 */
final readonly class TillBranches
{
    /**
     * The till branch of an order aliased `$orders`. Binds the first branch.
     */
    public static function ofOrder(string $orders = 'orders'): string
    {
        return "coalesce({$orders}.branch_id, (select zones.branch_id from delivery_zones as zones where zones.id = {$orders}.delivery_zone_id), cast(? as uuid))";
    }

    /**
     * Whether the order behind `$orderIdColumn` belongs to a till. Binds the first
     * branch, then the till's branch.
     */
    public static function orderIn(string $orderIdColumn): string
    {
        return '(select '.self::ofOrder('till_orders')." from orders as till_orders where till_orders.id = {$orderIdColumn}) is not distinct from cast(? as uuid)";
    }

    /**
     * Whether a row with its own nullable `branch_id` belongs to a till. Binds the
     * first branch, then the till's branch.
     */
    public static function rowIn(string $branchColumn): string
    {
        return "coalesce({$branchColumn}, cast(? as uuid)) is not distinct from cast(? as uuid)";
    }

    /**
     * The kitchen's first branch: the oldest active one, else the oldest of any.
     */
    public function first(string $organisationId): ?string
    {
        return $this->all($organisationId)[0]['id'] ?? null;
    }

    /**
     * Every branch, which is every till, the first one first. A closed branch
     * stays a till, so cash left in it can still be closed.
     *
     * @return list<array{id: string, name: string}>
     */
    public function all(string $organisationId): array
    {
        return OrganisationBranch::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->orderByRaw('case when status = ? then 0 else 1 end', [BranchStatus::Active->value])
            ->orderBy('created_at')
            ->orderBy('id')
            ->get(['id', 'name'])
            ->map(static fn (OrganisationBranch $branch): array => ['id' => (string) $branch->getKey(), 'name' => $branch->name])
            ->values()
            ->all();
    }
}
