<?php

declare(strict_types=1);

namespace Healthy360\Verification\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;

/**
 * The cross-channel lockout that sits above the per-challenge attempt counter.
 *
 * The attempt counter alone is not a defence. Three wrong guesses burn a
 * challenge — and then the caller asks for a new one and gets three more. The
 * only thing bounding a guessing attack is a counter that survives the
 * challenge it was counting, which is what this is: five failures against a
 * *contact point*, across every channel and every challenge, and that contact
 * stops accepting codes for fifteen minutes.
 *
 * **Keyed on the contact, not on the challenge, the IP address or the
 * account.** The contact is what the attacker is attacking and the only key
 * they cannot rotate. An IP-keyed lockout is defeated by a proxy pool; an
 * account-keyed one misses the guest journey, which has no account until the
 * code is verified.
 *
 * **In the cache rather than on the row**, because the lock has to outlive
 * every challenge it applies to and because it must be cheap enough to consult
 * on a path already holding a row lock. The trade is stated rather than
 * hidden: a cache flush clears lockouts. That is acceptable for a
 * fifteen-minute rate control and would not be for anything durable — which is
 * why the per-challenge counter, the part that must survive a restart, lives
 * in the database.
 */
final class OtpLockout
{
    private const string PREFIX = 'h360:otp:lockout:';

    public function isLockedOut(string $contactPointId): bool
    {
        return $this->lockedUntil($contactPointId) !== null;
    }

    public function lockedUntil(string $contactPointId): ?CarbonImmutable
    {
        $until = Cache::get(self::PREFIX.'until:'.$contactPointId);

        if (! is_int($until)) {
            return null;
        }

        $moment = CarbonImmutable::createFromTimestamp($until);

        return $moment->isFuture() ? $moment : null;
    }

    /**
     * Count one failure, and lock the contact out if that was the last one
     * allowed.
     *
     * @return CarbonImmutable|null the moment the lock lifts, when this
     *                              failure caused one
     */
    public function recordFailure(string $contactPointId): ?CarbonImmutable
    {
        $threshold = max(1, (int) config('verification.otp.lockout_threshold', 5));
        $minutes = max(1, (int) config('verification.otp.lockout_minutes', 15));
        $key = self::PREFIX.'failures:'.$contactPointId;

        // The window is the lockout window: failures more than fifteen minutes
        // apart are not an attack, and a counter that never decayed would
        // eventually lock out somebody who mistypes once a month.
        $failures = (int) Cache::get($key, 0) + 1;
        Cache::put($key, $failures, now()->addMinutes($minutes));

        if ($failures < $threshold) {
            return null;
        }

        $until = now()->addMinutes($minutes);
        Cache::put(self::PREFIX.'until:'.$contactPointId, $until->getTimestamp(), $until);

        return CarbonImmutable::createFromTimestamp($until->getTimestamp());
    }

    /**
     * A successful verification clears the count. Somebody who proves they
     * hold the contact was never the attacker the counter was for.
     */
    public function clear(string $contactPointId): void
    {
        Cache::forget(self::PREFIX.'failures:'.$contactPointId);
        Cache::forget(self::PREFIX.'until:'.$contactPointId);
    }
}
