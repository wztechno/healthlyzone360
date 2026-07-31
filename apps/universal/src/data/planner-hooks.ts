import type {
    AddEntryRequest,
    AdjustPortionRequest,
    CursorPage,
    DuplicatePlanRequest,
    Food,
    FoodSearchFilter,
    GeneratePlanRequest,
    GroceryList,
    MarketplaceMeal,
    MealFilter,
    MealPlanDay,
    MealPlanEntry,
    MealPlanSummary,
    MealPlanWeek,
    Pantry,
    PlanHistoryEvent,
    PlanNotes,
    Recipe,
    RecipeFilter,
    RegenerateScopeRequest,
    RepeatMealRequest,
    ReplaceEntryRequest,
    SaveTemplateRequest,
    SetPlanNotesRequest,
} from '@healthy360/api-client/contracts';
import type { MealPlanEntryId, MealPlanId, RecipeId } from '@healthy360/domain-types';
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
 * The meal planner's data access: the week, the day, the entry mutations, the replacement search,
 * notes, history, the grocery list, the pantry and the recipe record.
 *
 * Same rules as `./catalogue-hooks.ts` and `./vd-hooks.ts` — one hook per repository operation, the
 * `enabled` guards written once, and no screen ever holding a repository. Four things are specific
 * to the planner and each one is a decision rather than a style.
 *
 * ## Every mutation invalidates the whole `planner` root
 *
 * A planner mutation is never local. Locking an entry changes the week *and* the day *and* the
 * history; regenerating a day moves the week's totals and its cost; replacing an entry can change
 * the grocery list, because the grocery list is derived from the home-prepared entries
 * (`contracts/foods.ts`). `query-keys.ts` shapes every planner key as `['planner', …]` precisely so
 * that one prefix invalidation covers all of it, and anything narrower here would be a cache that
 * is right about the screen you are looking at and wrong about the one you navigate to next.
 *
 * The two exceptions are `saveAsTemplate` and `duplicate`: both create a *new* plan and leave the
 * current one untouched, so they invalidate the plan list and nothing else.
 *
 * ## The plan is resolved through `getCurrentPlan`, never through a Virtual Dietitian session
 *
 * Wave 2 had no way to discover a plan identifier and worked around it through the approved VD
 * session's `draftPlanId`. That draft is only materialised when `generateDraft` actually runs, so a
 * cold read of a fixture session's draft plan fails. `listPlans` and `getCurrentPlan` were added to
 * `MealPlanRepository` at the Wave 2 gate for exactly this reason, and the planner resolves through
 * `getCurrentPlan` alone — `null` from it is the honest "you have no plan yet" answer, and
 * `MealPlanSummary` already carries the `weekStart` the planner needs to open on. `listPlans` stays
 * unused here rather than being given a query key this wave invented (`query-keys.ts` is a
 * chokepoint later waves read and do not edit).
 *
 * ## The replacement search is keyed by the entry it is replacing
 *
 * `queryKeys.planner.replacements(planId, entryId, filter)` — not `catalogue.meals`. The candidates
 * are the same rows the catalogue lists, but the *question* is different: "what could go in this
 * slot", and the answer is scoped to a slot. Keying it under the catalogue would mean a filter typed
 * in the drawer silently changing what the public meal listing shows on the next screen.
 *
 * ## History is an infinite query
 *
 * `history()` is the one planner read with a cursor (`CursorPageRequest`), and a plan that has been
 * edited for a month has more events than a drawer can show. The cursor is deliberately not part of
 * the key: TanStack owns page assembly, and a key carrying the cursor creates one cache entry per
 * page.
 */

export { toFailure } from './hooks.ts';
/**
 * Re-exported rather than redefined. `catalogue-hooks.ts` already owns this query — the meal record
 * needs it to offer "add to my plan" — and two hooks over one key that drifted apart would be two
 * different answers to "which plan am I following".
 */
export { useCurrentPlanQuery } from './catalogue-hooks.ts';

/* ── the week and the day ────────────────────────────────────────────────────────────────────── */

/**
 * One week of one plan.
 *
 * Both parameters are nullable because both arrive indirectly: the plan identifier from
 * `getCurrentPlan`, which has not settled on the first frame, and the Monday from a route parameter
 * that may be absent or malformed. A disabled query is the honest state for either — asking
 * `getWeek(undefined, undefined)` would render a server failure that was really a routing race.
 */
export function usePlannerWeekQuery(
    planId: MealPlanId | null,
    weekStart: string | null,
): UseQueryResult<MealPlanWeek> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.planner.week(planId ?? ('' as MealPlanId), weekStart ?? ''),
        enabled: repositories !== null && planId !== null && weekStart !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (planId === null || weekStart === null) throw new Error('No plan week to read.');
            return repositories.planner.getWeek(planId, weekStart);
        },
    });
}

export function usePlannerDayQuery(
    planId: MealPlanId | null,
    date: string | null,
): UseQueryResult<MealPlanDay> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.planner.day(planId ?? ('' as MealPlanId), date ?? ''),
        enabled: repositories !== null && planId !== null && date !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (planId === null || date === null) throw new Error('No plan day to read.');
            return repositories.planner.getDay(planId, date);
        },
    });
}

/* ── notes and history ───────────────────────────────────────────────────────────────────────── */

export function usePlanNotesQuery(planId: MealPlanId | null): UseQueryResult<PlanNotes> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.planner.notes(planId ?? ('' as MealPlanId)),
        enabled: repositories !== null && planId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (planId === null) throw new Error('No plan identifier.');
            return repositories.planner.getNotes(planId);
        },
    });
}

export type PlanHistoryResult = UseInfiniteQueryResult<
    InfiniteData<CursorPage<PlanHistoryEvent>, string | undefined>,
    Error
>;

export function usePlanHistoryQuery(
    planId: MealPlanId | null,
    /** `false` while the drawer is shut, so a history nobody is reading is never fetched. */
    enabled = true,
    limit = 20,
): PlanHistoryResult {
    const { repositories } = useRepositoryContext();

    return useInfiniteQuery({
        queryKey: queryKeys.planner.history(planId ?? ('' as MealPlanId), { limit }),
        enabled: enabled && repositories !== null && planId !== null,
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (planId === null) throw new Error('No plan identifier.');
            return repositories.planner.history(planId, {
                limit,
                ...(pageParam === undefined ? {} : { cursor: pageParam }),
            });
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });
}

/** The accumulated history events across every page fetched so far. */
export function historyFromPages(
    pages: readonly CursorPage<PlanHistoryEvent>[] | undefined,
): readonly PlanHistoryEvent[] {
    return (pages ?? []).flatMap((page) => page.items);
}

/* ── grocery, pantry, recipes, foods ─────────────────────────────────────────────────────────── */

export function useGroceryListQuery(weekStart: string | null): UseQueryResult<GroceryList> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.planner.grocery(weekStart ?? ''),
        enabled: repositories !== null && weekStart !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (weekStart === null) throw new Error('No week to shop for.');
            return repositories.foods.getGroceryList(weekStart);
        },
    });
}

export function usePantryQuery(enabled = true): UseQueryResult<Pantry> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.planner.pantry(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.foods.getPantry();
        },
    });
}

/** One home-prepared recipe. Cached under `catalogue`, which is where recipe records belong. */
export function useRecipeQuery(recipeId: RecipeId | null): UseQueryResult<Recipe> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.catalogue.recipe(recipeId ?? ('' as RecipeId)),
        enabled: repositories !== null && recipeId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (recipeId === null) throw new Error('No recipe identifier.');
            return repositories.foods.getRecipe(recipeId);
        },
    });
}

export function useRecipesQuery(
    filter?: RecipeFilter,
    enabled = true,
): UseQueryResult<CursorPage<Recipe>> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.catalogue.recipes(filter),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.foods.listRecipes(filter);
        },
    });
}

/**
 * The food search behind "add a food".
 *
 * `FoodSearchFilter.query` is mandatory in the contract — the listing is always query-driven — so
 * the hook is disabled until something has been typed rather than fetching the whole ingredient
 * table on mount.
 */
export function useFoodSearchQuery(
    filter: FoodSearchFilter | null,
): UseQueryResult<CursorPage<Food>> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.catalogue.foods(filter ?? {}),
        enabled: repositories !== null && filter !== null && filter.query.trim() !== '',
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (filter === null) throw new Error('No food search.');
            return repositories.foods.searchFoods(filter);
        },
    });
}

/* ── the replacement search ──────────────────────────────────────────────────────────────────── */

/**
 * Marketplace meals as replacement candidates for one entry.
 *
 * Keyed under `planner.replacements`, not `catalogue.meals`: see the module note.
 */
export function useReplacementMealsQuery(
    planId: MealPlanId | null,
    entryId: MealPlanEntryId | null,
    filter: Omit<MealFilter, 'cursor'>,
    enabled = true,
): UseQueryResult<CursorPage<MarketplaceMeal>> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.planner.replacements(
            planId ?? ('' as MealPlanId),
            entryId ?? ('' as MealPlanEntryId),
            { source: 'kitchen_meal', ...filter },
        ),
        enabled: enabled && repositories !== null && planId !== null && entryId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.marketplace.listMeals(filter);
        },
    });
}

/** Home-prepared recipes as replacement candidates for one entry. */
export function useReplacementRecipesQuery(
    planId: MealPlanId | null,
    entryId: MealPlanEntryId | null,
    filter: RecipeFilter,
    enabled = true,
): UseQueryResult<CursorPage<Recipe>> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.planner.replacements(
            planId ?? ('' as MealPlanId),
            entryId ?? ('' as MealPlanEntryId),
            { source: 'recipe', ...filter },
        ),
        enabled: enabled && repositories !== null && planId !== null && entryId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.foods.listRecipes(filter);
        },
    });
}

/* ── mutations ───────────────────────────────────────────────────────────────────────────────── */

/**
 * The shared success path.
 *
 * Returned as an async function and awaited by every `onSuccess`, so the mutation stays `isPending`
 * until the refetch it triggered has landed. Without the await a screen briefly shows a settled
 * mutation over stale data, which is the frame in which a lock toggle appears to have done nothing.
 */
function usePlannerInvalidator(): () => Promise<void> {
    const queryClient = useQueryClient();
    return async () => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.planner.all() });
    };
}

export interface EntryVariables {
    readonly planId: MealPlanId;
    readonly entryId: MealPlanEntryId;
}

export function useLockEntryMutation(): UseMutationResult<
    MealPlanEntry,
    unknown,
    EntryVariables & { readonly locked: boolean }
> {
    const repositories = useRepositories();
    const invalidate = usePlannerInvalidator();

    return useMutation({
        mutationFn: ({ planId, entryId, locked }: EntryVariables & { readonly locked: boolean }) =>
            locked
                ? repositories.planner.lockEntry(planId, entryId)
                : repositories.planner.unlockEntry(planId, entryId),
        onSuccess: invalidate,
    });
}

export function useRegenerateEntryMutation(): UseMutationResult<
    MealPlanEntry,
    unknown,
    EntryVariables & { readonly request?: RegenerateScopeRequest | undefined }
> {
    const repositories = useRepositories();
    const invalidate = usePlannerInvalidator();

    return useMutation({
        mutationFn: ({
            planId,
            entryId,
            request,
        }: EntryVariables & { readonly request?: RegenerateScopeRequest | undefined }) =>
            repositories.planner.regenerateEntry(planId, entryId, request),
        onSuccess: invalidate,
    });
}

export interface RegenerateDayVariables {
    readonly planId: MealPlanId;
    readonly date: string;
    readonly request?: RegenerateScopeRequest | undefined;
}

export function useRegenerateDayMutation(): UseMutationResult<
    MealPlanDay,
    unknown,
    RegenerateDayVariables
> {
    const repositories = useRepositories();
    const invalidate = usePlannerInvalidator();

    return useMutation({
        mutationFn: ({ planId, date, request }: RegenerateDayVariables) =>
            repositories.planner.regenerateDay(planId, date, request),
        onSuccess: invalidate,
    });
}

export interface RegenerateWeekVariables {
    readonly planId: MealPlanId;
    readonly request?: RegenerateScopeRequest | undefined;
}

export function useRegenerateWeekMutation(): UseMutationResult<
    MealPlanWeek,
    unknown,
    RegenerateWeekVariables
> {
    const repositories = useRepositories();
    const invalidate = usePlannerInvalidator();

    return useMutation({
        mutationFn: ({ planId, request }: RegenerateWeekVariables) =>
            repositories.planner.regenerateWeek(planId, request),
        onSuccess: invalidate,
    });
}

export function useReplaceEntryMutation(): UseMutationResult<
    readonly MealPlanEntry[],
    unknown,
    EntryVariables & { readonly request: ReplaceEntryRequest }
> {
    const repositories = useRepositories();
    const invalidate = usePlannerInvalidator();

    return useMutation({
        mutationFn: ({
            planId,
            entryId,
            request,
        }: EntryVariables & { readonly request: ReplaceEntryRequest }) =>
            repositories.planner.replaceEntry(planId, entryId, request),
        onSuccess: invalidate,
    });
}

export function useAdjustPortionMutation(): UseMutationResult<
    MealPlanEntry,
    unknown,
    EntryVariables & { readonly request: AdjustPortionRequest }
> {
    const repositories = useRepositories();
    const invalidate = usePlannerInvalidator();

    return useMutation({
        mutationFn: ({
            planId,
            entryId,
            request,
        }: EntryVariables & { readonly request: AdjustPortionRequest }) =>
            repositories.planner.adjustPortion(planId, entryId, request),
        onSuccess: invalidate,
    });
}

export interface AddEntryVariables {
    readonly planId: MealPlanId;
    readonly request: AddEntryRequest;
}

export function useAddEntryMutation(): UseMutationResult<
    MealPlanEntry,
    unknown,
    AddEntryVariables
> {
    const repositories = useRepositories();
    const invalidate = usePlannerInvalidator();

    return useMutation({
        mutationFn: ({ planId, request }: AddEntryVariables) =>
            repositories.planner.addEntry(planId, request),
        onSuccess: invalidate,
    });
}

export function useRemoveEntryMutation(): UseMutationResult<void, unknown, EntryVariables> {
    const repositories = useRepositories();
    const invalidate = usePlannerInvalidator();

    return useMutation({
        mutationFn: ({ planId, entryId }: EntryVariables) =>
            repositories.planner.removeEntry(planId, entryId),
        onSuccess: invalidate,
    });
}

export interface RepeatMealVariables {
    readonly planId: MealPlanId;
    readonly request: RepeatMealRequest;
}

export function useRepeatMealMutation(): UseMutationResult<
    readonly MealPlanEntry[],
    unknown,
    RepeatMealVariables
> {
    const repositories = useRepositories();
    const invalidate = usePlannerInvalidator();

    return useMutation({
        mutationFn: ({ planId, request }: RepeatMealVariables) =>
            repositories.planner.repeatMeal(planId, request),
        onSuccess: invalidate,
    });
}

export interface SetNotesVariables {
    readonly planId: MealPlanId;
    readonly request: SetPlanNotesRequest;
}

export function useSetPlanNotesMutation(): UseMutationResult<
    PlanNotes,
    unknown,
    SetNotesVariables
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ planId, request }: SetNotesVariables) =>
            repositories.planner.setNotes(planId, request),
        onSuccess: async (notes) => {
            // Written straight in as well as invalidated: the editor reports "saved" in the same
            // frame it shows the saved text, and a refetch would land after it.
            queryClient.setQueryData(queryKeys.planner.notes(notes.planId), notes);
            await queryClient.invalidateQueries({ queryKey: queryKeys.planner.all() });
        },
    });
}

export interface SaveTemplateVariables {
    readonly planId: MealPlanId;
    readonly request: SaveTemplateRequest;
}

/**
 * Saving the plan as a template creates a *new* plan and leaves this one alone, so only the plan
 * list is stale. Invalidating the week here would reload the whole planner for a change that did
 * not touch it.
 */
export function useSaveTemplateMutation(): UseMutationResult<
    MealPlanSummary,
    unknown,
    SaveTemplateVariables
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ planId, request }: SaveTemplateVariables) =>
            repositories.planner.saveAsTemplate(planId, request),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.planner.currentPlan() });
        },
    });
}

export interface DuplicatePlanVariables {
    readonly planId: MealPlanId;
    readonly request: DuplicatePlanRequest;
}

export function useDuplicatePlanMutation(): UseMutationResult<
    MealPlanWeek,
    unknown,
    DuplicatePlanVariables
> {
    const repositories = useRepositories();
    const invalidate = usePlannerInvalidator();

    return useMutation({
        mutationFn: ({ planId, request }: DuplicatePlanVariables) =>
            repositories.planner.duplicate(planId, request),
        onSuccess: invalidate,
    });
}

/**
 * Generating a week.
 *
 * Offered from the empty state of a week that has nothing in it, which is the only place in the
 * planner where "there is no plan here" has a real answer rather than a link somewhere else.
 */
export function useGeneratePlanMutation(): UseMutationResult<
    MealPlanWeek,
    unknown,
    GeneratePlanRequest
> {
    const repositories = useRepositories();
    const invalidate = usePlannerInvalidator();

    return useMutation({
        mutationFn: (request: GeneratePlanRequest) => repositories.planner.generate(request),
        onSuccess: invalidate,
    });
}
