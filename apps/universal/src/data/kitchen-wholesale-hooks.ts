import type {
    CreatePriceListRequest,
    CreateSalesChannelRequest,
    ItemChannelOffering,
    PriceListAdmin,
    PriceListChannels,
    SalesChannelRecord,
    SetPriceListChannelsRequest,
} from '@healthy360/api-client/contracts';
import type { PriceListId } from '@healthy360/domain-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

/**
 * The wholesale setup's reads and writes (`/kitchen/wholesale`, the price-list editor's Channels).
 *
 * Keys live under the `kitchenAdmin` root, so every kitchen write's `kitchenAdmin.all()`
 * invalidation reaches them and theirs reaches the price lists — a channel write bumps the list's
 * lock version, and the entries editor must save against the new one.
 */
const wholesaleKeys = {
    salesChannels: () => [...queryKeys.kitchenAdmin.all(), 'sales-channel-rows'] as const,
    priceListChannels: (id: PriceListId) =>
        [...queryKeys.kitchenAdmin.all(), 'price-list-channels', id] as const,
    priceListChannelsAll: () => [...queryKeys.kitchenAdmin.all(), 'price-list-channels'] as const,
    itemOfferings: (itemIds: readonly string[]) =>
        [...queryKeys.kitchenAdmin.all(), 'item-channel-offerings', itemIds.join(',')] as const,
};

/** Rows keyed by id, with the read's pending and failed states. */
export interface ManyReads<T> {
    readonly byId: ReadonlyMap<string, T>;
    readonly pending: boolean;
    readonly failed: boolean;
}

export function useSalesChannelRowsQuery(
    enabled = true,
): UseQueryResult<readonly SalesChannelRecord[]> {
    const { repositories } = useRepositoryContext();
    return useQuery({
        queryKey: wholesaleKeys.salesChannels(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listSalesChannels();
        },
    });
}

export function usePriceListChannelsQuery(
    priceListId: PriceListId | null,
): UseQueryResult<PriceListChannels> {
    const { repositories } = useRepositoryContext();
    return useQuery({
        queryKey: wholesaleKeys.priceListChannels(priceListId ?? ('' as PriceListId)),
        enabled: repositories !== null && priceListId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (priceListId === null) throw new Error('No price list identifier.');
            return repositories.kitchenAdmin.getPriceListChannels(priceListId);
        },
    });
}

/** Every list's scope and channels, from one index read. */
export function usePriceListChannelsMany(
    priceListIds: readonly PriceListId[],
): ManyReads<PriceListChannels> {
    const { repositories } = useRepositoryContext();
    const query = useQuery({
        queryKey: wholesaleKeys.priceListChannelsAll(),
        enabled: repositories !== null && priceListIds.length > 0,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listPriceListChannels();
        },
    });
    return asManyReads(query, priceListIds.length, (row) => String(row.priceListId));
}

/** Which channels each item is offered on, a hundred items to a request. */
export function useItemChannelOfferings(
    itemIds: readonly string[],
    enabled = true,
): ManyReads<ItemChannelOffering> {
    const { repositories } = useRepositoryContext();
    const sorted = [...itemIds].sort();
    const query = useQuery({
        queryKey: wholesaleKeys.itemOfferings(sorted),
        enabled: enabled && repositories !== null && sorted.length > 0,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenAdmin.listItemChannelOfferings(sorted);
        },
    });
    return asManyReads(query, sorted.length, (row) => row.itemId);
}

/** A batched read as the per-id map the screen reads; nothing asked for is not pending. */
function asManyReads<T>(
    query: UseQueryResult<readonly T[]>,
    asked: number,
    idOf: (row: T) => string,
): ManyReads<T> {
    const byId = new Map<string, T>();
    for (const row of query.data ?? []) byId.set(idOf(row), row);
    return {
        byId,
        pending: asked > 0 && query.isPending,
        failed: query.isError,
    };
}

export function useInvalidateKitchen() {
    const queryClient = useQueryClient();
    return () => queryClient.invalidateQueries({ queryKey: queryKeys.kitchenAdmin.all() });
}

export function useCreateSalesChannelMutation(): UseMutationResult<
    SalesChannelRecord,
    unknown,
    CreateSalesChannelRequest
> {
    const repositories = useRepositories();
    const invalidate = useInvalidateKitchen();
    return useMutation({
        mutationFn: (request: CreateSalesChannelRequest) =>
            repositories.kitchenAdmin.createSalesChannel(request),
        onSuccess: () => invalidate(),
    });
}

export function useCreatePriceListMutation(): UseMutationResult<
    PriceListAdmin,
    unknown,
    CreatePriceListRequest
> {
    const repositories = useRepositories();
    const invalidate = useInvalidateKitchen();
    return useMutation({
        mutationFn: (request: CreatePriceListRequest) =>
            repositories.kitchenAdmin.createPriceList(request),
        onSuccess: () => invalidate(),
    });
}

export interface SetPriceListChannelsVariables {
    readonly priceListId: PriceListId;
    readonly request: SetPriceListChannelsRequest;
}

export function useSetPriceListChannelsMutation(): UseMutationResult<
    PriceListChannels,
    unknown,
    SetPriceListChannelsVariables
> {
    const repositories = useRepositories();
    const invalidate = useInvalidateKitchen();
    return useMutation({
        mutationFn: ({ priceListId, request }: SetPriceListChannelsVariables) =>
            repositories.kitchenAdmin.setPriceListChannels(priceListId, request),
        onSuccess: () => invalidate(),
    });
}

/** One item at a time; the batch caller invalidates once at the end. */
export function useOfferItemOnChannel(): (
    itemId: string,
    salesChannelId: string,
) => Promise<ItemChannelOffering> {
    const repositories = useRepositories();
    return (itemId, salesChannelId) =>
        repositories.kitchenAdmin.offerItemOnChannel(itemId, salesChannelId);
}
