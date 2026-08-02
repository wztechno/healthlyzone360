<?php

declare(strict_types=1);

namespace Healthy360\Verification\Enums;

/**
 * What a passcode is being asked for.
 *
 * The vocabulary is the source journeys' own (appendix A) and is declared
 * complete rather than grown per phase: J1 issues only
 * `contact_verification`, but the other five are already valid values in the
 * table's CHECK constraint. A reserved value nobody issues is a word with no
 * caller; adding it later would be a migration on a table those phases would
 * otherwise only read.
 *
 * The purpose matters beyond bookkeeping. It scopes the one-live-challenge
 * index — verifying a phone and signing a B2B agreement are different acts and
 * must not supersede each other — and it is what a step-up consumer checks
 * before honouring a verification, so a code obtained for a harmless purpose
 * cannot be replayed against a dangerous one.
 */
enum OtpPurpose: string
{
    /** Proving a contact point belongs to the person claiming it. J1. */
    case ContactVerification = 'contact_verification';

    /** A guest proving their contact before an order is placed. G1. */
    case GuestOrder = 'guest_order';

    /** A guest proving their contact before their data is purged. G1. */
    case GuestDeletion = 'guest_deletion';

    /** Step-up before account closure. J2. */
    case ClosureStepUp = 'closure_step_up';

    /** Step-up before payment details are changed. PAY1. */
    case PaymentDetailsStepUp = 'payment_details_step_up';

    /** A signatory's click-wrap signature on a B2B agreement. B1. */
    case B2bSignatory = 'b2b_signatory';

    /**
     * Whether this purpose is issued by a phase that exists.
     *
     * `OtpService` refuses the rest rather than letting a caller quietly issue
     * a challenge for a journey nobody has built, which would produce a
     * verified step-up that no consumer knows how to honour.
     *
     * The list grows one phase at a time and only when the consumer lands with
     * it. G1 adds the two guest purposes because it is the phase that builds
     * their journeys: `GuestSessionService` issues `guest_order` to promote a
     * session to `place_order`, and `GuestDeletionService` issues
     * `guest_deletion` to prove an erasure request before anything is erased.
     *
     * The consumers are named in prose rather than through `@see`, because a
     * docblock reference to a Customers class is an import waiting to happen and
     * the dependency edge runs Customers → Verification, never the reverse.
     */
    public function isIssuable(): bool
    {
        return in_array($this, [
            self::ContactVerification,
            self::GuestOrder,
            self::GuestDeletion,
        ], true);
    }
}
