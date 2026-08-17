<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

/**
 * What one branch must buy for one window, and the part of that window nobody
 * could compute.
 *
 * The two halves are kept apart on purpose and never fold into each other. A
 * requirement row is a number the kitchen can act on; a `not_computable` hole is
 * an admission that some of the window's demand could not be turned into one.
 * Adding a hole to the numbers as a zero would be the worst possible answer —
 * "buy nothing for that" reads exactly like "you already have enough" — and
 * dropping it silently would be the second worst. So a meal with no recipe
 * contributes no quantity to any row and one entry to {@see $reasons}, and a
 * buyer reading a short list can see how short it is.
 *
 * @phpstan-type RequirementRow array{
 *     ingredient_id: string,
 *     stock_item_id: string,
 *     code: string,
 *     name_en: string,
 *     unit_id: string|null,
 *     unit_code: string|null,
 *     required: numeric-string,
 *     available: numeric-string,
 *     short: numeric-string,
 *     suggested_buy: numeric-string,
 * }
 */
final readonly class RequirementForecastResult
{
    /**
     * @param  list<RequirementRow>  $requirements  one row per branch stock item the window needs anything of, ordered by stock-item code
     * @param  int  $notComputableDays  distinct **dates** carrying at least one hole — see {@see RequirementForecast} for why a date rather than a demand item
     * @param  array<string, int>  $reasons  hole counts by reason code, highest first; only reasons that actually occurred appear
     */
    public function __construct(
        public array $requirements = [],
        public int $notComputableDays = 0,
        public array $reasons = [],
    ) {}
}
