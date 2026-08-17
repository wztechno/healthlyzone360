import type {
    AddOrderDeskCustomerAddressRequest,
    AssignDeliveryJobRequest,
    AssignedDeliveryJob,
    CreateOrderDeskCustomerRequest,
    KitchenOrder,
    OrderDeskCalendar,
    OrderDeskCalendarFilters,
    OrderDeskCashReport,
    OrderDeskCashReportFilters,
    OrderDeskCustomerAddress,
    OrderDeskCustomerCreated,
    OrderDeskCustomerSearch,
    OrderDeskDrivers,
    OrderDeskQueue,
    OrderDeskQueueFilters,
    OrderDeskQuote,
    OrderDeskRequirements,
    OrderDeskRequirementsFilters,
    OrderDeskSaleRequest,
    OrderDeskShortfallCount,
    PlaceOrderDeskSaleRequest,
} from '@healthy360/api-client/contracts';
import type { BranchId } from '@healthy360/domain-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

/**
 * The Order Desk's data access — the queue and the cadence that keeps it live, the week beside it,
 * and the writes that work them both.
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
 * The week, and the people who can carry it
 * ---------------------------------------------------------------------------------------------- */

/**
 * The same orders counted by date, three ways.
 *
 * A plain query with **no poll at all**, and the contrast with the queue above is the whole point.
 * The queue is a live work surface measured in minutes; a calendar is read to plan a week, and two
 * of its three bases are subscription arithmetic that does not move between one glance and the
 * next. A fifteen-second interval here would be a request every fifteen seconds for an answer that
 * changes when somebody places an order — which invalidation already handles.
 *
 * `filters` is passed to the key as one object (query-key shape rule 3), so a memoised filter is
 * the identity that decides whether this is the same week. `null` disables the read, which is how a
 * screen that has not resolved its week yet asks for nothing rather than asking for the calendar of
 * an undefined range.
 */
export function useOrderDeskCalendarQuery(
    filters: OrderDeskCalendarFilters | null,
    enabled = true,
): UseQueryResult<OrderDeskCalendar> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.orderDesk.calendar(filters ?? undefined),
        enabled: enabled && filters !== null && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (filters === null) throw new Error('There is no week to read.');
            return repositories.orderDesk.listCalendar(filters);
        },
    });
}

/**
 * How long a buy list stays fresh.
 *
 * A minute. Longer than the queue's fifteen-second poll and much shorter than the driver
 * directory's five minutes, because what moves it is somebody receiving a delivery or wasting a
 * tray — human-scale events that happen while a buyer is reading, but not every few seconds. It is
 * a `staleTime` rather than a `refetchInterval` on purpose: a table of thirty ingredients redrawing
 * under somebody's finger while they read down it is worse than a number a minute old.
 */
export const REQUIREMENTS_STALE_MS = 60_000;

/**
 * What one branch must buy for a window.
 *
 * `filters` carries a **required** branch, and `null` is how a screen says it has none yet — which
 * is the state the requirements screen sits in until somebody picks one, and the reason this hook
 * can be mounted before the question is answerable. Disabled rather than defaulted: a buy list for
 * a guessed branch is a buy list for the wrong shelf, and it would look exactly like a right one.
 */
export function useOrderDeskRequirementsQuery(
    filters: OrderDeskRequirementsFilters | null,
    enabled = true,
): UseQueryResult<OrderDeskRequirements> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.orderDesk.requirements(filters ?? undefined),
        enabled: enabled && filters !== null && repositories !== null,
        staleTime: REQUIREMENTS_STALE_MS,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (filters === null) throw new Error('There is no branch to buy for.');
            return repositories.orderDesk.listRequirements(filters);
        },
    });
}

/**
 * How many ingredients the next seven days are short of — the hub badge.
 *
 * **Asked even when there is no branch**, which is the difference between this and the list beside
 * it. The endpoint answers `count: null` rather than refusing, and a badge that skipped the request
 * would have to invent the same null anyway — this way the hub renders one code path whether or not
 * somebody has chosen a shelf, and the "nothing to show" is the server's answer rather than the
 * screen's assumption.
 *
 * Shares the list's stale window: the two numbers come from the same arithmetic, and a badge that
 * disagreed with the table underneath it would send somebody looking for a bug.
 */
export function useOrderDeskShortfallCountQuery(
    branchId: BranchId | null,
    enabled = true,
): UseQueryResult<OrderDeskShortfallCount> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.orderDesk.shortfallCount(branchId),
        enabled: enabled && repositories !== null,
        staleTime: REQUIREMENTS_STALE_MS,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.orderDesk.countRequirementShortfalls(branchId ?? undefined);
        },
    });
}

/**
 * How long a driver listing stays fresh.
 *
 * Five minutes, which is short next to how often a kitchen's membership changes and long next to
 * how often somebody opens the picker. The number exists so that assigning four runs in a row is
 * one request rather than four: the dialog mounts its query on open, and without a stale window
 * every open would refetch a list that could not have changed in the thirty seconds since the last
 * one. Exported because the assign dialog's own test asserts the second open does not re-read.
 */
export const DRIVERS_STALE_MS = 5 * 60_000;

/**
 * The people a run can be given to.
 *
 * **Fetched when a picker opens, not kept warm.** `enabled` is the dialog's own open state, which
 * is what keeps a directory of the organisation's members off a queue screen that is polling every
 * fifteen seconds and may never assign anything. The answer is bounded and unpaged, so the whole
 * list arrives at once and the search over it is the screen's, client-side.
 */
/**
 * One day's takings, by agent and by method — the till-shift mitigation.
 *
 * **No poll and no stale window at all**, unlike every other read on this surface, and the contrast
 * is deliberate. The queue is a live work surface measured in minutes; the buy list is a number that
 * moves when somebody receives a delivery. This is a *reconciliation* — somebody stands a cash box
 * next to it and counts — and a table that renewed itself under that person's finger would move the
 * figures they were halfway through checking. It refetches when the screen asks and when a payment
 * is recorded, which is every occasion on which it could have changed.
 *
 * `filters` is passed to the key as one object (query-key shape rule 3), so a memoised filter is the
 * identity that decides whether this is the same day. `null` disables the read, which is how a screen
 * whose date box is mid-edit asks for nothing rather than asking for the takings of a half-typed
 * date.
 */
export function useOrderDeskCashReportQuery(
    filters: OrderDeskCashReportFilters | null,
    enabled = true,
): UseQueryResult<OrderDeskCashReport> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.orderDesk.cashReport(filters ?? undefined),
        enabled: enabled && filters !== null && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (filters === null) throw new Error('There is no day to report.');
            return repositories.orderDesk.getCashReport(filters);
        },
    });
}

export function useOrderDeskDriversQuery(enabled = true): UseQueryResult<OrderDeskDrivers> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.orderDesk.drivers(),
        enabled: enabled && repositories !== null,
        staleTime: DRIVERS_STALE_MS,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.orderDesk.listDrivers();
        },
    });
}

/**
 * Give a run to a driver.
 *
 * **Only the desk root is invalidated, and only it should be.** The job lives on the queue's own
 * row and nowhere else: the order detail endpoint does not serve a delivery job at all, so evicting
 * `kitchenOrders` would refetch an order whose answer this write cannot have changed. That is the
 * mirror image of {@link usePlaceOrderDeskSaleMutation}, which names both roots because a sale
 * writes a row both of them list — and the two hooks disagreeing on purpose is what makes the
 * separation of the roots a decision rather than an accident.
 *
 * There is **no retry**, and here the reason is sharper than usual. A `409` is either a lost race —
 * somebody else took the run, and retrying would resolve it in favour of whoever clicked last — or
 * a job that has already finished, which no amount of retrying makes assignable. Both are answered
 * by the screen, and neither by the client.
 */
export function useAssignDeliveryJobMutation(): UseMutationResult<
    AssignedDeliveryJob,
    unknown,
    AssignDeliveryJobRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        retry: false,
        mutationFn: (request: AssignDeliveryJobRequest) =>
            repositories.orderDesk.assignDeliveryJob(request),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.orderDesk.all() });
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
