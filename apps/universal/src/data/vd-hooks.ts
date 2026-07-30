import type {
    AcceptVdProposalRequest,
    CreateVdSessionRequest,
    CursorPage,
    GenerateVdDraftRequest,
    OverrideVdProposalRequest,
    RequestVdReviewRequest,
    SendVdMessageRequest,
    VdSession,
    VdSessionSummary,
} from '@healthy360/api-client/contracts';
import type { VdSessionId } from '@healthy360/domain-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

/**
 * Virtual Dietitian data access.
 *
 * Same shape as `./hooks.ts` and `./marketplace-hooks.ts`: one hook per repository operation, so the
 * screens never hold a repository and the cache-invalidation rules are written once.
 *
 * ## Every mutation answers with the whole session, and every mutation writes it into the cache
 *
 * `VirtualDietitianRepository` returns the complete `VdSession` from `sendMessage`,
 * `generateDraft`, `requestReview`, `acceptProposal` and `overrideProposal` — the state machine's
 * next state, the appended messages and the updated proposal, in one object. So the mutations
 * `setQueryData` rather than invalidate-and-refetch. That is not an optimisation: a refetch means
 * one render where the session screen has the *old* state and the new messages, and the state
 * announcer would then announce a transition that had not happened yet. Writing the authoritative
 * answer straight in makes that frame unreachable.
 *
 * The summaries list is invalidated on the same beat, because a state change moves the row's badge
 * on the entry screen.
 *
 * ## Nothing here is persisted
 *
 * The `vd` root is deliberately absent from `PERSISTABLE_QUERY_ROOTS`. A Virtual Dietitian session
 * is medical-adjacent personal data and never touches disk (plan §21).
 */

export { toFailure } from './hooks.ts';

/* ── queries ─────────────────────────────────────────────────────────────────────────────────── */

export function useVdSessionsQuery(enabled = true): UseQueryResult<CursorPage<VdSessionSummary>> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.vd.sessions(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.virtualDietitian.listSessions();
        },
    });
}

/**
 * One session.
 *
 * `sessionId` is nullable because it arrives from a route parameter, and a route parameter is a
 * string that may not be present on the first frame of a deep link. Guarding here rather than at the
 * call site is what stops the screen asking for `getSession(undefined)` and rendering a server
 * failure that was really a routing race.
 */
export function useVdSessionQuery(sessionId: VdSessionId | null): UseQueryResult<VdSession> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.vd.session(sessionId ?? ('' as VdSessionId)),
        enabled: repositories !== null && sessionId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (sessionId === null) throw new Error('No session identifier.');
            return repositories.virtualDietitian.getSession(sessionId);
        },
    });
}

/* ── mutations ───────────────────────────────────────────────────────────────────────────────── */

/**
 * The shared success path: write the returned session into its own cache entry, then invalidate the
 * list so the entry screen's state badge follows.
 */
function useSessionWriter() {
    const queryClient = useQueryClient();

    return (session: VdSession) => {
        queryClient.setQueryData(queryKeys.vd.session(session.id), session);
        void queryClient.invalidateQueries({ queryKey: queryKeys.vd.sessions() });
    };
}

export function useCreateVdSessionMutation(): UseMutationResult<
    VdSession,
    unknown,
    CreateVdSessionRequest | undefined
> {
    const repositories = useRepositories();
    const write = useSessionWriter();

    return useMutation({
        mutationFn: (request?: CreateVdSessionRequest) =>
            repositories.virtualDietitian.createSession(request),
        onSuccess: write,
    });
}

export function useSendVdMessageMutation(
    sessionId: VdSessionId | null,
): UseMutationResult<VdSession, unknown, SendVdMessageRequest> {
    const repositories = useRepositories();
    const write = useSessionWriter();

    return useMutation({
        mutationFn: (request: SendVdMessageRequest) => {
            if (sessionId === null) throw new Error('No session identifier.');
            return repositories.virtualDietitian.sendMessage(sessionId, request);
        },
        onSuccess: write,
    });
}

export function useGenerateVdDraftMutation(
    sessionId: VdSessionId | null,
): UseMutationResult<VdSession, unknown, GenerateVdDraftRequest> {
    const repositories = useRepositories();
    const write = useSessionWriter();

    return useMutation({
        mutationFn: (request: GenerateVdDraftRequest) => {
            if (sessionId === null) throw new Error('No session identifier.');
            return repositories.virtualDietitian.generateDraft(sessionId, request);
        },
        onSuccess: write,
    });
}

export function useRequestVdReviewMutation(
    sessionId: VdSessionId | null,
): UseMutationResult<VdSession, unknown, RequestVdReviewRequest | undefined> {
    const repositories = useRepositories();
    const write = useSessionWriter();

    return useMutation({
        mutationFn: (request?: RequestVdReviewRequest) => {
            if (sessionId === null) throw new Error('No session identifier.');
            return repositories.virtualDietitian.requestReview(sessionId, request);
        },
        onSuccess: write,
    });
}

export function useAcceptVdProposalMutation(
    sessionId: VdSessionId | null,
): UseMutationResult<VdSession, unknown, AcceptVdProposalRequest> {
    const repositories = useRepositories();
    const write = useSessionWriter();

    return useMutation({
        mutationFn: (request: AcceptVdProposalRequest) => {
            if (sessionId === null) throw new Error('No session identifier.');
            return repositories.virtualDietitian.acceptProposal(sessionId, request);
        },
        onSuccess: write,
    });
}

export function useOverrideVdProposalMutation(
    sessionId: VdSessionId | null,
): UseMutationResult<VdSession, unknown, OverrideVdProposalRequest> {
    const repositories = useRepositories();
    const write = useSessionWriter();

    return useMutation({
        mutationFn: (request: OverrideVdProposalRequest) => {
            if (sessionId === null) throw new Error('No session identifier.');
            return repositories.virtualDietitian.overrideProposal(sessionId, request);
        },
        onSuccess: write,
    });
}
