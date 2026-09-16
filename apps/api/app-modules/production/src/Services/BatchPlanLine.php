<?php

declare(strict_types=1);

namespace Healthy360\Production\Services;

use InvalidArgumentException;

/**
 * One shelf a planned batch would draw on, and whether it can (PROD1).
 *
 * Five quantities, and none of them is the same question.
 *
 * - `required` — what the batch needs, from the explosion.
 * - `onHand` — what is physically there.
 * - `reserved` — what *other* confirmed batches have already claimed. A batch
 *   never counts its own claim against itself, which is what lets a confirmed
 *   order be re-planned without appearing to have run out of everything.
 * - `available` — `onHand − reserved`. May be negative; a shelf somebody
 *   over-committed is a real state and clamping it would hide it.
 * - `missing` — `max(0, required − available)`. The number a buyer acts on.
 *
 * The cost half is an **estimate with its provenance attached**, never a bare
 * amount: `weekly` stands on what was actually paid, `component` on the recipe
 * that makes the thing, `fallback` on a price somebody typed, and `none` means
 * the line is uncosted. Uncosted is never zero — a zero reads as free, and a
 * kitchen would price against it.
 */
final readonly class BatchPlanLine
{
    /** @var numeric-string */
    public string $required;

    /** @var numeric-string */
    public string $onHand;

    /** @var numeric-string */
    public string $reserved;

    /** @var numeric-string */
    public string $available;

    /** @var numeric-string */
    public string $missing;

    /** @var numeric-string|null per `unitId` */
    public ?string $estimatedUnitCost;

    /** @var numeric-string|null `required × estimatedUnitCost` */
    public ?string $estimatedLineCost;

    /**
     * Narrowed here rather than trusted: bcmath handed a non-numeric string
     * returns zero, which would make a shelf look covered when nobody knows
     * whether it is.
     *
     * @param  'ingredient'|'packaging'  $kind
     * @param  'weekly'|'component'|'fallback'|'none'  $costSource
     */
    public function __construct(
        public string $stockItemId,
        public string $ingredientId,
        public string $kind,
        public string $unitId,
        string $required,
        string $onHand,
        string $reserved,
        string $available,
        string $missing,
        ?string $estimatedUnitCost,
        ?string $estimatedLineCost,
        public ?string $currencyCode,
        public string $costSource,
        public ?string $sourceRecipeVersionId = null,
        public ?string $effectiveFrom = null,
    ) {
        $this->required = self::numeric($required, 'required');
        $this->onHand = self::numeric($onHand, 'on hand');
        $this->reserved = self::numeric($reserved, 'reserved');
        $this->available = self::numeric($available, 'available');
        $this->missing = self::numeric($missing, 'missing');
        $this->estimatedUnitCost = $estimatedUnitCost === null ? null : self::numeric($estimatedUnitCost, 'estimated unit cost');
        $this->estimatedLineCost = $estimatedLineCost === null ? null : self::numeric($estimatedLineCost, 'estimated line cost');
    }

    /**
     * @return numeric-string
     */
    private static function numeric(string $value, string $label): string
    {
        if (! is_numeric($value)) {
            throw new InvalidArgumentException("A batch plan line's {$label} must be numeric, [{$value}] given.");
        }

        return $value;
    }

    public function isShort(): bool
    {
        return bccomp($this->missing, '0', 4) > 0;
    }

    public function isCosted(): bool
    {
        return $this->estimatedUnitCost !== null;
    }
}
