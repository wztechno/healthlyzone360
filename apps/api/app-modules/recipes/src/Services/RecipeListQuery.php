<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Recipes\Contracts\RecipeUsageRegistry;
use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Enums\RecipeStatus;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

/**
 * The recipe book's filters — status, category, search, allergen, stale-only and sellers — as one
 * query, so the paged list and the spreadsheet export narrow by the identical rules.
 */
final class RecipeListQuery
{
    private const string STATUS_FILTER_MESSAGE = 'The status filter must be one of: active, archived, draft, review_required, published, retired.';

    public function __construct(
        private readonly RecipeUsageRegistry $usage,
    ) {}

    /**
     * @return Builder<Recipe>
     *
     * @throws ApiException
     */
    public function filtered(Request $request, bool $sellersVisible): Builder
    {
        $query = Recipe::query();

        $this->applyStatus($request, $query);
        $this->applyCategory($request, $query);
        $this->applySearch($request, $query, $sellersVisible);
        $this->applyAllergen($request, $query);
        $this->applyStaleOnly($request, $query);
        $this->applySellers($request, $query, $sellersVisible);

        return $query;
    }

    /**
     * Archived recipes are excluded unless asked for by name — the same rule
     * the ingredient list applies, and for the same reason.
     *
     * @param  Builder<Recipe>  $query
     *
     * @throws ApiException
     */
    private function applyStatus(Request $request, Builder $query): void
    {
        $status = $request->query('status');

        if ($status === null || $status === '') {
            $query->where('status', RecipeStatus::Active->value);

            return;
        }

        if (! is_string($status)) {
            throw new ApiException(ErrorCode::RequestInvalid, self::STATUS_FILTER_MESSAGE, ['parameter' => 'status']);
        }

        if (RecipeStatus::tryFrom($status) !== null) {
            $query->where('status', $status);

            return;
        }

        /*
         * A version state, not a recipe state.
         *
         * The recipe row carries `active | archived`; everything a reader actually filters by —
         * draft, review_required, published — lives on the version. The client used to translate
         * as best it could (published → active, retired → archived) and **drop draft and
         * review_required on the floor**, so picking either sent an unfiltered request and the list
         * answered with everything. That was invisible before a quarantine existed and is not
         * invisible now.
         *
         * Narrowed against the *current* version, for the same reason the Allergens filter is: the
         * status the row displays and the status the filter matches have to be the same one.
         */
        $versionStatus = RecipeVersionStatus::tryFrom($status);

        if ($versionStatus === null) {
            throw new ApiException(ErrorCode::RequestInvalid, self::STATUS_FILTER_MESSAGE, ['parameter' => 'status']);
        }

        if ($versionStatus === RecipeVersionStatus::Retired) {
            $query->where('status', RecipeStatus::Archived->value);

            return;
        }

        $query->where('status', RecipeStatus::Active->value)
            ->whereExists(function ($sub) use ($versionStatus): void {
                $sub->selectRaw('1')
                    ->from('recipe_versions as rv')
                    ->whereColumn('rv.recipe_id', 'recipes.id')
                    ->where('rv.status', $versionStatus->value)
                    ->whereRaw(
                        'rv.id = (
                            select inner_rv.id
                            from recipe_versions as inner_rv
                            where inner_rv.recipe_id = recipes.id
                            order by '.str_replace(
                            ['status', 'version_number'],
                            ['inner_rv.status', 'inner_rv.version_number'],
                            RecipeSummaries::CURRENT_VERSION_ORDER,
                        ).'
                            limit 1
                        )',
                        [
                            RecipeVersionStatus::Draft->value,
                            RecipeVersionStatus::ReviewRequired->value,
                            RecipeVersionStatus::Published->value,
                        ],
                    );
            });
    }

    /**
     * @param  Builder<Recipe>  $query
     */
    private function applyCategory(Request $request, Builder $query): void
    {
        $category = $request->query('category');

        if (! is_string($category) || $category === '') {
            return;
        }

        $query->where('recipe_category', $category);
    }

    /**
     * Both names, the slug, the recipe's own handle (`RC-0007`) — and, for a reader who may see the
     * catalogue, the handle and name of any item selling it (`SAC-016`, "Garlic mayo").
     *
     * The book prints the seller's handle in its ID column when there is one, so a search that
     * could not find what the column shows would read as a broken search. The seller half is left
     * out for a reader without catalogue view, exactly as the column is: finding a recipe by a
     * name the reader cannot see would disclose it.
     *
     * @param  Builder<Recipe>  $query
     */
    private function applySearch(Request $request, Builder $query, bool $sellersVisible): void
    {
        $term = $request->query('query');

        if (! is_string($term) || trim($term) === '') {
            return;
        }

        $needle = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower(trim($term))).'%';

        $query->where(function (Builder $scoped) use ($needle, $sellersVisible): void {
            $scoped->whereRaw('lower(name_en) like ?', [$needle])
                ->orWhereRaw('lower(name_ar) like ?', [$needle])
                ->orWhereRaw('lower(slug) like ?', [$needle])
                ->orWhereRaw('lower(recipes.source_ref) like ?', [$needle]);

            if ($sellersVisible) {
                $this->usage->orWhereSellerMatches($scoped, $needle);
            }
        });
    }

    /**
     * Narrows to the recipes whose current version declares one allergen class.
     *
     * **Against the current version, not every version the recipe has ever had.** A recipe that
     * carried sesame at v1 and had it formulated out by v4 is not a sesame recipe, and a filter
     * matching any version would keep returning it — worse, it would return it while the row's own
     * Allergens cell, which reads the current version, showed no sesame. The list would be
     * disagreeing with itself on screen, which is the failure mode this filter exists to avoid.
     *
     * **Current is the client's rule, in SQL.** `pickCurrentRecipeVersion` prefers the highest
     * editable version — draft or review-required — then the published one, then the highest
     * number there is. That ordering is reproduced here rather than approximated, because the
     * column and the filter have to be reading the same version or the disagreement above comes
     * back through the other door. It differs from `applyStaleOnly`'s simpler "highest of the
     * three": that one is answering a question about the review queue, where any open version
     * carrying a stale derivation is worth surfacing, and the two are allowed to differ because
     * they are not answering the same question.
     *
     * **Both containments match**, the same call the ingredient list makes and for the same
     * reason: the Allergens column prints `contains` and `may_contain` alike, so a row reading
     * `gluten` that a `gluten` filter did not return would be the list disagreeing with itself.
     * It is also the safe direction — somebody narrowing by an allergen wants everything that
     * could carry it, and dropping the `may_contain` rows would answer a food-safety question by
     * under-reporting.
     *
     * **Declared rows match too.** A chef's `declared` row is the strongest claim on the label —
     * a human who knows the fryer is shared — so a filter that only matched `derived` would hide
     * exactly the warnings somebody has taken the trouble to write down.
     *
     * Filtered here rather than in the client because the recipe book is paged: a filter applied
     * to the loaded page narrows that page while the count and every page after it go on
     * describing the unfiltered set.
     *
     * @param  Builder<Recipe>  $query
     */
    private function applyAllergen(Request $request, Builder $query): void
    {
        $allergen = $request->query('allergen');

        if (! is_string($allergen) || $allergen === '') {
            return;
        }

        $query->whereExists(function ($sub) use ($allergen): void {
            $sub->selectRaw('1')
                ->from('recipe_version_allergens')
                ->where('recipe_version_allergens.allergen_code', $allergen)
                ->whereRaw(
                    'recipe_version_allergens.recipe_version_id = (
                        select rv.id
                        from recipe_versions as rv
                        where rv.recipe_id = recipes.id
                        order by '.str_replace(
                        ['status', 'version_number'],
                        ['rv.status', 'rv.version_number'],
                        RecipeSummaries::CURRENT_VERSION_ORDER,
                    ).'
                        limit 1
                    )',
                    [
                        RecipeVersionStatus::Draft->value,
                        RecipeVersionStatus::ReviewRequired->value,
                        RecipeVersionStatus::Published->value,
                    ],
                );
        });
    }

    /**
     * When `stale_only` is true, keep recipes whose editable or live version
     * still carries a stale allergen derivation. Used by the kitchen review queue.
     *
     * @param  Builder<Recipe>  $query
     */
    private function applyStaleOnly(Request $request, Builder $query): void
    {
        if (! $request->boolean('stale_only')) {
            return;
        }

        $editableStatuses = [
            RecipeVersionStatus::Draft->value,
            RecipeVersionStatus::ReviewRequired->value,
            RecipeVersionStatus::Published->value,
        ];

        $query->whereExists(function ($sub) use ($editableStatuses): void {
            $sub->selectRaw('1')
                ->from('recipe_versions as current_version')
                ->whereColumn('current_version.recipe_id', 'recipes.id')
                ->whereIn('current_version.status', $editableStatuses)
                ->where('current_version.derivation_state', DerivationState::Stale->value)
                ->whereRaw(
                    'current_version.version_number = (
                        select max(rv.version_number)
                        from recipe_versions as rv
                        where rv.recipe_id = recipes.id
                          and rv.status in (?, ?, ?)
                    )',
                    $editableStatuses,
                );
        });
    }

    /**
     * `kind` and `selling_status`: the recipe book's own axes, both about the items selling a
     * recipe rather than the recipe.
     *
     * **Refused, not ignored, for a reader without catalogue view** — `403` naming the permission.
     * Dropping the filter would answer with every recipe under a Sauces heading, and matching it
     * would let a reader probe what the catalogue sells one request at a time; the client never
     * sends either for such a reader, so a request that does is a mistake worth hearing about.
     *
     * The kind is one of the four cooked kinds or `preparation` (nothing sells it); the status is
     * an item status, the same four words a recipe version uses. Given together they must hold of
     * one seller — the port's rule, stated there.
     *
     * @param  Builder<Recipe>  $query
     *
     * @throws ApiException
     */
    private function applySellers(Request $request, Builder $query, bool $sellersVisible): void
    {
        $sent = array_values(array_filter(
            ['kind', 'selling_status'],
            static fn (string $parameter): bool => ! in_array($request->query($parameter), [null, ''], true),
        ));

        if ($sent === []) {
            return;
        }

        if (! $sellersVisible) {
            throw new ApiException(
                ErrorCode::AuthzPermissionDenied,
                'Filtering recipes by what sells them needs permission to view the catalogue.',
                ['reason' => 'permission_not_granted', 'permission' => RecipeSummaries::SELLERS_PERMISSION],
            );
        }

        $this->usage->constrainBySellers(
            $query,
            $this->sellerFilter($request, 'kind', [...RecipeUsageRegistry::KINDS, RecipeUsageRegistry::PREPARATION]),
            // The catalogue's item statuses are the same four a recipe version carries — the two
            // families are one vocabulary by design — and recipes may not name the catalogue enum.
            $this->sellerFilter($request, 'selling_status', array_column(RecipeVersionStatus::cases(), 'value')),
        );
    }

    /**
     * One seller filter's value: null when absent, the value when it is one of `$allowed`, and a
     * `400` naming the parameter for anything else — never a filter that quietly matches nothing.
     *
     * @param  list<string>  $allowed
     *
     * @throws ApiException
     */
    private function sellerFilter(Request $request, string $parameter, array $allowed): ?string
    {
        $value = $request->query($parameter);

        if ($value === null || $value === '') {
            return null;
        }

        if (! is_string($value) || ! in_array($value, $allowed, true)) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                sprintf('The %s filter must be one of: %s.', $parameter, implode(', ', $allowed)),
                ['parameter' => $parameter],
            );
        }

        return $value;
    }
}
