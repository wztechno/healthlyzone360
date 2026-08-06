import type { AcceptedInvitation, Invitation } from '@healthy360/api-client/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

/**
 * The two calls behind the invitation landing screen (PA1).
 *
 * ## The read does not wait for a session
 *
 * Every other query module here guards on `repositories !== null` *and*, where it matters, on a
 * token being present. This one guards only on the repositories, because the endpoint is anonymous:
 * the whole reason the screen exists is to render for somebody who has not signed in and to give
 * them a reason to. A hook that waited for a session would leave that visitor looking at a spinner
 * that never resolves.
 *
 * ## Retries are off
 *
 * The only failure this read produces is `resource.not_found` — one answer for an unknown token, a
 * revoked-and-purged one and a typo in a pasted link. Retrying a 404 three times delays the
 * "this link is dead" message by a second and a half and cannot change it. Network failures still
 * surface, and the screen offers a manual retry.
 *
 * ## Acceptance invalidates the session, not just the invitation
 *
 * Accepting creates a membership, and the thing that has changed is *who the signed-in person is on
 * this platform* — their memberships, their permissions, their landing route. Invalidating
 * `queryKeys.me()` is what makes the workspace link on the success panel lead somewhere the gates
 * will actually let them in. The invitation's own entry is invalidated too, so a person who goes
 * back sees `accepted` rather than a stale `pending` with a live button on it.
 */

export function useInvitationQuery(token: string | null): UseQueryResult<Invitation> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.invitations.byToken(token ?? ''),
        enabled: repositories !== null && token !== null && token !== '',
        retry: false,
        // A token is single-use and its state changes when somebody accepts it. Re-reading on focus
        // is what stops two open tabs disagreeing about whether the offer is still open.
        staleTime: 0,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (token === null || token === '') throw new Error('An invitation token is required.');
            return repositories.invitations.getInvitation(token);
        },
    });
}

export function useAcceptInvitationMutation(): UseMutationResult<
    AcceptedInvitation,
    unknown,
    string
> {
    const repositories = useRepositories();
    const client = useQueryClient();

    return useMutation({
        mutationFn: (token: string) => repositories.invitations.acceptInvitation(token),
        onSuccess: (_result, token) => {
            void client.invalidateQueries({ queryKey: queryKeys.invitations.byToken(token) });
            void client.invalidateQueries({ queryKey: queryKeys.me() });
        },
    });
}
