<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Enums;

/**
 * Where a packaging line's quantity comes from.
 *
 * The source workbook types every packaging quantity by hand, which is why its
 * "Bottle 300" reads `1` against a 1.7 kg yield — a figure that was right for
 * some earlier batch size and was never revisited. A typed count is wrong the
 * moment the yield moves and nothing says so, so two of these three bases
 * compute the number instead and only the third accepts one.
 */
enum PackagingBasis: string
{
    /**
     * `ceil(yield / capacity)` — a container, filled until the batch is gone.
     *
     * Bottles, tubs, trays, clamshells. Requires the packaging item to state a
     * capacity and the version to state a yield; without both there is nothing
     * to divide and the service refuses the line rather than guessing at one.
     *
     * `ceil`, because two thirds of a bottle holds nothing. The half-empty
     * last container is real and is accounted for by the waste coefficient,
     * not by rounding the count down and understating the cost.
     */
    case FillsYield = 'fills_yield';

    /**
     * One per container — the count every `fills_yield` line on the version
     * adds up to.
     *
     * Caps, lids, sleeves, the sticker that goes on the jar. These scale with
     * the number of containers rather than with the weight, so a batch that
     * doubles needs twice the caps without anybody re-typing the figure.
     *
     * A version with no `fills_yield` line has no containers, so a
     * `per_container` line on one is a statement about nothing. The service
     * refuses it, because silently costing it as zero would hide the fact that
     * the container line is what is actually missing.
     */
    case PerContainer = 'per_container';

    /**
     * Typed, and consumed once per run whatever comes out of it.
     *
     * The escape hatch, and a narrow one: a shipping carton, a roll of film, a
     * batch label. Anything that scales with weight or with container count
     * has a basis above that keeps it correct on its own, and reaching for
     * this instead is how a sheet goes stale.
     */
    case PerBatch = 'per_batch';

    /**
     * Whether this basis takes its quantity from the request rather than
     * computing one.
     *
     * The single place that question is answered, so the validator, the
     * service and the presenter cannot drift into three different opinions
     * about which bases carry a typed figure.
     */
    public function isTyped(): bool
    {
        return $this === self::PerBatch;
    }
}
