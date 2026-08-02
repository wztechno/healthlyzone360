<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

use Healthy360\Orders\Models\Order;
use Random\RandomException;
use RuntimeException;

/**
 * The number a customer quotes to a courier.
 *
 * The same construction `CustomerAccountNumbers` uses, and for the same
 * reasons: the primary key stays a UUIDv7, this is the human identifier, and
 * the two have different jobs. Crockford base 32 excludes `I`, `L`, `O` and
 * `U`, so nothing is read aloud ambiguously and nothing spells anything
 * unfortunate.
 *
 * **Random, not sequential**, which matters more here than it does for
 * accounts. A sequential order number tells every customer how many orders the
 * platform has taken — and, held twice a week apart, how fast it is growing.
 * That is commercially sensitive information printed on a receipt.
 *
 * Unique platform-wide rather than per kitchen, because support answers the
 * phone before it knows which kitchen is being asked about.
 */
final class OrderNumbers
{
    private const string ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    private const int LENGTH = 10;

    private const string PREFIX = 'ORD-';

    /**
     * Attempts before giving up. Reaching this is not a collision but a sign
     * the generator or the table is broken, so it fails loudly.
     */
    private const int MAX_ATTEMPTS = 5;

    /**
     * @throws RandomException
     */
    public function next(): string
    {
        for ($attempt = 0; $attempt < self::MAX_ATTEMPTS; $attempt++) {
            $candidate = self::PREFIX.$this->random();

            if (! Order::query()->where('order_number', $candidate)->exists()) {
                return $candidate;
            }
        }

        throw new RuntimeException('Could not allocate a unique order number.');
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
