<?php

declare(strict_types=1);

namespace Healthy360\Verification\Services;

use Random\RandomException;
use RuntimeException;

/**
 * Generates passcodes and turns them into the digest the table stores.
 *
 * **`random_int`, not `rand` or `mt_rand`.** A passcode is a credential, and a
 * predictable one is no credential at all — the whole framework's guarantee
 * reduces to whether an attacker can guess the next code from the last one.
 *
 * **Leading zeros are preserved.** `str_pad` rather than a range starting at
 * 100000, because excluding codes that begin with a zero throws away ten per
 * cent of the keyspace and tells an attacker so.
 *
 * **HMAC under a pepper, not bcrypt.** Six digits is a keyspace of one
 * million, which a password hash's work factor cannot save: an attacker with
 * the table brute-forces a bcrypt digest of a six-digit code in minutes and a
 * SHA-256 in milliseconds. What actually protects it is a key that is not in
 * the table — so the digest is an HMAC under `verification.otp.pepper`, and a
 * database dump alone reveals nothing. The work factor would only slow down
 * the legitimate verification path.
 *
 * Outside production the pepper falls back to `APP_KEY` so a fresh checkout
 * runs; in production its absence is a deployment error and this class says so
 * rather than quietly reducing the guarantee to "we hashed it".
 */
final class OtpCodeHasher
{
    /**
     * A fresh passcode as a decimal string of the configured length.
     *
     * @throws RandomException
     */
    public function generate(): string
    {
        $length = max(4, (int) config('verification.otp.length', 6));
        $max = (10 ** $length) - 1;

        return str_pad((string) random_int(0, $max), $length, '0', STR_PAD_LEFT);
    }

    public function hash(string $code): string
    {
        return hash_hmac('sha256', $code, $this->pepper());
    }

    /**
     * Constant-time comparison. A non-constant-time compare on a six-digit
     * secret is a genuinely practical oracle — the search space is small
     * enough that per-character timing narrows it fast.
     */
    public function matches(string $candidate, string $digest): bool
    {
        return hash_equals($digest, $this->hash($candidate));
    }

    private function pepper(): string
    {
        $pepper = config('verification.otp.pepper');

        if (is_string($pepper) && $pepper !== '') {
            return $pepper;
        }

        if (app()->isProduction()) {
            throw new RuntimeException('OTP_PEPPER is not configured. Passcode hashing must not fall back to the application key in production.');
        }

        return 'otp:'.(string) config('app.key');
    }
}
