<?php

declare(strict_types=1);

namespace Healthy360\Customers\Services;

use Healthy360\Customers\Models\CustomerAccount;
use Random\RandomException;
use RuntimeException;

/**
 * The number a person reads down a phone line.
 *
 * The primary key is a UUIDv7 and stays that way; this is the *human*
 * identifier, and the two have different jobs. A UUID cannot be dictated,
 * transcribed or checked by eye, and support conversations start with somebody
 * reading an identifier aloud.
 *
 * **Crockford base 32**, which is the whole reason not to use digits. The
 * alphabet excludes `I`, `L`, `O` and `U` — the first three because they are
 * indistinguishable from `1` and `0` in most fonts and in most handwriting,
 * the fourth because excluding it makes accidental obscenities very unlikely.
 *
 * **Random, not sequential.** A sequential number tells anybody holding one
 * how many customers exist and lets them guess their neighbours', which is a
 * business disclosure and an enumeration vector at once. Ten characters of
 * base 32 is about 50 bits, so collisions are vanishingly rare — and the loop
 * still checks, because "vanishingly rare" over a long enough time is
 * "eventually", and the failure mode would be a unique-violation on a customer
 * signing up.
 */
final class CustomerAccountNumbers
{
    private const string ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    private const int LENGTH = 10;

    private const string PREFIX = 'H360-';

    /**
     * Attempts before giving up. Reaching this is not a collision — it is a
     * sign the generator or the table is broken — so it fails loudly rather
     * than looping forever.
     */
    private const int MAX_ATTEMPTS = 5;

    /**
     * @throws RandomException
     */
    public function next(): string
    {
        for ($attempt = 0; $attempt < self::MAX_ATTEMPTS; $attempt++) {
            $candidate = self::PREFIX.$this->random();

            $taken = CustomerAccount::query()->where('account_number', $candidate)->exists();

            if (! $taken) {
                return $candidate;
            }
        }

        throw new RuntimeException('Could not allocate a unique customer account number.');
    }

    /**
     * @throws RandomException
     */
    private function random(): string
    {
        $characters = '';

        for ($index = 0; $index < self::LENGTH; $index++) {
            $characters .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
        }

        return $characters;
    }
}
