<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Http\Concerns\ReadsPrecondition;
use Healthy360\Recipes\Http\Requests\ReplaceRecipeLinesRequest;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Presenters\RecipeVersionPresenter;
use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Recipes\Services\RecipeVersionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/recipes/{recipe}/versions/{version}/lines.
 *
 * A PUT because the body is the complete formulation. A PATCH surface would
 * make "I removed the sesame line" and "I forgot to send the sesame line" the
 * same request, and on a formulation that difference is the whole point.
 *
 * `If-Match` carries the **version's** `lock_version`, not a line's: the set is
 * the unit of change, and the replacement bumps the version so a concurrent
 * editor's next write is refused rather than silently overwriting this one.
 */
final class RecipeLineReplaceController
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
    public function __invoke(ReplaceRecipeLinesRequest $request, string $recipe, string $version): JsonResponse
    {
        $record = $this->locator->version($this->locator->recipe($recipe), $version);

        $updated = $this->versions->setLines($record, $request->lines(), $this->requiredLockVersion($request));

        $lines = RecipeVersionLine::query()
            ->where('recipe_version_id', $updated->getKey())
            ->orderBy('line_number')
            ->get();

        return ApiResponse::data([
            'version' => $this->presenter->version($updated),
            'lines' => $lines->map(fn (RecipeVersionLine $line): array => $this->presenter->line($line))->all(),
        ])->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
