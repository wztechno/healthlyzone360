import type {
    CreateKitchenRequest,
    CursorPage,
    InviteOwnerRequest,
    KitchenTenantFilter,
    LockedPlatformRequest,
    OwnerInvitation,
    OwnerRevocation,
    PlatformKitchen,
    PlatformKitchenSummary,
    SuspendKitchenRequest,
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
 * The platform console's data access (phase PA1).
 *
 * Same rules as every other hook module here — one hook per repository operation, the `enabled`
 * guards and the invalidation written once, and no screen ever holding a repository. Three things
 * are specific to this file.
 *
 * ## Every write invalidates the whole root
 *
 * `queryKeys.platformAdmin.all()`, not the row. A suspension changes the row *and* the list *and*
 * the counts on the list, a revocation changes the owner count on both, and a creation adds a row
 * that no targeted invalidation would reach. The console is a handful of screens over a handful of
 * rows, so the cost of refetching the root is a single request and the cost of getting the
 * targeting wrong is an operator staring at a kitchen the console says is still trading.
 *
 * ## `lockVersion` travels from the screen, never from here
 *
 * The suspend and reactivate mutations take it in their argument. A version cached in a hook is the
 * one from the last render, and the whole point of `If-Match` is that it is the version the person
 * was looking at when they pressed the button.
 *
 * ## The list is an infinite query and the detail is not
 *
 * Same reasoning as the kitchen workspace: an operator narrowing a search is comparing rows, not
 * paging through them. `keepPreviousData` is what stops the table blanking between keystrokes.
 */

export type PlatformKitchensInfiniteResult = UseInfiniteQueryResult<
    InfiniteData<CursorPage<PlatformKitchenSummary>>,
    unknown
>;

export function usePlatformKitchensQuery(
    filter?: Omit<KitchenTenantFilter, 'cursor'>,
    enabled = true,
): PlatformKitchensInfiniteResult {
    const { repositories } = useRepositoryContext();

    return useInfiniteQuery({
        queryKey: queryKeys.platformAdmin.kitchens(filter),
        enabled: enabled && repositories !== null,
        initialPageParam: undefined as string | undefined,
        placeholderData: keepPreviousData,
        queryFn: ({ pageParam }) => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.platformAdmin.listKitchens({
                ...filter,
                ...(pageParam === undefined ? {} : { cursor: pageParam }),
            });
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });
}

export function usePlatformKitchenQuery(
    kitchen: string | undefined,
    enabled = true,
): UseQueryResult<PlatformKitchen, unknown> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.platformAdmin.kitchen(kitchen ?? ''),
        enabled: enabled && repositories !== null && kitchen !== undefined && kitchen !== '',
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (kitchen === undefined) throw new Error('No kitchen selected.');
            return repositories.platformAdmin.getKitchen(kitchen);
        },
    });
}

/** One invalidation, used by every write. See the module docblock for why it is not targeted. */
function usePlatformAdminWriteEffects(): () => Promise<void> {
    const client = useQueryClient();

    return useCallback(async () => {
        await client.invalidateQueries({ queryKey: queryKeys.platformAdmin.all() });
    }, [client]);
}

export function useCreateKitchenMutation(): UseMutationResult<
    PlatformKitchen,
    unknown,
    CreateKitchenRequest
> {
    const repositories = useRepositories();
    const onWritten = usePlatformAdminWriteEffects();

    return useMutation({
        mutationFn: (request: CreateKitchenRequest) =>
            repositories.platformAdmin.createKitchen(request),
        onSuccess: onWritten,
    });
}

export interface SuspendKitchenVariables extends SuspendKitchenRequest {
    readonly kitchen: string;
}

export function useSuspendKitchenMutation(): UseMutationResult<
    PlatformKitchenSummary,
    unknown,
    SuspendKitchenVariables
> {
    const repositories = useRepositories();
    const onWritten = usePlatformAdminWriteEffects();

    return useMutation({
        mutationFn: ({ kitchen, ...request }: SuspendKitchenVariables) =>
            repositories.platformAdmin.suspendKitchen(kitchen, request),
        onSuccess: onWritten,
    });
}

export interface ReactivateKitchenVariables extends LockedPlatformRequest {
    readonly kitchen: string;
}

export function useReactivateKitchenMutation(): UseMutationResult<
    PlatformKitchenSummary,
    unknown,
    ReactivateKitchenVariables
> {
    const repositories = useRepositories();
    const onWritten = usePlatformAdminWriteEffects();

    return useMutation({
        mutationFn: ({ kitchen, ...request }: ReactivateKitchenVariables) =>
            repositories.platformAdmin.reactivateKitchen(kitchen, request),
        onSuccess: onWritten,
    });
}

export interface InviteOwnerVariables extends InviteOwnerRequest {
    readonly kitchen: string;
}

export function useInviteOwnerMutation(): UseMutationResult<
    OwnerInvitation,
    unknown,
    InviteOwnerVariables
> {
    const repositories = useRepositories();
    const onWritten = usePlatformAdminWriteEffects();

    return useMutation({
        mutationFn: ({ kitchen, ...request }: InviteOwnerVariables) =>
            repositories.platformAdmin.inviteOwner(kitchen, request),
        onSuccess: onWritten,
    });
}

export interface RevokeOwnerVariables {
    readonly kitchen: string;
    readonly membership: string;
}

export function useRevokeOwnerMutation(): UseMutationResult<
    OwnerRevocation,
    unknown,
    RevokeOwnerVariables
> {
    const repositories = useRepositories();
    const onWritten = usePlatformAdminWriteEffects();

    return useMutation({
        mutationFn: ({ kitchen, membership }: RevokeOwnerVariables) =>
            repositories.platformAdmin.revokeOwner(kitchen, membership),
        onSuccess: onWritten,
    });
}
