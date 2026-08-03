import type {
    ConfirmGuestContactRequest,
    ConfirmGuestDeletionRequest,
    ConvertGuestRequest,
    GuestCheckoutDraft,
    GuestContactChallenge,
    GuestConversionPrefill,
    GuestConversionResult,
    GuestDeletionAcknowledgement,
    GuestDeletionOutcome,
    GuestOrder,
    GuestSession,
    OtpChallenge,
    OtpChannel,
    RequestGuestDeletionRequest,
    UpdateGuestContactRequest,
} from '@healthy360/api-client/contracts';
import type { CartId } from '@healthy360/domain-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import { appGuestTokenStore } from '../session/guest-storage.ts';
import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

/**
 * Ordering without an account (plan Phase G1).
 *
 * Same rules as every other hook module here: one hook per repository operation, `enabled` guards
 * and invalidation written once, and no screen ever holding a repository. Four things are specific
 * to this contract.
 *
 * ## The credential is imported, not taken off the bundle
 *
 * `appGuestTokenStore` is reached directly (`../session/guest-storage.ts`) rather than through
 * `Repositories`, for the same reason the session token store is not a member of it either: a
 * credential store is not a data surface, and only the application knows whether this device has a
 * `sessionStorage` or a keychain behind it. `./repository-provider.tsx` hands that same instance to
 * `createRepositories`, so the store the guest repository writes and the store these hooks read are
 * one object rather than two that agree at the start and diverge on the first write.
 *
 * ## The token is subscribed to, not read
 *
 * {@link useGuestToken} goes through `useSyncExternalStore` for the same reason the session token
 * does: a plain `get()` during render goes stale the moment `startSession` writes the token, and
 * the checkout would sit on "no session" forever. Every query here is gated on it, so a screen
 * mounted before a session exists issues no requests at all rather than a request that is certain
 * to be refused.
 *
 * ## A dead session is not an error state, it is a step
 *
 * `getSession` rejects with `auth.unauthenticated` for four different causes — unknown, revoked,
 * expired, never-started — and deliberately does not say which (`contracts/guest.ts`). The recovery
 * is the same in all four: go back to the contact step, keeping the basket, which is a *screen*
 * decision. So these hooks do not retry that failure and do not clear the cache under it; they
 * surface it and let `GuestCheckoutScreen` decide. Retrying would burn requests on a token that
 * will never resolve again.
 *
 * ## Nothing here is persisted, and the guest root is the strongest case for it
 *
 * See `./query-keys.ts`. A guest has no account to sign out of, and frequently is not using their
 * own device.
 */

export { toFailure } from './hooks.ts';

/* ── the credential ──────────────────────────────────────────────────────────────────────────── */

/**
 * The current guest token, reactively.
 *
 * `null` means no guest session has been started on this device — which is the normal state for
 * almost every visitor, and is why every query below is disabled without it.
 */
export function useGuestToken(): string | null {
    return useSyncExternalStore(
        (listener) => appGuestTokenStore.subscribe(listener),
        () => appGuestTokenStore.get(),
        () => null,
    );
}

/* ── the session ─────────────────────────────────────────────────────────────────────────────── */

export function useGuestSessionQuery(enabled = true): UseQueryResult<GuestSession> {
    const { repositories } = useRepositoryContext();
    const token = useGuestToken();

    return useQuery({
        queryKey: queryKeys.guest.session(),
        enabled: enabled && repositories !== null && token !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.guest.getSession();
        },
        // A dead token stays dead. See the header.
        retry: false,
    });
}

export function useStartGuestSessionMutation(): UseMutationResult<
    GuestSession,
    unknown,
    { readonly cartId?: CartId | undefined } | undefined
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request?: { readonly cartId?: CartId | undefined }) =>
            repositories.guest.startSession(request),
        onSuccess: (session) => {
            // Seeded rather than invalidated: the answer *is* the session, and a refetch would
            // second-guess the one call that just created it. The token it carries is stripped —
            // the store already has it, and a plaintext credential does not belong in a cache.
            queryClient.setQueryData(queryKeys.guest.session(), { ...session, token: null });
        },
    });
}

/* ── the contact and its proof ───────────────────────────────────────────────────────────────── */

export function useUpdateGuestContactMutation(): UseMutationResult<
    GuestContactChallenge,
    unknown,
    UpdateGuestContactRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: UpdateGuestContactRequest) =>
            repositories.guest.updateContact(request),
        onSuccess: (result) => {
            if (result.challenge !== null) {
                queryClient.setQueryData(
                    queryKeys.guest.challenge(result.challenge.id),
                    result.challenge,
                );
            }
            // Correcting a contact can *lower* the grade — a verified typo does not carry its proof
            // onto the address it was corrected to — so the session is re-read rather than patched.
            void queryClient.invalidateQueries({ queryKey: queryKeys.guest.session() });
        },
    });
}

export function useConfirmGuestContactMutation(): UseMutationResult<
    GuestSession,
    unknown,
    ConfirmGuestContactRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: ConfirmGuestContactRequest) =>
            repositories.guest.confirmContact(request),
        onSuccess: (session) => {
            queryClient.setQueryData(queryKeys.guest.session(), session);
        },
    });
}

/**
 * Re-read a live challenge — after a reload, or when returning from a mail client.
 *
 * The one genuine query in the passcode surface. Issuing and resending are mutations even though
 * they merely read a code into existence, because each sends a message and consumes a budget.
 */
export function useGuestChallengeQuery(
    challengeId: string | null,
    enabled = true,
): UseQueryResult<OtpChallenge> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.guest.challenge(challengeId ?? ''),
        enabled: enabled && repositories !== null && challengeId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (challengeId === null) throw new Error('No challenge to read.');
            return repositories.guest.getChallenge({ challengeId });
        },
    });
}

export function useResendGuestChallengeMutation(): UseMutationResult<
    OtpChallenge,
    unknown,
    { readonly challengeId: string; readonly channel?: OtpChannel | undefined }
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: {
            readonly challengeId: string;
            readonly channel?: OtpChannel | undefined;
        }) => repositories.guest.resendChallenge(request),
        onSuccess: (next) => {
            // A resend supersedes: the answer carries a **new** identifier and the previous
            // challenge stops verifying. So the new key is seeded and the old one is left alone —
            // leaving it merely stale would let a re-render read a retired challenge.
            queryClient.setQueryData(queryKeys.guest.challenge(next.id), next);
        },
    });
}

/* ── the order ───────────────────────────────────────────────────────────────────────────────── */

export function usePlaceGuestOrderMutation(): UseMutationResult<
    GuestOrder,
    unknown,
    GuestCheckoutDraft
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (draft: GuestCheckoutDraft) => repositories.guest.placeOrder(draft),
        onSuccess: (order) => {
            queryClient.setQueryData(queryKeys.guest.order(order.reference), order);
            // The basket became the order. Anything still holding the old cart is now wrong, and a
            // basket badge showing items that have just been ordered is the specific wrongness this
            // prevents.
            void queryClient.invalidateQueries({ queryKey: queryKeys.commerce.cart() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.guest.session() });
        },
    });
}

export function useGuestOrderQuery(
    reference: string | null,
    enabled = true,
): UseQueryResult<GuestOrder> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.guest.order(reference ?? ''),
        enabled: enabled && repositories !== null && reference !== null && reference.length > 0,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (reference === null) throw new Error('No order to read.');
            return repositories.guest.getOrder(reference);
        },
    });
}

/* ── conversion ──────────────────────────────────────────────────────────────────────────────── */

export function useGuestConversionPrefillQuery(
    enabled = true,
): UseQueryResult<GuestConversionPrefill> {
    const { repositories } = useRepositoryContext();
    const token = useGuestToken();

    return useQuery({
        queryKey: queryKeys.guest.conversionPrefill(),
        enabled: enabled && repositories !== null && token !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.guest.getConversionPrefill();
        },
        retry: false,
    });
}

export function useConvertGuestMutation(): UseMutationResult<
    GuestConversionResult,
    unknown,
    ConvertGuestRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: ConvertGuestRequest) => repositories.guest.convert(request),
        onSuccess: () => {
            // The guest identity is over. The repository has already revoked the token and cleared
            // the store; removing the root rather than invalidating it is the point — an
            // invalidation would *refetch* a session that no longer exists, and every entry under
            // this root is personal data belonging to an identity that has just ended.
            queryClient.removeQueries({ queryKey: queryKeys.guest.all() });
        },
    });
}

/* ── deletion ────────────────────────────────────────────────────────────────────────────────── */

/**
 * Ask for erasure. Always accepted, always the same shape.
 *
 * No token is required and none is sent: the page this is called from is public, and making the
 * right to erasure conditional on holding a credential would deny it to exactly the people most
 * likely to have cleared their browser.
 */
export function useRequestGuestDeletionMutation(): UseMutationResult<
    GuestDeletionAcknowledgement,
    unknown,
    RequestGuestDeletionRequest
> {
    const repositories = useRepositories();

    return useMutation({
        mutationFn: (request: RequestGuestDeletionRequest) =>
            repositories.guest.requestDeletion(request),
    });
}

export function useConfirmGuestDeletionMutation(): UseMutationResult<
    GuestDeletionOutcome,
    unknown,
    ConfirmGuestDeletionRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: ConfirmGuestDeletionRequest) =>
            repositories.guest.confirmDeletion(request),
        onSuccess: () => {
            // Whatever was on this device about this person is now gone server-side; leaving a
            // token and a cached order behind would be the interface keeping a copy of what was
            // just erased.
            appGuestTokenStore.clear();
            queryClient.removeQueries({ queryKey: queryKeys.guest.all() });
        },
    });
}
