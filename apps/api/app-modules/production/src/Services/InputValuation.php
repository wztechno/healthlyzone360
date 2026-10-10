<?php

declare(strict_types=1);

namespace Healthy360\Production\Services;

use InvalidArgumentException;

/**
 * What one unit of an input was worth when the batch took it (PROD1).
 *
 * An amount **and** its currency, always together, because the house rule is that
 * an amount on its own is not a figure — and because the settlement's whole
 * currency check is "did every input agree", which needs the currency on every
 * line rather than assumed from the first.
 */
final readonly class InputValuation
{
    /** @var numeric-string per the line's own unit */
    public string $unitCostAmount;

    public function __construct(string $unitCostAmount, public string $currencyCode)
    {
        if (! is_numeric($unitCostAmount)) {
            throw new InvalidArgumentException("An input valuation must be numeric, [{$unitCostAmount}] given.");
        }

        $this->unitCostAmount = $unitCostAmount;
    }
}
