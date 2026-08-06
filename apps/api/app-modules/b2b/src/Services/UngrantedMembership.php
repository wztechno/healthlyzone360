<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use App\Models\User;
use Healthy360\B2b\Contracts\InvitationMembershipGranter;
use Healthy360\B2b\Models\OrganisationInvitation;

/**
 * The default `InvitationMembershipGranter`: grants nothing, and says so.
 *
 * The twin of `NoSellerOpenOrders` — a default that answers *not done* rather
 * than *done*, so a missing binding surfaces as a visible gap on the response
 * (`membership_created: false`) instead of a silent success. B2B on its own
 * genuinely cannot make this write; pretending otherwise would be the one
 * failure mode worth engineering against.
 */
final readonly class UngrantedMembership implements InvitationMembershipGranter
{
    public function grant(OrganisationInvitation $invitation, User $acceptor): ?string
    {
        return null;
    }
}
