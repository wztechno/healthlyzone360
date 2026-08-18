<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Orders\Services\OrderNumbers;
use Healthy360\Procurement\Models\PurchaseOrder;
use Random\RandomException;
use RuntimeException;

/**
 * The number a kitchen and its supplier quote at each other.
 *
 * The same construction {@see OrderNumbers} uses, and
 * for the same reasons: the primary key stays a UUIDv7, this is the human
 * identifier, and the two have different jobs. Crockford base 32 excludes `I`,
 * `L`, `O` and `U`, so nothing is read aloud ambiguously down a phone line and
 * nothing spells anything unfortunate.
 *
 * **Random, not sequential**, and here the argument is commercial rather than
 * merely tidy. `PO-000041` handed to a supplier in March and `PO-000068` handed
 * to the same supplier in April tells them exactly how many orders this kitchen
 * placed in between — with everybody, not just with them. That is purchasing
 * volume, and it is printed on a document the counterparty keeps. A random
 * number says nothing at all.
 *
 * Eight characters rather than an order number's ten: the collision space is
 * 32^8 ≈ 1.1 × 10^12 **per organisation** (the uniqueness is scoped to the
 * kitchen, unlike a customer-facing order number's platform-wide uniqueness),
 * against a book that grows by a few thousand rows a year. Shorter is better
 * where a human transcribes it onto a delivery note by hand.
 *
 * The `exists()` pre-check is an optimisation, never the guarantee. The
 * guarantee is `UNIQUE(organisation_id, number)` in the database, and
 * {@see PurchaseOrderService} is built around the 23505 that index raises: a
 * check and a write with a gap between them is a race two concurrent batches
 * would lose, and only the database can answer "is this taken" at the instant of
 * the write.
 *
 * **Not `final`, unlike its sibling `OrderNumbers`**, and the reason is that
 * race. The savepoint-and-re-mint loop in {@see PurchaseOrderService} is the
 * most consequential few lines in the batch write and the least reachable by
 * ordinary means — a genuine collision is a one-in-a-trillion event nobody can
 * arrange. A subclass that hands back a number already taken is how the
 * recovery gets exercised, and an untestable retry is an untested retry.
 */
class PurchaseOrderNumbers
{
    private const string ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    private const int LENGTH = 8;

    private const string PREFIX = 'PO-';

    /**
     * Attempts before giving up. Reaching this is not a collision but a sign
     * the generator or the table is broken, so it fails loudly.
     */
    private const int MAX_ATTEMPTS = 5;

    /**
     * A number free within this organisation, as far as a read can tell.
     *
     * Scoped explicitly rather than through the tenant global scope: this is
     * called from inside a batch write that already knows which kitchen it is
     * writing for, and `withoutGlobalScopes()` makes the uniqueness question
     * match the index exactly — `(organisation_id, number)`, both halves stated.
     *
     * @throws RandomException
     */
    public function next(string $organisationId): string
    {
        for ($attempt = 0; $attempt < self::MAX_ATTEMPTS; $attempt++) {
            $candidate = self::PREFIX.$this->random();

            $taken = PurchaseOrder::query()
                ->withoutGlobalScopes()
                ->where('organisation_id', $organisationId)
                ->where('number', $candidate)
                ->exists();

            if (! $taken) {
                return $candidate;
            }
        }

        throw new RuntimeException('Could not allocate a unique purchase order number.');
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
