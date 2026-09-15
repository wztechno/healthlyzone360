<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\OffsetPage;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/catalogue/items — everything this organisation sells.
 *
 * There is no platform library here, unlike ingredients and product
 * categories: an item belongs to exactly one organisation, always.
 *
 * Retired items are excluded unless asked for by name — the rule the
 * ingredient and recipe lists apply to archived rows, and for the same reason:
 * a list that offered withdrawn articles by default invites somebody to price
 * one.
 */
final class CatalogueItemIndexController
{
    public function __construct(private readonly CatalogueItemAdminPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $query = CatalogueItem::query()->with('category');

        $this->applyStatus($request, $query);
        $this->applyType($request, $query);
        $this->applyCategory($request, $query);
        $this->applySearch($request, $query);
        $this->applyAllergen($request, $query);

        $requestedPage = OffsetPage::page($request);

        if ($requestedPage !== null) {
            $perPage = OffsetPage::perPage($request);
            // Counted before the query is constrained: a constrained builder
            // counts the page rather than the collection.
            $total = $query->toBase()->getCountForPagination();

            OffsetPage::assertWithinRange($requestedPage, $perPage, $total);
            OffsetPage::constrain($query, $requestedPage, $perPage);

            $rows = $query->get();

            return ApiResponse::data(
                $rows->map(fn (CatalogueItem $item): array => $this->presenter->item($item))->all(),
                OffsetPage::meta($rows, $requestedPage, $perPage, $total),
            );
        }

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request));

        $page = CursorPage::page($query->get(), $limit);

        return ApiResponse::data(
            $page['items']->map(fn (CatalogueItem $item): array => $this->presenter->item($item))->all(),
            $page['meta'],
        );
    }

    /**
     * @param  Builder<CatalogueItem>  $query
     *
     * @throws ApiException
     */
    private function applyStatus(Request $request, Builder $query): void
    {
        $status = $request->query('status');

        if ($status === null || $status === '') {
            $query->where('status', '!=', CatalogueItemStatus::Retired->value);

            return;
        }

        if (! is_string($status) || CatalogueItemStatus::tryFrom($status) === null) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The status filter must be one of: draft, review_required, published, retired.',
                ['parameter' => 'status'],
            );
        }

        $query->where('status', $status);
    }

    /**
     * @param  Builder<CatalogueItem>  $query
     *
     * @throws ApiException
     */
    private function applyType(Request $request, Builder $query): void
    {
        $type = $request->query('item_type');

        if ($type === null || $type === '') {
            return;
        }

        if (! is_string($type) || CatalogueItemType::tryFrom($type) === null) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The item_type filter must be one of: product, meal, subscription_plan, sauce, dressing.',
                ['parameter' => 'item_type'],
            );
        }

        $query->where('item_type', $type);
    }

    /**
     * @param  Builder<CatalogueItem>  $query
     */
    private function applyCategory(Request $request, Builder $query): void
    {
        $category = $request->query('product_category_id');

        if (! is_string($category) || $category === '') {
            return;
        }

        $query->where('product_category_id', $category);
    }

    /**
     * @param  Builder<CatalogueItem>  $query
     */
    private function applySearch(Request $request, Builder $query): void
    {
        $term = $request->query('query');

        if (! is_string($term) || trim($term) === '') {
            return;
        }

        $needle = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower(trim($term))).'%';

        $query->where(function (Builder $scoped) use ($needle): void {
            $scoped->whereRaw('lower(name_en) like ?', [$needle])
                ->orWhereRaw('lower(name_ar) like ?', [$needle])
                ->orWhereRaw('lower(slug) like ?', [$needle]);
        });
    }

    /**
     * Narrows to the items whose derived allergen label carries one class.
     *
     * This is `DerivedAllergenService` expressed as a predicate, and it has to stay that way: the
     * service is what the Allergens column and the item's own allergen endpoint read, so a filter
     * that computed the set differently would return rows the column then contradicted. The
     * service's three bases are reproduced here **in its order of authority**, which is the part
     * that cannot be flattened into one `exists`:
     *
     * 1. **A published recipe version's frozen label.** When the item links a recipe with a
     *    published version, those rows *are* the answer, and the item's own ingredient list is not
     *    consulted at all.
     * 2. **A linked ingredient**, for an item that is exactly one bought-in good.
     * 3. **The item's listed ingredients**, rolled up.
     *
     * Bases 2 and 3 apply only in the absence of base 1 — hence the `whereNotExists` guard rather
     * than three alternatives ORed together. Without it a meal whose recipe was reformulated to
     * drop nuts would still match `nuts` through a stale ingredient row, while the column beside
     * it, reading the frozen label, showed none.
     *
     * **Effective mappings, so both layers.** An ingredient's allergens are the platform baseline
     * (`organisation_id is null`) union this organisation's own overlay — `AllergenRollupService::
     * effectiveFor`, in SQL. Matching one layer would drop whichever half a kitchen relies on.
     *
     * What this deliberately does **not** reproduce is the roll-up's containment *strengthening*:
     * the service resolves `contains` over `may_contain` where both layers speak, and this matches
     * either. Strength decides what the label reads, never whether the class is on it, and it is
     * presence the filter asks about. Both containments matching is also the same call the
     * ingredient and recipe lists make — a reader narrowing by an allergen wants everything that
     * could carry it, and dropping `may_contain` would answer a food-safety question by
     * under-reporting.
     *
     * `basis = none` — an item nobody has described — matches nothing, which is worth stating
     * rather than leaving to fall out: silence is not a statement of absence, so such an item is
     * neither "has nuts" nor "has no nuts", and a filter naming a class should not return it.
     *
     * @param  Builder<CatalogueItem>  $query
     */
    private function applyAllergen(Request $request, Builder $query): void
    {
        $allergen = $request->query('allergen');

        if (! is_string($allergen) || $allergen === '') {
            return;
        }

        $published = RecipeVersionStatus::Published->value;

        $query->where(function (Builder $scoped) use ($allergen, $published): void {
            // Base 1 — the frozen label of the linked recipe's published version.
            $scoped->whereExists(function ($sub) use ($allergen, $published): void {
                $sub->selectRaw('1')
                    ->from('recipe_versions as rv')
                    ->join('recipe_version_allergens as rva', 'rva.recipe_version_id', '=', 'rv.id')
                    ->whereColumn('rv.recipe_id', 'catalogue_items.recipe_id')
                    ->whereColumn('rv.organisation_id', 'catalogue_items.organisation_id')
                    ->where('rv.status', $published)
                    ->where('rva.allergen_code', $allergen);
            });

            // Bases 2 and 3 — only where base 1 has nothing to say.
            $scoped->orWhere(function (Builder $fallback) use ($allergen, $published): void {
                $fallback->whereNotExists(function ($sub) use ($published): void {
                    $sub->selectRaw('1')
                        ->from('recipe_versions as rv')
                        ->whereColumn('rv.recipe_id', 'catalogue_items.recipe_id')
                        ->whereColumn('rv.organisation_id', 'catalogue_items.organisation_id')
                        ->where('rv.status', $published);
                })->where(function (Builder $either) use ($allergen): void {
                    // Base 3 — the item's listed ingredients.
                    $either->whereExists(function ($sub) use ($allergen): void {
                        $sub->selectRaw('1')
                            ->from('catalogue_item_ingredients as cii')
                            ->join('ingredient_allergens as ia', 'ia.ingredient_id', '=', 'cii.ingredient_id')
                            ->whereColumn('cii.catalogue_item_id', 'catalogue_items.id')
                            ->where('ia.allergen_code', $allergen)
                            ->where(function ($layer): void {
                                $layer->whereNull('ia.organisation_id')
                                    ->orWhereColumn('ia.organisation_id', 'catalogue_items.organisation_id');
                            });
                    });

                    // Base 2 — the single linked ingredient, for an item carrying no list of its
                    // own. The service reaches for this only when the list is empty, and so does
                    // this: an item with both would otherwise match on a row the label ignores.
                    $either->orWhere(function (Builder $linked) use ($allergen): void {
                        $linked->whereNotExists(function ($sub): void {
                            $sub->selectRaw('1')
                                ->from('catalogue_item_ingredients as cii')
                                ->whereColumn('cii.catalogue_item_id', 'catalogue_items.id');
                        })->whereExists(function ($sub) use ($allergen): void {
                            $sub->selectRaw('1')
                                ->from('ingredient_allergens as ia')
                                ->whereColumn('ia.ingredient_id', 'catalogue_items.ingredient_id')
                                ->where('ia.allergen_code', $allergen)
                                ->where(function ($layer): void {
                                    $layer->whereNull('ia.organisation_id')
                                        ->orWhereColumn('ia.organisation_id', 'catalogue_items.organisation_id');
                                });
                        });
                    });
                });
            });
        });
    }
}
