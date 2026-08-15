<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Results;

/**
 * The answer to "delete everything you hold about this address" — and it is the
 * same answer whether or not there is anything to delete.
 *
 * **Every field is derived from the request, never from the database.** That is
 * the whole design. `destinationMasked` is masked from the value the caller just
 * submitted, so it can be echoed back without a lookup having happened;
 * `expiresInSeconds` and `verificationRequired` come from configuration. There
 * is no challenge identifier and no "we sent you a code", because a nullable
 * identifier is a boolean in disguise and the boolean is "this address is known
 * to us" — the exact fact an unauthenticated erasure endpoint must not disclose.
 *
 * The consequence is that the client's script is identical in both cases: it
 * says a code will arrive if the address is known, and asks for it. An address
 * that is not known receives nothing, and every code entered against it fails
 * the same way a wrong code does.
 *
 * The result is always accepted — the HTTP layer renders it 202 — because the
 * alternative status codes all answer the question the 202 exists to refuse.
 */
final readonly class GuestDeletionAcknowledgement
{
    public function __construct(
        public string $destinationMasked,
        public bool $verificationRequired,
        public int $expiresInSeconds,
    ) {}

    /**
     * @return array{accepted: true, destination_masked: string, verification_required: bool, expires_in_seconds: int}
     */
    public function toArray(): array
    {
        return [
            'accepted' => true,
            'destination_masked' => $this->destinationMasked,
            'verification_required' => $this->verificationRequired,
            'expires_in_seconds' => $this->expiresInSeconds,
        ];
    }
}
