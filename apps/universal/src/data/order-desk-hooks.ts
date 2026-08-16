import type {
    AddOrderDeskCustomerAddressRequest,
    CreateOrderDeskCustomerRequest,
    KitchenOrder,
    OrderDeskCustomerAddress,
    OrderDeskCustomerCreated,
    OrderDeskCustomerSearch,
    OrderDeskQueue,
    OrderDeskQueueFilters,
    OrderDeskQuote,
    OrderDeskSaleRequest,
    PlaceOrderDeskSaleRequest,
} from '@healthy360/api-client/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

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

/* ------------------------------------------------------------------------------------------------
 * Selling
 * ---------------------------------------------------------------------------------------------- */

/**
 * The fewest characters the customer search will accept.
 *
 * The server refuses less with a `422`, and the gate is mirrored here so that typing the first two
 * letters of a name is a *hint* ("keep going") rather than a red error message under the field.
 * Exported because the screen states the rule in its own hint copy and a second `3` written there
 * would be the one that stopped matching.
 */
export const CUSTOMER_SEARCH_MIN_LENGTH = 3;

/**
 * What this basket would come to.
 *
 * `null` disables the read — that is how a wizard with an empty basket, or one whose shape is not
 * yet answerable, asks for nothing rather than asking for the price of nothing. The request object
 * **is** the key, so the caller must memoise it (query-key shape rule 3): an equal-but-new object
 * per render would be a fresh cache entry per render, which for a `POST` means a request per
 * keystroke.
 *
 * `placeholderData` keeps the previous total on screen while the next one is in flight. A quote that
 * blanked between keystrokes would flicker a price the agent is reading out loud, and the stale
 * number is *labelled* stale by the screen (`isFetching`) rather than passed off as current.
 */
export function useOrderDeskQuoteQuery(
    request: OrderDeskSaleRequest | null,
    enabled = true,
): UseQueryResult<OrderDeskQuote> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.orderDesk.quote(request ?? undefined),
        enabled: enabled && request !== null && repositories !== null,
        placeholderData: (previous) => previous,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (request === null) throw new Error('There is no basket to quote.');
            return repositories.orderDesk.quoteSale(request);
        },
    });
}

/**
 * Find the customer this sale is for.
 *
 * Gated on {@link CUSTOMER_SEARCH_MIN_LENGTH} here as well as at the call site, so no caller can
 * spend a `422` on a two-letter query. The caller is expected to pass a **debounced** value: the
 * agent has somebody on the telephone and is typing a name, and a request per keystroke would be
 * twenty requests to answer one question.
 */
export function useOrderDeskCustomerSearchQuery(
    query: string,
    enabled = true,
): UseQueryResult<OrderDeskCustomerSearch> {
    const { repositories } = useRepositoryContext();
    const trimmed = query.trim();

    return useQuery({
        queryKey: queryKeys.orderDesk.customers(trimmed),
        enabled: enabled && repositories !== null && trimmed.length >= CUSTOMER_SEARCH_MIN_LENGTH,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.orderDesk.searchCustomers(trimmed);
        },
    });
}

/**
 * Sell it.
 *
 * **Both roots are invalidated, explicitly.** A desk sale writes a row that the queue and the order
 * book both list through two endpoints with two different sorts, and `query-keys.ts` keeps them as
 * separate roots precisely so that a fifteen-second poll on one does not evict the other. The cost
 * of that separation is this line: a write has to name both, and naming them is a decision somebody
 * can read rather than a coupling that happens to hold.
 *
 * There is **no retry**. A refused placement is a `409` carrying its reasons, and a client that
 * tried again would be asking the same question with a fresh idempotency key — placing a second
 * order the moment the refusal cleared.
 */
export function usePlaceOrderDeskSaleMutation(): UseMutationResult<
    KitchenOrder,
    unknown,
    PlaceOrderDeskSaleRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        retry: false,
        mutationFn: (request: PlaceOrderDeskSaleRequest) =>
            repositories.orderDesk.placeSale(request),
        onSuccess: (order: KitchenOrder) => {
            queryClient.setQueryData(queryKeys.kitchenOrders.order(order.id), order);
            void queryClient.invalidateQueries({ queryKey: queryKeys.orderDesk.all() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenOrders.all() });
        },
    });
}

/**
 * Write down a cold caller.
 *
 * Every customer search is invalidated afterwards rather than the new row being spliced into one:
 * the account is now findable under a name *and* a number, and only the server knows which of the
 * agent's previous queries it would have answered.
 */
export function useCreateOrderDeskCustomerMutation(): UseMutationResult<
    OrderDeskCustomerCreated,
    unknown,
    CreateOrderDeskCustomerRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        retry: false,
        mutationFn: (request: CreateOrderDeskCustomerRequest) =>
            repositories.orderDesk.createCustomer(request),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.orderDesk.all() });
        },
    });
}

/**
 * Add a delivery address to a customer.
 *
 * Nothing is invalidated: there is no operation on this surface that *lists* a customer's addresses,
 * so there is no cached list for a new one to be missing from. The screen holds the address it just
 * created, which is the only one this sale needs.
 */
export function useAddOrderDeskCustomerAddressMutation(): UseMutationResult<
    OrderDeskCustomerAddress,
    unknown,
    AddOrderDeskCustomerAddressRequest
> {
    const repositories = useRepositories();

    return useMutation({
        retry: false,
        mutationFn: (request: AddOrderDeskCustomerAddressRequest) =>
            repositories.orderDesk.addCustomerAddress(request),
    });
}
