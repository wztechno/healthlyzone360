<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Ingredients\Services\AllergenMappingService;
use Healthy360\Ingredients\Services\IngredientListQuery;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\OffsetPage;
use Illuminate\Database\Eloquent\Collection;
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
 *
 * `sort` and `direction` belong to the numbered walk and only to it. The list
 * is seventeen pages deep, so a column header the client sorted for itself
 * would reorder the eighteen rows in front of the reader and leave the other
 * three hundred where they were — which is not a sort of the catalogue, and
 * reads as one. The order therefore lives on the server, beside the `COUNT` and
 * the filters, which are there for the same reason — in {@see IngredientListQuery},
 * which the spreadsheet export shares.
 */
final class IngredientIndexController
{
    public function __construct(
        private readonly IngredientPresenter $presenter,
        private readonly AllergenMappingService $mappings,
        private readonly IngredientListQuery $list,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $query = $this->list->filtered($request)->with(['defaultUnit', 'purchaseUnit', 'capacityUnit']);

        // Resolved before the branch so an unknown `sort` is refused on both walks rather than
        // only on the one that can honour it.
        $order = $this->list->ordering($request);
        $requestedPage = OffsetPage::page($request);

        if ($requestedPage !== null) {
            $perPage = OffsetPage::perPage($request);
            // Counted before the query is constrained: a constrained builder
            // counts the page rather than the collection.
            $total = $query->toBase()->getCountForPagination();

            OffsetPage::assertWithinRange($requestedPage, $perPage, $total);
            OffsetPage::constrain($query, $requestedPage, $perPage, false, $order);

            $rows = $query->get();

            return ApiResponse::data(
                $this->present($rows),
                OffsetPage::meta($rows, $requestedPage, $perPage, $total),
            );
        }

        if ($order !== null) {
            // Refused, not ignored. A keyset walk *is* its ordering — the cursor encodes a
            // position in `(created_at, id)` and means nothing under another one — so a caller
            // asking for both is asking for two incompatible things, and the honest answer is to
            // say so rather than to serve the unsorted list and let them believe it worked.
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'Sorting is available on numbered pages only. Send `page` alongside `sort`.',
                ['parameter' => 'sort'],
            );
        }

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request));

        $page = CursorPage::page($query->get(), $limit);

        return ApiResponse::data($this->present($page['items']), $page['meta']);
    }

    /**
     * One page of ingredients, each carrying the allergen mappings this caller
     * can see.
     *
     * The mappings are fetched for the whole page in one query rather than per
     * row: an allergen column that costs a round trip per row is a column
     * nobody can afford to draw, and this list draws one.
     *
     * @param  Collection<int, Ingredient>  $rows
     * @return list<array<string, mixed>>
     */
    private function present(Collection $rows): array
    {
        $mappings = $this->mappings->mappingsForMany(
            array_values($rows->map(fn (Ingredient $ingredient): string => (string) $ingredient->getKey())->all()),
            $this->mappings->callerLayer(),
        );

        return array_values($rows
            ->map(fn (Ingredient $ingredient): array => $this->presenter->ingredient(
                $ingredient,
                $mappings[(string) $ingredient->getKey()] ?? [],
            ))
            ->all());
    }
}
