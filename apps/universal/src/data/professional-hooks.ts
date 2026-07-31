import type {
    ApproveReviewRequest,
    CursorPage,
    DietitianNote,
    MealPlanWeek,
    RequestChangesRequest,
    ReviewDetail,
    ReviewQueueFilter,
    ReviewQueueItem,
    SetDietitianNoteRequest,
    SetOverrideRequest,
    StoredNutritionTarget,
} from '@healthy360/api-client/contracts';
import type { MealPlanId, UserId } from '@healthy360/domain-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

/**
 * The dietitian's review queue and client work.
 *
 * Same rules as the other hook modules — one hook per repository operation, the `enabled` guards
 * written once, and no screen ever holding a repository. Three things are specific to the
 * professional surfaces.
 *
 * ## Every mutation invalidates the whole `professional` root, and the `nutrition` and `planner`
 * roots with it
 *
 * A professional decision is never local. Approving a nutrition-target review marks the *client's*
 * stored target as professionally approved; approving a meal-plan review writes a
 * `professionally_approved` event onto the plan; requesting changes writes a note onto it
 * (`mock/prototype/store.ts`). So an approval that invalidated only the queue would leave the client
 * plan screen, and the consumer-side target screen, showing figures the professional has just
 * changed the standing of. Three prefix invalidations is the honest cost of one decision touching
 * three aggregates.
 *
 * ## Nothing here is persisted
 *
 * `PERSISTABLE_QUERY_ROOTS` admits `reference` and `catalogue` only. Everything this module reads is
 * another person's health data held under a professional relationship; none of it may touch disk.
 *
 * ## There is no client list, by design and by contract
 *
 * `ProfessionalRepository` scopes every method by an identifier the caller was handed — a review, or
 * a `(clientId, planId, weekStart)` triple that came off a review. There is deliberately no "list my
 * clients" method (`contracts/professional.ts` says so), so the client plan screen is reachable from
 * a review and from a link, never from a directory. The screens follow that rather than inventing a
 * roster the interface does not publish.
 */

export { toFailure } from './hooks.ts';

/* ── the queue ───────────────────────────────────────────────────────────────────────────────── */

export function useReviewQueueQuery(
    filter?: ReviewQueueFilter,
): UseQueryResult<CursorPage<ReviewQueueItem>> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.professional.reviewQueue(filter),
        enabled: repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.professional.listReviewQueue(filter);
        },
    });
}

/** One review, with everything the professional needs before deciding. */
export function useReviewQuery(reviewId: string | null): UseQueryResult<ReviewDetail> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.professional.review(reviewId ?? ''),
        enabled: repositories !== null && reviewId !== null && reviewId !== '',
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (reviewId === null) throw new Error('No review identifier.');
            return repositories.professional.getReview(reviewId);
        },
    });
}

/** A client's week, as the professional sees it. All three parts of the address are required. */
export function useClientPlanQuery(
    clientId: UserId | null,
    planId: MealPlanId | null,
    weekStart: string | null,
): UseQueryResult<MealPlanWeek> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.professional.clientPlan(
            clientId ?? ('' as UserId),
            planId ?? ('' as MealPlanId),
            weekStart ?? '',
        ),
        enabled:
            repositories !== null && clientId !== null && planId !== null && weekStart !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (clientId === null || planId === null || weekStart === null) {
                throw new Error('A client plan needs a client, a plan and a week.');
            }
            return repositories.professional.getClientPlan(clientId, planId, weekStart);
        },
    });
}

/* ── decisions ───────────────────────────────────────────────────────────────────────────────── */

/** The three roots a professional decision can touch. Invalidated together, always. */
function useProfessionalInvalidation(): () => Promise<void> {
    const queryClient = useQueryClient();

    return async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.professional.all() }),
            queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.all() }),
            queryClient.invalidateQueries({ queryKey: queryKeys.planner.all() }),
        ]);
    };
}

export interface ApproveVariables {
    readonly reviewId: string;
    readonly request: ApproveReviewRequest;
}

/**
 * Approves a review.
 *
 * `signature` is required by the contract and is not decoration: it is recorded against the
 * professional's registration and shown to the client on the plan, so the screen collects it rather
 * than defaulting it to the signed-in display name.
 */
export function useApproveReviewMutation(): UseMutationResult<
    ReviewQueueItem,
    unknown,
    ApproveVariables
> {
    const repositories = useRepositories();
    const invalidate = useProfessionalInvalidation();

    return useMutation({
        mutationFn: ({ reviewId, request }: ApproveVariables) =>
            repositories.professional.approve(reviewId, request),
        onSuccess: invalidate,
    });
}

export interface RequestChangesVariables {
    readonly reviewId: string;
    readonly request: RequestChangesRequest;
}

export function useRequestChangesMutation(): UseMutationResult<
    ReviewQueueItem,
    unknown,
    RequestChangesVariables
> {
    const repositories = useRepositories();
    const invalidate = useProfessionalInvalidation();

    return useMutation({
        mutationFn: ({ reviewId, request }: RequestChangesVariables) =>
            repositories.professional.requestChanges(reviewId, request),
        onSuccess: invalidate,
    });
}

/** A note on the plan, or on one entry of it. `null` clears it. */
export function useSetDietitianNoteMutation(): UseMutationResult<
    DietitianNote,
    unknown,
    SetDietitianNoteRequest
> {
    const repositories = useRepositories();
    const invalidate = useProfessionalInvalidation();

    return useMutation({
        mutationFn: (request: SetDietitianNoteRequest) =>
            repositories.professional.setDietitianNote(request),
        onSuccess: invalidate,
    });
}

/**
 * Replaces a client's calculated target with the professional's own figures.
 *
 * The store re-runs the engine with a `ProfessionalOverride` attached rather than writing the number
 * straight in, so the stored result still explains itself — the override is a documented input to
 * the calculation, not a value that appeared from nowhere.
 */
export function useSetOverrideMutation(): UseMutationResult<
    StoredNutritionTarget,
    unknown,
    SetOverrideRequest
> {
    const repositories = useRepositories();
    const invalidate = useProfessionalInvalidation();

    return useMutation({
        mutationFn: (request: SetOverrideRequest) => repositories.professional.setOverride(request),
        onSuccess: invalidate,
    });
}
