<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Audit\Enums\PurposeOfUse;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Recipes\Enums\CostBasis;
use Healthy360\Recipes\Exceptions\MixedCostCurrency;
use Healthy360\Recipes\Models\RecipeCostSnapshot;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionPackaging;
use Healthy360\Recipes\Presenters\RecipeVersionPresenter;
use Healthy360\Recipes\Presenters\TechnicalSheetPresenter;
use Healthy360\Recipes\Services\RecipeCostingService;
use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Tenancy\TenantContext;
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
        private readonly RecipeVersionPresenter $versions,
        private readonly TechnicalSheetPresenter $presenter,
        private readonly RecipeCostingService $costing,
        private readonly AuditRecorder $audit,
        private readonly TenantContext $context,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $recipe, string $version): JsonResponse
    {
        $record = $this->locator->version($this->locator->recipe($recipe), $version);

        $lines = RecipeVersionLine::query()
            ->where('recipe_version_id', $record->getKey())
            ->orderBy('line_number')
            ->get();

        $packaging = RecipeVersionPackaging::query()
            ->where('recipe_version_id', $record->getKey())
            ->orderBy('line_number')
            ->get();

        $uncosted = $this->costing->uncostedLineNumbers($lines);
        $currencies = $this->costing->currenciesOf($lines);

        /*
         * The live block. `computeRecalculated()` throws on a formulation in two
         * currencies — an import defect somebody has to go and fix — and that
         * must not take the whole sheet down with it: the lines, the snapshots
         * and the conflict flag below are exactly what a person needs in order
         * to *see* the problem. So the live figures are dropped and the rest of
         * the response stands.
         */
        try {
            $production = $this->costing->computeRecalculated($record, $lines);
            $packagingCost = $this->costing->computePackaging($record, $packaging);

            $computed = $this->presenter->computed(
                $production,
                $packagingCost,
                $this->costing->totalCostPerYieldUnit($production, $packagingCost),
            );
        } catch (MixedCostCurrency) {
            $computed = null;
        }

        $snapshots = [];

        foreach (CostBasis::cases() as $basis) {
            $snapshot = RecipeCostSnapshot::latestFor((string) $record->getKey(), $basis);

            $snapshots[$basis->value] = $snapshot instanceof RecipeCostSnapshot
                ? $this->presenter->snapshot($snapshot)
                : null;
        }

        $this->audit->recordAccess(
            'catalogue.technical_sheet_viewed',
            PurposeOfUse::OrganisationAdministration,
            DataClassification::Confidential,
            actorUserId: $this->context->userId(),
            subjectType: 'recipe_version',
            subjectId: (string) $record->getKey(),

            // Identifiers and counts only. An audit row is readable with
            // `audit.view_organisation`, which is not the cost permission, so
            // a single amount here would route around the whole split.
            metadata: [
                'recipe_id' => $record->recipe_id,
                'version_number' => $record->version_number,
                'line_count' => $lines->count(),
                'packaging_line_count' => $packaging->count(),
                'uncosted_line_count' => count($uncosted),
            ],
        );

        return ApiResponse::data([
            'version' => $this->versions->version($record),
            'completeness' => $record->completeness->value,

            // The one currency the costed lines share, or null when nothing is
            // costed *or* when an import left more than one behind. The flag
            // beside it says which of those two it is, because "no currency"
            // and "several currencies" need different fixes.
            'currency_code' => count($currencies) === 1 ? $currencies[0] : null,
            'currency_conflict' => count($currencies) > 1,
            'lines' => $lines->map(fn (RecipeVersionLine $line): array => $this->presenter->line($line))->all(),
            'packaging_lines' => $packaging->map(
                fn (RecipeVersionPackaging $row): array => $this->presenter->packagingLine($row),
            )->all(),
            'uncosted_line_numbers' => $uncosted,
            'snapshots' => $snapshots,

            // Null only when the formulation carries two currencies, which the
            // `currency_conflict` flag above already reports. A client renders
            // the snapshots and the conflict in that case.
            'computed' => $computed,
        ]);
    }
}
