<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

/**
 * Where one formulation line's estimating cost came from, and how old it is.
 *
 * The provenance is on the wire beside the amount rather than inferred from it,
 * because the four sources are not interchangeable and a reader has to be able to
 * tell them apart:
 *
 * - `weekly` — the published weighted average of what was actually paid. The
 *   answer this whole feature exists to give.
 * - `component_recipe` — the line names something the kitchen *makes*, so the
 *   figure is that recipe's own cost per unit of what it produces. This is what
 *   stops a dressing's olive oil being counted once inside the dressing and again
 *   inside the salad.
 * - `ingredient_fallback` — nobody has bought it at a recorded price, so the
 *   operator's typed purchase price stands in. Real, and visibly weaker than the
 *   other two: the requirement's "flag ingredients with no purchase history for
 *   initial price entry" is read off exactly these lines.
 * - `none` — no usable figure. The line stays **uncosted** and the total is
 *   withheld. Never zero, which would silently make an ingredient free.
 *
 * `effectiveFrom` is null on the last two — a typed price has no week, and a
 * missing one has no date at all.
 */
final readonly class WeeklyLineCost
{
    public const string SOURCE_WEEKLY = 'weekly';

    public const string SOURCE_COMPONENT = 'component_recipe';

    public const string SOURCE_FALLBACK = 'ingredient_fallback';

    public const string SOURCE_NONE = 'none';

    /**
     * @param  'weekly'|'component_recipe'|'ingredient_fallback'|'none'  $source
     * @param  numeric-string|null  $unitCostAmount  per the line's own unit
     */
    public function __construct(
        public int $lineNumber,
        public string $ingredientId,
        public string $source,
        public ?string $unitCostAmount,
        public ?string $currencyCode,
        public ?string $effectiveFrom,
        public ?string $sourceRecipeVersionId = null,
        public bool $carriedForward = false,
    ) {}

    public static function none(int $lineNumber, string $ingredientId): self
    {
        return new self($lineNumber, $ingredientId, self::SOURCE_NONE, null, null, null);
    }

    public function isCosted(): bool
    {
        return $this->unitCostAmount !== null && $this->currencyCode !== null;
    }

    /** Whether this line is one the initial-price-entry list should name. */
    public function needsInitialPrice(): bool
    {
        return $this->source === self::SOURCE_NONE || $this->source === self::SOURCE_FALLBACK;
    }
}
