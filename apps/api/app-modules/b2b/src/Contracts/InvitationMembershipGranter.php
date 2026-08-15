<?php

declare(strict_types=1);

namespace Healthy360\B2b\Contracts;

use App\Models\User;
use Healthy360\B2b\Models\OrganisationInvitation;

/**
 * Turn an accepted invitation into a membership — the write B1 deliberately
 * did not make.
 *
 * `InvitationService` has been able to prove an invitation valid since B1, and
 * has been unable to act on that proof for exactly as long. The gap was not an
 * oversight: creating a membership means writing `organisation_memberships`
 * and `membership_roles`, which belong to Organisations and AccessControl, and
 * both of those modules sit *below* B2B in the dependency graph. A direct call
 * would have run the edge backwards.
 *
 * So this is a port, published by the module that owns the invitation and
 * implemented by the module that owns tenant lifecycle — the same arrangement
 * `SellerOpenOrders` uses, and for the same reason.
 *
 * **The default binding refuses rather than pretends.** `UngrantedMembership`
 * answers `null`, and `InvitationService::accept()` reports
 * `membership_created: false` exactly as it has since B1. An implementation
 * that quietly returned success when nothing was bound would let a client show
 * somebody a workspace they cannot enter.
 */
interface InvitationMembershipGranter
{
    /**
     * Grant the membership an accepted invitation promises.
     *
     * Idempotent by contract: accepting is single-use, but a retry that lost
     * its response must not produce a second membership or a duplicate role
     * assignment.
     *
     * @return string|null the membership identifier, or null when nothing was
     *                     granted — an unresolvable role, or no implementation
     *                     bound at all
     */
    public function grant(OrganisationInvitation $invitation, User $acceptor): ?string;
}
