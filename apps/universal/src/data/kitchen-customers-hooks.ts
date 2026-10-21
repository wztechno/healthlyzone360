import type {
    KitchenCustomerDetail,
    KitchenCustomerFilter,
    KitchenCustomerList,
} from '@healthy360/api-client/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from './query-keys.ts';
import { useRepositoryContext } from './repository-provider.tsx';

/**
 * The kitchen's customer book — read-only, one hook per repository operation.
 *
 * The list keeps the previous page while a new search is in flight, so typing narrows the table
 * rather than flashing a skeleton on every debounced keystroke.
 */

export function useKitchenCustomersQuery(
    filter: KitchenCustomerFilter,
): UseQueryResult<KitchenCustomerList> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenCustomers.list(filter),
        enabled: repositories !== null,
        placeholderData: keepPreviousData,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenCustomers.listCustomers(filter);
        },
    });
}

export function useKitchenCustomerQuery(
    customerId: string | undefined,
): UseQueryResult<KitchenCustomerDetail> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenCustomers.customer(customerId ?? ''),
        enabled: repositories !== null && customerId !== undefined && customerId !== '',
        queryFn: () => {
            if (repositories === null || customerId === undefined) {
                throw new Error('Repositories are not ready.');
            }
            return repositories.kitchenCustomers.getCustomer(customerId);
        },
    });
}
