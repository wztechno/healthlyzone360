import { asApiFailure } from '@healthy360/api-client';
import type {
    ApiFailure,
    EmailVerificationStatus,
    LoginRequest,
    LoginResult,
    MeResponse,
    PasswordConfirmationResult,
    PasswordResetRequest,
    RegisterRequest,
    RegisterResult,
    ResendVerificationResult,
    SetContextRequest,
    TwoFactorChallengeRequest,
} from '@healthy360/api-client';
import type { ActiveContext, Device, DeviceId } from '@healthy360/domain-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import { useRepositories, useRepositoryContext } from './repository-provider.tsx';
import { queryKeys } from './query-keys.ts';

/**
 * The session token, observed reactively. A plain `tokenStore.get()` during render goes stale the
 * moment a login mutation writes the token — nothing above would re-render, the `me` query would
 * stay disabled, and the session would never leave `anonymous` (it did not, until this hook).
 */
export function useSessionToken(): string | null {
    const { tokenStore } = useRepositoryContext();
    return useSyncExternalStore(
        tokenStore.subscribe,
        () => tokenStore.get(),
        () => tokenStore.get(),
    );
}

/**
 * One hook per repository operation.
 *
 * Screens call these and never a repository directly, so the retry policy, the cache invalidation
 * and the failure narrowing are written once. `asApiFailure` is applied at this boundary so a
 * screen's `error` is always an `ApiFailure | null` and never a bare `Error`.
 */

export function toFailure(error: unknown): ApiFailure | null {
    return error === null || error === undefined ? null : asApiFailure(error);
}

// ── queries ─────────────────────────────────────────────────────────────────────────────────────

export function useMeQuery(): UseQueryResult<MeResponse> {
    const { repositories } = useRepositoryContext();
    const hasToken = useSessionToken() !== null;

    return useQuery({
        queryKey: queryKeys.me(),
        // Asking `me()` with no token would be a guaranteed 401 on every cold start.
        enabled: repositories !== null && hasToken,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.session.me();
        },
    });
}

export function useDevicesQuery(enabled = true): UseQueryResult<readonly Device[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.devices(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.devices.list();
        },
    });
}

export function useEmailVerificationQuery(
    enabled: boolean,
): UseQueryResult<EmailVerificationStatus> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.emailVerification(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.auth.verifyEmailStatus();
        },
    });
}

// ── mutations ───────────────────────────────────────────────────────────────────────────────────

export function useLoginMutation(): UseMutationResult<LoginResult, unknown, LoginRequest> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: LoginRequest) => repositories.auth.login(request),
        onSuccess: async (result) => {
            // A two-factor challenge is not a session yet; refetching `me` would 401.
            if (result.status === 'authenticated') {
                await queryClient.invalidateQueries({ queryKey: queryKeys.me() });
            }
        },
    });
}

export function useTwoFactorChallengeMutation() {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: TwoFactorChallengeRequest) =>
            repositories.auth.challengeTwoFactor(request),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.me() });
        },
    });
}

export function useRegisterMutation(): UseMutationResult<RegisterResult, unknown, RegisterRequest> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: RegisterRequest) => repositories.auth.register(request),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.me() });
        },
    });
}

export function useLogoutMutation(): UseMutationResult<void, unknown, void> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: () => repositories.auth.logout(),
        onSuccess: () => {
            // Everything in the cache belonged to the session that has just ended.
            queryClient.clear();
        },
    });
}

export function useForgotPasswordMutation(): UseMutationResult<void, unknown, { email: string }> {
    const repositories = useRepositories();
    return useMutation({
        mutationFn: (request: { email: string }) =>
            repositories.auth.requestPasswordReset(request),
    });
}

export function useResetPasswordMutation(): UseMutationResult<
    void,
    unknown,
    PasswordResetRequest
> {
    const repositories = useRepositories();
    return useMutation({
        mutationFn: (request: PasswordResetRequest) => repositories.auth.resetPassword(request),
    });
}

export function useResendVerificationMutation(): UseMutationResult<
    ResendVerificationResult,
    unknown,
    void
> {
    const repositories = useRepositories();
    return useMutation({ mutationFn: () => repositories.auth.resendVerification() });
}

export function useRecheckVerificationMutation(): UseMutationResult<
    EmailVerificationStatus,
    unknown,
    void
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: () => repositories.auth.verifyEmailStatus(),
        onSuccess: async (status) => {
            if (status.verified) {
                await queryClient.invalidateQueries({ queryKey: queryKeys.me() });
            }
        },
    });
}

export function useSetContextMutation(): UseMutationResult<
    ActiveContext,
    unknown,
    SetContextRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: SetContextRequest) => repositories.context.setContext(request),
        onSuccess: async (context) => {
            // Write the server-confirmed context into the cached `me` SYNCHRONOUSLY. The
            // navigation that follows this mutation reads the cache immediately; leaving the
            // update to an invalidation refetch races it, and the picker screens bounce back to
            // /select-organisation off the stale `activeContext: null` (they did).
            queryClient.setQueryData(queryKeys.me(), (old: MeResponse | undefined) =>
                old === undefined ? old : { ...old, activeContext: context },
            );
            // The permission set has changed, so anything scoped by it is now wrong. The refetch
            // confirms the optimistically written context in the background.
            void queryClient.invalidateQueries({ queryKey: queryKeys.me() });
            await queryClient.invalidateQueries({ queryKey: queryKeys.devices() });
        },
    });
}

export function useConfirmPasswordMutation(): UseMutationResult<
    PasswordConfirmationResult,
    unknown,
    { password: string }
> {
    const repositories = useRepositories();
    return useMutation({
        mutationFn: (request: { password: string }) => repositories.auth.confirmPassword(request),
    });
}

export function useRevokeDeviceMutation(): UseMutationResult<void, unknown, DeviceId> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (deviceId: DeviceId) => repositories.devices.revoke(deviceId),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.devices() });
        },
    });
}
