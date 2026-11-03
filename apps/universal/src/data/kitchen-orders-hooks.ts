import type {
    CancelKitchenOrderRequest,
    CloseFailedDeliveryRequest,
    FailKitchenOrderDeliveryRequest,
    HandToCourierRequest,
    KitchenDisplay,
    KitchenOrder,
    KitchenOrderFilters,
    KitchenOrderPage,
    KitchenOrderTransitionRequest,
    RecordKitchenOrderPaymentRequest,
    RecordedKitchenOrderPayment,
    RedeliverKitchenOrderRequest,
    DecideOrderRefundRequest,
    OrderRefundLedger,
    RecordOrderRefundRequest,
    OrderComplaint,
    RecordComplaintRequest,
    UpdateComplaintRequest,
} from '@healthy360/api-client/contracts';
import type { OrderId } from '@healthy360/domain-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

/**
 * The kitchen order book's data access — a list, a detail read, the three lifecycle actions, and the
 * receipt that records money arriving against one of them.
 *
 * One hook per repository operation, same as `./kitchen-ops-hooks.ts`, with one difference that
 * shapes everything below: these rows **are** lock-versioned, so a screen here is not free to
 * invalidate and forget.
 *
 * ## Why every write seeds the detail entry *and* invalidates the root
 *
 * Each of `confirmOrder` / `fulfilOrder` / `cancelOrder` answers the fresh order carrying the next
 * `lockVersion`. Writing it straight into `queryKeys.kitchenOrders.order(id)` is not an
 * optimisation — it is what makes a second action possible without a round trip: the detail panel
 * stays open after "Confirm", and the "Fulfil" button beside it needs a version the server will
 * accept. Dropping the response and merely invalidating would leave that panel holding a stale
 * validator for as long as the refetch takes, and a fast second click would earn a
 * `resource.conflict` the person did nothing to deserve.
 *
 * The root invalidation happens as well, because the list rows carry status and counts that the
 * action just changed, and because another tablet's list is not this tablet's problem to patch.
 *
 * ## Conflicts are not retried here
 *
 * A `resource.conflict` from any of the three means somebody else moved this order. The remedy is
 * to re-read and show the person what actually happened, which is the caller's decision — a hook
 * that silently refetched and retried would resolve the race in favour of whoever clicked last,
 * which is the lost update the `If-Match` guard exists to prevent.
 */

export { toFailure } from './hooks.ts';

/**
 * One page of orders, newest first.
 *
 * `filters` is passed to the key as a single object (query-key shape rule 3), so two screens asking
 * for the same view share one entry and a filter change is a different entry rather than a mutation
 * of this one.
 *
 * `refetchInterval` is the caller's poll cadence, as the wall board's is: the order book is open on
 * a shelf tablet too, and an order placed meanwhile has to appear without a pull to refresh.
 */
export function useKitchenOrdersQuery(
    filters?: KitchenOrderFilters,
    enabled = true,
    refetchInterval: number | false = false,
): UseQueryResult<KitchenOrderPage> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenOrders.list(filters),
        enabled: enabled && repositories !== null,
        refetchInterval,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenOrders.listOrders(filters);
        },
    });
}

/**
 * The wall board.
 *
 * It takes a poll cadence because a wall screen is one nobody touches: an order placed while the
 * tablet sits on a shelf has to appear without a person pulling to refresh, and this client slice
 * has no push channel to deliver it.
 */
export function useKitchenDisplayQuery(
    enabled: boolean,
    refetchInterval: number | false,
): UseQueryResult<KitchenDisplay> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenOrders.display(),
        enabled: enabled && repositories !== null,
        refetchInterval,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenOrders.getDisplay();
        },
    });
}

/**
 * One order with its lines — and its `lockVersion`, which is the reason the detail panel cannot be
 * rendered from a list row alone.
 *
 * `orderId` is nullable so the slide-in can mount before anything is selected without the caller
 * writing its own `enabled` dance.
 */
export function useKitchenOrderQuery(
    orderId: OrderId | null,
    enabled = true,
): UseQueryResult<KitchenOrder> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenOrders.order(orderId ?? ('' as OrderId)),
        enabled: enabled && orderId !== null && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (orderId === null) throw new Error('No order is selected.');
            return repositories.kitchenOrders.getOrder(orderId);
        },
    });
}

/**
 * Seeds the fresh record into its own entry, then invalidates every list that shows it. See the
 * module note.
 *
 * **Two roots, named explicitly.** The same order is listed by the order book and by the Order Desk
 * queue through two endpoints with two different sorts, and `query-keys.ts` keeps them as separate
 * roots precisely so a fifteen-second poll on one does not evict the other. The cost of that
 * separation is this second line: a lifecycle write changes the status the desk queue draws and the
 * window a confirmed order falls into, so a desk left holding the old row would offer "Confirm" on
 * an order somebody at the book already confirmed. Naming both is a decision a reader can see,
 * rather than a coupling that happens to hold — and it is the same pair
 * `usePlaceOrderDeskSaleMutation` names for the same reason.
 *
 * Invalidating a root nothing is subscribed to costs nothing, so the order book pays no price for
 * keeping the desk honest.
 */
function useKitchenOrderWriteEffects(): (order: KitchenOrder) => void {
    const queryClient = useQueryClient();

    return (order: KitchenOrder) => {
        queryClient.setQueryData(queryKeys.kitchenOrders.order(order.id), order);
        // The answer into every cached list too, so a KDS ticket moves the moment Ready lands
        // rather than when the refetch below does — seconds on a slow server, and the board looked
        // as if nothing had happened.
        const withFresh = (rows: readonly KitchenOrder[]): readonly KitchenOrder[] =>
            rows.map((row) => (row.id === order.id ? order : row));
        queryClient.setQueriesData<{
            readonly items?: readonly KitchenOrder[];
            readonly orders?: readonly KitchenOrder[];
        }>(
            // The whole family; the guards below leave anything that is not a page of orders. The
            // book's pages hold `items`, the kitchen display's holds `orders`.
            { queryKey: queryKeys.kitchenOrders.all() },
            (page) => {
                if (page === undefined) return page;
                if (Array.isArray(page.items)) return { ...page, items: withFresh(page.items) };
                if (Array.isArray(page.orders)) return { ...page, orders: withFresh(page.orders) };
                return page;
            },
        );
        void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenOrders.all() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.orderDesk.all() });
    };
}

/**
 * "Start" on the kitchen display (HA-24): stamps `preparingAt`, confirming a placed order first.
 */
export function useStartOrderMutation(): UseMutationResult<
    KitchenOrder,
    unknown,
    KitchenOrderTransitionRequest
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOrderWriteEffects();

    return useMutation({
        mutationFn: (request: KitchenOrderTransitionRequest) =>
            repositories.kitchenOrders.startOrder(request),
        onSuccess: onWritten,
    });
}

/** "Ready" on the kitchen display: stamps `readyAt`, the order stays confirmed until handed over. */
export function useMarkOrderReadyMutation(): UseMutationResult<
    KitchenOrder,
    unknown,
    KitchenOrderTransitionRequest
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOrderWriteEffects();

    return useMutation({
        mutationFn: (request: KitchenOrderTransitionRequest) =>
            repositories.kitchenOrders.markOrderReady(request),
        onSuccess: onWritten,
    });
}

/** `placed → confirmed`. Sends the `lockVersion` the caller read as `If-Match`. */
export function useConfirmOrderMutation(): UseMutationResult<
    KitchenOrder,
    unknown,
    KitchenOrderTransitionRequest
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOrderWriteEffects();

    return useMutation({
        mutationFn: (request: KitchenOrderTransitionRequest) =>
            repositories.kitchenOrders.confirmOrder(request),
        onSuccess: onWritten,
    });
}

/** `confirmed → fulfilled`, terminal. */
export function useFulfilOrderMutation(): UseMutationResult<
    KitchenOrder,
    unknown,
    KitchenOrderTransitionRequest
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOrderWriteEffects();

    return useMutation({
        mutationFn: (request: KitchenOrderTransitionRequest) =>
            repositories.kitchenOrders.fulfilOrder(request),
        onSuccess: onWritten,
    });
}

/**
 * From `placed` or `confirmed` only, terminal.
 *
 * `reason` is required and is one of four fixed values — there is no free-text note to collect, so
 * the confirm dialog behind this is a choice, not a form.
 */
/** A courier took the food. The desk's "Hand to courier". */
export function useHandToCourierMutation(): UseMutationResult<
    KitchenOrder,
    unknown,
    HandToCourierRequest
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOrderWriteEffects();

    return useMutation({
        mutationFn: (request: HandToCourierRequest) =>
            repositories.kitchenOrders.handToCourier(request),
        onSuccess: onWritten,
    });
}

/** A courier's run came back. */
export function useFailDeliveryMutation(): UseMutationResult<
    KitchenOrder,
    unknown,
    FailKitchenOrderDeliveryRequest
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOrderWriteEffects();

    return useMutation({
        mutationFn: (request: FailKitchenOrderDeliveryRequest) =>
            repositories.kitchenOrders.failDelivery(request),
        onSuccess: onWritten,
    });
}

/** Send a failed run out again. */
export function useRedeliverOrderMutation(): UseMutationResult<
    KitchenOrder,
    unknown,
    RedeliverKitchenOrderRequest
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOrderWriteEffects();

    return useMutation({
        mutationFn: (request: RedeliverKitchenOrderRequest) =>
            repositories.kitchenOrders.redeliverOrder(request),
        onSuccess: onWritten,
    });
}

/** Cancel a failed delivery with `delivery_failed`. */
export function useCloseFailedDeliveryMutation(): UseMutationResult<
    KitchenOrder,
    unknown,
    CloseFailedDeliveryRequest
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOrderWriteEffects();

    return useMutation({
        mutationFn: (request: CloseFailedDeliveryRequest) =>
            repositories.kitchenOrders.closeFailedDelivery(request),
        onSuccess: onWritten,
    });
}

export function useCancelOrderMutation(): UseMutationResult<
    KitchenOrder,
    unknown,
    CancelKitchenOrderRequest
> {
    const repositories = useRepositories();
    const onWritten = useKitchenOrderWriteEffects();

    return useMutation({
        mutationFn: (request: CancelKitchenOrderRequest) =>
            repositories.kitchenOrders.cancelOrder(request),
        onSuccess: onWritten,
    });
}

/**
 * Write down money that arrived against an order.
 *
 * ## Why this is here and not in `order-desk-hooks.ts`
 *
 * The person pressing it is a desk agent, and this is the fourth hook the desk queue's drawer
 * imports out of this module — `useKitchenOrderQuery`, `useConfirmOrderMutation` and
 * `useFulfilOrderMutation` are the other three. That is the settled shape: the desk owns the *queue*
 * and the order owns its own *writes*, because the writes carry the order's `lockVersion` and one
 * module has to be where a screen looks for it. `order-desk-repository.ts` states the rule at
 * length; this hook is the same rule one layer up.
 *
 * ## It does **not** go through {@link useKitchenOrderWriteEffects}, and that is the point
 *
 * The three lifecycle writes answer the fresh order and seed it into the detail entry, which is what
 * lets "Fulfil" fire straight after "Confirm". This one answers a **receipt** and a payment position
 * — no order at all — because recording a payment does not touch the order row and does not bump its
 * version. So there is nothing to seed, and seeding is not merely unnecessary: the version the caller
 * sent is still current, and a screen that re-read to discover that would be spending a round trip to
 * learn nothing had changed.
 *
 * Both roots are still invalidated, and for the reason they always are here. The queue row carries
 * `payment.receivedMinor` and `payment.receipted`, which this write has just changed and which the
 * order book's own detail read does not serve at all — so the desk's row is the *only* place the
 * result becomes visible, and it is the one that must be refetched. `kitchenOrders` is named beside
 * it because the same order's list rows are a legitimate audience for "this is settled now" the day a
 * payment column reaches them, and because an invalidation nothing is subscribed to costs nothing.
 *
 * **No retry.** A `409` is either a stale precondition — answered by re-reading, which is the
 * screen's decision — or a cancelled order, which no amount of retrying makes payable. A silent
 * retry would also risk a second receipt against a fresh idempotency key, which is money written down
 * twice.
 */
export function useOrderRefundsQuery(orderId: OrderId): UseQueryResult<OrderRefundLedger> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenOrders.refunds(orderId),
        enabled: repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenOrders.getRefunds(orderId);
        },
    });
}

/** No retry: a silent second attempt would be a second refund under a fresh idempotency key. */
export function useRecordOrderRefundMutation(): UseMutationResult<
    OrderRefundLedger,
    unknown,
    RecordOrderRefundRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        retry: false,
        mutationFn: (request: RecordOrderRefundRequest) =>
            repositories.kitchenOrders.recordRefund(request),
        onSuccess: (ledger, request) => {
            queryClient.setQueryData(queryKeys.kitchenOrders.refunds(request.orderId), ledger);
            // A correction moves the desk row's received figure.
            void queryClient.invalidateQueries({ queryKey: queryKeys.orderDesk.all() });
        },
    });
}

export function useDecideOrderRefundMutation(): UseMutationResult<
    OrderRefundLedger,
    unknown,
    DecideOrderRefundRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        retry: false,
        mutationFn: (request: DecideOrderRefundRequest) =>
            repositories.kitchenOrders.decideRefund(request),
        onSuccess: (ledger, request) => {
            queryClient.setQueryData(queryKeys.kitchenOrders.refunds(request.orderId), ledger);
            void queryClient.invalidateQueries({ queryKey: queryKeys.orderDesk.all() });
        },
    });
}

export function useRecordOrderPaymentMutation(): UseMutationResult<
    RecordedKitchenOrderPayment,
    unknown,
    RecordKitchenOrderPaymentRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        retry: false,
        mutationFn: (request: RecordKitchenOrderPaymentRequest) =>
            repositories.kitchenOrders.recordPayment(request),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.orderDesk.all() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenOrders.all() });
        },
    });
}

/* ------------------------------------------------------------------------------------------------
 * Complaints
 * ---------------------------------------------------------------------------------------------- */

export function useOrderComplaintsQuery(): UseQueryResult<readonly OrderComplaint[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.kitchenOrders.complaints(),
        enabled: repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.kitchenOrders.listComplaints();
        },
    });
}

export function useRecordComplaintMutation(): UseMutationResult<
    OrderComplaint,
    unknown,
    RecordComplaintRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        retry: false,
        mutationFn: (request) => repositories.kitchenOrders.recordComplaint(request),
        onSuccess: () => {
            void queryClient.invalidateQueries({
                queryKey: queryKeys.kitchenOrders.complaints(),
            });
        },
    });
}

export function useUpdateComplaintMutation(): UseMutationResult<
    OrderComplaint,
    unknown,
    UpdateComplaintRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        retry: false,
        mutationFn: (request) => repositories.kitchenOrders.updateComplaint(request),
        onSuccess: () => {
            void queryClient.invalidateQueries({
                queryKey: queryKeys.kitchenOrders.complaints(),
            });
        },
    });
}

/** No retry: a silent second attempt is refused, but only after somebody read the error. */
export function useRemakeComplaintMutation(): UseMutationResult<OrderComplaint, unknown, string> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        retry: false,
        mutationFn: (complaintId) => repositories.kitchenOrders.remakeComplaint(complaintId),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenOrders.all() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.orderDesk.all() });
        },
    });
}
