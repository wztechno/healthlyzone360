<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use Healthy360\B2b\Models\OrganisationInvitation;

/**
 * What acceptance actually did.
 *
 * `membershipCreated` was `false` for every acceptance B1 performed, and the
 * flag existed so that nothing downstream could mistake a validated token for
 * a provisioned user. PA1 bound `InvitationMembershipGranter` to a real
 * implementation, so the flag now varies — and the reason to keep it is
 * unchanged: with no implementation bound, or with a role code that resolves
 * to no role, acceptance still stamps the row and grants nothing, and a caller
 * that assumed otherwise would show somebody a workspace they cannot enter.
 */
final readonly class AcceptedInvitation
{
    public function __construct(
        public OrganisationInvitation $invitation,
        public bool $membershipCreated,
        public ?string $membershipId = null,
    ) {}

    /**
     * Whether this acceptance still needs provisioning to finish the job.
     */
    public function acceptedWithoutMembership(): bool
    {
        return ! $this->membershipCreated;
    }
}
