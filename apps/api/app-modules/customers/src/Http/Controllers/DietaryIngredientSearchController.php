<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Controllers;

use Healthy360\Catalogues\Models\CatalogueItemIngredient;
use Healthy360\Customers\Http\Requests\SearchDietaryIngredientsRequest;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\Kitchens\Presenters\MarketplaceLocale;
use Healthy360\Kitchens\Services\MarketplaceMeals;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\Scopes\OrganisationScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/me/dietary-profile/ingredients?q=… — the foods a person can
 * name as "leave this out".
 *
 * Read-only, and it reaches past the tenant scope on purpose: a customer has no
 * kitchen context, and the ingredient table is otherwise only ever read inside
 * one. What it may see is exactly two kinds of row, both already public:
 *
 * 1. **The platform library** (`organisation_id` NULL) — shared reference data
 *    every kitchen reads and none owns.
 * 2. **A kitchen's own ingredient that a meal on sale lists.** The meal-safety
 *    check matches an exclusion on the identifier a meal's list carries, so a
 *    person who wants a kitchen's "Garlic" kept off their plate needs that row,
 *    not the library's. Listing it on a published, offered meal is the kitchen
 *    putting it in front of customers.
 *
 * Nothing else a kitchen keeps — stock it buys, ingredients on drafts, its
 * prices, suppliers, aliases or notes — is reachable, and only id, name and
 * category leave. Active food only: packaging and retired rows are not foods
 * a person avoids. No ingredient table is under row-level security today (the
 * tenant boundary on it is the Eloquent scope this bypasses), so the
 * `withoutTenancy()` calls here are the whole of the decision.
 *
 * Names starting with the term come first, then the rest alphabetically, so
 * "gar" offers Garlic before Cigar-anything.
 */
final class DietaryIngredientSearchController
{
    public function __construct(private readonly MarketplaceMeals $meals) {}

    public function __invoke(SearchDietaryIngredientsRequest $request): JsonResponse
    {
        $locale = MarketplaceLocale::from($request->header('Accept-Language'));
        $term = mb_strtolower($request->term());
        $escaped = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $term);
        $contains = '%'.$escaped.'%';
        $prefix = $escaped.'%';
        $nameColumn = $locale === 'ar' ? 'name_ar' : 'name_en';

        $onSale = CatalogueItemIngredient::withoutTenancy()
            ->whereIn('catalogue_item_id', $this->meals->visible()->select('catalogue_items.id'))
            ->select('ingredient_id');

        $found = Ingredient::withoutTenancy()
            ->excludingPackaging()
            ->where('status', IngredientStatus::Active->value)
            ->where(fn (Builder $scope) => $scope->whereNull('organisation_id')->orWhereIn('id', $onSale))
            ->where(fn (Builder $name) => $name
                ->whereRaw('lower(name_en) like ?', [$contains])
                ->orWhereRaw('lower(name_ar) like ?', [$contains]))
            ->with(['category' => fn ($query) => $query->withoutGlobalScope(OrganisationScope::class)])
            ->orderByRaw("case when lower({$nameColumn}) like ? then 0 else 1 end", [$prefix])
            ->orderBy($nameColumn)
            ->orderBy('id')
            ->limit($request->limit())
            ->get(['id', 'name_en', 'name_ar', 'ingredient_category_id']);

        $data = $found->map(static function (Ingredient $ingredient) use ($locale): array {
            $category = $ingredient->category;

            return [
                'id' => (string) $ingredient->getKey(),
                'name' => MarketplaceLocale::pick($locale, $ingredient->name_en, $ingredient->name_ar),
                'category' => $category instanceof IngredientCategory
                    ? MarketplaceLocale::pick($locale, $category->name_en, $category->name_ar)
                    : null,
            ];
        })->values()->all();

        return ApiResponse::data($data, ['locale' => $locale, 'count' => count($data)]);
    }
}
