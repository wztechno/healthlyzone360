<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Http\Concerns\ReadsPrecondition;
use Healthy360\Recipes\Http\Requests\ReplaceRecipeOutputsRequest;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\Recipes\Presenters\RecipeVersionPresenter;
use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Recipes\Services\RecipeVersionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/recipes/{recipe}/versions/{version}/outputs — what
 * this version produces (master plan v2 §4.2).
 *
 * An empty set is legitimate: a component whose yield nobody has measured yet.
 * A non-empty set must name exactly one primary — "the thing this recipe
 * makes" has to be answerable without a tie-break.
 */
final class RecipeOutputReplaceController
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
    public function __invoke(ReplaceRecipeOutputsRequest $request, string $recipe, string $version): JsonResponse
    {
        $record = $this->locator->version($this->locator->recipe($recipe), $version);

        $updated = $this->versions->setOutputs($record, $request->outputs(), $this->requiredLockVersion($request));

        $outputs = RecipeVersionOutput::query()
            ->where('recipe_version_id', $updated->getKey())
            ->orderByDesc('is_primary')
            ->orderBy('id')
            ->get();

        return ApiResponse::data([
            'version' => $this->presenter->version($updated),
            'outputs' => $outputs->map(fn (RecipeVersionOutput $output): array => $this->presenter->output($output))->all(),
        ])->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
