<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * Turns route parameters into records the caller is allowed to see, or into a
 * 404.
 *
 * Route-model binding is not used, matching `CatalogueLocator` and for the
 * same reason: the tenant scope only means anything once `org.context` has
 * run, and resolving a scoped model in the router's binding middleware would
 * either fail closed before the context exists or bypass the scope entirely.
 *
 * A version is always resolved *through* its recipe. Reaching a version by
 * identifier alone would make `/recipes/{a}/versions/{b}` accept a version of
 * some other recipe and silently act on it — the kind of confused-deputy path
 * that only shows up in production.
 */
final class RecipeLocator
{
    /**
     * @throws ApiException
     */
    public function recipe(string $id): Recipe
    {
        $recipe = Recipe::query()->whereKey($id)->first();

        if (! $recipe instanceof Recipe) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $recipe;
    }

    /**
     * A version of this recipe, addressed either by its identifier or by its
     * version number.
     *
     * Both because both are natural: a client that walked the list holds
     * identifiers, and a human reading a technical sheet holds "version 3".
     * A number is only accepted when it cannot be a UUID, so there is no
     * ambiguity to resolve.
     *
     * @throws ApiException
     */
    public function version(Recipe $recipe, string $id): RecipeVersion
    {
        $query = RecipeVersion::query()->where('recipe_id', $recipe->getKey());

        preg_match('/^\d+$/', $id) === 1
            ? $query->where('version_number', (int) $id)
            : $query->whereKey($id);

        $version = $query->first();

        if (! $version instanceof RecipeVersion) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $version;
    }
}
