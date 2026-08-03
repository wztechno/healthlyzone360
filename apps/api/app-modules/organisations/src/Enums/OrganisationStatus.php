<?php

declare(strict_types=1);

namespace Healthy360\Organisations\Enums;

/**
 * `closed` is B2's addition and is not a synonym for `suspended`.
 *
 * A suspended organisation is one the platform has stopped from trading and
 * expects to hear from again — its members keep their memberships, and
 * reinstating it is a status change. A closed one has been offboarded: every
 * membership has ended, the agreement is terminated, and the legal entity row
 * survives only because company registration data is retained while the
 * personal data around it is purged. Nothing reopens a closed organisation;
 * a returning customer is a new application.
 */
enum OrganisationStatus: string
{
    case Active = 'active';
    case Suspended = 'suspended';
    case Pending = 'pending';
    case Closed = 'closed';

    /** Whether the organisation may still be traded with. */
    public function isTrading(): bool
    {
        return $this === self::Active;
    }
}
