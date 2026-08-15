<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\OffsetPage;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/catalogue/ingredients — the kitchen's catalogue and the
 * platform library it inherits, in one list.
 *
 * The two layers are not separate endpoints because a cook looking for
 * "chickpeas" does not care who owns the row; `is_platform` on each item is
 * what the client needs to know, and it is on the wire.
 *
 * Walks either way. Without `page` this is the keyset list it has always been,
 * unchanged down to the absent `COUNT`. With `page` it answers numbered pages
 * instead — see {@see OffsetPage} for why this collection is allowed offset
 * when `docs/api/conventions.md` forbids it elsewhere, and why the count that
 * makes "page 3 of 12" possible is only paid for when somebody asks for it.
 */
final class IngredientIndexController
{
    public function __construct(private readonly IngredientPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $query = Ingredient::query()->with('defaultUnit');

        $this->applyStatus($request, $query);
        $this->applyCategory($request, $query);
        $this->applySearch($request, $query);

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
                $rows->map(fn (Ingredient $ingredient): array => $this->presenter->ingredient($ingredient))->all(),
                OffsetPage::meta($rows, $requestedPage, $perPage, $total),
            );
        }

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request));

        $page = CursorPage::page($query->get(), $limit);

        return ApiResponse::data(
            $page['items']->map(fn (Ingredient $ingredient): array => $this->presenter->ingredient($ingredient))->all(),
            $page['meta'],
        );
    }

    /**
     * Archived rows are excluded unless asked for by name: an archived
     * ingredient is history, and a list that quietly includes it invites
     * somebody to build a recipe out of one.
     *
     * @param  Builder<Ingredient>  $query
     *
     * @throws ApiException
     */
    private function applyStatus(Request $request, Builder $query): void
    {
        $status = $request->query('status');

        if ($status === null || $status === '') {
            $query->whereIn('status', [IngredientStatus::Active->value, IngredientStatus::Inactive->value]);

            return;
        }

        if (! is_string($status) || IngredientStatus::tryFrom($status) === null) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The status filter must be one of: active, inactive, archived.',
                ['parameter' => 'status'],
            );
        }

        $query->where('status', $status);
    }

    /**
     * @param  Builder<Ingredient>  $query
     */
    private function applyCategory(Request $request, Builder $query): void
    {
        $category = $request->query('category');

        if (! is_string($category) || $category === '') {
            return;
        }

        $query->where(function (Builder $scoped) use ($category): void {
            $scoped->where('ingredient_category_id', $category)
                ->orWhere('ingredient_subcategory_id', $category);
        });
    }

    /**
     * Matches names and aliases. `ILIKE` with an escaped needle, not a
     * regular expression and not a full-text index: the catalogue is small,
     * and a substring search a cook can predict beats a clever one they
     * cannot.
     *
     * @param  Builder<Ingredient>  $query
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
                ->orWhereExists(function ($alias) use ($needle): void {
                    $alias->from('ingredient_aliases')
                        ->whereColumn('ingredient_aliases.ingredient_id', 'ingredients.id')
                        ->whereRaw('ingredient_aliases.alias_normalised like ?', [$needle]);
                });
        });
    }
}
