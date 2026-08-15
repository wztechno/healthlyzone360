<?php

declare(strict_types=1);

namespace Healthy360\Verification\Presenters;

use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Verification\Models\OtpChallenge;

/**
 * The wire shapes of the passcode surface — the two that are not already
 * authored elsewhere.
 *
 * There is deliberately **no method for an issued challenge**. That shape is
 * `OtpChallengeResult::toArray()`, which lives beside the fields it serialises
 * so the two cannot drift while they are apart; a presenter method that rebuilt
 * it would be a second copy of a contract the journey forced, and the first
 * time somebody added a field to one of them the countdown on the resend button
 * would start disagreeing with the cooldown that governs it.
 *
 * **No code, ever, on any shape here.** The plaintext exists in memory between
 * generation and delivery and nowhere else; every field below is drawn from
 * columns that survive the request, and none of those columns is the code.
 * `destination_masked` is server-authored and is carried through rather than
 * recomputed — a mask the client could derive would mean the value was handed
 * over.
 */
final class VerificationPresenter
{
    /**
     * A challenge's state, for the screen that has to render a countdown.
     *
     * `is_live` is carried alongside `status` rather than left to the client to
     * infer, because expiry is a moment and not an event: a row stays `pending`
     * past its window until something writes the transition, so a client
     * branching on the column alone would offer an attempt that cannot succeed.
     *
     * @return array{
     *     challenge_id: string,
     *     purpose: string,
     *     channel: string,
     *     destination_masked: string,
     *     status: string,
     *     is_live: bool,
     *     attempts_remaining: int,
     *     resends_remaining: int,
     *     expires_at: string,
     *     resend_available_at: string|null,
     *     last_sent_at: string|null,
     *     verified_at: string|null
     * }
     */
    public function challenge(OtpChallenge $challenge): array
    {
        return [
            'challenge_id' => (string) $challenge->getKey(),
            'purpose' => $challenge->purpose->value,
            'channel' => $challenge->channel->value,
            'destination_masked' => $challenge->destination_masked,
            'status' => $challenge->status->value,
            'is_live' => $challenge->isLive(),
            'attempts_remaining' => $challenge->attemptsRemaining(),
            'resends_remaining' => $challenge->resendsRemaining(),
            'expires_at' => $challenge->expires_at->toIso8601String(),
            'resend_available_at' => $challenge->resend_available_at?->toIso8601String(),
            'last_sent_at' => $challenge->last_sent_at?->toIso8601String(),
            'verified_at' => $challenge->verified_at?->toIso8601String(),
        ];
    }

    /**
     * The destination a passcode has just proven.
     *
     * The mask is taken from the challenge rather than recomputed from the
     * contact: the challenge recorded what the person was shown when the code
     * was sent, and answering with anything else would tell them a code went
     * somewhere it did not.
     *
     * @return array{
     *     id: string,
     *     channel: string,
     *     destination_masked: string,
     *     is_primary: bool,
     *     is_login_identity: bool,
     *     verified_at: string|null
     * }
     */
    public function verifiedContact(ContactPoint $contact, OtpChallenge $challenge): array
    {
        return [
            'id' => (string) $contact->getKey(),
            'channel' => $contact->channel->value,
            'destination_masked' => $challenge->destination_masked,
            'is_primary' => $contact->is_primary,
            'is_login_identity' => $contact->is_login_identity,
            'verified_at' => $contact->verified_at?->toIso8601String(),
        ];
    }
}
