<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Enums;

/**
 * How much of a person the platform is being asked to let go of.
 *
 * Two values, and they are not degrees of the same thing. `marketing_opt_out`
 * is a preference change: it withdraws the marketing consents, writes the
 * suppression that stops the next import re-adding the person, and touches
 * nothing else. `full` is an erasure: it revokes every credential, ends every
 * membership, and deletes every identifying row the platform holds.
 *
 * They live on one journey because they are one journey from the customer's
 * side — somebody who has decided to stop hearing from us is often deciding
 * whether to stop being a customer, and making them find two different screens
 * to say so is how a platform ends up with an opt-out nobody could find and a
 * closure nobody meant.
 *
 * The step-up requirement follows from the scope and from nothing else, which
 * is why it is a method here rather than a flag on the request: an opt-out that
 * demanded a passcode would be friction protecting nothing, and a closure that
 * did not would be an erasure anybody with a borrowed session could trigger.
 */
enum ClosureScope: string
{
    /** Stop the marketing. Immediate, reversible, deletes nothing. */
    case MarketingOptOut = 'marketing_opt_out';

    /** Forget me. Irreversible, step-up proven, and the reason this module exists. */
    case Full = 'full';

    /**
     * Whether a request of this scope must be proven with a passcode before it
     * takes effect.
     */
    public function requiresStepUp(): bool
    {
        return $this === self::Full;
    }

    /**
     * Whether a request of this scope must clear the blocker registry.
     *
     * Only a full closure. An open order is a reason not to erase somebody —
     * food is on its way to an address that is about to be scrubbed — and it is
     * emphatically not a reason to keep emailing them offers.
     */
    public function consultsBlockers(): bool
    {
        return $this === self::Full;
    }
}
