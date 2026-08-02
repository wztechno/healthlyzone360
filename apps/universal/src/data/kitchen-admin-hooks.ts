import type {
    AllergenClass,
    CreateIngredientRequest,
    CreateRecipeRequest,
    CursorPage,
    IngredientAdmin,
    IngredientAdminFilter,
    LockedRequest,
    RecipeAdmin,
    RecipeAdminFilter,
    RecipeAdminSummary,
    RecipeRollupDraft,
    RecipeRollupPreview,
    SetIngredientAllergensRequest,
    SetRecipeLinesRequest,
    SetRecipeOutputsRequest,
    SetRecipeStepsRequest,
    UpdateIngredientRequest,
    UpdateRecipeRequest,
} from '@healthy360/api-client/contracts';
import type { IngredientId, KitchenId, RecipeId } from '@healthy360/domain-types';
import {
    keepPreviousData,
    useInfiniteQuery,
    useMutation,
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

/** One category the kitchen actually uses, with how many rows carry it. */
export interface IngredientCategory {
    readonly code: string;
    readonly count: number;
}

/**
 * The category vocabulary, derived from the codes in use.
 *
 * See the module note: there is no category resource on the contract. The derivation reads one
 * unfiltered page rather than every page, because a filter control that made the reader wait for the
 * whole library before it could offer a choice would be worse than one that offers the codes the
 * first page proves exist. `limit` is the repository's maximum so the common case is complete.
 */
export function useIngredientCategoriesQuery(): UseQueryResult<readonly IngredientCategory[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.ingredients({ derive: 'categories' }),
        enabled: repositories !== null,
        queryFn: async (): Promise<readonly IngredientCategory[]> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            const page = await repositories.kitchenAdmin.listIngredients({ limit: 100 });
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

/** What the hub card for a managed family reports. */
export interface FamilySummary {
    /** `null` when the repository cannot count cheaply — the card then says so. */
    readonly total: number | null;
    readonly drafts: number | null;
    readonly quarantined: number | null;
}

/**
 * The ingredient counts behind the hub card, in one query.
 *
 * Three listings rather than one, each asking for a single row: `CursorPage.totalCount` is the count
 * of everything that *matched*, so a `limit: 1` request is the cheapest honest way to ask "how many
 * drafts are there?" without pulling the library across to count it on the client. They are folded
 * into one `queryFn` for the same reason `useCorporateProgrammesQuery` folds its two — one pending
 * state, one error, one `refetch`, which is what a card can actually render.
 */
export function useIngredientSummaryQuery(enabled = true): UseQueryResult<FamilySummary> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.ingredients({ derive: 'summary' }),
        enabled: enabled && repositories !== null,
        queryFn: async (): Promise<FamilySummary> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            const [all, drafts, quarantined] = await Promise.all([
                repositories.kitchenAdmin.listIngredients({ limit: 1 }),
                repositories.kitchenAdmin.listIngredients({ limit: 1, statuses: ['draft'] }),
                repositories.kitchenAdmin.listIngredients({
                    limit: 1,
                    statuses: ['review_required'],
                }),
            ]);
            return {
                total: all.totalCount,
                drafts: drafts.totalCount,
                quarantined: quarantined.totalCount,
            };
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

/** What the recipes hub card reports. `published` is the one a kitchen actually acts on. */
export interface RecipeFamilySummary extends FamilySummary {
    readonly published: number | null;
}

/**
 * The recipe counts behind the hub card, in one query.
 *
 * Four `limit: 1` listings folded into one `queryFn`, for the reason
 * {@link useIngredientSummaryQuery} gives: `CursorPage.totalCount` counts everything that *matched*,
 * so asking for a single row is the cheapest honest way to count a status, and one card can only
 * render one pending state, one error and one `refetch`.
 */
export function useRecipeSummaryQuery(enabled = true): UseQueryResult<RecipeFamilySummary> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenAdmin.recipes({ derive: 'summary' }),
        enabled: enabled && repositories !== null,
        queryFn: async (): Promise<RecipeFamilySummary> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            const [all, published, drafts, quarantined] = await Promise.all([
                repositories.kitchenAdmin.listRecipes({ limit: 1 }),
                repositories.kitchenAdmin.listRecipes({ limit: 1, statuses: ['published'] }),
                repositories.kitchenAdmin.listRecipes({ limit: 1, statuses: ['draft'] }),
                repositories.kitchenAdmin.listRecipes({ limit: 1, statuses: ['review_required'] }),
            ]);
            return {
                total: all.totalCount,
                published: published.totalCount,
                drafts: drafts.totalCount,
                quarantined: quarantined.totalCount,
            };
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
