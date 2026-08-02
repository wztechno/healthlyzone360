import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { useAccountRepositories } from '../features/account/repositories-shim.ts';
import type {
    AccountOverview,
    AccountSetupChecklist,
    AddContactPointRequest,
    ConsentState,
    ContactPoint,
    ContactPointAdded,
    CustomerAddress,
    DietaryProfile,
    IssueOtpRequest,
    OtpChallenge,
    OtpVerificationResult,
    SaveAddressRequest,
    SaveDietaryProfileRequest,
    ServiceAreaOption,
} from '../features/account/repositories-shim.ts';
import { queryKeys } from './query-keys.ts';

/**
 * The D2C account area and the one-time-code surface (plan Phase J1).
 *
 * Same rules as every other hook module here: one hook per repository operation, `enabled` guards
 * and invalidation written once, and no screen ever holding a repository. Four things are specific
 * to this pair of contracts.
 *
 * ## The repositories come through a shim, and that is temporary
 *
 * `VerificationRepository` and `AccountRepository` are not in the `Repositories` bundle yet, so
 * `useAccountRepositories()` (`../features/account/repositories-shim.ts`) resolves them from the
 * bundle when they are there and from the standalone mock world when they are not. The *only* line
 * that changes when the integrator wave registers them is the import at the top of this file.
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
    const { account, ready } = useAccountRepositories();

    return useQuery({
        queryKey: queryKeys.account.overview(),
        enabled: enabled && ready,
        queryFn: () => account.getOverview(),
    });
}

export function useAccountChecklistQuery(enabled = true): UseQueryResult<AccountSetupChecklist> {
    const { account, ready } = useAccountRepositories();

    return useQuery({
        queryKey: queryKeys.account.checklist(),
        enabled: enabled && ready,
        queryFn: () => account.getChecklist(),
    });
}

/* ── account: addresses ──────────────────────────────────────────────────────────────────────── */

export function useAddressesQuery(enabled = true): UseQueryResult<readonly CustomerAddress[]> {
    const { account, ready } = useAccountRepositories();

    return useQuery({
        queryKey: queryKeys.account.addresses(),
        enabled: enabled && ready,
        queryFn: () => account.listAddresses(),
    });
}

/**
 * The closed list of areas an address may point at.
 *
 * A **contract gap**, honestly routed: no consumer-facing operation lists service areas, so the
 * shim answers from the mock world and API mode rejects. See the shim's header.
 */
export function useServiceAreasQuery(enabled = true): UseQueryResult<readonly ServiceAreaOption[]> {
    const { listServiceAreas, ready } = useAccountRepositories();

    return useQuery({
        queryKey: queryKeys.account.serviceAreas(),
        enabled: enabled && ready,
        queryFn: () => listServiceAreas(),
    });
}

export function useAddAddressMutation(): UseMutationResult<
    CustomerAddress,
    unknown,
    SaveAddressRequest
> {
    const { account } = useAccountRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: SaveAddressRequest) => account.addAddress(request),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.account.all() });
        },
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
    const { account } = useAccountRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ addressId, request }: UpdateAddressVariables) =>
            account.updateAddress({ ...request, addressId }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.account.all() });
        },
    });
}

export function useRemoveAddressMutation(): UseMutationResult<void, unknown, string> {
    const { account } = useAccountRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (addressId: string) => account.removeAddress({ addressId }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.account.all() });
        },
    });
}

/* ── account: the allergy declaration ────────────────────────────────────────────────────────── */

export function useDietaryProfileQuery(enabled = true): UseQueryResult<DietaryProfile> {
    const { account, ready } = useAccountRepositories();

    return useQuery({
        queryKey: queryKeys.account.dietaryProfile(),
        enabled: enabled && ready,
        queryFn: () => account.getDietaryProfile(),
    });
}

export function useSaveDietaryProfileMutation(): UseMutationResult<
    DietaryProfile,
    unknown,
    SaveDietaryProfileRequest
> {
    const { account } = useAccountRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: SaveDietaryProfileRequest) => account.saveDietaryProfile(request),
        onSuccess: async (profile) => {
            queryClient.setQueryData(queryKeys.account.dietaryProfile(), profile);
            await queryClient.invalidateQueries({ queryKey: queryKeys.account.all() });
        },
    });
}

/* ── account: consents ───────────────────────────────────────────────────────────────────────── */

export function useConsentsQuery(enabled = true): UseQueryResult<readonly ConsentState[]> {
    const { account, ready } = useAccountRepositories();

    return useQuery({
        queryKey: queryKeys.account.consents(),
        enabled: enabled && ready,
        queryFn: () => account.listConsents(),
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
    const { account } = useAccountRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: SetConsentVariables) => account.setConsent(request),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.account.all() });
        },
    });
}

/* ── verification: contact points ────────────────────────────────────────────────────────────── */

export function useContactPointsQuery(enabled = true): UseQueryResult<readonly ContactPoint[]> {
    const { verification, ready } = useAccountRepositories();

    return useQuery({
        queryKey: queryKeys.verification.contacts(),
        enabled: enabled && ready,
        queryFn: () => verification.listContactPoints(),
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
    const { verification } = useAccountRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: AddContactPointRequest) => verification.addContactPoint(request),
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
    const { verification } = useAccountRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (contactPointId: string) => verification.removeContactPoint({ contactPointId }),
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
    const { verification, ready } = useAccountRepositories();

    return useQuery({
        queryKey: queryKeys.verification.challenge(challengeId ?? 'none'),
        enabled: enabled && ready && challengeId !== null,
        queryFn: () => {
            if (challengeId === null) throw new Error('No challenge to read.');
            return verification.getChallenge({ challengeId });
        },
    });
}

export function useIssueChallengeMutation(): UseMutationResult<
    OtpChallenge,
    unknown,
    IssueOtpRequest
> {
    const { verification } = useAccountRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: IssueOtpRequest) => verification.issueChallenge(request),
        onSuccess: (challenge) => {
            queryClient.setQueryData(queryKeys.verification.challenge(challenge.id), challenge);
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
    const { verification } = useAccountRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ challengeId, channel }: ResendChallengeVariables) =>
            verification.resendChallenge(
                channel === undefined
                    ? { challengeId }
                    : // The channel union is the contract's; the variables keep it as a string so
                      // this module needs no second copy of it.
                      ({ challengeId, channel } as Parameters<
                          typeof verification.resendChallenge
                      >[0]),
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
    const { verification } = useAccountRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ challengeId, code }: VerifyChallengeVariables) =>
            verification.verifyChallenge({ challengeId, code }),
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
