import type {
    B2BAgreement,
    B2BApplication,
    B2BApplicationRepository,
    DocumentDownload,
    SignAgreementRequest,
    UploadDocumentRequest,
} from '@healthy360/api-client/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

/**
 * B2B onboarding (plan Phase B1).
 *
 * Same rules as every other hook module here: one hook per repository operation, `enabled` guards
 * and invalidation written once, and no screen ever holding a repository. Two things are specific
 * to this contract.
 *
 * ## Every write returns the whole application, and every write seeds the cache with it
 *
 * The repository answers each mutation with the application as it now stands rather than with the
 * fragment that changed, so the mutations `setQueryData` instead of invalidating. That is not an
 * optimisation: a section save changes `lockVersion`, and the *next* save has to send the new one.
 * A wizard that invalidated and re-read would have a window between the refetch starting and
 * landing in which the version on screen is stale and the following save is a guaranteed
 * `resource.conflict`. Seeding closes the window entirely.
 *
 * ## The draft is server-side, and there is no local copy to lose
 *
 * There is no reducer here holding answers until the end. Every step is a real
 * {@link useSaveSectionMutation} round trip against a real row — the plan is explicit about it
 * (Phase B1: "application wizard (server-side draft)") and the quotation builder is the counter
 * example that made it explicit. A person filling in a B2B application stops halfway, finds the
 * trade licence, and comes back tomorrow; a wizard whose answers live in a tab cannot support that
 * and loses the morning's work to a refresh.
 */

export { toFailure } from './hooks.ts';

/**
 * What a section save sends.
 *
 * Derived from the contract's own parameter rather than restated, because the shape is anonymous
 * there: writing the object out again at the three places this module needs to name it would be
 * three copies free to drift from the one the repository actually accepts.
 */
export type SaveSectionRequest = Parameters<B2BApplicationRepository['saveSection']>[0];

/* ── reads ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * The applicant's live application, or `null`.
 *
 * `null` is a value, not an error: "you have not applied yet" is the entry screen's normal state.
 */
export function useB2BApplicationQuery(enabled = true): UseQueryResult<B2BApplication | null> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.b2bApplication.current(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.b2bApplication.getApplication();
        },
    });
}

/**
 * The agreement, read on its own.
 *
 * The signing screen re-reads it rather than using the copy carried on the application, because the
 * digest it echoes back on `signAgreement` has to be the one the server holds *now*. A document that
 * changed under the signatory must be refused, and that only works if the client is holding a fresh
 * digest rather than one from an application read five minutes ago.
 */
export function useB2BAgreementQuery(
    applicationId: string | null,
    enabled = true,
): UseQueryResult<B2BAgreement | null> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.b2bApplication.agreement(applicationId ?? 'none'),
        enabled: enabled && repositories !== null && applicationId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (applicationId === null) throw new Error('No application to read.');
            return repositories.b2bApplication.getAgreement({ applicationId });
        },
    });
}

/* ── writes ──────────────────────────────────────────────────────────────────────────────────── */

/** Seeds both entries from one answer. See the module header for why this is not an invalidation. */
function useApplicationWrite<Variables>(
    run: (repository: B2BApplicationRepository, variables: Variables) => Promise<B2BApplication>,
): UseMutationResult<B2BApplication, unknown, Variables> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (variables: Variables) => run(repositories.b2bApplication, variables),
        onSuccess: (application) => {
            queryClient.setQueryData(queryKeys.b2bApplication.current(), application);
            if (application.agreement !== null) {
                queryClient.setQueryData(
                    queryKeys.b2bApplication.agreement(application.id),
                    application.agreement,
                );
            }
        },
    });
}

export function useStartB2BApplicationMutation(): UseMutationResult<B2BApplication, unknown, void> {
    return useApplicationWrite<void>((repository) => repository.startApplication());
}

export function useSaveSectionMutation(): UseMutationResult<
    B2BApplication,
    unknown,
    SaveSectionRequest
> {
    return useApplicationWrite<SaveSectionRequest>((repository, request) =>
        repository.saveSection(request),
    );
}

export function useUploadDocumentMutation(): UseMutationResult<
    B2BApplication,
    unknown,
    UploadDocumentRequest
> {
    return useApplicationWrite<UploadDocumentRequest>((repository, request) =>
        repository.uploadDocument(request),
    );
}

export interface RemoveDocumentVariables {
    readonly applicationId: string;
    readonly documentId: string;
}

export function useRemoveDocumentMutation(): UseMutationResult<
    B2BApplication,
    unknown,
    RemoveDocumentVariables
> {
    return useApplicationWrite<RemoveDocumentVariables>((repository, request) =>
        repository.removeDocument(request),
    );
}

export interface ApplicationVersionVariables {
    readonly applicationId: string;
    readonly lockVersion: number;
}

export function useSubmitB2BApplicationMutation(): UseMutationResult<
    B2BApplication,
    unknown,
    ApplicationVersionVariables
> {
    return useApplicationWrite<ApplicationVersionVariables>((repository, request) =>
        repository.submitApplication(request),
    );
}

export function useWithdrawB2BApplicationMutation(): UseMutationResult<
    B2BApplication,
    unknown,
    ApplicationVersionVariables
> {
    return useApplicationWrite<ApplicationVersionVariables>((repository, request) =>
        repository.withdrawApplication(request),
    );
}

export function useSignAgreementMutation(): UseMutationResult<
    B2BApplication,
    unknown,
    SignAgreementRequest
> {
    return useApplicationWrite<SignAgreementRequest>((repository, request) =>
        repository.signAgreement(request),
    );
}

/**
 * Mint a short-lived link to one document.
 *
 * A mutation rather than a query even though it reads: minting the link is an audited event with a
 * purpose of use, and caching "somebody opened a passport" would both repeat the audit entry and
 * hand back a URL that has since expired.
 */
export function useDocumentDownloadMutation(): UseMutationResult<
    DocumentDownload,
    unknown,
    RemoveDocumentVariables
> {
    const repositories = useRepositories();

    return useMutation({
        mutationFn: (request: RemoveDocumentVariables) =>
            repositories.b2bApplication.getDocumentDownload(request),
    });
}
