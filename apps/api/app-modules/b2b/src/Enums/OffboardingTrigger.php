<?php

declare(strict_types=1);

namespace Healthy360\B2b\Enums;

/**
 * Why a corporate relationship is ending.
 *
 * B1 left `b2b_offboardings.reason` a free string and said in the migration
 * that the vocabulary was "a product decision, not a schema one". It is now a
 * decision: four values, and the distinction between them is not bookkeeping.
 *
 * `contract_end` and `non_renewal` both arrive at the agreement's `ends_on`,
 * and they are not the same event — one is a term running out as everybody
 * expected, the other is somebody declining to extend. `termination` is a
 * platform decision and `client_request` is the buyer's; conflating those two
 * would make it impossible to answer "how many corporate customers did we
 * lose last quarter" without reading notes.
 *
 * The reason a company *gives* is `reason_note`, which stays free text. This
 * enum is what the platform can count.
 */
enum OffboardingTrigger: string
{
    /** The agreement's term ran out. */
    case ContractEnd = 'contract_end';

    /** The platform ended the relationship. */
    case Termination = 'termination';

    /** A term that could have been extended was not. */
    case NonRenewal = 'non_renewal';

    /** The buyer asked to leave. */
    case ClientRequest = 'client_request';

    /**
     * Whether the buyer, rather than the platform, initiated this.
     *
     * Used where the wording of a notice differs — nobody should be told
     * "as you requested" about a termination.
     */
    public function isBuyerInitiated(): bool
    {
        return $this === self::ClientRequest || $this === self::NonRenewal;
    }
}
