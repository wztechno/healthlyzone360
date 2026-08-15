import type { OrderDeskQueue, OrderDeskQueueFilters } from '@healthy360/api-client/contracts';
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from './query-keys.ts';
import { useRepositoryContext } from './repository-provider.tsx';

/**
 * The Order Desk queue's data access — one read, and the cadence that keeps it live.
 *
 * ## Why the poll lives here rather than at the call site
 *
 * `kitchen-orders-hooks.ts` makes the interval an *option*, because the order book is worked by
 * somebody who is already causing invalidations by acting on it and only the wall display wants a
 * timer. The desk queue is the opposite case: it is a queue of work arriving from outside — a
 * customer ordering, another agent confirming — and a desk that only refreshed when its own operator
 * pressed something would be a desk that never learns about the order it is meant to pick up next.
 * So the poll is the hook's own behaviour, and the screen decides only whether the device is in a
 * state where polling means anything.
 *
 * ## Online-gated, on the kitchen display's terms
 *
 * The interval is passed by the caller as `online ? ORDER_DESK_POLL_MS : false` — the same shape
 * `kds-tickets-screen.tsx` uses — because an interval firing into a dead network is retries nobody
 * asked for and a battery cost nobody chose. The constant lives beside the screen that owns the
 * cadence rather than being imported from the KDS screen module: importing it would drag a whole
 * screen (and its queries) into this slice's dependency graph for the sake of one number.
 */

export { toFailure } from './hooks.ts';

export interface OrderDeskQueueQueryOptions {
    /**
     * Poll cadence in milliseconds, or `false` for a queue that only refetches when something asks
     * it to. Screens pass `false` while the device is offline. See the module note.
     */
    readonly refetchInterval?: number | false | undefined;
}

/**
 * The open queue in due order, capped, with the day and clock it was measured against.
 *
 * `filters` is passed to the key as a single object (query-key shape rule 3), so the memoised filter
 * a screen holds is the identity that decides whether this is the same entry — a re-render that
 * produces an equal-but-new object must not look like a new view.
 */
export function useOrderDeskQueueQuery(
    filters?: OrderDeskQueueFilters,
    enabled = true,
    options: OrderDeskQueueQueryOptions = {},
): UseQueryResult<OrderDeskQueue> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.orderDesk.queue(filters),
        enabled: enabled && repositories !== null,
        refetchInterval: options.refetchInterval ?? false,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.orderDesk.listQueue(filters);
        },
    });
}
