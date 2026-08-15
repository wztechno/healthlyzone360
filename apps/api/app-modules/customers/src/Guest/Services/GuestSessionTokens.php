<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Services;

use Random\RandomException;

/**
 * Minting, hashing and comparing the opaque guest token.
 *
 * Small enough to have been three lines inside `GuestSessionService`, separate
 * because it is the one place the credential's security properties live and
 * they should be readable in one screen:
 *
 * **48 bytes from the CSPRNG, base64url-encoded.** 384 bits. `random_bytes()`
 * rather than anything seeded, and base64url rather than base64 so the token
 * survives a URL, a header and a cookie without escaping — a credential that
 * needs encoding somewhere along the way is a credential that will eventually be
 * compared in its encoded form on one side and its decoded form on the other.
 *
 * **Stored as a plain SHA-256, and that is not an oversight.** The neighbouring
 * `ContactValueHasher` peppers its digests because email addresses come from a
 * small, guessable space; a dump of unpeppered digests would be a membership
 * oracle. Nothing analogous applies to 384 random bits — there is no dictionary
 * to run — and peppering would tie every live session to a secret whose rotation
 * would sign every guest out mid-checkout. The right defence for this input is
 * entropy, and it is already present.
 *
 * **`matches()` is constant-time.** Lookup is by digest, so the interesting
 * comparison happens inside PostgreSQL's index and not here; `hash_equals` is
 * for the caller that has already fetched a row and wants to confirm it, and it
 * exists so no call site is tempted to write `===` on a credential.
 */
final class GuestSessionTokens
{
    /**
     * A fresh token. The plaintext is returned once and never stored.
     *
     * @throws RandomException
     */
    public function mint(): string
    {
        $bytes = random_bytes($this->entropyBytes());

        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    /**
     * The digest `guest_sessions.token_hash` holds.
     */
    public function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    public function matches(string $token, string $digest): bool
    {
        return hash_equals($digest, $this->hash($token));
    }

    /**
     * Below 32 bytes a bearer token stops being a secret and starts being a
     * guess, so the floor is enforced rather than documented.
     *
     * @return int<32, max>
     */
    private function entropyBytes(): int
    {
        $configured = (int) config('guest.token.entropy_bytes', 48);

        return $configured < 32 ? 32 : $configured;
    }
}
