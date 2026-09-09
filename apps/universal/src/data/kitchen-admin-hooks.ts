import type {
    AllergenClass,
    BranchOperating,
    CreateDeliveryZoneRequest,
    CreateIngredientRequest,
    CreateMealRequest,
    CreatePlanRequest,
    CreateProductRequest,
    CreateRecipeRequest,
    CursorPage,
    DeliveryZoneAdmin,
    DeliveryZoneAdminFilter,
    IngredientAdmin,
    IngredientAdminFilter,
    IngredientCategoryAdmin,
    LockedRequest,
    MealAdmin,
    MealAdminFilter,
    PlanAdmin,
    PlanAdminFilter,
    PlanMenu,
    PriceListAdmin,
    PriceListAdminFilter,
    ProductAdmin,
    ProductAdminFilter,
    RecipeAdmin,
    RecipeAdminFilter,
    RecipeAdminSummary,
    RecipeRollupDraft,
    RecipeRollupPreview,
    ReferenceSeries,
    ReplacePlanMenuRequest,
    ServiceArea,
    SetBranchOperatingRequest,
    SetChannelAvailabilityRequest,
    SetDeliveryWindowsRequest,
    SetIngredientAllergensRequest,
    SetMealAvailabilityRequest,
    SetPlanCombinationsRequest,
    SetPlanDurationsRequest,
    SetPlanVariantsRequest,
    SetPriceListEntriesRequest,
    SetRecipeLinesRequest,
    SetRecipePackagingRequest,
    SetRecipeOutputsRequest,
    SetRecipeStepsRequest,
    SetZoneAreasRequest,
    UpdateDeliveryZoneRequest,
    UpdateIngredientRequest,
    UpdateMealRequest,
    UpdatePlanRequest,
    UpdateProductRequest,
    UpdateRecipeRequest,
    TechnicalSheetAdmin,
} from '@healthy360/api-client/contracts';
import { PACKAGING_CATEGORY_CODE, pageCount } from '@healthy360/api-client/contracts';
import type {
    DeliveryZoneId,
    IngredientId,
    KitchenBranchId,
    KitchenId,
    MealId,
    PriceListId,
    ProductId,
    RecipeId,
    SubscriptionPlanId,
    RecipeVersionId,
} from '@healthy360/domain-types';
import {
    hashKey,
    keepPreviousData,
    useInfiniteQuery,
    useMutation,
    useQueries,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import type {
    InfiniteData,
    UseInfiniteQueryResult,
    UseMutationResult,
    UseQueryResult,
} from '@tanstack/react-query';

import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

/**
 * The kitchen workspace's data access (phase K1).
 *
 * Same rules as every other hook module here — one hook per repository operation, the `enabled`
 * guards and the invalidation written once, and no screen ever holding a repository. Four things are
 * specific to this file, and each is a decision rather than a style.
 *
 * ## Every list is an infinite query, and the recipes/products/plans ones will be too
 *
 * `KitchenAdminRepository` answers every listing with a `CursorPage`, and an admin list is exactly
 * the surface where "the next twenty without losing the twenty I was reading" matters: somebody
 * narrowing a search is comparing rows, not paging through them. So the ingredient listing is a
 * `useInfiniteQuery` with a "load more" control, built the same way `useMealsQuery` is
 * (`./catalogue-hooks.ts`) — the cursor is deliberately **not** part of the query key, because a key
 * that carried it would create one cache entry per page and throw the accumulated list away on every
 * filter change.
 *
 * `listAllergenClasses` is the exception and says so in the contract: fourteen regulatory rows, not
 * paginated, no writer.
 *
 * ## Every mutation writes the detail entry *and* invalidates the root
 *
 * A management write answers with the whole record at its new `lockVersion`, so the detail entry is
 * written synchronously — the editor has to rebase its lock version in the same frame it reports
 * success, and a refetch would land after it. The *root* is then invalidated rather than the list
 * key, because one write can move a row between several cached views at once: renaming an ingredient
 * changes its list row, archiving it removes it from the default status filter, and saving an
 * allergen mapping can quarantine both the ingredient and every published recipe that derived a
 * label from it (`mock/prototype/catalogue-store.ts`). A narrower invalidation would leave at least
 * one of those views showing something that is no longer true.
 *
 * ## Two contract gaps, probed rather than invented
 *
 * 1. **There is no category resource.** `IngredientAdmin` carries a `categoryCode` and
 *    `IngredientAdminFilter` filters on one, but `KitchenAdminRepository` publishes no
 *    `listIngredientCategories()`, no create and no rename. {@link useIngredientCategoriesQuery}
 *    therefore derives the vocabulary from the codes in use — honest, contract-only, and wrong in an
 *    obvious way: a category nobody has assigned yet is invisible, and a code cannot be renamed
 *    without touching every row that carries it. A real `GET /api/v1/kitchen/ingredient-categories`
 *    collapses this into one request and makes the create/rename affordances possible.
 * 2. **Aliases are a field, not a sub-resource.** `UpdateIngredientRequest.aliases` replaces the
 *    whole list, so "add" and "remove" are edits to the editor's working copy that travel with the
 *    next save. There is no `addIngredientAlias` to wrap, and inventing a hook that pretended
 *    otherwise would put a spinner on a control that never reaches the network.
 *
 * ## Three more gaps, on the recipe half (K1.2)
 *
 * 3. **A version is not addressable.** `KitchenAdminRepository` publishes `getRecipe`, and a
 *    `RecipeAdmin` carries its *current* version in full plus a `RecipeVersionSummary` per
 *    version. There is no `getRecipeVersion(id)`, so the lines of a version that is not current
 *    cannot be read at all. {@link useRecipeQuery} is therefore the only version reader there is,
 *    and the editor says so where a reader would otherwise expect to open an older version.
 * 4. **There is no `createVersion`.** A published version is immutable, and the server opens the
 *    next draft *as a consequence of the first write to it* — which is why every line/step/output
 *    setter answers with the whole `RecipeAdmin` rather than with the version the caller thought it
 *    was editing. {@link useOpenRecipeDraftMutation} therefore sends an `updateRecipe` carrying
 *    nothing but the lock version: the smallest legal write, whose only effect is that the draft
 *    exists. "Copy from" is not a parameter because there is nothing to point it at — the copy is
 *    always taken from the current version.
 * 5. **A recipe has no category and no confidentiality flag.** `RecipeAdminSummary` carries a
 *    kitchen, a name, a slug, version counters and the publication meta, and nothing else. The list
 *    filters on {@link useRecipeKitchensQuery} — derived from the rows in use, exactly as the
 *    ingredient categories are, and backed by a real `RecipeAdminFilter.kitchenId` — rather than on
 *    a taxonomy the contract has never published.
 *
 * ## Four more, on the product and meal half (K1.4)
 *
 * 6. **A product has no publication action.** `ProductAdmin.meta` carries the full
 *    `PublishableStatus`, and `KitchenAdminRepository` publishes `archiveProduct` and nothing else:
 *    no `publishProduct`, no `retireProduct`. So a product moves *out* of visibility from this
 *    workspace and never into it, and no hook here pretends otherwise. The screens render the status
 *    they are given and offer archive alone; when the publication actions land, they join this file
 *    beside {@link usePublishMealMutation} and the editor grows one button.
 * 7. **A meal's channel availability is readable and not writable.** `MealAdmin.channelAvailability`
 *    is on the read shape, but `setProductChannelAvailability` is a *product* method and the contract
 *    has no meal counterpart. The meal editor therefore shows the channels as a fact and puts the
 *    editor on the product, which is the only place a setter exists.
 * 8. **Neither family has a category resource**, exactly as the ingredients do not.
 *    {@link useProductCategoriesQuery} derives the vocabulary from the codes in use, with the same
 *    honest limitation the ingredient one documents. Meals have no category at all; their second axis
 *    is `MealAdminFilter.mealTypes`, which is a closed platform enum and needs no derivation.
 * 9. **A meal's diet classifications and allergens are answered from its recipe.** The contract
 *    accepts `dietClassifications` on the meal write and returns `allergens` frozen from the recipe
 *    version; there is no allergen setter and no per-meal provenance beyond `recipeId` /
 *    `recipeVersionId`. The editor writes the one and displays the other, and says which is which.
 *
 * ## Four more, on the pricing half (K1.5)
 *
 * 10. **A price list cannot be created, renamed or retired from here.** `KitchenAdminRepository`
 *     publishes `listPriceLists`, `getPriceList`, `setPriceListEntries` and `publishPriceList` —
 *     no `createPriceList`, no `updatePriceList`, no `retirePriceList`. So a list's name, currency,
 *     kitchen and channel set are **read-only facts** in this workspace, the list screen offers no
 *     create affordance, and the editor's header states the currency rather than offering to change
 *     it. That also settles the "is the currency read-only after creation?" question the slice was
 *     told to probe: there is no creation path to be after.
 * 11. **An entry has no minimum quantity.** `PriceListEntry` is item + status + amount + effective
 *     dates + note, and nothing else. Volume tiers exist on the *B2B* contract
 *     (`business.ts` `CatalogueItemTier`) and not on this one, so no minimum-quantity control is
 *     rendered here; a field that wrote nowhere would be worse than its absence.
 * 12. **Effective dating is modelled per entry; supersession history is not readable.** Every entry
 *     carries `effectiveFrom` and a nullable `effectiveUntil`, so the editor edits both. But
 *     `setPriceListEntries` *replaces* the set, and there is no reader for anything a replacement
 *     displaced — so no history affordance is offered, because there is no history to open.
 * 13. **There is no customer scope.** `PriceListAdmin` carries `channels` and no `customerScope` or
 *     agreement reference, so "this list belongs to one buyer relationship" is expressed by the
 *     channel set alone (`hasPrivatePricing`), and the confidential treatment keys off that.
 *
 * ## Four more, on the delivery half (K1.7)
 *
 * 14. **A delivery window belongs to a zone, not to the kitchen.** `setDeliveryWindows` takes a
 *     `DeliveryZoneId` and answers with the whole `DeliveryZoneAdmin`; there is no `listWindows`,
 *     no `getWindow` and no kitchen-wide window resource. So there is no windows hook here and no
 *     windows screen: the zone editor owns them, which is where the only setter is.
 * 15. **A zone has no publication action.** The contract publishes `archiveZone` and nothing else —
 *     no `publishZone`, no `retireZone` — so a zone moves *out* of visibility from this workspace
 *     and never into it, exactly as a product does. {@link useZoneSummaryQuery} therefore counts
 *     three statuses rather than four; `review_required` is unreachable for this family.
 * 16. **The kitchen workspace cannot list its own branches.** `KitchenAdminRepository` has
 *     `getBranchOperating(branchId)` and no `listBranches`, and `DeliveryZoneAdmin.branchIds` is a
 *     list of identifiers with no names attached. Two consequences, both deliberate: the branch a
 *     person edits hours for is the **session's active branch** rather than one picked from a list
 *     this contract cannot supply, and the zone editor shows `branchIds` as a read-only count
 *     instead of offering a picker whose vocabulary it would have to invent — a picker missing an
 *     option would silently drop a branch from the zone on the next save.
 * 17. **A zone's currency has no organisational source.** `CreateDeliveryZoneRequest.currency` is
 *     required and nothing on the session, the organisation or this contract publishes "the
 *     currency this kitchen trades in". The create form therefore derives the default from the
 *     currencies already in use — the kitchen's own zones first, then its price lists — and offers
 *     the full `CURRENCY_CODES` list when neither exists, rather than hard-coding a country's money.
 */

export { toFailure } from './hooks.ts';

/* ── platform reference ──────────────────────────────────────────────────────────────────────── */

/**
 * The fourteen canonical allergen classes.
 *
 * Read-only by construction: the contract has no writer, because a kitchen maps onto these codes and
 * never edits them (plan §4.6). Every screen that renders a mapping needs the list, so it is one
 * cache entry shared between the reference page and the mapping editor.
 */
export function useAllergenClassesQuery(): UseQueryResult<readonly AllergenClass[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.allergenClasses(),
        enabled: repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listAllergenClasses();
        },
    });
}

/* ── ingredients ─────────────────────────────────────────────────────────────────────────────── */

export type IngredientsInfiniteResult = UseInfiniteQueryResult<
    InfiniteData<CursorPage<IngredientAdmin>, string | undefined>,
    Error
>;

/** The accumulated ingredients across every page fetched so far. */
export function ingredientsFromPages(
    pages: readonly CursorPage<IngredientAdmin>[] | undefined,
): readonly IngredientAdmin[] {
    return (pages ?? []).flatMap((page) => page.items);
}

/** Total matching rows when the repository can count them; `null` when it cannot. */
export function ingredientTotalFromPages(
    pages: readonly CursorPage<IngredientAdmin>[] | undefined,
): number | null {
    return pages?.[0]?.totalCount ?? null;
}

export function useIngredientsQuery(
    filter?: Omit<IngredientAdminFilter, 'cursor'>,
    enabled = true,
): IngredientsInfiniteResult {
    const { repositories } = useRepositoryContext();

    return useInfiniteQuery({
        queryKey: queryKeys.kitchenAdmin.ingredients(filter),
        enabled: enabled && repositories !== null,
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listIngredients({
                ...filter,
                ...(pageParam === undefined ? {} : { cursor: pageParam }),
            });
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });
}

/**
 * One ingredient.
 *
 * `ingredientId` is nullable for the reason every detail hook here is: a route parameter may not be
 * there on the first frame of a deep link, and it is `null` for the whole life of the *create*
 * screen, which has no record to read yet.
 */
export function useIngredientQuery(
    ingredientId: IngredientId | null,
): UseQueryResult<IngredientAdmin> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.ingredient(ingredientId ?? ('' as IngredientId)),
        enabled: repositories !== null && ingredientId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (ingredientId === null) throw new Error('No ingredient identifier.');
            return repositories.kitchenAdmin.getIngredient(ingredientId);
        },
    });
}

/**
 * The specific ingredients a set of ids names, read one request at a time.
 *
 * The recipe editor's line table has to show a designation and a unit price for every row it draws,
 * and the row only stores an id. It cannot get those from the listing: `CursorPage::MAX_LIMIT` is
 * 100 and the library is several hundred, so a line whose ingredient happens to sort onto page two
 * would render with a blank name and no price — which is what "not all ingredients are showing"
 * looks like from inside a saved recipe.
 *
 * It cannot get them from the recipe either. `RecipeVersionPresenter` omits `unit_cost_amount` and
 * `line_cost_amount` on purpose until the `recipe.view_costs_organisation` split exists (K1.3), so
 * `RecipeLine.lineCost` is `null` on the wire, and `ingredientName` is really the line's
 * `source_designation` — often empty. The ingredient record is the only place both facts live.
 *
 * So the ids are resolved directly, and the cost is bounded by the length of a recipe rather than by
 * the size of the library: twenty lines is twenty cached reads, and every one of them is the same
 * cache entry the ingredient editor opens.
 */
export function useIngredientsByIds(
    ingredientIds: readonly IngredientId[],
): Readonly<Record<string, IngredientAdmin>> {
    const { repositories } = useRepositoryContext();

    return useQueries({
        queries: ingredientIds.map((ingredientId) => ({
            queryKey: queryKeys.kitchenAdmin.ingredient(ingredientId),
            enabled: repositories !== null,
            queryFn: () => {
                if (repositories === null) throw new Error('Repositories are not ready.');
                return repositories.kitchenAdmin.getIngredient(ingredientId);
            },
        })),
        // A plain record, for the reason `useRecipeDetails` gives: `combine` runs through the same
        // structural sharing every other query result does, and its memoisation is what keeps the
        // callers' `useMemo`s from rebuilding on every render.
        combine: (results): Readonly<Record<string, IngredientAdmin>> => {
            const byId: Record<string, IngredientAdmin> = {};
            for (const result of results) {
                if (result.data !== undefined) byId[String(result.data.id)] = result.data;
            }
            return byId;
        },
    });
}

/**
 * The declared category tree — both levels, every branch, whether or not anything is filed under it.
 *
 * This used to be derived: one unfiltered page of a hundred ingredients, reduced to the set of
 * `categoryCode`s that appeared on it. That answered "which categories are in use on page one",
 * which is not the question either picker asks. A category whose ingredients all sat on page two
 * was missing from the filter; a sub-category with nothing under it yet could not be chosen at all,
 * so the only way to file the first ingredient under a new leaf was to not use it. The contract now
 * carries {@link KitchenAdminRepository.listIngredientCategories}, so this is a read.
 *
 * Unpaginated and effectively static, so it is left to the client's default staleness rather than
 * refetched per keystroke of a filter.
 */
export function useIngredientCategoriesQuery(): UseQueryResult<readonly IngredientCategoryAdmin[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.ingredientCategories(),
        enabled: repositories !== null,
        queryFn: (): Promise<readonly IngredientCategoryAdmin[]> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listIngredientCategories();
        },
    });
}

/**
 * The handle the next record of a kind will take — `ING-307`, `SAC-0016`.
 *
 * For a create form, which draws its reference before there is a record to read one from. It is
 * the same scan the create itself performs, so the two agree; it is a *preview* and not a
 * reservation, so two forms open at once are both told 307 and the second save lands at 308.
 *
 * `enabled` is the caller's, because the only screen that wants this is one that is creating.
 * Failure is not an error state anybody should see: a form whose reference box is empty is the
 * behaviour that existed before this endpoint, so callers render `''` and carry on.
 */
export function useNextReferenceQuery(
    prefix: ReferenceSeries,
    enabled = true,
): UseQueryResult<string> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.nextReference(prefix),
        enabled: enabled && repositories !== null,
        // A handle taken while this form was open is one this form must not offer. Short, because
        // the cost of a stale answer is a save that lands one number later than the box said.
        staleTime: 0,
        retry: false,
        queryFn: (): Promise<string> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.nextReference(prefix);
        },
    });
}

/** The top-level categories, in catalogue order. */
export function topLevelCategories(
    categories: readonly IngredientCategoryAdmin[] | undefined,
): readonly IngredientCategoryAdmin[] {
    return (categories ?? []).filter((entry) => entry.parentCode === null);
}

/**
 * The leaves under one category, in catalogue order.
 *
 * Empty for a category with no leaves, which is a real answer — some branches are one level deep —
 * and the caller renders "filed at the top level" alone rather than an error.
 */
export function subcategoriesOf(
    categories: readonly IngredientCategoryAdmin[] | undefined,
    categoryCode: string,
): readonly IngredientCategoryAdmin[] {
    if (categoryCode === '') return [];
    return (categories ?? []).filter((entry) => entry.parentCode === categoryCode);
}

/** What the hub card for a managed family reports. */
export interface FamilySummary {
    /** `null` when the repository cannot count cheaply — the card then says so. */
    readonly total: number | null;
    readonly drafts: number | null;
    readonly quarantined: number | null;
}

/**
 * Live kitchen listings map `totalCount` to `null` (cursor meta has page size, not a match total).
 * Walk pages until the cursor ends so a kitchen with more than one page of ingredients still gets
 * an exact figure; stop and admit "unavailable" only if the walk hits the safety ceiling.
 */
const SUMMARY_PAGE_LIMIT = 100;
const SUMMARY_MAX_PAGES = 50;

async function countAcrossPages<T>(
    load: (cursor: string | undefined) => Promise<CursorPage<T>>,
): Promise<number | null> {
    let total = 0;
    let cursor: string | undefined;
    let pages = 0;

    do {
        const page = await load(cursor);
        if (page.totalCount !== null) return page.totalCount;
        total += page.items.length;
        if (!page.hasMore) return total;
        cursor = page.nextCursor ?? undefined;
        pages += 1;
    } while (pages < SUMMARY_MAX_PAGES && cursor !== undefined);

    return null;
}

/**
 * The ingredient counts behind the hub card, in one query.
 *
 * Three filtered listings folded into one `queryFn` so a card gets one pending state, one error and
 * one `refetch`. Counts walk every page ({@link countAcrossPages}) because a live kitchen library
 * routinely exceeds one cursor page.
 */
export function useIngredientSummaryQuery(enabled = true): UseQueryResult<FamilySummary> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.ingredients({ derive: 'summary' }),
        enabled: enabled && repositories !== null,
        queryFn: async (): Promise<FamilySummary> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            const [total, drafts, quarantined] = await Promise.all([
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listIngredients({
                        limit: SUMMARY_PAGE_LIMIT,
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listIngredients({
                        limit: SUMMARY_PAGE_LIMIT,
                        statuses: ['draft'],
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listIngredients({
                        limit: SUMMARY_PAGE_LIMIT,
                        statuses: ['review_required'],
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
            ]);
            return { total, drafts, quarantined };
        },
    });
}

/* ── ingredient writes ───────────────────────────────────────────────────────────────────────── */

/**
 * Writes the record into its detail entry and invalidates the workspace root.
 *
 * Both, not either — see the module note. Kept as one function so that the eight mutations this
 * workspace will eventually carry cannot each remember it slightly differently.
 */
function useIngredientWriteEffects(): (ingredient: IngredientAdmin) => void {
    const queryClient = useQueryClient();

    return (ingredient: IngredientAdmin) => {
        queryClient.setQueryData(queryKeys.kitchenAdmin.ingredient(ingredient.id), ingredient);
        void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenAdmin.all() });
    };
}

export function useCreateIngredientMutation(): UseMutationResult<
    IngredientAdmin,
    unknown,
    CreateIngredientRequest
> {
    const repositories = useRepositories();
    const onWritten = useIngredientWriteEffects();

    return useMutation({
        mutationFn: (request: CreateIngredientRequest) =>
            repositories.kitchenAdmin.createIngredient(request),
        onSuccess: onWritten,
    });
}

export interface UpdateIngredientVariables {
    readonly ingredientId: IngredientId;
    readonly request: UpdateIngredientRequest;
}

export function useUpdateIngredientMutation(): UseMutationResult<
    IngredientAdmin,
    unknown,
    UpdateIngredientVariables
> {
    const repositories = useRepositories();
    const onWritten = useIngredientWriteEffects();

    return useMutation({
        mutationFn: ({ ingredientId, request }: UpdateIngredientVariables) =>
            repositories.kitchenAdmin.updateIngredient(ingredientId, request),
        onSuccess: onWritten,
    });
}

export interface ArchiveIngredientVariables {
    readonly ingredientId: IngredientId;
    readonly request: LockedRequest;
}

/**
 * Archives the row.
 *
 * Nothing is deleted — the contract retires it, because recipes and cost snapshots still point at
 * it. The screen says exactly that before it asks.
 */
export function useArchiveIngredientMutation(): UseMutationResult<
    IngredientAdmin,
    unknown,
    ArchiveIngredientVariables
> {
    const repositories = useRepositories();
    const onWritten = useIngredientWriteEffects();

    return useMutation({
        mutationFn: ({ ingredientId, request }: ArchiveIngredientVariables) =>
            repositories.kitchenAdmin.archiveIngredient(ingredientId, request),
        onSuccess: onWritten,
    });
}

/**
 * Copies a platform-library ingredient into this kitchen so it can be edited.
 *
 * Resolves to the **fork**, not the row that was passed in, so a caller routes to
 * `result.id` afterwards rather than staying on the library row it just left. The write
 * effects then seed the fork's own cache entry and invalidate the lists, which is what
 * makes the shadowed library row disappear from the catalogue on the next read.
 *
 * Retry-safe by contract: a second call returns the fork that already exists. That is
 * worth knowing here, because a double-pressed button on a slow connection is exactly
 * how a kitchen would otherwise end up with two copies of one ingredient.
 */
export function useForkIngredientMutation(): UseMutationResult<
    IngredientAdmin,
    unknown,
    IngredientId
> {
    const repositories = useRepositories();
    const onWritten = useIngredientWriteEffects();

    return useMutation({
        mutationFn: (ingredientId: IngredientId) =>
            repositories.kitchenAdmin.forkIngredient(ingredientId),
        onSuccess: onWritten,
    });
}

export interface SetIngredientAllergensVariables {
    readonly ingredientId: IngredientId;
    readonly request: SetIngredientAllergensRequest;
}

/**
 * Replaces the whole allergen mapping set.
 *
 * Wholesale because the contract is wholesale: an allergen determination is judged as a set, and
 * applying half of one would leave a label nobody meant to publish. The answer may come back
 * `review_required` — the store's quarantine — which is a *success* the editor has to render, not a
 * failure it can swallow.
 */
export function useSetIngredientAllergensMutation(): UseMutationResult<
    IngredientAdmin,
    unknown,
    SetIngredientAllergensVariables
> {
    const repositories = useRepositories();
    const onWritten = useIngredientWriteEffects();

    return useMutation({
        mutationFn: ({ ingredientId, request }: SetIngredientAllergensVariables) =>
            repositories.kitchenAdmin.setIngredientAllergens(ingredientId, request),
        onSuccess: onWritten,
    });
}

/* ── recipes ─────────────────────────────────────────────────────────────────────────────────── */

export type RecipesInfiniteResult = UseInfiniteQueryResult<
    InfiniteData<CursorPage<RecipeAdminSummary>, string | undefined>,
    Error
>;

/** The accumulated recipes across every page fetched so far. */
export function recipesFromPages(
    pages: readonly CursorPage<RecipeAdminSummary>[] | undefined,
): readonly RecipeAdminSummary[] {
    return (pages ?? []).flatMap((page) => page.items);
}

/** Total matching recipes when the repository can count them; `null` when it cannot. */
export function recipeTotalFromPages(
    pages: readonly CursorPage<RecipeAdminSummary>[] | undefined,
): number | null {
    return pages?.[0]?.totalCount ?? null;
}

export function useRecipesQuery(
    filter?: Omit<RecipeAdminFilter, 'cursor'>,
    enabled = true,
): RecipesInfiniteResult {
    const { repositories } = useRepositoryContext();

    return useInfiniteQuery({
        queryKey: queryKeys.kitchenAdmin.recipes(filter),
        enabled: enabled && repositories !== null,
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listRecipes({
                ...filter,
                ...(pageParam === undefined ? {} : { cursor: pageParam }),
            });
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });
}

/**
 * One recipe, with its current version in full and a summary of every other one.
 *
 * The list uses this per row as well, for the derived allergen column: `RecipeAdminSummary` carries
 * no label, and a column that showed nothing would hide the one fact the publication gate turns on.
 * The cost is one detail request per visible row — stated rather than hidden — and the cache entry
 * it fills is the same one the editor opens, so following a row costs nothing.
 */
export function useRecipeQuery(recipeId: RecipeId | null): UseQueryResult<RecipeAdmin> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.recipe(recipeId ?? ('' as RecipeId)),
        enabled: repositories !== null && recipeId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (recipeId === null) throw new Error('No recipe identifier.');
            return repositories.kitchenAdmin.getRecipe(recipeId);
        },
    });
}

/**
 * Every recipe on the page in hand, read one request at a time.
 *
 * `RecipeAdminSummary` carries a version *number* and a version *count*, and nothing about the
 * state that version is in or the allergens it derived — which are the two questions a kitchen
 * brings to a recipe index ("which of these still have a draft open?", "which declare sesame?").
 * Both live on `RecipeAdmin.currentVersion`, so the list reads the detail of every row it draws.
 *
 * It is an N+1 and it is written down rather than hidden. What changed when the list moved onto the
 * Catalogue shell is *where* it happens: three cell components each calling {@link useRecipeQuery}
 * became one call here, so the list holds the answers synchronously and its column spec stays a
 * plain array — a cell cannot call a hook, and the row-action callback that decides whether a
 * version is immutable is not a component at all.
 *
 * The cost buys something back, exactly as it did before: each entry filled is the one the editor
 * opens, so following a row costs no further request. A real `GET /kitchen/recipes` that returned
 * the derived label and the version state on the summary retires this hook and turns both columns
 * into plain fields.
 *
 * Keyed on {@link queryKeys}`.kitchenAdmin.recipe`, the same key {@link useRecipeQuery} uses, so the
 * two share one cache entry per recipe and neither refetches what the other has.
 */
export function useRecipeDetails(
    recipeIds: readonly RecipeId[],
): Readonly<Record<string, RecipeAdmin>> {
    const { repositories } = useRepositoryContext();

    return useQueries({
        queries: recipeIds.map((recipeId) => ({
            queryKey: queryKeys.kitchenAdmin.recipe(recipeId),
            enabled: repositories !== null,
            queryFn: () => {
                if (repositories === null) throw new Error('Repositories are not ready.');
                return repositories.kitchenAdmin.getRecipe(recipeId);
            },
        })),
        // A plain record rather than a Map: `combine` runs through the same structural sharing every
        // other query result does, so the value it returns has to be one that sharing understands.
        // Its memoisation is what keeps the column spec's `useMemo` from rebuilding every render.
        combine: (results): Readonly<Record<string, RecipeAdmin>> => {
            const byId: Record<string, RecipeAdmin> = {};
            for (const result of results) {
                if (result.data !== undefined) byId[String(result.data.id)] = result.data;
            }
            return byId;
        },
    });
}

/**
 * CONFIDENTIAL — the costed technical sheet of the version on screen.
 *
 * `null` data is a state, not an error: it is what the repository returns for
 * a member without `recipe.view_costs_organisation`, and the panel renders
 * the formulation without money rather than failing the screen.
 */
export function useRecipeTechnicalSheetQuery(
    recipeId: RecipeId | null,
    versionId: RecipeVersionId | null,
): UseQueryResult<TechnicalSheetAdmin | null> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.recipeTechnicalSheet(
            recipeId ?? ('' as RecipeId),
            versionId === null ? '' : String(versionId),
        ),
        enabled: repositories !== null && recipeId !== null && versionId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (recipeId === null || versionId === null) throw new Error('No recipe version.');
            return repositories.kitchenAdmin.getRecipeTechnicalSheet(recipeId, versionId);
        },
    });
}

/** One kitchen recipes are actually filed under, with how many carry it. */
export interface RecipeKitchen {
    readonly kitchenId: KitchenId;
    readonly count: number;
}

/**
 * The kitchen vocabulary the recipe list filters on, derived from the rows in use.
 *
 * Same shape and the same honest limitation as {@link useIngredientCategoriesQuery}: one unfiltered
 * page rather than every page, because a filter that made the reader wait for the whole library
 * before offering a choice is worse than one that offers what the first page proves exists. Unlike
 * the ingredient categories, the value it produces *is* a real filter parameter —
 * `RecipeAdminFilter.kitchenId` — so narrowing by it is a server concern already.
 */
export function useRecipeKitchensQuery(): UseQueryResult<readonly RecipeKitchen[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.recipes({ derive: 'kitchens' }),
        enabled: repositories !== null,
        queryFn: async (): Promise<readonly RecipeKitchen[]> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            const page = await repositories.kitchenAdmin.listRecipes({ limit: 100 });
            const counts = new Map<string, number>();
            for (const row of page.items) {
                counts.set(String(row.kitchenId), (counts.get(String(row.kitchenId)) ?? 0) + 1);
            }
            return [...counts.entries()]
                .map(([kitchenId, count]) => ({ kitchenId: kitchenId as KitchenId, count }))
                .sort((left, right) =>
                    String(left.kitchenId).localeCompare(String(right.kitchenId)),
                );
        },
    });
}

/**
 * What a hub card reports for a family whose records have a publication state.
 *
 * `published` is the number a kitchen actually acts on: "eleven published, two drafts, one awaiting
 * review" is the state of the menu, which is the question a workspace home is asked. Shared by
 * recipes, products and meals rather than declared three times, because the shape is one shape and
 * three copies of it drift.
 */
export interface PublishedFamilySummary extends FamilySummary {
    readonly published: number | null;
}

/** What the recipes hub card reports. */
export type RecipeFamilySummary = PublishedFamilySummary;

/**
 * The recipe counts behind the hub card, in one query.
 *
 * Four filtered listings folded into one `queryFn`. Counts walk pages via {@link countAcrossPages}.
 */
export function useRecipeSummaryQuery(enabled = true): UseQueryResult<RecipeFamilySummary> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.recipes({ derive: 'summary' }),
        enabled: enabled && repositories !== null,
        queryFn: async (): Promise<RecipeFamilySummary> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            const [total, published, drafts, quarantined] = await Promise.all([
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listRecipes({
                        limit: SUMMARY_PAGE_LIMIT,
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listRecipes({
                        limit: SUMMARY_PAGE_LIMIT,
                        statuses: ['published'],
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listRecipes({
                        limit: SUMMARY_PAGE_LIMIT,
                        statuses: ['draft'],
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listRecipes({
                        limit: SUMMARY_PAGE_LIMIT,
                        statuses: ['review_required'],
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
            ]);
            return { total, published, drafts, quarantined };
        },
    });
}

/* ── recipe writes ───────────────────────────────────────────────────────────────────────────── */

/**
 * Writes the record into its detail entry and invalidates the workspace root.
 *
 * The recipe half needs this more than the ingredient half did, not less: one line write can move
 * the recipe's row in the list, open a *new* version, change the derived allergen label the list
 * column renders, and — on publish — add or remove a row from the consumer marketplace projection
 * the same store answers. Anything narrower would leave one of those showing something untrue.
 */
function useRecipeWriteEffects(): (recipe: RecipeAdmin) => void {
    const queryClient = useQueryClient();

    return (recipe: RecipeAdmin) => {
        queryClient.setQueryData(queryKeys.kitchenAdmin.recipe(recipe.id), recipe);
        void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenAdmin.all() });
    };
}

export function useCreateRecipeMutation(): UseMutationResult<
    RecipeAdmin,
    unknown,
    CreateRecipeRequest
> {
    const repositories = useRepositories();
    const onWritten = useRecipeWriteEffects();

    return useMutation({
        mutationFn: (request: CreateRecipeRequest) =>
            repositories.kitchenAdmin.createRecipe(request),
        onSuccess: onWritten,
    });
}

export interface UpdateRecipeVariables {
    readonly recipeId: RecipeId;
    readonly request: UpdateRecipeRequest;
}

/**
 * Recipe-level fields, and the version's yield and waste with them.
 *
 * One request covers both because the contract puts them in one request: `UpdateRecipeRequest`
 * carries `name`/`description` (the recipe) beside `yieldQuantity`/`yieldUnit`/`yieldPieces`/
 * `wastePercent` (the current version). Writing it against a *published* version opens the next
 * draft and lands the change there — see {@link useOpenRecipeDraftMutation}.
 */
export function useUpdateRecipeMutation(): UseMutationResult<
    RecipeAdmin,
    unknown,
    UpdateRecipeVariables
> {
    const repositories = useRepositories();
    const onWritten = useRecipeWriteEffects();

    return useMutation({
        mutationFn: ({ recipeId, request }: UpdateRecipeVariables) =>
            repositories.kitchenAdmin.updateRecipe(recipeId, request),
        onSuccess: onWritten,
    });
}

export interface OpenRecipeDraftVariables {
    readonly recipeId: RecipeId;
    readonly request: LockedRequest;
}

/**
 * Opens the next draft from the current version.
 *
 * The contract has no `createVersion` (see the module note): a published version is immutable, and
 * the server opens the successor as a consequence of the first write to it. So this sends the
 * smallest legal `updateRecipe` — a lock version and no fields — whose only effect is that the
 * draft now exists, carrying a copy of the published version's lines, outputs and steps.
 *
 * Kept as its own hook rather than as a call site of {@link useUpdateRecipeMutation} because the two
 * report differently: this one's pending state belongs to a "create a new draft" button and its
 * success is a *navigation*, not a save toast.
 */
export function useOpenRecipeDraftMutation(): UseMutationResult<
    RecipeAdmin,
    unknown,
    OpenRecipeDraftVariables
> {
    const repositories = useRepositories();
    const onWritten = useRecipeWriteEffects();

    return useMutation({
        mutationFn: ({ recipeId, request }: OpenRecipeDraftVariables) =>
            repositories.kitchenAdmin.updateRecipe(recipeId, request),
        onSuccess: onWritten,
    });
}

export interface SetRecipeLinesVariables {
    readonly recipeId: RecipeId;
    readonly request: SetRecipeLinesRequest;
}

/**
 * Replaces the whole line set.
 *
 * Wholesale, like every other setter here, and for a stronger reason than the ingredient mappings
 * had: the order of the array *is* the order of the lines, and a per-line endpoint would need a
 * position vocabulary that the schema deliberately does not have. Duplicated ingredients are legal
 * and are not collapsed — a sheet that lists olive oil twice, once for the pan and once to finish,
 * is describing two things.
 */
export function useSetRecipeLinesMutation(): UseMutationResult<
    RecipeAdmin,
    unknown,
    SetRecipeLinesVariables
> {
    const repositories = useRepositories();
    const onWritten = useRecipeWriteEffects();

    return useMutation({
        mutationFn: ({ recipeId, request }: SetRecipeLinesVariables) =>
            repositories.kitchenAdmin.setRecipeLines(recipeId, request),
        onSuccess: onWritten,
    });
}

export interface SetRecipePackagingVariables {
    readonly recipeId: RecipeId;
    readonly versionId: RecipeVersionId;
    readonly request: SetRecipePackagingRequest;
}

/**
 * Replaces the packaging set on a recipe version.
 *
 * Wholesale like the lines setter, and read back rather than trusted: two of the three bases
 * compute their own quantity server-side, so the counts in the answer are genuinely not the counts
 * in the request. A screen that echoed its own draft would render a bottle count of nothing.
 */
export function useSetRecipePackagingMutation(): UseMutationResult<
    RecipeAdmin,
    unknown,
    SetRecipePackagingVariables
> {
    const repositories = useRepositories();
    const onWritten = useRecipeWriteEffects();

    return useMutation({
        mutationFn: ({ recipeId, versionId, request }: SetRecipePackagingVariables) =>
            repositories.kitchenAdmin.setRecipePackaging(recipeId, versionId, request),
        onSuccess: onWritten,
    });
}

export interface SetRecipeOutputsVariables {
    readonly recipeId: RecipeId;
    readonly request: SetRecipeOutputsRequest;
}

/** Replaces the whole output set. At most one may be primary; a second is `validation.failed`. */
export function useSetRecipeOutputsMutation(): UseMutationResult<
    RecipeAdmin,
    unknown,
    SetRecipeOutputsVariables
> {
    const repositories = useRepositories();
    const onWritten = useRecipeWriteEffects();

    return useMutation({
        mutationFn: ({ recipeId, request }: SetRecipeOutputsVariables) =>
            repositories.kitchenAdmin.setRecipeOutputs(recipeId, request),
        onSuccess: onWritten,
    });
}

export interface SetRecipeStepsVariables {
    readonly recipeId: RecipeId;
    readonly request: SetRecipeStepsRequest;
}

/** Replaces the whole method. Array order is step order; the server assigns the indices. */
export function useSetRecipeStepsMutation(): UseMutationResult<
    RecipeAdmin,
    unknown,
    SetRecipeStepsVariables
> {
    const repositories = useRepositories();
    const onWritten = useRecipeWriteEffects();

    return useMutation({
        mutationFn: ({ recipeId, request }: SetRecipeStepsVariables) =>
            repositories.kitchenAdmin.setRecipeSteps(recipeId, request),
        onSuccess: onWritten,
    });
}

export interface RecipeLifecycleVariables {
    readonly recipeId: RecipeId;
    readonly request: LockedRequest;
}

/**
 * Publishes the current version.
 *
 * Refused structurally from `review_required` (plan §4.7) — the store answers `validation.failed`
 * on `status` rather than a permission failure, because a quarantine is a fact about the record, not
 * about the person. The publish dialog renders that refusal beside its own button.
 */
export function usePublishRecipeMutation(): UseMutationResult<
    RecipeAdmin,
    unknown,
    RecipeLifecycleVariables
> {
    const repositories = useRepositories();
    const onWritten = useRecipeWriteEffects();

    return useMutation({
        mutationFn: ({ recipeId, request }: RecipeLifecycleVariables) =>
            repositories.kitchenAdmin.publishRecipe(recipeId, request),
        onSuccess: onWritten,
    });
}

/**
 * Retires the recipe.
 *
 * The contract has no `archiveRecipe`: retiring *is* the archive, and nothing is deleted, because
 * meals, products and cost snapshots still point at the version. Retiring removes it from every
 * consumer read and leaves the history intact.
 */
export function useRetireRecipeMutation(): UseMutationResult<
    RecipeAdmin,
    unknown,
    RecipeLifecycleVariables
> {
    const repositories = useRepositories();
    const onWritten = useRecipeWriteEffects();

    return useMutation({
        mutationFn: ({ recipeId, request }: RecipeLifecycleVariables) =>
            repositories.kitchenAdmin.retireRecipe(recipeId, request),
        onSuccess: onWritten,
    });
}

/* ── products ────────────────────────────────────────────────────────────────────────────────── */

export type ProductsInfiniteResult = UseInfiniteQueryResult<
    InfiniteData<CursorPage<ProductAdmin>, string | undefined>,
    Error
>;

/** The accumulated products across every page fetched so far. */
export function productsFromPages(
    pages: readonly CursorPage<ProductAdmin>[] | undefined,
): readonly ProductAdmin[] {
    return (pages ?? []).flatMap((page) => page.items);
}

/** Total matching products when the repository can count them; `null` when it cannot. */
export function productTotalFromPages(
    pages: readonly CursorPage<ProductAdmin>[] | undefined,
): number | null {
    return pages?.[0]?.totalCount ?? null;
}

export function useProductsQuery(
    filter?: Omit<ProductAdminFilter, 'cursor'>,
    enabled = true,
): ProductsInfiniteResult {
    const { repositories } = useRepositoryContext();

    return useInfiniteQuery({
        queryKey: queryKeys.kitchenAdmin.products(filter),
        enabled: enabled && repositories !== null,
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listProducts({
                ...filter,
                ...(pageParam === undefined ? {} : { cursor: pageParam }),
            });
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });
}

/**
 * One product.
 *
 * Unlike the recipe list, the product list needs no per-row detail request: `listProducts` answers
 * with the whole {@link ProductAdmin}, packs, channels and all, so every column the list renders is
 * already in the page it fetched.
 */
export function useProductQuery(productId: ProductId | null): UseQueryResult<ProductAdmin> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.product(productId ?? ('' as ProductId)),
        enabled: repositories !== null && productId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (productId === null) throw new Error('No product identifier.');
            return repositories.kitchenAdmin.getProduct(productId);
        },
    });
}

/** One product category the kitchen actually uses, with how many rows carry it. */
export interface ProductCategory {
    readonly code: string;
    readonly count: number;
}

/**
 * The product category vocabulary, derived from the codes in use.
 *
 * Same gap and the same honest limitation as {@link useIngredientCategoriesQuery}: no category
 * resource on the contract, one unfiltered page rather than every page, and a code nobody has
 * assigned yet is invisible. `ProductAdminFilter.categoryCode` is a real filter parameter, so
 * narrowing by the value it produces is a server concern already.
 *
 * `itemType` is part of the derivation, not decoration on it. Sauces and dressings are their own
 * pages over their own rows, and a vocabulary derived from the *product* page offered the sauces
 * list a category filter whose every option matched nothing on it — the filter looked real, ran a
 * request, and came back empty. Deriving per family is what makes the options on a page the codes
 * that page's own rows carry.
 */
export function useProductCategoriesQuery(
    itemType: 'product' | 'sauce' | 'dressing' = 'product',
): UseQueryResult<readonly ProductCategory[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.products({ derive: 'categories', itemType }),
        enabled: repositories !== null,
        queryFn: async (): Promise<readonly ProductCategory[]> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            const page = await repositories.kitchenAdmin.listProducts({ itemType, limit: 100 });
            const counts = new Map<string, number>();
            for (const row of page.items) {
                counts.set(row.categoryCode, (counts.get(row.categoryCode) ?? 0) + 1);
            }
            return [...counts.entries()]
                .map(([code, count]) => ({ code, count }))
                .sort((left, right) => left.code.localeCompare(right.code));
        },
    });
}

/** The product counts behind the hub card, in one query. */
export function useProductSummaryQuery(
    enabled = true,
    itemType: 'product' | 'sauce' | 'dressing' = 'product',
): UseQueryResult<PublishedFamilySummary> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.products({ derive: 'summary', itemType }),
        enabled: enabled && repositories !== null,
        queryFn: async (): Promise<PublishedFamilySummary> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            const [total, published, drafts, quarantined] = await Promise.all([
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listProducts({
                        limit: SUMMARY_PAGE_LIMIT,
                        itemType,
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listProducts({
                        limit: SUMMARY_PAGE_LIMIT,
                        itemType,
                        statuses: ['published'],
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listProducts({
                        limit: SUMMARY_PAGE_LIMIT,
                        itemType,
                        statuses: ['draft'],
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listProducts({
                        limit: SUMMARY_PAGE_LIMIT,
                        itemType,
                        statuses: ['review_required'],
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
            ]);
            return { total, published, drafts, quarantined };
        },
    });
}

/* ── product writes ──────────────────────────────────────────────────────────────────────────── */

/** Writes the record into its detail entry and invalidates the workspace root. */
function useProductWriteEffects(): (product: ProductAdmin) => void {
    const queryClient = useQueryClient();

    return (product: ProductAdmin) => {
        queryClient.setQueryData(queryKeys.kitchenAdmin.product(product.id), product);
        void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenAdmin.all() });
    };
}

export function useCreateProductMutation(): UseMutationResult<
    ProductAdmin,
    unknown,
    CreateProductRequest
> {
    const repositories = useRepositories();
    const onWritten = useProductWriteEffects();

    return useMutation({
        mutationFn: (request: CreateProductRequest) =>
            repositories.kitchenAdmin.createProduct(request),
        onSuccess: onWritten,
    });
}

export interface UpdateProductVariables {
    readonly productId: ProductId;
    readonly request: UpdateProductRequest;
}

/**
 * Product fields, and the whole pack-variant set with them.
 *
 * One request covers both because `UpdateProductRequest` does: `packVariants` replaces the list
 * wholesale, exactly as the recipe setters replace their rows, so array order *is* pack order and
 * there is no position vocabulary to keep in step.
 */
export function useUpdateProductMutation(): UseMutationResult<
    ProductAdmin,
    unknown,
    UpdateProductVariables
> {
    const repositories = useRepositories();
    const onWritten = useProductWriteEffects();

    return useMutation({
        mutationFn: ({ productId, request }: UpdateProductVariables) =>
            repositories.kitchenAdmin.updateProduct(productId, request),
        onSuccess: onWritten,
    });
}

export interface ArchiveProductVariables {
    readonly productId: ProductId;
    readonly request: LockedRequest;
}

/**
 * Archives the product.
 *
 * The contract's only lifecycle action for this family (see the module note): it retires the row, and
 * nothing is deleted, because price-list entries and order history still point at it.
 */
export function useArchiveProductMutation(): UseMutationResult<
    ProductAdmin,
    unknown,
    ArchiveProductVariables
> {
    const repositories = useRepositories();
    const onWritten = useProductWriteEffects();

    return useMutation({
        mutationFn: ({ productId, request }: ArchiveProductVariables) =>
            repositories.kitchenAdmin.archiveProduct(productId, request),
        onSuccess: onWritten,
    });
}

export interface SetProductChannelAvailabilityVariables {
    readonly productId: ProductId;
    readonly request: SetChannelAvailabilityRequest;
}

/**
 * Replaces the whole channel-availability set.
 *
 * Its own method rather than a field on the update, because the contract makes it one: which routes
 * to market a product is sold through is a commercial decision with its own permission and its own
 * audit action server-side, and folding it into a rename would make that impossible to enforce.
 */
export function useSetProductChannelAvailabilityMutation(): UseMutationResult<
    ProductAdmin,
    unknown,
    SetProductChannelAvailabilityVariables
> {
    const repositories = useRepositories();
    const onWritten = useProductWriteEffects();

    return useMutation({
        mutationFn: ({ productId, request }: SetProductChannelAvailabilityVariables) =>
            repositories.kitchenAdmin.setProductChannelAvailability(productId, request),
        onSuccess: onWritten,
    });
}

/* ── price lists (K1.5) ──────────────────────────────────────────────────────────────────────── */

export type PriceListsInfiniteResult = UseInfiniteQueryResult<
    InfiniteData<CursorPage<PriceListAdmin>, string | undefined>,
    Error
>;

/** The accumulated price lists across every page fetched so far. */
export function priceListsFromPages(
    pages: readonly CursorPage<PriceListAdmin>[] | undefined,
): readonly PriceListAdmin[] {
    return (pages ?? []).flatMap((page) => page.items);
}

/** Total matching price lists when the repository can count them; `null` when it cannot. */
export function priceListTotalFromPages(
    pages: readonly CursorPage<PriceListAdmin>[] | undefined,
): number | null {
    return pages?.[0]?.totalCount ?? null;
}

/**
 * The kitchen's price lists.
 *
 * `listPriceLists` answers with whole {@link PriceListAdmin} records — **entries included** — so the
 * list screen's confirmed/placeholder/market split costs no extra request per row. That is worth
 * stating because it is also the reason the list is capped rather than infinite in spirit: a
 * thousand-entry list is a large page, and the "load more" control is the honest place that shows.
 */
export function usePriceListsQuery(
    filter?: Omit<PriceListAdminFilter, 'cursor'>,
    enabled = true,
): PriceListsInfiniteResult {
    const { repositories } = useRepositoryContext();

    return useInfiniteQuery({
        queryKey: queryKeys.kitchenAdmin.priceLists(filter),
        enabled: enabled && repositories !== null,
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listPriceLists({
                ...filter,
                ...(pageParam === undefined ? {} : { cursor: pageParam }),
            });
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });
}

/** One price list. Nullable identifier for the reason every detail hook here is. */
export function usePriceListQuery(priceListId: PriceListId | null): UseQueryResult<PriceListAdmin> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.priceList(priceListId ?? ('' as PriceListId)),
        enabled: repositories !== null && priceListId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (priceListId === null) throw new Error('No price list identifier.');
            return repositories.kitchenAdmin.getPriceList(priceListId);
        },
    });
}

/**
 * What the price-list hub card reports.
 *
 * `published` is the number that matters most in this family: a published price list is the one a
 * cart resolves a price from, so "two published, one draft" is the state of what customers can
 * actually be charged.
 */
export type PriceListFamilySummary = PublishedFamilySummary;

/** The price-list counts behind the hub card, in one query. Four `limit: 1` listings, folded. */
export function usePriceListSummaryQuery(enabled = true): UseQueryResult<PriceListFamilySummary> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.priceLists({ derive: 'summary' }),
        enabled: enabled && repositories !== null,
        queryFn: async (): Promise<PriceListFamilySummary> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            const [total, published, drafts, quarantined] = await Promise.all([
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listPriceLists({
                        limit: SUMMARY_PAGE_LIMIT,
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listPriceLists({
                        limit: SUMMARY_PAGE_LIMIT,
                        statuses: ['published'],
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listPriceLists({
                        limit: SUMMARY_PAGE_LIMIT,
                        statuses: ['draft'],
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listPriceLists({
                        limit: SUMMARY_PAGE_LIMIT,
                        statuses: ['review_required'],
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
            ]);
            return { total, published, drafts, quarantined };
        },
    });
}

/* ── plans (K1.6) ────────────────────────────────────────────────────────────────────────────── */

export type AdminPlansInfiniteResult = UseInfiniteQueryResult<
    InfiniteData<CursorPage<PlanAdmin>, string | undefined>,
    Error
>;

/** The accumulated plans across every page fetched so far. */
export function plansFromPages(
    pages: readonly CursorPage<PlanAdmin>[] | undefined,
): readonly PlanAdmin[] {
    return (pages ?? []).flatMap((page) => page.items);
}

/** Total matching plans when the repository can count them; `null` when it cannot. */
export function planTotalFromPages(
    pages: readonly CursorPage<PlanAdmin>[] | undefined,
): number | null {
    return pages?.[0]?.totalCount ?? null;
}

/**
 * The kitchen's subscription plans.
 *
 * Landed by K1.5 as a *reader* — a price list prices plans and their variants
 * (`CatalogueItemRef`), so the price editor's item picker needed the listing before the plan family
 * had an editor. K1.6 adds the writers below it and nothing about the price editor changed.
 */
export function useAdminPlansQuery(
    filter?: Omit<PlanAdminFilter, 'cursor'>,
    enabled = true,
): AdminPlansInfiniteResult {
    const { repositories } = useRepositoryContext();

    return useInfiniteQuery({
        queryKey: queryKeys.kitchenAdmin.plans(filter),
        enabled: enabled && repositories !== null,
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listPlans({
                ...filter,
                ...(pageParam === undefined ? {} : { cursor: pageParam }),
            });
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });
}

/** One plan, as its kitchen sees it. Nullable identifier for the reason every detail hook here is. */
export function useAdminPlanQuery(planId: SubscriptionPlanId | null): UseQueryResult<PlanAdmin> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.plan(planId ?? ('' as SubscriptionPlanId)),
        enabled: repositories !== null && planId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (planId === null) throw new Error('No plan identifier.');
            return repositories.kitchenAdmin.getPlan(planId);
        },
    });
}

/**
 * The plan's fixed menu.
 *
 * Its own query rather than a field of {@link useAdminPlanQuery}, because the plan record does not
 * carry one: the menu is a separate document on a separate endpoint, and the four sections that
 * were there before this one have no use for it. Disabled until the identifier parses, exactly like
 * the detail read beside it.
 */
export function usePlanMenuQuery(planId: SubscriptionPlanId | null): UseQueryResult<PlanMenu> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.planMenu(planId ?? ('' as SubscriptionPlanId)),
        enabled: repositories !== null && planId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (planId === null) throw new Error('No plan identifier.');
            return repositories.kitchenAdmin.getPlanMenu(planId);
        },
    });
}

/** The plan counts behind the hub card, in one query. Four `limit: 1` listings, folded. */
export function usePlanSummaryQuery(enabled = true): UseQueryResult<PublishedFamilySummary> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.plans({ derive: 'summary' }),
        enabled: enabled && repositories !== null,
        queryFn: async (): Promise<PublishedFamilySummary> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            const [total, published, drafts, quarantined] = await Promise.all([
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listPlans({
                        limit: SUMMARY_PAGE_LIMIT,
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listPlans({
                        limit: SUMMARY_PAGE_LIMIT,
                        statuses: ['published'],
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listPlans({
                        limit: SUMMARY_PAGE_LIMIT,
                        statuses: ['draft'],
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listPlans({
                        limit: SUMMARY_PAGE_LIMIT,
                        statuses: ['review_required'],
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
            ]);
            return { total, published, drafts, quarantined };
        },
    });
}

/* ── plan writes ─────────────────────────────────────────────────────────────────────────────── */

/**
 * Writes the record into its detail entry and invalidates the workspace root *and* the catalogue.
 *
 * The catalogue invalidation is the same rule the meal writes follow and for the same reason:
 * `publishPlan` puts a plan on the consumer plans listing that this world answers from the same
 * store, and `retirePlan` takes it away. A narrower invalidation would leave a shopper's cached plan
 * catalogue disagreeing with the kitchen that owns it.
 */
function usePlanWriteEffects(): (plan: PlanAdmin) => void {
    const queryClient = useQueryClient();

    return (plan: PlanAdmin) => {
        queryClient.setQueryData(queryKeys.kitchenAdmin.plan(plan.id), plan);
        void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenAdmin.all() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.catalogue.all() });
    };
}

export function useCreatePlanMutation(): UseMutationResult<PlanAdmin, unknown, CreatePlanRequest> {
    const repositories = useRepositories();
    const onWritten = usePlanWriteEffects();

    return useMutation({
        mutationFn: (request: CreatePlanRequest) => repositories.kitchenAdmin.createPlan(request),
        onSuccess: onWritten,
    });
}

export interface UpdatePlanVariables {
    readonly planId: SubscriptionPlanId;
    readonly request: UpdatePlanRequest;
}

export function useUpdatePlanMutation(): UseMutationResult<
    PlanAdmin,
    unknown,
    UpdatePlanVariables
> {
    const repositories = useRepositories();
    const onWritten = usePlanWriteEffects();

    return useMutation({
        mutationFn: ({ planId, request }: UpdatePlanVariables) =>
            repositories.kitchenAdmin.updatePlan(planId, request),
        onSuccess: onWritten,
    });
}

export interface SetPlanVariantsVariables {
    readonly planId: SubscriptionPlanId;
    readonly request: SetPlanVariantsRequest;
}

/**
 * Replaces the whole variant set.
 *
 * Wholesale, like every setter in this contract, which is exactly what makes the matrix editor
 * expressible: a cell that stops existing is a variant *absent from the array*, not a delete call.
 * A variant the caller sends with `id: null` is minted server-side and comes back with one.
 */
export function useSetPlanVariantsMutation(): UseMutationResult<
    PlanAdmin,
    unknown,
    SetPlanVariantsVariables
> {
    const repositories = useRepositories();
    const onWritten = usePlanWriteEffects();

    return useMutation({
        mutationFn: ({ planId, request }: SetPlanVariantsVariables) =>
            repositories.kitchenAdmin.setPlanVariants(planId, request),
        onSuccess: onWritten,
    });
}

export interface SetPlanDurationsVariables {
    readonly planId: SubscriptionPlanId;
    readonly request: SetPlanDurationsRequest;
}

/**
 * Replaces the whole duration set.
 *
 * The store re-checks `isPlanDurationConsistent` on the way in and answers `validation.failed` on
 * `durations` for a row that breaks it. The editor therefore never relies on that — it blocks the
 * save and marks the offending row — but the server refusing it as well is what makes the rule true
 * rather than merely enforced by a screen.
 */
export function useSetPlanDurationsMutation(): UseMutationResult<
    PlanAdmin,
    unknown,
    SetPlanDurationsVariables
> {
    const repositories = useRepositories();
    const onWritten = usePlanWriteEffects();

    return useMutation({
        mutationFn: ({ planId, request }: SetPlanDurationsVariables) =>
            repositories.kitchenAdmin.setPlanDurations(planId, request),
        onSuccess: onWritten,
    });
}

export interface SetPlanCombinationsVariables {
    readonly planId: SubscriptionPlanId;
    readonly request: SetPlanCombinationsRequest;
}

/** Replaces the whole combination set — the rows of the variant matrix. */
export function useSetPlanCombinationsMutation(): UseMutationResult<
    PlanAdmin,
    unknown,
    SetPlanCombinationsVariables
> {
    const repositories = useRepositories();
    const onWritten = usePlanWriteEffects();

    return useMutation({
        mutationFn: ({ planId, request }: SetPlanCombinationsVariables) =>
            repositories.kitchenAdmin.setPlanCombinations(planId, request),
        onSuccess: onWritten,
    });
}

export interface ReplacePlanMenuVariables {
    readonly planId: SubscriptionPlanId;
    readonly request: ReplacePlanMenuRequest;
}

/**
 * Replaces the whole fixed menu — or withdraws it, when all three parts arrive empty.
 *
 * Two invalidations rather than one, and neither is optional. The menu's own entry is refreshed
 * because it is what changed; the plan record is refreshed because this write moves the **catalogue
 * item's** lock version, which is the number the editor's other four sections send with their next
 * save. Leaving the record stale would make the next unrelated save fail with a conflict the person
 * could not account for.
 *
 * The workspace root is *not* blanket-invalidated the way {@link usePlanWriteEffects} does it: a
 * menu changes nothing on the plan listing, nothing a shopper sees, and nothing in the price lists.
 * What it does change is what a generated subscription order deducts — and there is no client cache
 * of that to invalidate, which is precisely why the editor states the consequence before the save
 * rather than after it.
 */
export function useReplacePlanMenuMutation(): UseMutationResult<
    PlanMenu,
    unknown,
    ReplacePlanMenuVariables
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ planId, request }: ReplacePlanMenuVariables) =>
            repositories.kitchenAdmin.replacePlanMenu(planId, request),
        onSuccess: (menu) => {
            queryClient.setQueryData(queryKeys.kitchenAdmin.planMenu(menu.planId), menu);
            void queryClient.invalidateQueries({
                queryKey: queryKeys.kitchenAdmin.plan(menu.planId),
            });
        },
    });
}

export interface PlanLifecycleVariables {
    readonly planId: SubscriptionPlanId;
    readonly request: LockedRequest;
}

/**
 * Publishes the plan.
 *
 * Refused two ways, and the editor renders both beside its own button. A quarantined plan is
 * `validation.failed` on `status` (plan §4.7). A plan with no *confirmed* price anywhere in this
 * kitchen's price lists is `validation.failed` on `price` — the mock store checks exactly that
 * (`mock/prototype/catalogue-store.ts`), because publishing a plan priced only by placeholders
 * would advertise a number nobody has decided (plan §2.4, §3 #15).
 */
export function usePublishPlanMutation(): UseMutationResult<
    PlanAdmin,
    unknown,
    PlanLifecycleVariables
> {
    const repositories = useRepositories();
    const onWritten = usePlanWriteEffects();

    return useMutation({
        mutationFn: ({ planId, request }: PlanLifecycleVariables) =>
            repositories.kitchenAdmin.publishPlan(planId, request),
        onSuccess: onWritten,
    });
}

/** Withdraws the plan from every consumer surface. Nothing is deleted. */
export function useRetirePlanMutation(): UseMutationResult<
    PlanAdmin,
    unknown,
    PlanLifecycleVariables
> {
    const repositories = useRepositories();
    const onWritten = usePlanWriteEffects();

    return useMutation({
        mutationFn: ({ planId, request }: PlanLifecycleVariables) =>
            repositories.kitchenAdmin.retirePlan(planId, request),
        onSuccess: onWritten,
    });
}

/* ── price-list writes ───────────────────────────────────────────────────────────────────────── */

/**
 * Writes the record into its detail entry and invalidates the workspace root.
 *
 * The root invalidation earns its keep in this family more than in most: `publishPlan` is refused
 * while no confirmed price exists for the plan (`mock/prototype/catalogue-store.ts`), so confirming
 * a price here changes whether a *plan* editor's publish button can succeed. A narrower
 * invalidation would leave that screen showing a blocker that has just been cleared.
 */
function usePriceListWriteEffects(): (priceList: PriceListAdmin) => void {
    const queryClient = useQueryClient();

    return (priceList: PriceListAdmin) => {
        queryClient.setQueryData(queryKeys.kitchenAdmin.priceList(priceList.id), priceList);
        void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenAdmin.all() });
    };
}

export interface SetPriceListEntriesVariables {
    readonly priceListId: PriceListId;
    readonly request: SetPriceListEntriesRequest;
}

/**
 * Replaces the whole entry set.
 *
 * Wholesale, like every other setter in this contract, and the mock enforces the migration's `CHECK`
 * on the way in: an entry breaking `isPriceEntryConsistent` is `validation.failed` on `entries`
 * rather than a silently dropped row. The editor therefore never *relies* on that — it blocks the
 * save and marks the offending rows — but the server refusing it as well is what makes the rule
 * true rather than merely enforced by a screen.
 */
export function useSetPriceListEntriesMutation(): UseMutationResult<
    PriceListAdmin,
    unknown,
    SetPriceListEntriesVariables
> {
    const repositories = useRepositories();
    const onWritten = usePriceListWriteEffects();

    return useMutation({
        mutationFn: ({ priceListId, request }: SetPriceListEntriesVariables) =>
            repositories.kitchenAdmin.setPriceListEntries(priceListId, request),
        onSuccess: onWritten,
    });
}

export interface PriceListLifecycleVariables {
    readonly priceListId: PriceListId;
    readonly request: LockedRequest;
}

/**
 * Publishes the price list.
 *
 * Refused while any entry breaks `isPriceEntryConsistent` — the contract says so and the store does
 * it, answering `validation.failed` on `entries`. The dialog renders that refusal beside its own
 * button, and states the count of entries that would actually reach a customer, because publishing a
 * list of forty rows of which three carry a number is not publishing forty prices.
 */
export function usePublishPriceListMutation(): UseMutationResult<
    PriceListAdmin,
    unknown,
    PriceListLifecycleVariables
> {
    const repositories = useRepositories();
    const onWritten = usePriceListWriteEffects();

    return useMutation({
        mutationFn: ({ priceListId, request }: PriceListLifecycleVariables) =>
            repositories.kitchenAdmin.publishPriceList(priceListId, request),
        onSuccess: onWritten,
    });
}

/* ── meals ───────────────────────────────────────────────────────────────────────────────────── */

export type AdminMealsInfiniteResult = UseInfiniteQueryResult<
    InfiniteData<CursorPage<MealAdmin>, string | undefined>,
    Error
>;

/** The accumulated meals across every page fetched so far. */
export function mealsFromPages(
    pages: readonly CursorPage<MealAdmin>[] | undefined,
): readonly MealAdmin[] {
    return (pages ?? []).flatMap((page) => page.items);
}

/** Total matching meals when the repository can count them; `null` when it cannot. */
export function mealTotalFromPages(
    pages: readonly CursorPage<MealAdmin>[] | undefined,
): number | null {
    return pages?.[0]?.totalCount ?? null;
}

/**
 * The kitchen's meals.
 *
 * Named `useAdminMealsQuery` rather than `useMealsQuery` because `./catalogue-hooks.ts` already owns
 * that name for the *consumer* listing, and the two are deliberately different things: this one
 * answers with `MealAdmin` — both languages, the margin, the publication state — and the other with
 * the published `MarketplaceMeal` a shopper sees. They read the same store, which is exactly why
 * their names must not be confusable at a call site.
 */
export function useAdminMealsQuery(
    filter?: Omit<MealAdminFilter, 'cursor'>,
    enabled = true,
): AdminMealsInfiniteResult {
    const { repositories } = useRepositoryContext();

    return useInfiniteQuery({
        queryKey: queryKeys.kitchenAdmin.meals(filter),
        enabled: enabled && repositories !== null,
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listMeals({
                ...filter,
                ...(pageParam === undefined ? {} : { cursor: pageParam }),
            });
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });
}

/** One meal, as its kitchen sees it. Nullable identifier for the reason every detail hook here is. */
export function useAdminMealQuery(mealId: MealId | null): UseQueryResult<MealAdmin> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.meal(mealId ?? ('' as MealId)),
        enabled: repositories !== null && mealId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (mealId === null) throw new Error('No meal identifier.');
            return repositories.kitchenAdmin.getMeal(mealId);
        },
    });
}

/** The meal counts behind the hub card, in one query. */
export function useMealSummaryQuery(enabled = true): UseQueryResult<PublishedFamilySummary> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.meals({ derive: 'summary' }),
        enabled: enabled && repositories !== null,
        queryFn: async (): Promise<PublishedFamilySummary> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            const [total, published, drafts, quarantined] = await Promise.all([
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listMeals({
                        limit: SUMMARY_PAGE_LIMIT,
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listMeals({
                        limit: SUMMARY_PAGE_LIMIT,
                        statuses: ['published'],
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listMeals({
                        limit: SUMMARY_PAGE_LIMIT,
                        statuses: ['draft'],
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listMeals({
                        limit: SUMMARY_PAGE_LIMIT,
                        statuses: ['review_required'],
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
            ]);
            return { total, published, drafts, quarantined };
        },
    });
}

/* ── meal writes ─────────────────────────────────────────────────────────────────────────────── */

/**
 * Writes the record into its detail entry and invalidates the workspace root.
 *
 * The meal half needs the root invalidation most of all: publishing a meal adds a row to the
 * *consumer* marketplace listing the same store answers, and retiring one removes it. A narrower
 * invalidation would leave a shopper's cached menu disagreeing with the kitchen that owns it.
 */
function useMealWriteEffects(): (meal: MealAdmin) => void {
    const queryClient = useQueryClient();

    return (meal: MealAdmin) => {
        queryClient.setQueryData(queryKeys.kitchenAdmin.meal(meal.id), meal);
        void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenAdmin.all() });
        // The consumer roots read the same catalogue. Publication is the one write in this
        // workspace whose effect is visible outside it, so the marketplace cache is told.
        void queryClient.invalidateQueries({ queryKey: queryKeys.catalogue.all() });
    };
}

export function useCreateMealMutation(): UseMutationResult<MealAdmin, unknown, CreateMealRequest> {
    const repositories = useRepositories();
    const onWritten = useMealWriteEffects();

    return useMutation({
        mutationFn: (request: CreateMealRequest) => repositories.kitchenAdmin.createMeal(request),
        onSuccess: onWritten,
    });
}

export interface UpdateMealVariables {
    readonly mealId: MealId;
    readonly request: UpdateMealRequest;
}

export function useUpdateMealMutation(): UseMutationResult<
    MealAdmin,
    unknown,
    UpdateMealVariables
> {
    const repositories = useRepositories();
    const onWritten = useMealWriteEffects();

    return useMutation({
        mutationFn: ({ mealId, request }: UpdateMealVariables) =>
            repositories.kitchenAdmin.updateMeal(mealId, request),
        onSuccess: onWritten,
    });
}

export interface MealLifecycleVariables {
    readonly mealId: MealId;
    readonly request: LockedRequest;
}

/**
 * Publishes the meal.
 *
 * The one write in this workspace whose effect a shopper can see: after it, the meal is in
 * `marketplace.listMeals` and on its own public page. Refused structurally from `review_required`
 * (plan §4.7) — the store answers `validation.failed` on `status`, because a quarantine is a fact
 * about the record rather than about the person pressing the button.
 */
export function usePublishMealMutation(): UseMutationResult<
    MealAdmin,
    unknown,
    MealLifecycleVariables
> {
    const repositories = useRepositories();
    const onWritten = useMealWriteEffects();

    return useMutation({
        mutationFn: ({ mealId, request }: MealLifecycleVariables) =>
            repositories.kitchenAdmin.publishMeal(mealId, request),
        onSuccess: onWritten,
    });
}

/**
 * Retires the meal.
 *
 * The contract has no `archiveMeal`: retiring *is* the archive, it removes the meal from every
 * consumer read, and nothing is deleted because order history and price-list entries still point at
 * it.
 */
export function useRetireMealMutation(): UseMutationResult<
    MealAdmin,
    unknown,
    MealLifecycleVariables
> {
    const repositories = useRepositories();
    const onWritten = useMealWriteEffects();

    return useMutation({
        mutationFn: ({ mealId, request }: MealLifecycleVariables) =>
            repositories.kitchenAdmin.retireMeal(mealId, request),
        onSuccess: onWritten,
    });
}

export interface SetMealAvailabilityVariables {
    readonly mealId: MealId;
    readonly request: SetMealAvailabilityRequest;
}

/**
 * Replaces the whole availability calendar.
 *
 * Wholesale, and **by calendar date** — `MealAvailabilityDay` carries a `YYYY-MM-DD`, not a weekday
 * and not a slot. That is what the contract models and it is what the editor renders: a kitchen says
 * "the twelfth, forty portions, orders close at 18:00", and a weekly rule that this contract cannot
 * express would be a control writing something the server has no column for.
 */
export function useSetMealAvailabilityMutation(): UseMutationResult<
    MealAdmin,
    unknown,
    SetMealAvailabilityVariables
> {
    const repositories = useRepositories();
    const onWritten = useMealWriteEffects();

    return useMutation({
        mutationFn: ({ mealId, request }: SetMealAvailabilityVariables) =>
            repositories.kitchenAdmin.setMealAvailability(mealId, request),
        onSuccess: onWritten,
    });
}

/* ── the roll-up preview ─────────────────────────────────────────────────────────────────────── */

/**
 * A stable fingerprint of a draft roll-up request.
 *
 * The key map deliberately holds no hashing policy (`data/query-keys.ts`), so the policy lives here
 * — once, so two call sites cannot hash differently and split the cache in half. Line **order** is
 * part of the fingerprint even though it does not change a single figure: reordering is an edit the
 * preview is expected to acknowledge, and a hash that ignored it would leave the panel silent.
 *
 * `JSON.stringify` over a hand-built array rather than over the request object: object key order is
 * an implementation detail of whoever built the draft, and a fingerprint that changed when a caller
 * reordered its own literal would be a cache miss with no cause.
 */
export function recipeRollupHash(draft: RecipeRollupDraft): string {
    return JSON.stringify([
        draft.recipeId === null ? null : String(draft.recipeId),
        draft.servings,
        draft.wastePercent ?? null,
        draft.serving?.unit ?? null,
        draft.lines.map((line) => [
            String(line.ingredientId),
            line.quantity,
            line.unit,
            line.isOptional ?? false,
        ]),
    ]);
}

/**
 * The line editor's figures, as a **query over a proposal**.
 *
 * A query rather than a mutation because it is one: `previewRecipeRollup` stores nothing and changes
 * nothing, so it caches, deduplicates and retries like any other read. Debouncing is deliberately
 * *not* here — the editor knows which edits should wait (a quantity being typed) and which must not
 * (a line added, removed, reordered, or its unit changed), and a hook that guessed would make the
 * fast cases feel broken.
 *
 * `keepPreviousData` is the load-bearing option. The draft's hash is part of the key, so every edit
 * is a *different* query, and without it the panel would blank on each keystroke — dropping the
 * allergen list, which is the one thing on this screen that must never flicker to empty. With it,
 * the previous figures stay mounted while the next ones are fetched and `isPlaceholderData` tells
 * the panel to dim them and set `aria-busy`.
 *
 * `draft` is nullable and an empty line set never runs: the store refuses a roll-up with nothing to
 * roll up, and a `validation.failed` on the empty state of a new recipe would be a red panel that
 * says nothing a person can act on.
 */
export function useRecipeRollupQuery(
    draft: RecipeRollupDraft | null,
): UseQueryResult<RecipeRollupPreview> {
    const { repositories } = useRepositoryContext();
    const runnable = draft !== null && draft.lines.length > 0;

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.recipeRollup(
            draft === null ? 'none' : recipeRollupHash(draft),
        ),
        enabled: repositories !== null && runnable,
        placeholderData: keepPreviousData,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (draft === null) throw new Error('No draft to preview.');
            return repositories.kitchenAdmin.previewRecipeRollup(draft);
        },
    });
}

/* ── the delivery-area gazetteer (K1.7) ──────────────────────────────────────────────────────── */

/**
 * Pages the gazetteer fetches before it stops, and the cap that follows from it.
 *
 * `listServiceAreas` is a `CursorPage` like every other listing, and the mock repository's page
 * limit is 100. The production gazetteer the plan describes is ~125 rows, so a single page would
 * silently hide the last quarter of the country from a selector — which is the one place in this
 * workspace where an invisible row is a delivery that never happens. Four pages is therefore the
 * loop's bound, and {@link ServiceAreaGazetteer.truncated} says out loud when it was reached rather
 * than pretending the answer is complete.
 */
const SERVICE_AREA_PAGE_SIZE = 100;
const SERVICE_AREA_MAX_PAGES = 4;

export interface ServiceAreaGazetteer {
    readonly areas: readonly ServiceArea[];
    /** Rows the server says match, when it can count them; `null` when it cannot. */
    readonly total: number | null;
    /** True when the loop hit its bound with more rows still to come. */
    readonly truncated: boolean;
}

/**
 * The delivery-area gazetteer a zone selects from, in one country.
 *
 * **Scoped to the organisation's own country, on the server.** The gazetteer is a *platform* table
 * spanning every market the platform has opened — the committed one is Lebanese, and a demo tenant
 * adds Emirati rows (data register §5) — while `setZoneAreas` refuses any area outside the country
 * the zone's organisation operates in (`area_country_mismatch`). An unscoped read therefore offers
 * a manager hundreds of places their own zone can never cover, and the refusal arrives on save
 * rather than in the picker. `countryCode` is the one filter this endpoint applies itself, so it is
 * the one that is sent.
 *
 * **The rest is filtered on the client.** The picker is a search box over a few hundred stable
 * rows: filtering locally makes it instant and needs no debounce, no request per keystroke and no
 * "searching…" state — and the search a person actually performs is over *both* languages and the
 * parent's name, which is `areaMatches` in the feature, not a server parameter.
 *
 * `null` disables the read rather than widening it: a picker that cannot name its country must show
 * nothing, never everything.
 */
export function useServiceAreasQuery(
    countryCode: string | null,
    enabled = true,
): UseQueryResult<ServiceAreaGazetteer> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.serviceAreas({
            pageSize: SERVICE_AREA_PAGE_SIZE,
            countryCode,
        }),
        enabled: enabled && repositories !== null && countryCode !== null,
        queryFn: async (): Promise<ServiceAreaGazetteer> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (countryCode === null) throw new Error('No country to read the gazetteer for.');

            const areas: ServiceArea[] = [];
            let cursor: string | undefined;
            let total: number | null = null;
            let truncated = false;

            for (let page = 0; page < SERVICE_AREA_MAX_PAGES; page += 1) {
                const answered: CursorPage<ServiceArea> =
                    await repositories.kitchenAdmin.listServiceAreas({
                        limit: SERVICE_AREA_PAGE_SIZE,
                        countryCode,
                        ...(cursor === undefined ? {} : { cursor }),
                    });
                areas.push(...answered.items);
                if (page === 0) total = answered.totalCount;
                if (answered.nextCursor === null) break;
                cursor = answered.nextCursor;
                truncated = page === SERVICE_AREA_MAX_PAGES - 1;
            }

            return { areas, total, truncated };
        },
    });
}

/* ── delivery zones (K1.7) ───────────────────────────────────────────────────────────────────── */

export type AdminZonesInfiniteResult = UseInfiniteQueryResult<
    InfiniteData<CursorPage<DeliveryZoneAdmin>, string | undefined>,
    Error
>;

/** The accumulated zones across every page fetched so far. */
export function zonesFromPages(
    pages: readonly CursorPage<DeliveryZoneAdmin>[] | undefined,
): readonly DeliveryZoneAdmin[] {
    return (pages ?? []).flatMap((page) => page.items);
}

/** Total matching zones when the repository can count them; `null` when it cannot. */
export function zoneTotalFromPages(
    pages: readonly CursorPage<DeliveryZoneAdmin>[] | undefined,
): number | null {
    return pages?.[0]?.totalCount ?? null;
}

/** The kitchen's delivery zones, with their areas and windows already resolved by the contract. */
export function useAdminZonesQuery(
    filter?: Omit<DeliveryZoneAdminFilter, 'cursor'>,
    enabled = true,
): AdminZonesInfiniteResult {
    const { repositories } = useRepositoryContext();

    return useInfiniteQuery({
        queryKey: queryKeys.kitchenAdmin.zones(filter),
        enabled: enabled && repositories !== null,
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listZones({
                ...filter,
                ...(pageParam === undefined ? {} : { cursor: pageParam }),
            });
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });
}

/** One zone. Nullable identifier for the reason every detail hook here is. */
export function useAdminZoneQuery(
    zoneId: DeliveryZoneId | null,
): UseQueryResult<DeliveryZoneAdmin> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.zone(zoneId ?? ('' as DeliveryZoneId)),
        enabled: repositories !== null && zoneId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (zoneId === null) throw new Error('No zone identifier.');
            return repositories.kitchenAdmin.getZone(zoneId);
        },
    });
}

/**
 * The zone counts behind the hub card.
 *
 * Three `limit: 1` listings rather than four: a zone has no `review_required` state to reach.
 * `archiveZone` is the only lifecycle method the contract publishes for this family — there is no
 * `publishZone` — so a zone moves draft → retired and nothing quarantines it. Counting a status
 * nothing can produce would put a permanent zero on the card.
 */
export function useZoneSummaryQuery(enabled = true): UseQueryResult<PublishedFamilySummary> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.zones({ derive: 'summary' }),
        enabled: enabled && repositories !== null,
        queryFn: async (): Promise<PublishedFamilySummary> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            const [total, published, drafts] = await Promise.all([
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listZones({
                        limit: SUMMARY_PAGE_LIMIT,
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listZones({
                        limit: SUMMARY_PAGE_LIMIT,
                        statuses: ['published'],
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
                countAcrossPages((cursor) =>
                    repositories.kitchenAdmin.listZones({
                        limit: SUMMARY_PAGE_LIMIT,
                        statuses: ['draft'],
                        ...(cursor === undefined ? {} : { cursor }),
                    }),
                ),
            ]);
            return { total, published, drafts, quarantined: 0 };
        },
    });
}

/* ── zone writes ─────────────────────────────────────────────────────────────────────────────── */

/**
 * Writes the record into its detail entry and invalidates the workspace root *and* the marketplace.
 *
 * The marketplace invalidation is this family's own version of the rule the meal and plan writes
 * follow. A zone is not a consumer record, but a **branch publishes the zones that name it** — the
 * mock store rebuilds `Kitchen.branches[].deliveryZones` on every zone write
 * (`mock/prototype/catalogue-store.ts`), and only for zones that are `published`. So renaming a zone
 * changes what a shopper reads on the kitchen page, and archiving one takes it off that page
 * entirely. A narrower invalidation would leave the two disagreeing.
 */
function useZoneWriteEffects(): (zone: DeliveryZoneAdmin) => void {
    const queryClient = useQueryClient();

    return (zone: DeliveryZoneAdmin) => {
        queryClient.setQueryData(queryKeys.kitchenAdmin.zone(zone.id), zone);
        void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenAdmin.all() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.marketplace.all() });
    };
}

export function useCreateZoneMutation(): UseMutationResult<
    DeliveryZoneAdmin,
    unknown,
    CreateDeliveryZoneRequest
> {
    const repositories = useRepositories();
    const onWritten = useZoneWriteEffects();

    return useMutation({
        mutationFn: (request: CreateDeliveryZoneRequest) =>
            repositories.kitchenAdmin.createZone(request),
        onSuccess: onWritten,
    });
}

export interface UpdateZoneVariables {
    readonly zoneId: DeliveryZoneId;
    readonly request: UpdateDeliveryZoneRequest;
}

export function useUpdateZoneMutation(): UseMutationResult<
    DeliveryZoneAdmin,
    unknown,
    UpdateZoneVariables
> {
    const repositories = useRepositories();
    const onWritten = useZoneWriteEffects();

    return useMutation({
        mutationFn: ({ zoneId, request }: UpdateZoneVariables) =>
            repositories.kitchenAdmin.updateZone(zoneId, request),
        onSuccess: onWritten,
    });
}

export interface ZoneLifecycleVariables {
    readonly zoneId: DeliveryZoneId;
    readonly request: LockedRequest;
}

/**
 * Retires the zone.
 *
 * Nothing is deleted, and the consequence is visible immediately: the branches that serve the zone
 * stop publishing it, because the store only projects a zone onto a branch while it is `published`.
 * The editor states that before it asks.
 */
export function useArchiveZoneMutation(): UseMutationResult<
    DeliveryZoneAdmin,
    unknown,
    ZoneLifecycleVariables
> {
    const repositories = useRepositories();
    const onWritten = useZoneWriteEffects();

    return useMutation({
        mutationFn: ({ zoneId, request }: ZoneLifecycleVariables) =>
            repositories.kitchenAdmin.archiveZone(zoneId, request),
        onSuccess: onWritten,
    });
}

export interface SetZoneAreasVariables {
    readonly zoneId: DeliveryZoneId;
    readonly request: SetZoneAreasRequest;
}

/**
 * Replaces the whole area set.
 *
 * Wholesale because the contract is wholesale, and because coverage is judged as a set: "these are
 * the areas we deliver to" is one decision, and applying half of it would advertise a zone into a
 * district nobody agreed to. The store rejects an unknown identifier with `resource.not_found`
 * rather than skipping it, which is why the picker only ever offers rows it actually loaded.
 */
export function useSetZoneAreasMutation(): UseMutationResult<
    DeliveryZoneAdmin,
    unknown,
    SetZoneAreasVariables
> {
    const repositories = useRepositories();
    const onWritten = useZoneWriteEffects();

    return useMutation({
        mutationFn: ({ zoneId, request }: SetZoneAreasVariables) =>
            repositories.kitchenAdmin.setZoneAreas(zoneId, request),
        onSuccess: onWritten,
    });
}

export interface SetDeliveryWindowsVariables {
    readonly zoneId: DeliveryZoneId;
    readonly request: SetDeliveryWindowsRequest;
}

/**
 * Replaces the whole window set.
 *
 * A window sent with `id: null` is minted server-side and comes back with one, exactly as a plan
 * variant is — so the editor rebases its rows on the echo after every save. Without that, a second
 * save would send the same window with a null identifier again and create a duplicate.
 */
export function useSetDeliveryWindowsMutation(): UseMutationResult<
    DeliveryZoneAdmin,
    unknown,
    SetDeliveryWindowsVariables
> {
    const repositories = useRepositories();
    const onWritten = useZoneWriteEffects();

    return useMutation({
        mutationFn: ({ zoneId, request }: SetDeliveryWindowsVariables) =>
            repositories.kitchenAdmin.setDeliveryWindows(zoneId, request),
        onSuccess: onWritten,
    });
}

/* ── branch operating data (K1.7) ────────────────────────────────────────────────────────────── */

/**
 * One branch's trading week.
 *
 * Keyed by `KitchenBranchId`, which is **not** the `BranchId` the session context carries — two
 * brands, deliberately, because an organisation branch and a kitchen branch are different records
 * in the plan's schema. In this world they resolve to the same identity for the branch a kitchen
 * manager signs into, and the caller is the one place that crossing is made and stated
 * (`screens/branch-operating-screen.tsx`). Nothing is cast here.
 */
export function useBranchOperatingQuery(
    branchId: KitchenBranchId | null,
): UseQueryResult<BranchOperating> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.branchOperating(branchId ?? ('' as KitchenBranchId)),
        enabled: repositories !== null && branchId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (branchId === null) throw new Error('No branch identifier.');
            return repositories.kitchenAdmin.getBranchOperating(branchId);
        },
    });
}

/* ── the publication review queue (K1.8) ─────────────────────────────────────────────────────── */

/**
 * How many rows per family the queue fetches.
 *
 * A review queue that paged would be answering the wrong question: "is anything blocked?" has to be
 * answerable in one glance, and a second page hides exactly the row somebody has not looked at. So
 * one page per family, and {@link ReviewQueueSources.truncated} says out loud when a family filled
 * it rather than pretending the answer is complete. Fifty is chosen over the hundred the gazetteer
 * uses because six families at a hundred is six hundred admin records on one screen, which is a list
 * nobody reads either.
 */
const REVIEW_PAGE_SIZE = 50;

/**
 * The rows the queue is built from, still in contract shapes.
 *
 * This module deliberately stops here rather than returning a finished queue: deciding *why* a row
 * needs review is presentation logic, it belongs beside the screen that renders it
 * (`features/kitchen-admin/review-queue.ts`), and a data module that imported a feature would invert
 * this codebase's one dependency direction. The shape is structurally the feature's `ReviewSources`,
 * so `buildReviewQueue(sources)` takes it unchanged.
 */
export interface ReviewQueueSources {
    readonly ingredients: readonly IngredientAdmin[];
    readonly quarantinedRecipes: readonly RecipeAdminSummary[];
    readonly staleRecipes: readonly RecipeAdminSummary[];
    readonly products: readonly ProductAdmin[];
    readonly meals: readonly MealAdmin[];
    readonly plans: readonly PlanAdmin[];
    readonly priceLists: readonly PriceListAdmin[];
    /** True when some family filled its page, so more rows exist than the queue is showing. */
    readonly truncated: boolean;
}

/**
 * Everything awaiting review, across every family that can hold something, in one query.
 *
 * ## Seven listings, one cache entry, two readers
 *
 * The hub's "Needs review" card and the `/kitchen/review` screen ask the same question, so they call
 * this same hook and share one cache entry (`queryKeys.kitchenAdmin.review()` takes no parameters
 * for exactly that reason). Opening the queue from the hub therefore costs nothing, and the card can
 * lead with a number it did not have to guess.
 *
 * They are folded into one `queryFn` rather than composed from seven hooks for the reason every
 * summary above gives: a card and a screen can each render one pending state, one error and one
 * `refetch`, and seven independent queries would give them seven of each — including the state where
 * five families have answered and the total on screen is wrong.
 *
 * ## Why the filters are what they are
 *
 * Every listing is **narrowed server-side**, so this is seven requests and not a scan of the
 * catalogue. `statuses: ['review_required']` is a real filter on five of the six families;
 * `staleOnly` filters recipes whose published (or draft-only) version has a stale derivation.
 * the `CHECK` violation the queue reports (`isPriceEntryConsistent`) has no filter on
 * `PriceListAdminFilter`, and the listing already returns every entry of every list, so evaluating
 * it here costs one request rather than one per list. A `?inconsistentOnly=true` on the endpoint
 * would remove that asymmetry and this note with it.
 *
 * @param enabled `false` while the reader holds no catalogue permission — the hub passes it.
 */
export function useReviewQueueQuery(enabled = true): UseQueryResult<ReviewQueueSources> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.review(),
        enabled: enabled && repositories !== null,
        queryFn: async (): Promise<ReviewQueueSources> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            const limit = REVIEW_PAGE_SIZE;
            const quarantine = { limit, statuses: ['review_required'] as const };

            const [
                ingredients,
                quarantinedRecipes,
                staleRecipes,
                products,
                meals,
                plans,
                priceLists,
            ] = await Promise.all([
                repositories.kitchenAdmin.listIngredients({ ...quarantine }),
                repositories.kitchenAdmin.listRecipes({ ...quarantine }),
                repositories.kitchenAdmin.listRecipes({ limit, staleOnly: true }),
                repositories.kitchenAdmin.listProducts({ ...quarantine }),
                repositories.kitchenAdmin.listMeals({ ...quarantine }),
                repositories.kitchenAdmin.listPlans({ ...quarantine }),
                repositories.kitchenAdmin.listPriceLists({ limit }),
            ]);

            const pages = [
                ingredients,
                quarantinedRecipes,
                staleRecipes,
                products,
                meals,
                plans,
                priceLists,
            ];

            return {
                ingredients: ingredients.items,
                quarantinedRecipes: quarantinedRecipes.items,
                staleRecipes: staleRecipes.items,
                products: products.items,
                meals: meals.items,
                plans: plans.items,
                priceLists: priceLists.items,
                truncated: pages.some((page) => page.nextCursor !== null),
            };
        },
    });
}

export interface SetBranchOperatingVariables {
    readonly branchId: KitchenBranchId;
    readonly request: SetBranchOperatingRequest;
}

/**
 * Replaces the branch's whole trading week.
 *
 * The marketplace invalidation matters as much here as on a zone write and for the same mechanism:
 * the store re-projects `KitchenBranch.openingHours` from this record, so a shopper's view of when
 * a branch trades is downstream of this one save. The workspace root is invalidated rather than
 * only this branch's key, because the hub card counts open days from the same record.
 */
export function useSetBranchOperatingMutation(): UseMutationResult<
    BranchOperating,
    unknown,
    SetBranchOperatingVariables
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ branchId, request }: SetBranchOperatingVariables) =>
            repositories.kitchenAdmin.setBranchOperating(branchId, request),
        onSuccess: (operating: BranchOperating) => {
            queryClient.setQueryData(
                queryKeys.kitchenAdmin.branchOperating(operating.branchId),
                operating,
            );
            void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenAdmin.all() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.marketplace.all() });
        },
    });
}

/* ── numbered pages ──────────────────────────────────────────────────────────────────────────── */

/**
 * The seven catalogue lists, one page at a time.
 *
 * These sit *beside* the infinite hooks above rather than replacing them, because the two have
 * different callers. A list screen wants a page control; an editor wants the whole picker
 * (`useRecipesQuery({ limit: 100 })` feeds a select, and a page control on a select is nonsense).
 * Collapsing them into one hook would mean a return type that is a union of an infinite result and
 * a plain one, and every one of the twelve editor call sites narrowing it for no gain.
 *
 * Only these seven exist. Offset pagination is confined to the kitchen catalogue for the reasons
 * `docs/api/conventions.md` sets out, and a `use…PageQuery` for the order book or the marketplace
 * would compile here and 400 in production.
 *
 * ## Previous data is kept across a page change and dropped across a filter change
 *
 * Both halves matter. Without the first, the table unmounts on every page change and the screen
 * flashes its skeleton between page 3 and page 4. Without the second, typing into the search box
 * leaves rows on screen that do not match what was typed — for as long as the request takes — and
 * "no results" becomes unreadable, because the reader cannot tell a stale list from a matching one.
 *
 * `keepPreviousData` alone gives the first and not the second: it keeps whatever the last entry
 * held, and the last entry is as likely to be a different filter as a different page.
 * {@link samePageSet} is what tells them apart.
 *
 * `perPage` is fixed per family rather than offered as a control. A page-size select is a real
 * feature, but an unused one costs every reader the moment it takes to decide it is not for them,
 * and nothing in the design asks for it.
 */

/**
 * Whether two page keys describe the same collection, differing only in which page of it.
 *
 * The keys are `['kitchenAdmin', <family>, 'page', <filter>, <page>]`, so everything but the last
 * member is the collection. Hashed with TanStack's own `hashKey` rather than compared by identity or
 * by `JSON.stringify`, because that is the function the cache itself uses to decide whether two keys
 * are the same — anything else would be a second, subtly different answer to a question already
 * settled elsewhere.
 */
function samePageSet(a: readonly unknown[] | undefined, b: readonly unknown[]): boolean {
    if (a === undefined) return false;
    return hashKey(a.slice(0, -1)) === hashKey(b.slice(0, -1));
}

/**
 * `placeholderData` that survives a page change and not a filter change.
 *
 * Written once and passed to all seven, so the two behaviours cannot drift apart per family.
 */
function keepAcrossPages<T>(key: readonly unknown[]) {
    return (
        previous: T | undefined,
        previousQuery: { queryKey: readonly unknown[] } | undefined,
    ) => (samePageSet(previousQuery?.queryKey, key) ? previous : undefined);
}

/**
 * Rows per page across the kitchen catalogue.
 *
 * Eighteen, which is what `Catalogue.dc.html` draws and what a 28px row lets a desk viewport hold
 * without scrolling: the whole page of results sits in the fold, so paging is a deliberate act
 * rather than the thing that happens when you reach the bottom of a half-shown page.
 *
 * Below the backend's own default of 25, and deliberately not equal to it — a client that wants a
 * particular page shape should say so rather than inherit whatever the server happens to prefer.
 * `per_page` accepts 1–100, so this is well inside the contract.
 *
 * One number for all seven families. A page size that differed per list would make "next page" mean
 * a different amount of work on each of them for no reason a reader could see.
 */
export const KITCHEN_PAGE_SIZE = 18;

export type PagedListResult<T> = UseQueryResult<CursorPage<T>, Error>;

/**
 * Pages in a numbered result, or `null` before the first page has landed.
 *
 * `null` and `0` are different answers and the caller must not conflate them: `0` is "this filter
 * matches nothing", which is an empty state; `null` is "not known yet", which is a skeleton.
 */
export function pagesInResult(page: CursorPage<unknown> | undefined): number | null {
    return page === undefined ? null : pageCount(page.totalCount, KITCHEN_PAGE_SIZE);
}

/** A filter as a list screen holds it: no pagination, since the page control owns that. */
type ListFilter<F> = Omit<F, 'cursor' | 'limit' | 'page' | 'perPage'>;

export function useIngredientPageQuery(
    filter: ListFilter<IngredientAdminFilter> | undefined,
    page: number,
    enabled = true,
): PagedListResult<IngredientAdmin> {
    const { repositories } = useRepositoryContext();

    const key = queryKeys.kitchenAdmin.ingredientsPage(filter, page);

    return useQuery({
        queryKey: key,
        enabled: enabled && repositories !== null,
        placeholderData: keepAcrossPages(key),
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listIngredients({
                ...filter,
                page,
                perPage: KITCHEN_PAGE_SIZE,
            });
        },
    });
}

/**
 * One numbered page of the packaging catalogue.
 *
 * Not its own endpoint any more. Packaging is back in `ingredients`, filed under
 * {@link PACKAGING_CATEGORY_CODE}, so this is the ingredient page asking for that one branch —
 * and its counterpart is the ingredient list asking for everything *but* that branch.
 *
 * The pair is what replaced the separate table, and the failure that produced the table is closed
 * on both sides now: `listIngredients` returns an empty page for an inclusion it cannot resolve,
 * and *refuses* an exclusion it cannot resolve. Neither list can widen by accident, which is the
 * only property the split was ever buying.
 */
export function usePackagingPageQuery(
    filter: ListFilter<IngredientAdminFilter> | undefined,
    page: number,
    enabled = true,
): PagedListResult<IngredientAdmin> {
    return useIngredientPageQuery(
        { ...filter, categoryCode: filter?.categoryCode ?? PACKAGING_CATEGORY_CODE },
        page,
        enabled,
    );
}

/**
 * The packaging taxonomy — the branch of the ingredient tree, not a tree of its own.
 *
 * Returns the branch's own nodes: the root and its children, which is what the packaging list's
 * sub-category filter offers. The whole tree is {@link useIngredientCategoriesQuery}.
 */
export function usePackagingCategoriesQuery(): UseQueryResult<readonly IngredientCategoryAdmin[]> {
    const categories = useIngredientCategoriesQuery();

    return {
        ...categories,
        data: categories.data?.filter((entry) => entry.code.startsWith(PACKAGING_CATEGORY_CODE)),
    } as UseQueryResult<readonly IngredientCategoryAdmin[]>;
}

export function useRecipePageQuery(
    filter: ListFilter<RecipeAdminFilter> | undefined,
    page: number,
    enabled = true,
): PagedListResult<RecipeAdminSummary> {
    const { repositories } = useRepositoryContext();

    const key = queryKeys.kitchenAdmin.recipesPage(filter, page);

    return useQuery({
        queryKey: key,
        enabled: enabled && repositories !== null,
        placeholderData: keepAcrossPages(key),
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listRecipes({
                ...filter,
                page,
                perPage: KITCHEN_PAGE_SIZE,
            });
        },
    });
}

export function useProductPageQuery(
    filter: ListFilter<ProductAdminFilter> | undefined,
    page: number,
    enabled = true,
): PagedListResult<ProductAdmin> {
    const { repositories } = useRepositoryContext();

    const key = queryKeys.kitchenAdmin.productsPage(filter, page);

    return useQuery({
        queryKey: key,
        enabled: enabled && repositories !== null,
        placeholderData: keepAcrossPages(key),
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listProducts({
                ...filter,
                page,
                perPage: KITCHEN_PAGE_SIZE,
            });
        },
    });
}

export function useAdminMealPageQuery(
    filter: ListFilter<MealAdminFilter> | undefined,
    page: number,
    enabled = true,
): PagedListResult<MealAdmin> {
    const { repositories } = useRepositoryContext();

    const key = queryKeys.kitchenAdmin.mealsPage(filter, page);

    return useQuery({
        queryKey: key,
        enabled: enabled && repositories !== null,
        placeholderData: keepAcrossPages(key),
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listMeals({
                ...filter,
                page,
                perPage: KITCHEN_PAGE_SIZE,
            });
        },
    });
}

export function useAdminPlanPageQuery(
    filter: ListFilter<PlanAdminFilter> | undefined,
    page: number,
    enabled = true,
): PagedListResult<PlanAdmin> {
    const { repositories } = useRepositoryContext();

    const key = queryKeys.kitchenAdmin.plansPage(filter, page);

    return useQuery({
        queryKey: key,
        enabled: enabled && repositories !== null,
        placeholderData: keepAcrossPages(key),
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listPlans({
                ...filter,
                page,
                perPage: KITCHEN_PAGE_SIZE,
            });
        },
    });
}

export function usePriceListPageQuery(
    filter: ListFilter<PriceListAdminFilter> | undefined,
    page: number,
    enabled = true,
): PagedListResult<PriceListAdmin> {
    const { repositories } = useRepositoryContext();

    const key = queryKeys.kitchenAdmin.priceListsPage(filter, page);

    return useQuery({
        queryKey: key,
        enabled: enabled && repositories !== null,
        placeholderData: keepAcrossPages(key),
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listPriceLists({
                ...filter,
                page,
                perPage: KITCHEN_PAGE_SIZE,
            });
        },
    });
}

export function useDeliveryZonePageQuery(
    filter: ListFilter<DeliveryZoneAdminFilter> | undefined,
    page: number,
    enabled = true,
): PagedListResult<DeliveryZoneAdmin> {
    const { repositories } = useRepositoryContext();

    const key = queryKeys.kitchenAdmin.zonesPage(filter, page);

    return useQuery({
        queryKey: key,
        enabled: enabled && repositories !== null,
        placeholderData: keepAcrossPages(key),
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listZones({
                ...filter,
                page,
                perPage: KITCHEN_PAGE_SIZE,
            });
        },
    });
}
