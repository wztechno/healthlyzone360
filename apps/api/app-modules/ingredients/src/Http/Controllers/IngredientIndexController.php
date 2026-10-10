<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Closure;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Ingredients\Services\AllergenMappingService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\OffsetPage;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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
 * reads as one. The order therefore lives here, beside the `COUNT` and the
 * filters, which are on the server for the same reason.
 */
final class IngredientIndexController
{
    public function __construct(
        private readonly IngredientPresenter $presenter,
        private readonly AllergenMappingService $mappings,
        private readonly TenantContext $context,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $query = Ingredient::query()->with(['defaultUnit', 'purchaseUnit', 'capacityUnit']);

        $this->applyStatus($request, $query);
        $this->applyCategory($request, $query);
        $this->applyExcludedCategory($request, $query);
        $this->applyReferenceSeries($request, $query);
        $this->applyAllergen($request, $query);
        $this->applySearch($request, $query);
        $this->hideForkedPlatformRows($query);

        // Resolved before the branch so an unknown `sort` is refused on both walks rather than
        // only on the one that can honour it.
        $order = $this->ordering($request);
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
     * What each sort name orders by, as the SQL it becomes.
     *
     * A whitelist, and every value is a literal in this file: `sort` reaches `ORDER BY`, and the
     * one thing that must never be true of a string on that path is that the caller chose it.
     * Static analysis holds the line here too — `orderByRaw` takes a `literal-string`, so a
     * column name assembled from a request could not be passed to it even by mistake.
     *
     * `name` is absent deliberately. The list renders the reader's own language and sorts on what
     * it renders, so the client names the column — `name_en` or `name_ar` — rather than the
     * server guessing a locale from a header it ignores everywhere else in this presenter.
     */
    private const SORT_COLUMNS = [
        'reference' => 'ingredients.source_ref',
        'name_en' => 'ingredients.name_en',
        'name_ar' => 'ingredients.name_ar',
        'unit_price' => 'ingredients.unit_price_amount',
        'status' => 'ingredients.status',
        'updated_at' => 'ingredients.updated_at',
    ];

    /**
     * The two sorts that are not columns on this table at all.
     *
     * `category` and `unit` are foreign keys, and ordering by a UUID is ordering by nothing a
     * reader can see — the list draws the category's *code* and the unit's *code*, so those are
     * what it has to order by.
     *
     * A correlated subquery rather than a join, for the reason {@see applyAllergen} gives: a join
     * would have to be proved not to multiply the page, and a subquery is simply incapable of it.
     */
    private const SORT_SUBQUERIES = [
        'category' => '(select ingredient_categories.code from ingredient_categories'
            .' where ingredient_categories.id = ingredients.ingredient_category_id)',
        'unit' => '(select measurement_units.code from measurement_units'
            .' where measurement_units.id = ingredients.default_unit_id)',
    ];

    /**
     * How the page is ordered, or `null` for the collection's own `(created_at, id)`.
     *
     * Handed to {@see OffsetPage::constrain()} rather than applied here — see its docblock for why
     * neither before nor after that call would work.
     *
     * **Empties sort last in both directions.** A row with no reference or no price is not the
     * smallest one; it is the one somebody has to go and fill in, and a descending sort that
     * buried it under three hundred priced rows would hide exactly what the reader pressed the
     * column to find. `NULLS LAST` on a descending sort is Postgres' default and is stated anyway,
     * so the rule is one line rather than a fact about which direction was asked for.
     *
     * @throws ApiException
     */
    private function ordering(Request $request): ?Closure
    {
        $sort = $request->query('sort');

        if ($sort === null || $sort === '') {
            return null;
        }

        $direction = $this->direction($request);

        if (! is_string($sort)) {
            throw $this->unsortable();
        }

        $expression = self::SORT_COLUMNS[$sort] ?? self::SORT_SUBQUERIES[$sort] ?? null;

        if ($expression === null) {
            throw $this->unsortable();
        }

        return static function (Builder $query) use ($expression, $direction): void {
            $query->orderByRaw($expression.' '.$direction.' nulls last');
        };
    }

    /**
     * @return 'asc'|'desc'
     *
     * @throws ApiException
     */
    private function direction(Request $request): string
    {
        $direction = $request->query('direction');

        if ($direction === null || $direction === '') {
            return 'asc';
        }

        if ($direction !== 'asc' && $direction !== 'desc') {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The sort direction must be one of: asc, desc.',
                ['parameter' => 'direction'],
            );
        }

        return $direction;
    }

    private function unsortable(): ApiException
    {
        return new ApiException(
            ErrorCode::RequestInvalid,
            'The sort must be one of: '.implode(', ', [
                ...array_keys(self::SORT_COLUMNS),
                ...array_keys(self::SORT_SUBQUERIES),
            ]).'.',
            ['parameter' => 'sort'],
        );
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

    /**
     * A library row this kitchen has forked is dropped, so the fork replaces it
     * rather than sitting beside it.
     *
     * Without this the two layers both surface and the catalogue lists "Olive
     * oil" twice — the platform row and the kitchen's copy of it — with nothing
     * on either to say which one a cook should pick, and a search for it
     * returning a read-only row half the time. The fork is the newer, editable,
     * kitchen-specific answer, so it is the one that survives.
     *
     * A `WHERE id NOT IN (subquery)` rather than a join: the set is small (a
     * kitchen forks a handful of rows, not thousands), the subquery is a single
     * indexed read on `(organisation_id, forked_from_ingredient_id)`, and a
     * join would have to be an anti-join to avoid multiplying the page.
     *
     * Only the *shadowed* row goes. The fork is a normal tenant row and is
     * listed by the ordinary scope, and a platform row nobody has forked is
     * untouched.
     *
     * @param  Builder<Ingredient>  $query
     */
    private function hideForkedPlatformRows(Builder $query): void
    {
        $organisationId = $this->context->organisationId();

        if ($organisationId === null) {
            return;
        }

        $query->whereNotIn(
            'id',
            Ingredient::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->whereNotNull('forked_from_ingredient_id')
                ->select('forked_from_ingredient_id'),
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
     * Narrows to the rows declaring one allergen class.
     *
     * **Both containments match, and that is the whole design of it.** A mapping is `contains` or
     * `may_contain`, and the list's Allergens column prints every code either way — so a row
     * reading `gluten` that a `gluten` filter did not return would be the list disagreeing with
     * itself on screen. It is also the safe direction: somebody narrowing a catalogue by an
     * allergen is looking for everything that could carry it, and a filter that quietly dropped
     * the `may_contain` rows would answer a food-safety question by under-reporting.
     *
     * Filtering here rather than in the client, unlike the status fallback: this list is paged
     * seventeen deep, and a filter applied to the loaded page narrows that page while every count
     * and every page after it goes on describing the unfiltered set. `IngredientAdminFilter`
     * carries `allergenCodes` for the picker, which loads one page and means it.
     *
     * `whereExists` rather than a join, because a row declaring an allergen twice — the platform
     * baseline and a kitchen's own determination — would otherwise arrive twice.
     *
     * @param  Builder<Ingredient>  $query
     */
    private function applyAllergen(Request $request, Builder $query): void
    {
        $allergen = $request->query('allergen');

        if (! is_string($allergen) || $allergen === '') {
            return;
        }

        $query->whereExists(function ($scoped) use ($allergen): void {
            $scoped->select(DB::raw(1))
                ->from('ingredient_allergens')
                ->whereColumn('ingredient_allergens.ingredient_id', 'ingredients.id')
                ->where('ingredient_allergens.allergen_code', $allergen);
        });
    }

    /**
     * Drops a whole branch of the taxonomy from the answer.
     *
     * The case it exists for is packaging. Bags, lids and cutlery are
     * ingredient rows — they have to be, or a recipe cannot cost the box its
     * meal ships in — but they are not *raw materials*, and a catalogue of 306
     * foods reads worse with 31 disposables shuffled into it. The recipe
     * editor already made its two pickers disjoint this way; this is the same
     * separation, moved to where the count is computed so the list says 306
     * rather than saying 337 and showing 306.
     *
     * A parameter rather than a hardcoded rule: the endpoint serves the
     * ingredient list *and* the packaging list, and a server that silently hid
     * a branch from both would leave the second one impossible to write.
     * Subcategories go with their parent, matching `applyCategory`.
     *
     * @param  Builder<Ingredient>  $query
     */
    private function applyExcludedCategory(Request $request, Builder $query): void
    {
        $excluded = $request->query('exclude_category');

        if (! is_string($excluded) || $excluded === '') {
            return;
        }

        $query->where(function (Builder $scoped) use ($excluded): void {
            $scoped->where('ingredient_category_id', '!=', $excluded)
                ->orWhereNull('ingredient_category_id');
        })->where(function (Builder $scoped) use ($excluded): void {
            $scoped->where('ingredient_subcategory_id', '!=', $excluded)
                ->orWhereNull('ingredient_subcategory_id');
        });
    }

    /**
     * Keeps only the rows numbered in one series — the ingredient list asks for `ING-`.
     *
     * A whitelist, and it has to be, because everything that ends up in this table wearing another
     * handle got here for a reason of its own. The v6 import writes an ingredient beside every
     * sellable row it brings in — 43 `SAC-` sauces, 19 `DRS-` dressings, 69 `PRD-`/`RSL-` product
     * and resale lines — because a sauce is both sold and consumed and a formulation has to be able
     * to name it. The packaging rows carry `PKG-`. None of them are raw materials, and a library of
     * 306 foods reads badly with a hundred and thirty finished goods shuffled into it.
     *
     * **A whitelist rather than a list of exclusions**, because the exclusions kept losing. Filing
     * cannot separate these: the sauces sit under `sauce`, but the product and resale twins sit
     * under `meat-egg`, `bread` and `dairy`, the same branches real food uses. Clearing the rows by
     * hand cannot either — the import recreates whatever is missing, by design, so every cleanup
     * was undone by the next run. A series a row either carries or does not is the one property
     * that survives both.
     *
     * It follows that a row **must** carry `ING-` to be seen here, which is why `create` assigns the
     * next one and `fork` does too. A kitchen's own ingredient joins the library's sequence at 307
     * rather than arriving without a handle and vanishing from the list it was typed into.
     *
     * A parameter rather than a rule, for the reason `applyExcludedCategory` gives: this endpoint
     * serves the browse list *and* the recipe line picker, and a cook writing a burger has every
     * reason to add Garlic Mayo Sauce as a line. The list passes it; the picker does not.
     *
     * @param  Builder<Ingredient>  $query
     */
    private function applyReferenceSeries(Request $request, Builder $query): void
    {
        $series = $request->query('reference_series');

        if (! is_string($series) || $series === '') {
            return;
        }

        // Anchored, and digits only after the prefix: `ING-` must not also admit
        // `v6-recipe-designations.json#…` or any other shape that happens to start with it.
        $query->where('source_ref', '~', '^'.preg_quote($series, '/').'[0-9]+$');
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
