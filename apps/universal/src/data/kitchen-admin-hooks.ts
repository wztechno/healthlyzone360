import type {
    AllergenClass,
    CreateIngredientRequest,
    CursorPage,
    IngredientAdmin,
    IngredientAdminFilter,
    LockedRequest,
    SetIngredientAllergensRequest,
    UpdateIngredientRequest,
} from '@healthy360/api-client/contracts';
import type { IngredientId } from '@healthy360/domain-types';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
