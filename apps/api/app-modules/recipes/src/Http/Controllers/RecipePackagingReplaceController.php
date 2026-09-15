<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Http\Concerns\ReadsPrecondition;
use Healthy360\Recipes\Http\Requests\ReplaceRecipePackagingRequest;
use Healthy360\Recipes\Models\RecipeVersionPackaging;
use Healthy360\Recipes\Presenters\RecipeVersionPresenter;
use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Recipes\Services\RecipeVersionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/recipes/{recipe}/versions/{version}/packaging.
 *
 * The sibling of {@see RecipeLineReplaceController}, and a PUT for the same
 * reason: the body is the complete list, so "I removed the sleeve" and "I
 * forgot to send the sleeve" stay different requests.
 *
 * `If-Match` carries the **version's** `lock_version`, not a line's. The set is
 * the unit of change, and the replacement bumps the version so a concurrent
 * editor's next write is refused rather than silently overwriting this one.
 *
 * The response returns the stored rows rather than echoing the request, and
 * that is load-bearing here in a way it is not for formulation lines: two of
 * the three bases compute their own quantity, so the numbers on the way out are
 * genuinely not the numbers on the way in. A client that assumed otherwise
 * would render a bottle count of nothing.
 *
 * No cost fields. This controller answers with `RecipeVersionPresenter`, which
 * has none by construction — the costed view is the technical sheet, behind
 * `recipe.view_costs_organisation`.
 */
final class RecipePackagingReplaceController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly RecipeLocator $locator,
        private readonly RecipeVersionService $versions,
        private readonly RecipeVersionPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ReplaceRecipePackagingRequest $request, string $recipe, string $version): JsonResponse
    {
        $record = $this->locator->version($this->locator->recipe($recipe), $version);

        $updated = $this->versions->setPackaging($record, $request->packaging(), $this->requiredLockVersion($request));

        $rows = RecipeVersionPackaging::query()
            ->where('recipe_version_id', $updated->getKey())
            ->orderBy('line_number')
            ->get();

        return ApiResponse::data([
            'version' => $this->presenter->version($updated),
            'packaging' => $rows->map(
                fn (RecipeVersionPackaging $row): array => $this->presenter->packaging($row),
            )->all(),
        ])->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
