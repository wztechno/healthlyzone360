import type {
    AgreementTermsInput,
    B2BAgreement,
    B2BApplicationSection,
    CursorPage,
    DocumentDownload,
    KycRejectionReason,
    PlatformApplicationFilter,
    PlatformB2bApplication,
    PlatformB2bApplicationSummary,
    PlatformInvitation,
    ProvisionOutcome,
    SellerPriceListOption,
} from '@healthy360/api-client/contracts';
import {
    keepPreviousData,
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import type {
    InfiniteData,
    UseInfiniteQueryResult,
    UseMutationResult,
    UseQueryResult,
} from '@tanstack/react-query';
import { useCallback } from 'react';

import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

/**
 * The platform reviewer's B2B onboarding data access.
 *
 * The rules `platform-admin-hooks.ts` states, applied: one hook per operation, every write
 * invalidates the whole `platformB2b` root (a decision moves a row between queue tabs as well as
 * changing the file), and `lockVersion` always travels from the screen.
 */

export type PlatformB2bApplicationsResult = UseInfiniteQueryResult<
    InfiniteData<CursorPage<PlatformB2bApplicationSummary>>,
    unknown
>;

export function usePlatformB2bApplicationsQuery(
    filter?: Omit<PlatformApplicationFilter, 'cursor'>,
    enabled = true,
): PlatformB2bApplicationsResult {
    const { repositories } = useRepositoryContext();

    return useInfiniteQuery({
        queryKey: queryKeys.platformB2b.applications(filter),
        enabled: enabled && repositories !== null,
        initialPageParam: undefined as string | undefined,
        placeholderData: keepPreviousData,
        queryFn: ({ pageParam }) => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.platformB2b.listApplications({
                ...filter,
                ...(pageParam === undefined ? {} : { cursor: pageParam }),
            });
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });
}

function useApplicationScopedQuery<T>(
    key: readonly unknown[],
    applicationId: string | undefined,
    read: (applicationId: string) => Promise<T>,
    enabled = true,
): UseQueryResult<T, unknown> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: key,
        enabled:
            enabled && repositories !== null && applicationId !== undefined && applicationId !== '',
        queryFn: () => {
            if (applicationId === undefined) throw new Error('No application selected.');
            return read(applicationId);
        },
    });
}

export function usePlatformB2bApplicationQuery(
    applicationId: string | undefined,
): UseQueryResult<PlatformB2bApplication, unknown> {
    const { repositories } = useRepositoryContext();
    return useApplicationScopedQuery(
        queryKeys.platformB2b.application(applicationId ?? ''),
        applicationId,
        (id) => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.platformB2b.getApplication(id);
        },
    );
}

export function usePlatformB2bAgreementsQuery(
    applicationId: string | undefined,
): UseQueryResult<readonly B2BAgreement[], unknown> {
    const { repositories } = useRepositoryContext();
    return useApplicationScopedQuery(
        queryKeys.platformB2b.agreements(applicationId ?? ''),
        applicationId,
        (id) => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.platformB2b.listAgreements(id);
        },
    );
}

export function usePlatformB2bInvitationsQuery(
    applicationId: string | undefined,
    enabled = true,
): UseQueryResult<readonly PlatformInvitation[], unknown> {
    const { repositories } = useRepositoryContext();
    return useApplicationScopedQuery(
        queryKeys.platformB2b.invitations(applicationId ?? ''),
        applicationId,
        (id) => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.platformB2b.listInvitations(id);
        },
        enabled,
    );
}

export function useSellerPriceListsQuery(
    enabled = true,
): UseQueryResult<readonly SellerPriceListOption[], unknown> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.platformB2b.sellerPriceLists(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.platformB2b.listSellerPriceLists();
        },
    });
}

/** One invalidation, used by every write. */
function usePlatformB2bWriteEffects(): () => Promise<void> {
    const client = useQueryClient();

    return useCallback(async () => {
        await client.invalidateQueries({ queryKey: queryKeys.platformB2b.all() });
    }, [client]);
}

function usePlatformB2bMutation<TResult, TVariables>(
    write: (
        repositories: ReturnType<typeof useRepositories>,
        variables: TVariables,
    ) => Promise<TResult>,
): UseMutationResult<TResult, unknown, TVariables> {
    const repositories = useRepositories();
    const onWritten = usePlatformB2bWriteEffects();

    return useMutation({
        mutationFn: (variables: TVariables) => write(repositories, variables),
        onSuccess: onWritten,
    });
}

interface Locked {
    readonly applicationId: string;
    readonly lockVersion: number;
}

export function useClaimApplicationMutation() {
    return usePlatformB2bMutation<void, Locked>((r, v) => r.platformB2b.claim(v));
}

export function useRequestInformationMutation() {
    return usePlatformB2bMutation<
        void,
        Locked & { readonly message: string; readonly sections: readonly B2BApplicationSection[] }
    >((r, v) => r.platformB2b.requestInformation(v));
}

export function useApproveApplicationMutation() {
    return usePlatformB2bMutation<
        void,
        Locked & { readonly applicantMessage?: string; readonly internalNote?: string }
    >((r, v) => r.platformB2b.approve(v));
}

export function useDeclineApplicationMutation() {
    return usePlatformB2bMutation<
        void,
        Locked & { readonly applicantMessage: string; readonly internalNote?: string }
    >((r, v) => r.platformB2b.decline(v));
}

export function useReviewDocumentMutation() {
    return usePlatformB2bMutation<
        void,
        {
            readonly documentId: string;
            readonly verdict: 'accepted' | 'rejected';
            readonly rejectionReason?: KycRejectionReason;
            readonly note?: string;
        }
    >((r, v) => r.platformB2b.reviewDocument(v));
}

/** Not a cache write: a short-lived, audited link the screen opens once. */
export function useReviewerDocumentDownloadMutation(): UseMutationResult<
    DocumentDownload,
    unknown,
    { readonly applicationId: string; readonly documentId: string }
> {
    const repositories = useRepositories();

    return useMutation({
        mutationFn: (variables) => repositories.platformB2b.getDocumentDownload(variables),
    });
}

export function useDraftAgreementMutation() {
    return usePlatformB2bMutation<
        B2BAgreement,
        {
            readonly applicationId: string;
            readonly title: string;
            readonly terms: AgreementTermsInput;
        }
    >((r, v) => r.platformB2b.draftAgreement(v));
}

export function useUpdateAgreementMutation() {
    return usePlatformB2bMutation<
        B2BAgreement,
        {
            readonly agreementId: string;
            readonly lockVersion: number;
            readonly terms: AgreementTermsInput;
        }
    >((r, v) => r.platformB2b.updateAgreement(v));
}

export function useSendAgreementMutation() {
    return usePlatformB2bMutation<
        B2BAgreement,
        { readonly agreementId: string; readonly lockVersion: number }
    >((r, v) => r.platformB2b.sendAgreement(v));
}

export function useReviseAgreementMutation() {
    return usePlatformB2bMutation<
        B2BAgreement,
        { readonly agreementId: string; readonly lockVersion: number }
    >((r, v) => r.platformB2b.reviseAgreement(v));
}

export function useProvisionApplicationMutation() {
    return usePlatformB2bMutation<ProvisionOutcome, string>((r, applicationId) =>
        r.platformB2b.provision(applicationId),
    );
}

export function useResendInvitationMutation() {
    return usePlatformB2bMutation<
        void,
        { readonly applicationId: string; readonly invitationId: string }
    >((r, v) => r.platformB2b.resendInvitation(v));
}
