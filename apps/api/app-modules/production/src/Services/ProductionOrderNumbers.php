<?php

declare(strict_types=1);

namespace Healthy360\Production\Services;

use Carbon\CarbonImmutable;
use Healthy360\Procurement\Services\PurchaseOrderNumbers;
use Healthy360\Production\Models\ProductionOrder;
use Illuminate\Support\Facades\DB;
use Random\RandomException;
use RuntimeException;

/**
 * The numbers a batch is known by (PROD1, D-145–D-147).
 *
 * Two of them, with two jobs. `reference` (`PB-7K3M9QXA`) names the **work
 * order** — what the kitchen plans and cooks against — and is minted at confirm.
 * The **lot** (`2609250077`, shown `260925-007-7`) names what the batch *made*:
 * it is the number on the label and inside its barcode, and it is minted at
 * settlement, once usable units reach a shelf.
 *
 * ## The reference
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
 * The `exists()` pre-check is an optimisation and never the guarantee, for the
 * reason its sibling gives: a check and a write with a gap between them is a race
 * that two concurrent confirms would lose, and only the index can answer "is this
 * taken" at the instant of the write.
 *
 * ## The lot is the number on the label
 *
 * `YYMMDD` of the production date, a three-digit sequence for that organisation
 * and day, and a GS1 mod-10 check digit. **Sequential, unlike the reference**,
 * because a lot is read by people holding a tray: the date is legible in it, and
 * a mistyped digit fails the check instead of opening somebody else's batch. All
 * digits, so the barcode stays in Code 128 set C and short.
 *
 * `production_orders.batch_reference` is the older answer to the same question —
 * whatever the cook wrote on the tray — and is legacy wording now: kept and shown
 * for the batches that carry it, and no longer accepted at completion.
 *
 * The barcode string is derived here and never stored ({@see barcode()}), and
 * {@see lookupKey()} is its inverse: whatever a scanner or a person types, it
 * answers with the one key the register can search on, or with nothing.
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

    /** Three sequence digits — see {@see lot()} for the ceiling. */
    private const int LOT_SEQUENCE_CEILING = 999;

    /** ASCII 29, the GS1 group separator a scanner sends in place of FNC1. */
    private const string GROUP_SEPARATOR = "\x1D";

    /**
     * The fixed-length GS1 AIs a label may carry ahead of the lot, and their
     * data lengths: GTIN, and the production, packaging, best-before and expiry
     * dates. Anything else ends the parse as unrecognised.
     */
    private const array FIXED_LENGTH_AIS = ['01' => 14, '11' => 6, '13' => 6, '15' => 6, '17' => 6];

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
     * The next lot for this organisation and production day.
     *
     * **Call it inside the settlement transaction, and last.** The advisory lock
     * is transaction-scoped: it serialises every settlement minting on the same
     * (organisation, day) until commit, so two cooks completing at the same
     * instant cannot both read `…006` and both write `…007`. It is taken after the
     * stock locks, so it cannot close a cycle with them. One statement, rather
     * than the purchase order's savepoint-and-retry loop, is what lets the lot
     * ride in the same `save()` as the rest of the outcome.
     * `production_orders_lot_number_unique` is the backstop, not the mechanism.
     *
     * `hashtext` folds the key to 32 bits, so two unrelated (organisation, day)
     * pairs can share a lock. That costs a moment's wait, never a wrong number:
     * the read below is still scoped to its own organisation and day.
     *
     * @throws RuntimeException when the day's sequence is exhausted
     */
    public function lot(string $organisationId, CarbonImmutable $productionDate): string
    {
        $day = $productionDate->toDateString();

        DB::statement('select pg_advisory_xact_lock(hashtext(?))', ["production_lot:{$organisationId}:{$day}"]);

        $highest = ProductionOrder::query()
            ->withoutGlobalScopes()
            ->where('organisation_id', $organisationId)
            ->where('production_date', $day)
            ->max('lot_number');

        $sequence = is_string($highest) ? (int) substr($highest, 6, 3) + 1 : 1;

        // ponytail: three sequence digits cap a kitchen at 999 finished batches a
        // day. Widening SSS to four digits (an 11-digit lot, still set C with a
        // leading zero) is the upgrade path if a central kitchen ever gets there.
        if ($sequence > self::LOT_SEQUENCE_CEILING) {
            throw new RuntimeException("Organisation [{$organisationId}] has minted every lot for {$day}.");
        }

        return self::lotFor($productionDate, $sequence);
    }

    /**
     * `YYMMDD` + the three-digit sequence + its check digit.
     */
    public static function lotFor(CarbonImmutable $productionDate, int $sequence): string
    {
        $digits = $productionDate->format('ymd').str_pad((string) $sequence, 3, '0', STR_PAD_LEFT);

        return $digits.self::checkDigit($digits);
    }

    /**
     * The GS1 mod-10 check digit — the one a GTIN carries.
     *
     * Weights 3, 1, 3, … from the **right**, so the same function serves any
     * length. It catches every single mistyped digit and most adjacent swaps,
     * which is exactly the mistake a person copying a lot off a tray makes.
     */
    public static function checkDigit(string $digits): int
    {
        $sum = 0;

        foreach (array_reverse(str_split($digits)) as $index => $digit) {
            $sum += (int) $digit * ($index % 2 === 0 ? 3 : 1);
        }

        return (10 - $sum % 10) % 10;
    }

    /**
     * The GS1-128 element string, human-readable: `(11)YYMMDD[(17)YYMMDD](10)<lot>`.
     *
     * Fixed-length AIs first and the variable-length (10) **last**, so no FNC1
     * separator is ever needed inside the symbol — separators are what
     * keyboard-wedge scanners mangle. `(11)` repeats the lot's own date because
     * that is the AI a reader looks for; drop it here if a label printer's head
     * turns out narrower than the 50 mm of bars it costs (D-146).
     */
    public static function barcode(string $lot, ?CarbonImmutable $expiry): string
    {
        return '(11)'.substr($lot, 0, 6)
            .($expiry === null ? '' : '(17)'.$expiry->format('ymd'))
            .'(10)'.$lot;
    }

    /**
     * What to search for, given whatever a scanner or a person produced.
     *
     * Answers a valid ten-digit lot, a normalised `PB-` reference, or null —
     * never a guess. In order:
     *
     * 1. A `PB-` reference, in any case.
     * 2. A lot typed by hand: ten digits, dashes allowed, the check digit must
     *    hold. A wrong digit is null rather than the nearest batch.
     * 3. A GS1 element string, as a scanner in keyboard mode sends it (with or
     *    without the `]C1` symbology prefix, with an ASCII 29 separator or none)
     *    or as it is printed under the bars, in parentheses. The (10) lot inside
     *    it is validated like (2). An AI this kitchen never prints is null.
     */
    public static function lookupKey(string $code): ?string
    {
        $code = strtoupper(str_replace(' ', '', trim($code)));

        if (preg_match('/^'.preg_quote(self::PREFIX, '/').'['.self::ALPHABET.']{'.self::LENGTH.'}$/', $code) === 1) {
            return $code;
        }

        $digits = str_replace('-', '', $code);

        if (preg_match('/^[0-9]{10}$/', $digits) === 1) {
            return self::validLot($digits);
        }

        if (str_starts_with($code, ']C1')) {
            $code = substr($code, 3);
        }

        // Each "(" opens an AI, which in the raw form is where a separator would
        // sit; the leading one is noise.
        $code = ltrim(str_replace(['(', ')'], [self::GROUP_SEPARATOR, ''], $code), self::GROUP_SEPARATOR);
        $position = 0;

        while ($position < strlen($code)) {
            $ai = substr($code, $position, 2);

            if ($ai === '10') {
                $end = strpos($code, self::GROUP_SEPARATOR, $position + 2);
                $lot = $end === false ? substr($code, $position + 2) : substr($code, $position + 2, $end - $position - 2);

                return self::validLot($lot);
            }

            $length = self::FIXED_LENGTH_AIS[$ai] ?? null;

            if ($length === null) {
                return null;
            }

            $value = substr($code, $position + 2, $length);

            if (strlen($value) !== $length || ! ctype_digit($value)) {
                return null;
            }

            $position += 2 + $length;

            if (($code[$position] ?? '') === self::GROUP_SEPARATOR) {
                $position++;
            }
        }

        return null;
    }

    private static function validLot(string $lot): ?string
    {
        if (preg_match('/^[0-9]{10}$/', $lot) !== 1) {
            return null;
        }

        return self::checkDigit(substr($lot, 0, 9)) === (int) $lot[9] ? $lot : null;
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
