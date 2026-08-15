<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Http\Controllers;

use Healthy360\Recipes\Services\RecipeLocator;
use Healthy360\Recipes\Services\RecipeVersionReadiness;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/recipes/{recipe}/versions/{version}/readiness — would
 * publication succeed, and if not, why.
 *
 * A read of the same gate `POST …/publish` enforces, and deliberately nothing
 * more: the evaluator behind both is one service, so an answer here that says
 * "publishable" is the answer the publish attempt will give a moment later
 * against the same rows. The value is that a review queue can ask thirty times
 * without publishing anything, and that a version editor can show what is
 * missing while somebody is still fixing it rather than only after they press
 * publish.
 *
 * Behind `recipe.view_organisation` rather than `recipe.publish_organisation`.
 * Knowing what a formulation is missing is the chef's business — they are the
 * ones who fix it — while deciding to publish is somebody else's. Guarding the
 * diagnosis behind the decision would mean the only person who can see the
 * problem is the person who cannot fix it.
 *
 * `reasons` is empty exactly when `publishable` is true. Both are on the wire
 * because a client rendering a badge wants the boolean and a client rendering a
 * checklist wants the list, and deriving one from the other at every call site
 * is how the two drift apart in a UI.
 *
 * No `ETag` and no `If-Match`: this is a read, and readiness is not a resource
 * with a version — it is a verdict about one, recomputed every time because the
 * inputs (ingredient mappings, verification statuses) move underneath it.
 */
final class RecipeVersionReadinessController
{
    public function __construct(
        private readonly RecipeLocator $locator,
        private readonly RecipeVersionReadiness $readiness,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $recipe, string $version): JsonResponse
    {
        $record = $this->locator->version($this->locator->recipe($recipe), $version);
        $reasons = $this->readiness->reasons($record);

        return ApiResponse::data(
            [
                'publishable' => $reasons === [],
                'reasons' => array_map(
                    // The context is cast to an object so an empty one
                    // serialises as `{}` rather than `[]`. A field whose JSON
                    // type depends on whether it happens to be empty is a
                    // client bug waiting for the first reason that carries
                    // nothing.
                    static fn (array $reason): array => [
                        'code' => $reason['code'],
                        'detail' => $reason['detail'],
                        'context' => (object) $reason['context'],
                    ],
                    $reasons,
                ),
            ],
            [
                'recipe_id' => $record->recipe_id,
                'version_number' => $record->version_number,
                'status' => $record->status->value,
                'derivation_state' => $record->derivation_state->value,
            ],
        );
    }
}
