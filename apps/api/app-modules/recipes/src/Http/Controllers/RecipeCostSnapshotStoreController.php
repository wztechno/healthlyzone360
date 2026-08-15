<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Http\Requests\StoreCostSnapshotRequest;
use Healthy360\Recipes\Presenters\TechnicalSheetPresenter;
use Healthy360\Recipes\Services\RecipeCostingService;
use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/recipes/{recipe}/versions/{version}/cost-snapshots —
 * cost this version from its lines, now, and append the result.
 *
 * Two permissions, stacked on the route: `recipe.manage_organisation` because
 * this writes, and `recipe.view_costs_organisation` because what it writes is
 * money. Neither alone is enough.
 *
 * No `If-Match`. A snapshot does not mutate the version — it appends a row to
 * a ledger beside it — so there is no lost update for a validator to prevent,
 * and demanding one would only teach clients to send a header that means
 * nothing here.
 *
 * Three refusals:
 *
 * - **Retired version** → `409 resource.conflict`. Retirement is terminal, and
 *   a fresh cost for something the kitchen has withdrawn is a number with
 *   nowhere to go.
 * - **Not fully costed** → `422 validation.failed` naming
 *   `uncosted_line_numbers`. A total that silently omits a line reads exactly
 *   like a total that did not, so no snapshot is written at all.
 * - **More than one currency** → `422 validation.failed` naming them. There is
 *   no exchange rate in this system and §4.4 forbids adding one.
 *
 * Success is `201` and does **not** touch `completeness`. Only publication
 * flips a version to `costed`: completeness is a statement about what was
 * published, and letting an ad-hoc recalculation promote a draft would make
 * the field mean "somebody once pressed a button" instead.
 */
final class RecipeCostSnapshotStoreController
{
    public function __construct(
        private readonly RecipeLocator $locator,
        private readonly RecipeCostingService $costing,
        private readonly TechnicalSheetPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreCostSnapshotRequest $request, string $recipe, string $version): JsonResponse
    {
        $record = $this->locator->version($this->locator->recipe($recipe), $version);

        if ($record->status === RecipeVersionStatus::Retired) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'A retired version cannot be costed again.',
                ['status' => $record->status->value],
            );
        }

        $computation = $this->costing->computeRecalculated($record);

        if (! $computation->isComplete()) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'This version cannot be costed: not every line carries both an amount and a unit cost.',
                [
                    'uncosted_line_numbers' => $computation->uncostedLineNumbers,
                    'partial' => $computation->isPartial(),
                ],
            );
        }

        $snapshot = $this->costing->writeSnapshot($record, $request->basis(), $computation);

        return ApiResponse::data(['snapshot' => $this->presenter->snapshot($snapshot)], status: 201);
    }
}
