<?php

declare(strict_types=1);

namespace Healthy360\Identity\Services;

use RuntimeException;

/**
 * The peppered digest `contact_points.value_hash` stores.
 *
 * **Why a hash at all.** Duplicate detection has to answer "has anybody
 * already proven this address" on every contact write. Doing that against
 * plaintext means an index over personal data — the thing most likely to end
 * up in a query plan, a slow-query log or a support screenshot. Hashing moves
 * the comparison off the plaintext without changing its result.
 *
 * **Why a pepper.** The value space of email addresses is not large in
 * practice: given a plain SHA-256 column and a list of addresses, anybody
 * holding a database dump can confirm membership in seconds. The pepper lives
 * in the environment, not in the database, so the dump alone proves nothing.
 *
 * **Why it falls back to APP_KEY outside production.** A developer's machine
 * and CI have no secret store, and a hasher that threw on a missing pepper
 * would make the whole module unrunnable there. Production is the opposite
 * case: a missing pepper means somebody deployed without configuring it, and
 * silently substituting a key that is already in the application's possession
 * would hide that permanently. So it throws — once, loudly, at the first
 * write.
 */
final class ContactValueHasher
{
    public function hash(string $normalised): string
    {
        return hash_hmac('sha256', $normalised, $this->pepper());
    }

    /**
     * Constant-time comparison, so a caller checking a candidate against a
     * stored digest cannot be timed.
     */
    public function matches(string $normalised, string $digest): bool
    {
        return hash_equals($digest, $this->hash($normalised));
    }

    private function pepper(): string
    {
        $pepper = config('verification.contact_pepper');

        if (is_string($pepper) && $pepper !== '') {
            return $pepper;
        }

        if (app()->isProduction()) {
            throw new RuntimeException('CONTACT_PEPPER is not configured. Contact hashing must not fall back to the application key in production.');
        }

        return 'contact:'.(string) config('app.key');
    }
}
