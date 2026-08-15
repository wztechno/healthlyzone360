<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Http\Concerns\ReadsPrecondition;
use Healthy360\Recipes\Http\Requests\ReplaceRecipeStepsRequest;
use Healthy360\Recipes\Models\RecipeVersionStep;
use Healthy360\Recipes\Presenters\RecipeVersionPresenter;
use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Recipes\Services\RecipeVersionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/recipes/{recipe}/versions/{version}/steps.
 */
final class RecipeStepReplaceController
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
    public function __invoke(ReplaceRecipeStepsRequest $request, string $recipe, string $version): JsonResponse
    {
        $record = $this->locator->version($this->locator->recipe($recipe), $version);

        $updated = $this->versions->setSteps($record, $request->steps(), $this->requiredLockVersion($request));

        $steps = RecipeVersionStep::query()
            ->where('recipe_version_id', $updated->getKey())
            ->orderBy('step_number')
            ->get();

        return ApiResponse::data([
            'version' => $this->presenter->version($updated),
            'steps' => $steps->map(fn (RecipeVersionStep $step): array => $this->presenter->step($step))->all(),
        ])->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
