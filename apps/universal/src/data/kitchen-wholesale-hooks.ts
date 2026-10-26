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
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
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
    itemOffering: (itemId: string) =>
        [...queryKeys.kitchenAdmin.all(), 'item-channel-offering', itemId] as const,
};

/** Many reads, one per id, gathered into a map once every one has answered. */
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

/** Every list's scope and channels — one read per list; a kitchen has a handful. */
export function usePriceListChannelsMany(
    priceListIds: readonly PriceListId[],
): ManyReads<PriceListChannels> {
    const { repositories } = useRepositoryContext();
    return useQueries({
        queries: priceListIds.map((id) => ({
            queryKey: wholesaleKeys.priceListChannels(id),
            enabled: repositories !== null,
            queryFn: () => {
                if (repositories === null) throw new Error('Repositories are not ready.');
                return repositories.kitchenAdmin.getPriceListChannels(id);
            },
        })),
        combine: (results) => gather(results, (row) => String(row.priceListId)),
    });
}

/**
 * Which channels each item is offered on — one read per item.
 * ponytail: N reads for N items; the items index has no channel filter. Add one server-side if a
 * kitchen's agreement lists ever price hundreds of articles.
 */
export function useItemChannelOfferings(
    itemIds: readonly string[],
    enabled = true,
): ManyReads<ItemChannelOffering> {
    const { repositories } = useRepositoryContext();
    return useQueries({
        queries: itemIds.map((id) => ({
            queryKey: wholesaleKeys.itemOffering(id),
            enabled: enabled && repositories !== null,
            queryFn: () => {
                if (repositories === null) throw new Error('Repositories are not ready.');
                return repositories.kitchenAdmin.getItemChannelOffering(id);
            },
        })),
        combine: (results) => gather(results, (row) => row.itemId),
    });
}

function gather<T>(
    results: readonly {
        readonly data?: T | undefined;
        readonly isPending: boolean;
        readonly isError: boolean;
    }[],
    idOf: (row: T) => string,
): ManyReads<T> {
    const byId = new Map<string, T>();
    for (const result of results) {
        if (result.data !== undefined) byId.set(idOf(result.data), result.data);
    }
    return {
        byId,
        pending: results.some((result) => result.isPending),
        failed: results.some((result) => result.isError),
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
