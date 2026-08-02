<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Audit\Enums\PurposeOfUse;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Recipes\Enums\CostBasis;
use Healthy360\Recipes\Models\RecipeCostSnapshot;
use Healthy360\Recipes\Models\RecipeVersionLine;
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
 *   for the import case where two currencies ended up on one sheet.
 *
 * **The snapshots are read, not computed.** A sheet that recalculated on every
 * GET would show a figure that no snapshot records and that changes as
 * ingredient prices move, which is precisely the thing a costed technical
 * sheet is supposed to pin down. Recomputing is an explicit POST.
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

        $uncosted = $this->costing->uncostedLineNumbers($lines);
        $currencies = $this->costing->currenciesOf($lines);

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
            'uncosted_line_numbers' => $uncosted,
            'snapshots' => $snapshots,
        ]);
    }
}
