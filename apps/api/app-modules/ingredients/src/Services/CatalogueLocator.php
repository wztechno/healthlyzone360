<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Services;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAlias;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * Turns a route parameter into a catalogue record the caller is allowed to
 * see, or into a 404.
 *
 * Route-model binding is not used, matching the house style (`DeviceController`)
 * and for a concrete reason here: the tenant scope is only meaningful once
 * `org.context` has run, and resolving a scoped model in the router's binding
 * middleware would either fail closed before the context exists or bypass the
 * scope entirely. Resolving here also keeps the failure honest — a row in
 * another organisation and a row that never existed are the same 404, so the
 * endpoint cannot be used to probe which ingredient identifiers are real.
 */
final class CatalogueLocator
{
    /**
     * @throws ApiException
     */
    public function ingredient(string $id): Ingredient
    {
        // The global organisation scope allows NULL rows, so this finds the
        // caller's own rows and the platform library and nothing else.
        $ingredient = Ingredient::query()->with('defaultUnit')->whereKey($id)->first();

        if (! $ingredient instanceof Ingredient) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $ingredient;
    }

    /**
     * @throws ApiException
     */
    public function category(string $id): IngredientCategory
    {
        $category = IngredientCategory::query()->whereKey($id)->first();

        if (! $category instanceof IngredientCategory) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $category;
    }

    /**
     * @throws ApiException
     */
    public function alias(Ingredient $ingredient, string $id): IngredientAlias
    {
        $alias = IngredientAlias::query()
            ->where('ingredient_id', $ingredient->getKey())
            ->whereKey($id)
            ->first();

        if (! $alias instanceof IngredientAlias) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $alias;
    }
}
