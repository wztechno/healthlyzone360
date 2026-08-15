<?php

declare(strict_types=1);

namespace Healthy360\Customers\Contracts;

/**
 * "Does anybody deliver here?"
 *
 * A port rather than a direct call into the delivery module, for the reason
 * the recipe/catalogue ports exist: this module needs one bit of information
 * from a neighbour and must not acquire the neighbour's whole vocabulary to
 * get it. Customers has no business knowing what a delivery zone is, that
 * zones can be branch-scoped, or that a suspended zone does not fall back to
 * the organisation-wide map — it needs to know whether an address the customer
 * is about to save can be delivered to.
 *
 * The implementation (`DeliveryZoneAreaService`) delegates to `ZoneResolver`,
 * which is the single place that rule lives. Two implementations of a delivery
 * precedence would be two precedences; this port is what keeps the second one
 * from being written here.
 */
interface AreaServiceLookup
{
    /**
     * Whether any active zone currently claims this area.
     *
     * Deliberately asked without a branch. A customer saving an address does
     * not know which kitchen or which branch will eventually cook for them,
     * and answering "no" because *this* branch does not deliver would refuse
     * an address that half the platform serves. The narrower, branch-aware
     * question is C1's, at checkout, when the kitchen is known.
     *
     * @param  string  $areaId  a `delivery_areas` identifier
     */
    public function isServed(string $areaId): bool;

    /**
     * The organisations with an active zone over this area.
     *
     * Used to explain a refusal ("no kitchen delivers to this area yet")
     * rather than to make one, and by the account checklist to say whether a
     * saved address is orderable today.
     *
     * @return list<string>
     */
    public function servingOrganisationIds(string $areaId): array;
}
