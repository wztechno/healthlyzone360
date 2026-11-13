<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Recipes\Services\RecipeVersionReads;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/recipes/{recipe}/versions/{version}/technical-sheet —
 * the costed view of a formulation.
 *
 * Behind `recipe.view_costs_organisation`, which is deliberately not
 * `recipe.view_organisation` (appendix C): a line cook needs the method and
 * the allergen label to make the dish, and must not thereby read the margin on
 * it. Splitting the permission is the only way that separation is real rather
 * than a convention nobody enforces.
 *
 * The response answers three questions a paper technical sheet answers:
 *
 * - *what goes in and what does it cost* — the lines, with unit and line costs;
 * - *what does the whole thing cost, per kilo and per piece, before and after
 *   waste* — the latest snapshot of each basis, both when both exist, each
 *   labelled with the basis it was computed on;
 * - *what is missing* — `uncosted_line_numbers`, and a currency conflict flag
 *   for the import case where two currencies ended up on one sheet;
 * - *what does it cost us today, all in* — the `computed` block: the
 *   formulation and the packaging costed from the same read, and the two added
 *   together into a cost per yield unit.
 *
 * **The snapshots are read, not computed.** A sheet that recalculated on every
 * GET would show a figure that no snapshot records and that changes as
 * ingredient prices move, which is precisely the thing a costed technical
 * sheet is supposed to pin down. Recomputing is an explicit POST.
 *
 * **The `computed` block is the deliberate exception, and it is beside them
 * rather than instead of them.** The two answer different questions — "what did
 * we say this cost when we costed it" against "what does it cost given today's
 * catalogue" — and an editor needs the second while somebody is still typing.
 * Keeping both on one response is what lets a screen show a live figure without
 * anybody mistaking it for the pinned one.
 *
 * Its two halves are computed in one pass on purpose. Packaging cost is derived
 * from the version's yield, so it moves while the yield does; adding a live
 * packaging figure to a production figure pinned in March would produce a total
 * of nothing in particular. Both sides live, or no total.
 *
 * Every successful read writes an `catalogue.technical_sheet_viewed` access
 * event with a purpose of use and the `confidential` classification — after
 * the read succeeds, never before: a denial has its own failure path already,
 * and recording an access that did not happen corrupts the trail.
 */
final class RecipeTechnicalSheetController
{
    public function __construct(
        private readonly RecipeLocator $locator,
        private readonly RecipeVersionReads $reads,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $recipe, string $version): JsonResponse
    {
        $record = $this->locator->version($this->locator->recipe($recipe), $version);

        return ApiResponse::data($this->reads->technicalSheet($record));
    }
}
