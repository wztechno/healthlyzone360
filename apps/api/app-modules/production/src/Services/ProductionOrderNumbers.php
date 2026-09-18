<?php

declare(strict_types=1);

namespace Healthy360\Production\Services;

use Healthy360\Procurement\Services\PurchaseOrderNumbers;
use Healthy360\Production\Models\ProductionOrder;
use Random\RandomException;
use RuntimeException;

/**
 * The reference a kitchen quotes at itself about one batch (PROD1).
 *
 * The same construction {@see PurchaseOrderNumbers}
 * uses: Crockford base 32, which excludes `I`, `L`, `O` and `U`, so nothing is
 * read aloud ambiguously across a kitchen and nothing spells anything
 * unfortunate. The primary key stays a UUIDv7; this is the human identifier, and
 * the two have different jobs.
 *
 * **Random rather than sequential**, but not for the purchase order's reason — a
 * batch number goes to nobody outside the kitchen, so there is no purchasing
 * volume to leak. It is random because a sequential one needs a counter, and a
 * counter needs a lock on a row that every confirm in the kitchen contends for.
 * Eight random characters need neither, and the uniqueness that matters is
 * guaranteed by `UNIQUE(organisation_id, reference)` rather than by the
 * generator.
 *
 * **This is not the number on the label.** `production_orders.batch_reference` is
 * what the cook writes on the tray, in whatever scheme the kitchen already uses,
 * and the two are deliberately separate: a system reference nobody chose and a
 * label reference nobody should have to ask a system for.
 *
 * The `exists()` pre-check is an optimisation and never the guarantee, for the
 * reason its sibling gives: a check and a write with a gap between them is a race
 * that two concurrent confirms would lose, and only the index can answer "is this
 * taken" at the instant of the write.
 */
class ProductionOrderNumbers
{
    private const string ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    private const int LENGTH = 8;

    private const string PREFIX = 'PB-';

    /**
     * Attempts before giving up. Reaching this is not a collision but a sign the
     * generator or the table is broken, so it fails loudly.
     */
    private const int MAX_ATTEMPTS = 5;

    /**
     * A reference free within this organisation, as far as a read can tell.
     *
     * @throws RandomException
     */
    public function next(string $organisationId): string
    {
        for ($attempt = 0; $attempt < self::MAX_ATTEMPTS; $attempt++) {
            $candidate = self::PREFIX.$this->random();

            $taken = ProductionOrder::query()
                ->withoutGlobalScopes()
                ->where('organisation_id', $organisationId)
                ->where('reference', $candidate)
                ->exists();

            if (! $taken) {
                return $candidate;
            }
        }

        throw new RuntimeException('Could not allocate a unique production order reference.');
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
