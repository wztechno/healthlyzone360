<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use Healthy360\B2b\Models\OrganisationInvitation;

/**
 * What acceptance actually did.
 *
 * `membershipCreated` is `false` for every acceptance B1 performs, and the
 * flag exists so that nothing downstream can mistake a validated token for a
 * provisioned user. The membership write lives in the provisioning transaction
 * the integrator wave owns; a result object that stayed quiet about the gap
 * would let a caller assume the person can now sign in.
 */
final readonly class AcceptedInvitation
{
    public function __construct(
        public OrganisationInvitation $invitation,
        public bool $membershipCreated,
    ) {}

    /**
     * Whether this acceptance still needs provisioning to finish the job.
     */
    public function acceptedWithoutMembership(): bool
    {
        return ! $this->membershipCreated;
    }
}
