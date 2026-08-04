import type {
    AddCartItemRequest,
    AddEntryRequest,
    Cart,
    CursorPage,
    DietCategory,
    MarketplaceMeal,
    MealFilter,
    MealPlanEntry,
    MealPlanSummary,
    PlanFilter,
    SubscriptionPlan,
} from '@healthy360/api-client/contracts';
import type { MealId, SubscriptionPlanId } from '@healthy360/domain-types';
import type { NutritionTargetRequest, NutritionTargetResult } from '@healthy360/nutrition';
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
 * The item catalogue: meals, subscription plans, diet categories and the public target calculator.
 *
 * Same rules as `./marketplace-hooks.ts` — one hook per repository operation, `enabled` guards and
 * failure narrowing written once, and no screen ever holding a repository. Two things are specific
 * to this file and worth stating.
 *
 * ## Why the meal listing is an infinite query and the plan listing is not
 *
 * `listMeals` is the only catalogue operation over a collection big enough to page: forty meals
 * behind six filter axes, where a person narrowing a range wants to see the next twenty without
 * losing the twenty they were reading. `listPlans` answers with eight rows and will answer with
 * dozens, not thousands; giving it a cursor UI would add a control that never has anything to do.
 *
 * The cursor is deliberately **not** part of the query key. TanStack owns page assembly, and a key
 * that carried the cursor would create one cache entry per page and lose the accumulated list on
 * every filter change — which is exactly the state the "load more" button exists to preserve.
 *
 * ## Why the calculators read a calculation as a *query*
 *
 * `POST /api/v1/nutrition/calculate-targets` stores nothing (`contracts/nutrition.ts`), so a given
 * request always has the same answer and caching it by its inputs is correct rather than merely
 * convenient. It also means the public calculators need no session, no mutation state machine and
 * no "submitting…" flag that outlives the answer.
 */

export { toFailure } from './hooks.ts';

/* ── meals ───────────────────────────────────────────────────────────────────────────────────── */

/** The accumulated meals across every page fetched so far. */
export function mealsFromPages(
    pages: readonly CursorPage<MarketplaceMeal>[] | undefined,
): readonly MarketplaceMeal[] {
    return (pages ?? []).flatMap((page) => page.items);
}

/** Total matching rows when the repository can count them; `null` when it cannot. */
export function totalFromPages(
    pages: readonly CursorPage<MarketplaceMeal>[] | undefined,
): number | null {
    return pages?.[0]?.totalCount ?? null;
}

export type MealsInfiniteResult = UseInfiniteQueryResult<
    InfiniteData<CursorPage<MarketplaceMeal>, string | undefined>,
    Error
>;

export function useMealsQuery(
    filter?: Omit<MealFilter, 'cursor'>,
    /** `false` for a screen whose section has nothing to ask for — a diet with no classification. */
    enabled = true,
): MealsInfiniteResult {
    const { repositories } = useRepositoryContext();

    return useInfiniteQuery({
        queryKey: queryKeys.catalogue.meals(filter),
        enabled: enabled && repositories !== null,
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.marketplace.listMeals({
                ...filter,
                ...(pageParam === undefined ? {} : { cursor: pageParam }),
            });
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });
}

/**
 * One meal.
 *
 * `mealId` is nullable for the same reason `useKitchenQuery`'s is: a route parameter may not be
 * there on the first frame of a deep link, and firing `getMeal(undefined)` would render a server
 * failure that was really a routing race.
 */
export function useMealQuery(mealId: MealId | null): UseQueryResult<MarketplaceMeal> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.catalogue.meal(mealId ?? ('' as MealId)),
        enabled: repositories !== null && mealId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (mealId === null) throw new Error('No meal identifier.');
            return repositories.marketplace.getMeal(mealId);
        },
    });
}

/* ── subscription plans ──────────────────────────────────────────────────────────────────────── */

export function usePlansQuery(filter?: PlanFilter): UseQueryResult<CursorPage<SubscriptionPlan>> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.catalogue.plans(filter),
        enabled: repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.marketplace.listPlans(filter);
        },
    });
}

export function usePlanQuery(planId: SubscriptionPlanId | null): UseQueryResult<SubscriptionPlan> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.catalogue.plan(planId ?? ('' as SubscriptionPlanId)),
        enabled: repositories !== null && planId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (planId === null) throw new Error('No plan identifier.');
            return repositories.marketplace.getPlan(planId);
        },
    });
}

/**
 * Two or three plans, side by side.
 *
 * One query rather than three `usePlanQuery` calls: the comparison table is meaningless with a
 * partial answer, and three independent queries would render two columns and a skeleton — a table
 * whose columns are not comparable is worse than one that has not arrived. An unknown identifier in
 * the selection therefore fails the whole comparison, which is the honest outcome.
 */
export function usePlanComparisonQuery(
    planIds: readonly SubscriptionPlanId[],
): UseQueryResult<readonly SubscriptionPlan[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.catalogue.planComparison(planIds),
        enabled: repositories !== null && planIds.length > 0,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return Promise.all(planIds.map((planId) => repositories.marketplace.getPlan(planId)));
        },
    });
}

/* ── diet categories ─────────────────────────────────────────────────────────────────────────── */

export function useDietCategoriesQuery(): UseQueryResult<readonly DietCategory[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.catalogue.dietCategories(),
        enabled: repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.marketplace.listDietCategories();
        },
    });
}

/**
 * One diet category, by slug.
 *
 * **Contract gap.** `MarketplaceRepository` publishes `listDietCategories()` and no
 * `getDietCategory(slug)`, so the single category is resolved from the list. That is defensible
 * while the list is thirteen rows and non-paginated (`contracts/marketplace.ts` says as much), and
 * it is recorded here rather than hidden: a `GET /api/v1/marketplace/diets/{diet}` would let this
 * screen deep-link without fetching the whole vocabulary. `null` is a real answer — an unknown slug
 * is a not-found page, not a failure.
 */
export function useDietCategoryQuery(slug: string | null): UseQueryResult<DietCategory | null> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.catalogue.dietCategory(slug ?? ''),
        enabled: repositories !== null && slug !== null,
        queryFn: async (): Promise<DietCategory | null> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            const categories = await repositories.marketplace.listDietCategories();
            return categories.find((category) => category.slug === slug) ?? null;
        },
    });
}

/* ── the public target calculation ───────────────────────────────────────────────────────────── */

/**
 * A nutrition target worked out from a request the person has just typed.
 *
 * `request` is `null` until every mandatory field is answered, which is what keeps the calculators
 * from computing an estimate from a half-filled form and presenting it as an answer.
 */
export function useTargetCalculationQuery(
    request: NutritionTargetRequest | null,
): UseQueryResult<NutritionTargetResult> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.nutrition.calculation(request ?? {}),
        enabled: repositories !== null && request !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (request === null) throw new Error('No calculation request.');
            return repositories.nutrition.calculateTargets(request);
        },
    });
}

/* ── ordering and planning a catalogue meal ──────────────────────────────────────────────────── */

/**
 * Adds a meal to the basket.
 *
 * The cart identifier is read rather than passed: `getCart()` creates one lazily
 * (`contracts/commerce.ts`), so a person who has never had a basket does not need a separate
 * "create basket" step, and no screen has to hold a `CartId` it did not ask for. The cart query is
 * invalidated on success, which is what makes the shell's basket badge move.
 */
export function useAddCartItemMutation(
    channelCode?: string,
): UseMutationResult<Cart, unknown, AddCartItemRequest> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();
    const cartOptions = channelCode === undefined ? {} : { channelCode };

    return useMutation({
        mutationFn: async (request: AddCartItemRequest) => {
            const cart = await repositories.commerce.getCart(cartOptions);
            return repositories.commerce.addCartItem(cart.id, request);
        },
        onSuccess: (cart) => {
            // Written synchronously as well as invalidated: the screen reports the new item count
            // in the same frame it shows the confirmation, and a refetch would land after it.
            queryClient.setQueryData(queryKeys.commerce.cart(channelCode), cart);
            void queryClient.invalidateQueries({ queryKey: queryKeys.commerce.cart(channelCode) });
        },
    });
}

/** The plan the person is currently following, or `null` when they have none yet. */
export function useCurrentPlanQuery(enabled: boolean): UseQueryResult<MealPlanSummary | null> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.planner.currentPlan(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.planner.getCurrentPlan();
        },
    });
}

export interface AddPlanEntryVariables {
    readonly planId: MealPlanSummary['planId'];
    readonly request: AddEntryRequest;
}

export function useAddPlanEntryMutation(): UseMutationResult<
    MealPlanEntry,
    unknown,
    AddPlanEntryVariables
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ planId, request }: AddPlanEntryVariables) =>
            repositories.planner.addEntry(planId, request),
        onSuccess: async () => {
            // The whole planner root: the week, the day and the entry all now disagree with the
            // server, and invalidating the prefix is what `query-keys.ts` shapes its keys for.
            await queryClient.invalidateQueries({ queryKey: queryKeys.planner.all() });
        },
    });
}
