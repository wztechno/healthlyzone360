import type {
    NutritionReview,
    RequestNutritionReviewRequest,
    StoredNutritionTarget,
    UpdateNutritionTargetRequest,
} from '@healthy360/api-client/contracts';
import type { NutritionTargetRequest, NutritionTargetResult } from '@healthy360/nutrition';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

/**
 * Nutrition-target data access — the four `NutritionRepository` operations, one hook each.
 *
 * Same shape and same reasons as `./hooks.ts` and `./marketplace-hooks.ts`: the enabled-guards, the
 * cache invalidation and the failure narrowing are written once, and no screen ever holds a
 * repository.
 *
 * `useCurrentTargetsQuery` is **re-exported** rather than redeclared. The consumer home already
 * reads the stored target through it, and a second hook over `queryKeys.nutrition.currentTargets()`
 * would be a second place to get the `enabled` guard wrong while sharing the first one's cache
 * entry — the subtlest kind of duplicate.
 */

export { useCurrentTargetsQuery } from './marketplace-hooks.ts';
export { toFailure } from './hooks.ts';

/* ── the calculation, read as a query ────────────────────────────────────────────────────────── */

/**
 * `POST /api/v1/nutrition/calculate-targets`, cached by its inputs.
 *
 * A calculation is a *query* even though the transport verb is POST: it stores nothing, so the same
 * request always has the same answer, and caching it by its inputs is not merely safe but the
 * behaviour a person expects — stepping back from the summary to change one answer and returning
 * should not recompute the other twenty-one (`query-keys.ts`, `nutrition.calculation`).
 *
 * `request` is nullable because the summary screen renders before the answers are complete. A
 * `null` request disables the query rather than sending a half-filled one, so the screen shows its
 * "still missing something" state instead of an engine validation failure dressed up as a server
 * error.
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

/* ── mutations ───────────────────────────────────────────────────────────────────────────────── */

/**
 * `PUT /api/v1/nutrition/targets/current` — accepting a calculated target.
 *
 * This is how onboarding finishes and how the nutrition page recalculates. It carries
 * `acknowledgedDisclaimer`, which the repository *enforces*: the mock rejects a save without it
 * (`prototype/store.ts`), so a screen that forgot to show the disclaimer fails loudly rather than
 * silently storing a medical-adjacent figure nobody was warned about.
 *
 * The whole `nutrition` root is invalidated rather than the one key, because a saved target
 * invalidates any cached calculation of it as well, and a person who has just accepted a figure
 * should not be shown a stale preview of the previous one anywhere.
 */
export function useSaveTargetsMutation(): UseMutationResult<
    StoredNutritionTarget,
    unknown,
    UpdateNutritionTargetRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: UpdateNutritionTargetRequest) =>
            repositories.nutrition.updateCurrentTargets(request),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.all() });
        },
    });
}

/**
 * Asking a qualified dietitian to look at the stored target.
 *
 * A real mutation against the prototype world: it creates a `NutritionReview` in the `requested`
 * state and puts an item on the professional review queue, which is what makes the pending state
 * the nutrition page renders a fact rather than a piece of optimistic copy.
 *
 * Invalidates `professional` as well as `nutrition`, because the request that appears on a person's
 * own screen is the same row that appears in a dietitian's queue, and leaving that stale would show
 * two people two different truths about the same request.
 */
export function useRequestNutritionReviewMutation(): UseMutationResult<
    NutritionReview,
    unknown,
    RequestNutritionReviewRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: RequestNutritionReviewRequest) =>
            repositories.nutrition.requestReview(request),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.all() }),
                queryClient.invalidateQueries({ queryKey: queryKeys.professional.all() }),
            ]);
        },
    });
}
