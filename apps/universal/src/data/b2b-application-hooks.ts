import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { useB2BApplicationRepositories } from '../features/b2b-application/repositories-shim.ts';
import type {
    B2BAgreement,
    B2BApplication,
    DocumentDownload,
    SaveSectionRequest,
    SignAgreementRequest,
    UploadDocumentRequest,
} from '../features/b2b-application/repositories-shim.ts';
import { queryKeys } from './query-keys.ts';

/**
 * B2B onboarding (plan Phase B1).
 *
 * Same rules as every other hook module here: one hook per repository operation, `enabled` guards
 * and invalidation written once, and no screen ever holding a repository. Three things are specific
 * to this contract.
 *
 * ## The repository comes through a shim, and that is temporary
 *
 * `B2BApplicationRepository` is not in the `Repositories` bundle yet, so
 * `useB2BApplicationRepositories()` resolves it from the bundle when it is there and refuses when it
 * is not. The *only* line that changes when the integrator wave registers it is the import at the
 * top of this file.
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

/* ── reads ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * The applicant's live application, or `null`.
 *
 * `null` is a value, not an error: "you have not applied yet" is the entry screen's normal state.
 */
export function useB2BApplicationQuery(enabled = true): UseQueryResult<B2BApplication | null> {
    const { b2bApplication, ready } = useB2BApplicationRepositories();

    return useQuery({
        queryKey: queryKeys.b2bApplication.current(),
        enabled: enabled && ready,
        queryFn: () => b2bApplication.getApplication(),
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
    const { b2bApplication, ready } = useB2BApplicationRepositories();

    return useQuery({
        queryKey: queryKeys.b2bApplication.agreement(applicationId ?? 'none'),
        enabled: enabled && ready && applicationId !== null,
        queryFn: () => {
            if (applicationId === null) throw new Error('No application to read.');
            return b2bApplication.getAgreement({ applicationId });
        },
    });
}

/* ── writes ──────────────────────────────────────────────────────────────────────────────────── */

/** Seeds both entries from one answer. See the module header for why this is not an invalidation. */
function useApplicationWrite<Variables>(
    run: (
        repository: ReturnType<typeof useB2BApplicationRepositories>['b2bApplication'],
        variables: Variables,
    ) => Promise<B2BApplication>,
): UseMutationResult<B2BApplication, unknown, Variables> {
    const { b2bApplication } = useB2BApplicationRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (variables: Variables) => run(b2bApplication, variables),
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
    const { b2bApplication } = useB2BApplicationRepositories();

    return useMutation({
        mutationFn: (request: RemoveDocumentVariables) =>
            b2bApplication.getDocumentDownload(request),
    });
}
