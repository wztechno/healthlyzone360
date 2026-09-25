<?php

declare(strict_types=1);

namespace Healthy360\Production\Services;

use InvalidArgumentException;

/**
 * What a cook says actually happened (PROD1).
 *
 * The three yield facts are separate because they are three different things and
 * exactly one of them is free:
 *
 * - **Finished waste** — `rejectedQuantity`. Units that were made and then thrown
 *   away: a failed check, a dropped tray. They are *inside* `producedQuantity`,
 *   carry the batch's unit cost, and leave the shelf again as a waste movement.
 * - **Input waste** — per line, in `$waste`. Raw material discarded during the
 *   batch: the half kilo of flour that went on the floor. It never became
 *   product, so it is not part of the batch's cost and not part of
 *   `consumedQuantity`; the shelf falls by the sum of the two, as two movements
 *   with different reasons.
 * - **Process loss** — not reported at all, and computed: planned 40 litres,
 *   produced 38. Evaporation and pot residue never existed as stock, so there is
 *   no movement to make and no money to attribute. Its cost is already absorbed
 *   into the unit cost of what *was* produced, and inventing a figure for it
 *   would count the batch twice.
 *
 * Omitting a line from `$consumed` means "as planned" rather than "nothing":
 * a cook who followed the recipe should not have to retype it. Omitting one from
 * `$waste` means zero, because waste that nobody mentioned did not happen.
 */
final readonly class BatchReport
{
    /** @var numeric-string what came out, in the planned yield unit, including anything rejected */
    public string $producedQuantity;

    /** @var numeric-string produced and then discarded */
    public string $rejectedQuantity;

    /** @var array<string, numeric-string> stock item id => what went into the batch; absent means "as planned" */
    public array $consumed;

    /** @var array<string, numeric-string> stock item id => input discarded; absent means none */
    public array $waste;

    /**
     * Narrowed here rather than trusted, because bcmath handed a non-numeric
     * string returns zero rather than erroring — which would turn a mistyped
     * yield into a batch that silently produced nothing.
     *
     * @param  array<string, string>  $consumed
     * @param  array<string, string>  $waste
     */
    public function __construct(
        string $producedQuantity,
        string $rejectedQuantity = '0',
        array $consumed = [],
        array $waste = [],
        public ?string $productionDate = null,
        public ?string $storageLocation = null,
        public ?string $expiryDate = null,
        public ?string $notes = null,
    ) {
        $this->producedQuantity = self::numeric($producedQuantity, 'produced quantity');
        $this->rejectedQuantity = self::numeric($rejectedQuantity, 'rejected quantity');
        $this->consumed = self::numericMap($consumed, 'consumption');
        $this->waste = self::numericMap($waste, 'input waste');
    }

    /**
     * @return numeric-string
     */
    private static function numeric(string $value, string $label): string
    {
        if (! is_numeric($value)) {
            throw new InvalidArgumentException("A batch report's {$label} must be numeric, [{$value}] given.");
        }

        return $value;
    }

    /**
     * @param  array<string, string>  $values
     * @return array<string, numeric-string>
     */
    private static function numericMap(array $values, string $label): array
    {
        $narrowed = [];

        foreach ($values as $stockItemId => $value) {
            $narrowed[(string) $stockItemId] = self::numeric($value, $label);
        }

        return $narrowed;
    }

    /**
     * Whether the batch produced nothing at all.
     *
     * A separate question from "produced a little", and the completion path
     * branches hard on it: there is no unit cost to divide out, no yield to post
     * and no finished stock to value, and the inputs are recorded as waste rather
     * than as consumption — nothing was transformed, so it was all loss.
     */
    public function producedNothing(): bool
    {
        return bccomp($this->producedQuantity, '0', 4) <= 0;
    }

    /**
     * Whether anything usable reaches a shelf: produced minus rejected, above zero.
     *
     * The lot and the recipe's use-by date both hang off this rather than off the
     * ending (D-144, D-145). A batch abandoned after yielding twelve good portions
     * put twelve portions on a shelf, and they need a label as much as a completed
     * batch's do; a batch that made nothing, or rejected everything it made, has
     * nothing to label or to date.
     */
    public function hasUsableOutput(): bool
    {
        return bccomp(bcsub($this->producedQuantity, $this->rejectedQuantity, 4), '0', 4) > 0;
    }
}
