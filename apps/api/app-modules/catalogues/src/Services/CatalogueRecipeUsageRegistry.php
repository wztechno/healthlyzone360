<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Recipes\Contracts\RecipeUsageRegistry;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Tenancy\TenantContext;

/**
 * The catalogues module's answer to "what else is selling this recipe".
 *
 * Bound by `CataloguesServiceProvider`, replacing the recipes module's null
 * implementation. The direction of the dependency is the point: recipes ask,
 * catalogues answer, and the module graph stays Catalogues → Recipes with no
 * cycle.
 *
 * **Published items only.** A draft item pointing at a recipe is somebody
 * working on next month's menu; blocking a retirement on it would make
 * drafting a future dish an obstacle to withdrawing a current one. Only a live
 * listing has a customer behind it, and only a live listing is showing a label
 * derived from the version about to be retired.
 */
final readonly class CatalogueRecipeUsageRegistry implements RecipeUsageRegistry
{
    public function __construct(private TenantContext $context) {}

    /**
     * @return list<string>
     */
    public function publishedItemIds(Recipe $recipe): array
    {
        if (! $this->context->hasOrganisation()) {
            return [];
        }

        return array_values(CatalogueItem::query()
            ->where('recipe_id', $recipe->getKey())
            ->where('status', CatalogueItemStatus::Published->value)
            ->orderBy('slug')
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all());
    }
}
