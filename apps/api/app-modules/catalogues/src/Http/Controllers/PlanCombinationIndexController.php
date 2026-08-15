<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Models\MealCombinationOption;
use Healthy360\Catalogues\Presenters\PlanAdminPresenter;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/plan-vocabulary/combinations.
 *
 * Not cursor-paginated, for `IngredientCategoryIndexController`'s reason: the
 * vocabulary is a handful of rows a client renders as a set of options in one
 * pass, and paging a set of radio buttons would hand a form half of itself.
 *
 * **Deactivated rows are served too**, with their `is_active` flag. This is the
 * administrative surface, and hiding a withdrawn combination would leave a
 * kitchen with no way to reactivate one — there being no delete, "gone from the
 * list" would mean gone for good.
 */
final class PlanCombinationIndexController
{
    public function __construct(private readonly PlanAdminPresenter $presenter) {}

    public function __invoke(): JsonResponse
    {
        $rows = MealCombinationOption::query()
            ->orderBy('display_order')
            ->orderBy('code')
            ->get();

        return ApiResponse::data(
            $rows->map(fn (MealCombinationOption $row): array => $this->presenter->combination($row))->all(),
            ['count' => $rows->count()],
        );
    }
}
