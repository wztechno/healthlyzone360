<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Results;

use Healthy360\Customers\Guest\Models\GuestSession;
use Healthy360\Verification\Results\OtpChallengeResult;

/**
 * A guest has been sent a passcode to prove a contact point.
 *
 * A thin pairing rather than a new shape: `OtpChallengeResult` already carries
 * everything the client needs to render the code entry screen (masked
 * destination, expiry, attempts and resends remaining, which channels are real),
 * and re-describing it here would be two vocabularies for one screen. What the
 * guest journey adds is *which session this proof will promote*, which the OTP
 * framework has no reason to know.
 *
 * Unlike the deletion path, this result may safely say a challenge exists: the
 * caller already holds a live guest token and supplied the destination
 * themselves, so there is no fact here they did not bring with them.
 */
final readonly class GuestContactChallenge
{
    public function __construct(
        public GuestSession $session,
        public OtpChallengeResult $challenge,
    ) {}
}
