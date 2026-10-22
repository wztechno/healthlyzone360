import type {
    AccountOverview,
    AccountServiceArea,
    AccountSetupChecklist,
    AddContactPointRequest,
    ClosurePreconditions,
    ClosureTicket,
    ConsentState,
    ContactPoint,
    ContactPointAdded,
    CustomerAddress,
    DietaryProfile,
    IssueOtpRequest,
    OtpChallenge,
    OtpVerificationResult,
    RequestClosureRequest,
    ResendOtpRequest,
    SaveAddressRequest,
    SaveDietaryProfileRequest,
    VerifyClosureRequest,
} from '@healthy360/api-client/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient, UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

/**
 * The D2C account area and the one-time-code surface (plan Phase J1).
 *
 * Same rules as every other hook module here: one hook per repository operation, `enabled` guards
 * and invalidation written once, and no screen ever holding a repository. Three things are specific
 * to this pair of contracts.
 *
 * ## Nothing here is a query over a code
 *
 * `issueChallenge`, `resendChallenge` and `verifyChallenge` are mutations, including the two that
 * merely *read* a code into existence, because each one sends a message and consumes a budget. The
 * one genuine query is {@link useOtpChallengeQuery}, which re-reads a live challenge after a reload
 * — with its cooldown intact, which is the whole reason `resendCooldownSeconds` is on every read
 * rather than only on the answer to a resend.
 *
 * ## A resend supersedes, so its answer replaces rather than updates
 *
 * The answer to a resend carries a **new** challenge identifier and the previous challenge stops
 * verifying (`contracts/verification.ts`). The mutation therefore seeds the new key and does not
 * touch the old one: leaving the old entry cached and merely stale would let a re-render read a
 * challenge the server has already retired.
 *
 * ## Every write invalidates the checklist
 *
 * Whether an account can be activated is the server's answer, and it changes on writes that look
 * unrelated to it — a first address flips `add_address`, a granted consent flips `consents`, a
 * verified phone flips a step that may not even be required in this environment. So account writes
 * invalidate the `account` root rather than the one entry they obviously touched. It is one extra
 * refetch on a screen a person visits a handful of times, against the alternative of a checklist
 * that says a step is outstanding after they have just done it.
 */

export { toFailure } from './hooks.ts';

/* ── account: overview, checklist ────────────────────────────────────────────────────────────── */

export function useAccountOverviewQuery(enabled = true): UseQueryResult<AccountOverview> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.account.overview(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.account.getOverview();
        },
    });
}

export function useAccountChecklistQuery(enabled = true): UseQueryResult<AccountSetupChecklist> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.account.checklist(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.account.getChecklist();
        },
    });
}

/* ── account: addresses ──────────────────────────────────────────────────────────────────────── */

export function useAddressesQuery(enabled = true): UseQueryResult<readonly CustomerAddress[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.account.addresses(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.account.listAddresses();
        },
    });
}

/**
 * The closed list of areas an address may point at.
 *
 * A consumer-facing operation of its own rather than a reach into `KitchenAdminRepository`, which
 * covers the same rows for a *management* audience — with zone membership, activation state and a
 * tenant context a customer has neither the permission nor the need for.
 */
export function useServiceAreasQuery(
    enabled = true,
): UseQueryResult<readonly AccountServiceArea[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.account.serviceAreas(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.account.listServiceAreas();
        },
    });
}

export function useAddAddressMutation(): UseMutationResult<
    CustomerAddress,
    unknown,
    SaveAddressRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: SaveAddressRequest) => repositories.account.addAddress(request),
        onSuccess: async (saved) => {
            upsertAddress(queryClient, saved);
            await queryClient.invalidateQueries({ queryKey: queryKeys.account.all() });
        },
    });
}

/**
 * Writes a saved address into the cached book before the refetch.
 *
 * The page that sent somebody to add an address — the checkout, the plan setup — is not mounted
 * while they do it, so its list is inactive and the invalidation below refetches it only once it is
 * back on screen. Until then it would show the old book, and the new address it was handed in the
 * URL would not be in it. The refetch still follows and settles anything the server added.
 */
function upsertAddress(queryClient: QueryClient, saved: CustomerAddress): void {
    queryClient.setQueryData<readonly CustomerAddress[]>(queryKeys.account.addresses(), (book) => {
        if (book === undefined) return book;
        const others = book
            .filter((entry) => entry.id !== saved.id)
            .map((entry) =>
                saved.isDefault && entry.isDefault ? { ...entry, isDefault: false } : entry,
            );
        const index = book.findIndex((entry) => entry.id === saved.id);
        if (index === -1) return [...others, saved];
        return [...others.slice(0, index), saved, ...others.slice(index)];
    });
}

export interface UpdateAddressVariables {
    readonly addressId: string;
    readonly request: SaveAddressRequest;
}

export function useUpdateAddressMutation(): UseMutationResult<
    CustomerAddress,
    unknown,
    UpdateAddressVariables
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ addressId, request }: UpdateAddressVariables) =>
            repositories.account.updateAddress({ ...request, addressId }),
        onSuccess: async (saved) => {
            upsertAddress(queryClient, saved);
            await queryClient.invalidateQueries({ queryKey: queryKeys.account.all() });
        },
    });
}

export function useRemoveAddressMutation(): UseMutationResult<void, unknown, string> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (addressId: string) => repositories.account.removeAddress({ addressId }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.account.all() });
        },
    });
}

/* ── account: the allergy declaration ────────────────────────────────────────────────────────── */

export function useDietaryProfileQuery(enabled = true): UseQueryResult<DietaryProfile> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.account.dietaryProfile(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.account.getDietaryProfile();
        },
    });
}

export function useSaveDietaryProfileMutation(): UseMutationResult<
    DietaryProfile,
    unknown,
    SaveDietaryProfileRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: SaveDietaryProfileRequest) =>
            repositories.account.saveDietaryProfile(request),
        onSuccess: async (profile) => {
            queryClient.setQueryData(queryKeys.account.dietaryProfile(), profile);
            await queryClient.invalidateQueries({ queryKey: queryKeys.account.all() });
        },
    });
}

/* ── account: consents ───────────────────────────────────────────────────────────────────────── */

export function useConsentsQuery(enabled = true): UseQueryResult<readonly ConsentState[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.account.consents(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.account.listConsents();
        },
    });
}

export interface SetConsentVariables {
    readonly key: string;
    readonly granted: boolean;
}

export function useSetConsentMutation(): UseMutationResult<
    ConsentState,
    unknown,
    SetConsentVariables
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: SetConsentVariables) => repositories.account.setConsent(request),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.account.all() });
        },
    });
}

/* ── verification: contact points ────────────────────────────────────────────────────────────── */

export function useContactPointsQuery(enabled = true): UseQueryResult<readonly ContactPoint[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.verification.contacts(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.verification.listContactPoints();
        },
    });
}

/**
 * Add a contact, optionally asking for a code in the same round trip.
 *
 * The answer's `challenge` is seeded into the challenge cache when there is one, so a screen that
 * navigates to the panel finds the challenge already there rather than issuing a second.
 */
export function useAddContactPointMutation(): UseMutationResult<
    ContactPointAdded,
    unknown,
    AddContactPointRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: AddContactPointRequest) =>
            repositories.verification.addContactPoint(request),
        onSuccess: async (added) => {
            if (added.challenge !== null) {
                queryClient.setQueryData(
                    queryKeys.verification.challenge(added.challenge.id),
                    added.challenge,
                );
            }
            await queryClient.invalidateQueries({ queryKey: queryKeys.verification.all() });
            await queryClient.invalidateQueries({ queryKey: queryKeys.account.all() });
        },
    });
}

export function useRemoveContactPointMutation(): UseMutationResult<void, unknown, string> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (contactPointId: string) =>
            repositories.verification.removeContactPoint({ contactPointId }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.verification.all() });
            await queryClient.invalidateQueries({ queryKey: queryKeys.account.all() });
        },
    });
}

/* ── verification: challenges ────────────────────────────────────────────────────────────────── */

/**
 * Re-read a live challenge.
 *
 * `staleTime: 0` and no polling: the cooldown ticks down on the device from the server's seed (see
 * `features/verification/use-countdown.ts`), and the server's number wins again on the next write.
 * Polling for a countdown would be a request per second for a number arithmetic already knows.
 */
export function useOtpChallengeQuery(
    challengeId: string | null,
    enabled = true,
): UseQueryResult<OtpChallenge> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.verification.challenge(challengeId ?? 'none'),
        enabled: enabled && repositories !== null && challengeId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (challengeId === null) throw new Error('No challenge to read.');
            return repositories.verification.getChallenge({ challengeId });
        },
    });
}

export function useIssueChallengeMutation(): UseMutationResult<
    OtpChallenge,
    unknown,
    IssueOtpRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: IssueOtpRequest) => repositories.verification.issueChallenge(request),
        onSuccess: (challenge) => {
            queryClient.setQueryData(queryKeys.verification.challenge(challenge.id), challenge);
        },
    });
}

/**
 * The login address's own passcode — the pair `/verify-email` uses (D-036).
 *
 * Neither writes the challenge cache. There is no identifier to key it by on the way out and none
 * to read it back with on the way in, which is the endpoints' whole design; the screen counts the
 * cooldown down from the answer it is holding and re-reads `/me` once the code lands.
 */
export function useSendEmailPasscodeMutation(): UseMutationResult<OtpChallenge, unknown, void> {
    const repositories = useRepositories();
    return useMutation({ mutationFn: () => repositories.verification.sendEmailPasscode() });
}

export function useVerifyEmailPasscodeMutation(): UseMutationResult<
    void,
    unknown,
    { readonly code: string }
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (request: { readonly code: string }) =>
            repositories.verification.verifyEmailPasscode(request),
        // A verified address changes the session (the gates read it from `me`) and ticks a
        // checklist step; both were left stale until something else happened to refetch them.
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.me() }),
                queryClient.invalidateQueries({ queryKey: queryKeys.account.all() }),
            ]);
        },
    });
}

export interface ResendChallengeVariables {
    readonly challengeId: string;
    readonly channel?: string | undefined;
}

/**
 * Resend, and take the new identifier seriously.
 *
 * The previous challenge is *superseded* server-side, so its cache entry is removed rather than
 * left to expire: a component still holding the old id would otherwise re-read an entry the server
 * has retired and draw a panel whose code can never verify.
 */
export function useResendChallengeMutation(): UseMutationResult<
    OtpChallenge,
    unknown,
    ResendChallengeVariables
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ challengeId, channel }: ResendChallengeVariables) =>
            repositories.verification.resendChallenge(
                channel === undefined
                    ? { challengeId }
                    : // The channel union is the contract's; the variables keep it as a plain
                      // string so a caller holding a channel from a panel's own view type passes it
                      // straight through rather than converting between two spellings of one thing.
                      ({ challengeId, channel } as ResendOtpRequest),
            ),
        onSuccess: (challenge, variables) => {
            queryClient.removeQueries({
                queryKey: queryKeys.verification.challenge(variables.challengeId),
            });
            queryClient.setQueryData(queryKeys.verification.challenge(challenge.id), challenge);
        },
    });
}

export interface VerifyChallengeVariables {
    readonly challengeId: string;
    readonly code: string;
}

export function useVerifyChallengeMutation(): UseMutationResult<
    OtpVerificationResult,
    unknown,
    VerifyChallengeVariables
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ challengeId, code }: VerifyChallengeVariables) =>
            repositories.verification.verifyChallenge({ challengeId, code }),
        onSuccess: async (_result, variables) => {
            // The challenge is consumed. Keeping it cached would let a stale render offer a resend
            // for something that has already succeeded.
            queryClient.removeQueries({
                queryKey: queryKeys.verification.challenge(variables.challengeId),
            });
            await queryClient.invalidateQueries({ queryKey: queryKeys.verification.all() });
            await queryClient.invalidateQueries({ queryKey: queryKeys.account.all() });
        },
    });
}

/* ── J2: closure ─────────────────────────────────────────────────────────────────────────────── */

/**
 * What is in the way, and what survives.
 *
 * `staleTime: 0` is not written here because it is the default, but it is the behaviour the wizard
 * depends on: every step re-reads this, so a subscription created in another tab between step two
 * and step four turns the checks step red instead of being closed over.
 */
export function useClosurePreconditionsQuery(enabled = true): UseQueryResult<ClosurePreconditions> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.account.closurePreconditions(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.account.getClosurePreconditions();
        },
    });
}

/** The one request in flight, or `null`. Read on mount so a reload resumes rather than restarts. */
export function useLiveClosureRequestQuery(enabled = true): UseQueryResult<ClosureTicket | null> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.account.closureRequest(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.account.getLiveClosureRequest();
        },
    });
}

function useClosureWrite<TVariables>(
    run: (
        repositories: ReturnType<typeof useRepositories>,
        variables: TVariables,
    ) => Promise<ClosureTicket>,
): UseMutationResult<ClosureTicket, unknown, TVariables> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        // Never retried. Every write here is either irreversible or one the server refuses a second
        // time (`closure_already_in_flight`), and a retry after a dropped connection would turn a
        // success into a conflict the person has no way to interpret.
        retry: 0,
        mutationFn: (variables: TVariables) => run(repositories, variables),
        onSuccess: async (ticket) => {
            queryClient.setQueryData(
                queryKeys.account.closureRequest(),
                ticket.status === 'completed' || ticket.status === 'cancelled' ? null : ticket,
            );
            // A completed full closure has ended the session. Refetching the account now would
            // only collect refusals, and refetching `me` here — before the wizard has left the
            // customer area — let the customer gate send the person to sign-in instead of to the
            // page that says their account is closed. So the account is only marked stale, and
            // the wizard tells the session query itself, once it has navigated away.
            const closed = ticket.status === 'completed' && ticket.scope === 'full';
            const refetchType = closed ? 'none' : 'active';
            // The whole account root: closing withdraws consents, deletes addresses and contacts,
            // and flips the lifecycle. Invalidating one key would leave four screens stale.
            await queryClient.invalidateQueries({ queryKey: queryKeys.account.all(), refetchType });
            await queryClient.invalidateQueries({
                queryKey: queryKeys.verification.all(),
                refetchType,
            });
        },
    });
}

export function useRequestClosureMutation(): UseMutationResult<
    ClosureTicket,
    unknown,
    RequestClosureRequest
> {
    return useClosureWrite<RequestClosureRequest>((repositories, request) =>
        repositories.account.requestClosure(request),
    );
}

export function useVerifyClosureMutation(): UseMutationResult<
    ClosureTicket,
    unknown,
    VerifyClosureRequest
> {
    return useClosureWrite<VerifyClosureRequest>((repositories, request) =>
        repositories.account.verifyClosure(request),
    );
}

export function useCancelClosureMutation(): UseMutationResult<
    ClosureTicket,
    unknown,
    { readonly ticketId: string }
> {
    return useClosureWrite<{ readonly ticketId: string }>((repositories, request) =>
        repositories.account.cancelClosure(request),
    );
}
