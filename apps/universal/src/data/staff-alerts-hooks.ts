import type {
    KitchenServiceSettings,
    StaffAlertList,
    StorefrontProfile,
} from '@healthy360/api-client/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

/**
 * The top-bar alerts and the kitchen's service timings — one hook per repository operation.
 */

/** There is no push channel, so the bell asks, as the display and the desk do. */
const ALERT_POLL_MS = 30_000;

/**
 * The caller's alerts. It keeps polling in a hidden tab: a manager working in another tab is
 * exactly who the tone is for.
 */
export function useStaffAlertsQuery(): UseQueryResult<StaffAlertList> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.staffAlerts.list(),
        enabled: repositories !== null,
        refetchInterval: ALERT_POLL_MS,
        refetchIntervalInBackground: true,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.staffAlerts.listAlerts();
        },
    });
}

export function useMarkStaffAlertReadMutation(): UseMutationResult<void, unknown, string> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (alertId: string) => repositories.staffAlerts.markAlertRead(alertId),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.staffAlerts.list() });
        },
    });
}

export function useMarkAllStaffAlertsReadMutation(): UseMutationResult<void, unknown, void> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: () => repositories.staffAlerts.markAllAlertsRead(),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.staffAlerts.list() });
        },
    });
}

/** This kitchen's timings. `enabled` because the read has its own permission. */
export function useKitchenServiceSettingsQuery(
    enabled = true,
): UseQueryResult<KitchenServiceSettings> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.staffAlerts.serviceSettings(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.staffAlerts.getServiceSettings();
        },
    });
}

export function usePauseKitchenMutation(): UseMutationResult<
    KitchenServiceSettings,
    unknown,
    number
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (minutes: number) => repositories.staffAlerts.pauseKitchen(minutes),
        onSuccess: (saved) => {
            queryClient.setQueryData(queryKeys.staffAlerts.serviceSettings(), saved);
        },
    });
}

export function useResumeKitchenMutation(): UseMutationResult<
    KitchenServiceSettings,
    unknown,
    void
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: () => repositories.staffAlerts.resumeKitchen(),
        onSuccess: (saved) => {
            queryClient.setQueryData(queryKeys.staffAlerts.serviceSettings(), saved);
        },
    });
}

export function useSaveKitchenServiceSettingsMutation(): UseMutationResult<
    KitchenServiceSettings,
    unknown,
    Omit<KitchenServiceSettings, 'pausedUntil'>
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (settings: Omit<KitchenServiceSettings, 'pausedUntil'>) =>
            repositories.staffAlerts.saveServiceSettings(settings),
        onSuccess: (saved) => {
            queryClient.setQueryData(queryKeys.staffAlerts.serviceSettings(), saved);
        },
    });
}

/** The kitchen's marketplace copy. Read and written on the catalogue permission. */
export function useStorefrontProfileQuery(): UseQueryResult<StorefrontProfile> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.staffAlerts.storefrontProfile(),
        enabled: repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.staffAlerts.getStorefrontProfile();
        },
    });
}

export function useSaveStorefrontProfileMutation(): UseMutationResult<
    StorefrontProfile,
    unknown,
    StorefrontProfile
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (profile: StorefrontProfile) =>
            repositories.staffAlerts.saveStorefrontProfile(profile),
        onSuccess: (saved) => {
            queryClient.setQueryData(queryKeys.staffAlerts.storefrontProfile(), saved);
        },
    });
}
