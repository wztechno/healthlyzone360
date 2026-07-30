import type {
    Cart,
    CursorPage,
    Dietitian,
    DietitianFilter,
    Kitchen,
    KitchenFilter,
    MarketplaceMeal,
    MealFilter,
    StoredNutritionTarget,
    Subscription,
} from '@healthy360/api-client/contracts';
import type { DietitianId, KitchenId, MealPlanId } from '@healthy360/domain-types';
import type { MealPlanDay } from '@healthy360/api-client/contracts';
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from './query-keys.ts';
import { useRepositoryContext } from './repository-provider.tsx';

/**
 * Marketplace and consumer-home data access.
 *
 * Same shape as `./hooks.ts` and for the same reasons: one hook per repository operation, the
 * failure narrowing and the enabled-guards written once, and no screen ever holding a repository.
 * `toFailure` is re-exported from `./hooks.ts` rather than duplicated — a screen's `error` is an
 * `ApiFailure | null` here exactly as it is there.
 *
 * Retry policy is inherited from `createQueryClient`: `shouldRetry` refuses to repeat any
 * `ApiFailure` that reports itself non-retryable, which covers every validation, authentication,
 * context and `prototype.not_implemented` answer. Nothing here overrides it, because a per-hook
 * retry rule is a per-hook chance to get it wrong.
 */

export { toFailure } from './hooks.ts';

/* ── marketplace: kitchens ───────────────────────────────────────────────────────────────────── */

export function useKitchensQuery(filter?: KitchenFilter): UseQueryResult<CursorPage<Kitchen>> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.marketplace.kitchens(filter),
        enabled: repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.marketplace.listKitchens(filter);
        },
    });
}

/**
 * One kitchen.
 *
 * `kitchenId` is nullable because it arrives from a route parameter, and a route parameter is a
 * string that may not be there at all on the first frame of a deep link. Guarding here rather than
 * at each call site is what stops a screen firing `getKitchen(undefined)` and rendering a server
 * failure that was really a routing race.
 */
export function useKitchenQuery(kitchenId: KitchenId | null): UseQueryResult<Kitchen> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.marketplace.kitchen(kitchenId ?? ('' as KitchenId)),
        enabled: repositories !== null && kitchenId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (kitchenId === null) throw new Error('No kitchen identifier.');
            return repositories.marketplace.getKitchen(kitchenId);
        },
    });
}

/**
 * A kitchen's consumer-visible menu.
 *
 * `listMeals` filters to kitchens configured for the marketplace channel, so a wholesale kitchen
 * answers with an empty page here rather than leaking a menu it does not sell to households.
 */
export function useKitchenMenuQuery(
    kitchenId: KitchenId | null,
    filter?: Omit<MealFilter, 'kitchenIds'>,
): UseQueryResult<CursorPage<MarketplaceMeal>> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.marketplace.kitchenMenu(kitchenId ?? ('' as KitchenId), filter),
        enabled: repositories !== null && kitchenId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (kitchenId === null) throw new Error('No kitchen identifier.');
            return repositories.marketplace.listMeals({ ...filter, kitchenIds: [kitchenId] });
        },
    });
}

/* ── marketplace: dietitians ─────────────────────────────────────────────────────────────────── */

export function useDietitiansQuery(
    filter?: DietitianFilter,
): UseQueryResult<CursorPage<Dietitian>> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.marketplace.dietitians(filter),
        enabled: repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.marketplace.listDietitians(filter);
        },
    });
}

export function useDietitianQuery(dietitianId: DietitianId | null): UseQueryResult<Dietitian> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.marketplace.dietitian(dietitianId ?? ('' as DietitianId)),
        enabled: repositories !== null && dietitianId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (dietitianId === null) throw new Error('No dietitian identifier.');
            return repositories.marketplace.getDietitian(dietitianId);
        },
    });
}

/* ── consumer: cart, targets, subscriptions ──────────────────────────────────────────────────── */

/**
 * The cart, read for the navigation badge.
 *
 * `enabled` is the caller's, because the shell asks for this on every signed-in screen and an
 * anonymous marketplace visitor must not. `getCart` creates a cart lazily when there is none, which
 * is harmless for a signed-in person and pointless for one who is not.
 */
export function useCartQuery(enabled: boolean): UseQueryResult<Cart> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.commerce.cart(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.commerce.getCart();
        },
    });
}

/** `null` is a real answer here: it means onboarding has not produced a target yet. */
export function useCurrentTargetsQuery(
    enabled: boolean,
): UseQueryResult<StoredNutritionTarget | null> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.nutrition.currentTargets(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.nutrition.getCurrentTargets();
        },
    });
}

export function useSubscriptionsQuery(enabled: boolean): UseQueryResult<CursorPage<Subscription>> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.commerce.subscriptions(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.commerce.listSubscriptions();
        },
    });
}

/* ── consumer: the plan behind the home screen ───────────────────────────────────────────────── */

/** ISO Monday of the week `date` (`YYYY-MM-DD`) falls in. */
export function weekStartFor(date: string): string {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    // `getUTCDay()` is 0 for Sunday; ISO weeks start on Monday, so Sunday is six days in.
    const offset = (parsed.getUTCDay() + 6) % 7;
    parsed.setUTCDate(parsed.getUTCDate() - offset);
    return parsed.toISOString().slice(0, 10);
}

/** Today as `YYYY-MM-DD`, in UTC, so a test and a screenshot agree on which day it is. */
export function todayIso(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10);
}

export interface ConsumerDay {
    readonly planId: MealPlanId;
    readonly day: MealPlanDay;
    /** True when `day.date` is the date that was asked for rather than a later one. */
    readonly isToday: boolean;
}

/**
 * The day the consumer home shows, resolved end to end in one query.
 *
 * ## Why this is not simply `planner.getDay(planId, today)`
 *
 * **There is no way to discover `planId`.** Every proposed planner operation takes a `{plan}` the
 * client is assumed to already hold, and no draft publishes a "list my meal plans" or a
 * `currentPlanId` on `GET /api/v1/me` (`docs/api/proposed/meal-plans.v1.draft.yaml`). Rather than
 * hard-code a fixture identifier into application code — which would be a fixture leak wearing a
 * constant's clothing, and would break the moment the API repository answered — this resolves the
 * plan through the only contract that publishes one: the Virtual Dietitian session that produced
 * it (`VdSession.draftPlanId`). Only a `professionally_approved` session is considered, because
 * that is the session whose plan the person is actually following; a `draft_generated` session
 * points at a draft they have not accepted.
 *
 * That is a workaround, and it is recorded as a contract gap for the orchestrator rather than
 * hidden. When `GET /api/v1/meal-plans` lands, this function loses its first two steps and nothing
 * above it changes.
 *
 * ## Why the day is searched rather than fetched
 *
 * "What am I eating next?" is the question the home screen answers, and the answer on a Sunday
 * evening is Monday's breakfast. So the week is read once and the first day at or after the target
 * date that actually has entries wins; an empty week is a real, designed state, not an error.
 */
export function useConsumerDayQuery(
    enabled: boolean,
    date: string = todayIso(),
): UseQueryResult<ConsumerDay | null> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: [...queryKeys.planner.currentPlan(), date],
        enabled: enabled && repositories !== null,
        queryFn: async (): Promise<ConsumerDay | null> => {
            if (repositories === null) throw new Error('Repositories are not ready.');

            const sessions = await repositories.virtualDietitian.listSessions();
            const approved = sessions.items
                .filter((session) => session.state === 'professionally_approved')
                .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
            if (approved === undefined) return null;

            const session = await repositories.virtualDietitian.getSession(approved.id);
            const planId = session.draftPlanId;
            if (planId === null) return null;

            const week = await repositories.planner.getWeek(planId, weekStartFor(date));
            const populated = week.days.filter((day) => day.entries.length > 0);
            const upcoming = populated.find((day) => day.date >= date) ?? populated[0];
            if (upcoming === undefined) {
                const empty = week.days.find((day) => day.date === date) ?? week.days[0];
                return empty === undefined
                    ? null
                    : { planId, day: empty, isToday: empty.date === date };
            }
            return { planId, day: upcoming, isToday: upcoming.date === date };
        },
    });
}
