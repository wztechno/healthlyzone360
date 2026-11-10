import type { ApiFailure } from '@healthy360/api-client';
import type {
    KitchenOrderFilters,
    OrderDeskDeliveryWindow,
    OrderDeskQueueFilters,
} from '@healthy360/api-client/contracts';
import { useMemo } from 'react';

import { toFailure } from '../../../data/hooks.ts';
import {
    useKitchenOrdersQuery,
    useKitchenOrdersWholeQuery,
} from '../../../data/kitchen-orders-hooks.ts';
import {
    useOrderDeskDeliveryWindowsQuery,
    useOrderDeskQueueQuery,
} from '../../../data/order-desk-hooks.ts';
import { useOnlineStatus } from '../../../online/online-status.tsx';
import { addDays } from '../../planner/format.ts';
import { windowCodesOfMeal } from '../order-desk-calendar.ts';
import { datesSpan, isToCollect, needsDriver } from './order-book.ts';
import type { BookRow, DatesFilter, KindFilter, SlotFilter, StatusFilter } from './order-book.ts';

/**
 * The reads behind the Orders page.
 *
 * - **The order book** (`/catalogue/orders`) serves every order, every status, each row carrying
 *   what has been paid, its run and — for a reader allowed to see it — the customer. It narrows by
 *   the calendar's day (`from`/`to`), by slot and by delivery or pickup, so a day's list and the
 *   calendar's count for that day agree.
 * - **The desk queue** (`/order-desk/queue`) answers what only it can: the late orders across every
 *   day (its past-due lens, with the server's count) and the open orders of a span.
 *
 * Polled on the desk's fifteen seconds, and not at all offline.
 */

export const ORDERS_POLL_MS = 15_000;

/** The figures that look further back poll slower: they move when somebody acts, not by the clock. */
const FIGURE_POLL_MS = 60_000;

/** The most the book answers in one read. */
const BOOK_PAGE_LIMIT = 100;

/** How far back "Needs a driver" looks for a confirmed delivery nobody was given. */
const DRIVER_LOOKBACK_DAYS = 30;

export interface BookRead {
    readonly rows: readonly BookRow[];
    readonly pending: boolean;
    readonly fetching: boolean;
    readonly failure: ApiFailure | null;
    /** More matched than were read. */
    readonly truncated: boolean;
    readonly refetch: () => void;
}

function usePoll(interval: number = ORDERS_POLL_MS): number | false {
    const { online } = useOnlineStatus();
    return online ? interval : false;
}

/** The kitchen's slots, for names and hours. Empty while they load. */
export function useDeliveryWindows(enabled = true): readonly OrderDeskDeliveryWindow[] {
    const windows = useOrderDeskDeliveryWindowsQuery(enabled);
    return useMemo(() => windows.data ?? [], [windows.data]);
}

/** The book's narrowing for a slot and a kind — the server does it, so pages stay whole. */
export function bookNarrowing(
    slot: SlotFilter,
    kind: KindFilter,
): Pick<KitchenOrderFilters, 'deliveryWindowCodes' | 'fulfilmentType'> {
    return {
        ...(slot === 'all' ? {} : { deliveryWindowCodes: windowCodesOfMeal(slot) }),
        ...(kind === 'all' ? {} : { fulfilmentType: kind }),
    };
}

/** Every order whose day falls in a span, every status, read whole. */
export function useOrdersBetween(from: string, to: string, enabled = true, maxPages = 5): BookRead {
    const filters = useMemo<KitchenOrderFilters>(
        () => ({ from, to, limit: BOOK_PAGE_LIMIT }),
        [from, to],
    );
    const book = useKitchenOrdersWholeQuery(filters, enabled, usePoll(), maxPages);
    return {
        rows: book.data?.items ?? [],
        pending: book.isPending,
        fetching: book.isFetching,
        failure: toFailure(book.error),
        truncated: book.data?.truncated === true,
        refetch: () => {
            void book.refetch();
        },
    };
}

/** Every order on one day. */
export function useDayOrders(day: string, enabled = true): BookRead {
    return useOrdersBetween(day, day, enabled);
}

/** Every open order between two days, inclusive — the calendar's to-confirm and late marks. */
export function useOpenOrdersBetween(from: string, to: string, enabled = true): BookRead {
    const filters = useMemo<OrderDeskQueueFilters>(
        () => ({ window: 'range', from, to }),
        [from, to],
    );
    const queue = useOrderDeskQueueQuery(filters, enabled, { refetchInterval: usePoll() });
    return {
        rows: queue.data?.rows ?? [],
        pending: queue.isPending,
        fetching: queue.isFetching,
        failure: toFailure(queue.error),
        truncated: queue.data?.meta.truncated === true,
        refetch: () => {
            void queue.refetch();
        },
    };
}

export interface LateRead extends BookRead {
    /** The server's count of late orders across every day, or `null` before it answers. */
    readonly count: number | null;
}

/** Every open order past the time it was due, whatever its day — the desk's past-due lens. */
export function useLateOrders(enabled = true): LateRead {
    const filters = useMemo<OrderDeskQueueFilters>(() => ({ lens: 'past_due' }), []);
    const queue = useOrderDeskQueueQuery(filters, enabled, { refetchInterval: usePoll() });
    return {
        rows: queue.data?.rows ?? [],
        count: queue.data?.meta.pastDueCount ?? null,
        pending: queue.isPending,
        fetching: queue.isFetching,
        failure: toFailure(queue.error),
        truncated: queue.data?.meta.truncated === true,
        refetch: () => {
            void queue.refetch();
        },
    };
}

/** Every order still waiting to be confirmed, whatever its day. */
export function useToConfirmOrders(enabled = true): BookRead {
    const filters = useMemo<KitchenOrderFilters>(
        () => ({ status: 'placed', limit: BOOK_PAGE_LIMIT }),
        [],
    );
    const book = useKitchenOrdersWholeQuery(filters, enabled, usePoll());
    return {
        rows: book.data?.items ?? [],
        pending: book.isPending,
        fetching: book.isFetching,
        failure: toFailure(book.error),
        truncated: book.data?.truncated === true,
        refetch: () => {
            void book.refetch();
        },
    };
}

/** Confirmed deliveries nobody has been given, up to tomorrow. */
export function useNeedsDriverOrders(today: string, enabled = true): BookRead {
    const filters = useMemo<OrderDeskQueueFilters>(
        () => ({
            window: 'range',
            from: addDays(today, -DRIVER_LOOKBACK_DAYS),
            to: addDays(today, 1),
            statuses: ['confirmed'],
            fulfilmentType: 'delivery',
        }),
        [today],
    );
    const queue = useOrderDeskQueueQuery(filters, enabled, { refetchInterval: usePoll() });
    const rows = useMemo(() => (queue.data?.rows ?? []).filter(needsDriver), [queue.data]);
    return {
        rows,
        pending: queue.isPending,
        fetching: queue.isFetching,
        failure: toFailure(queue.error),
        truncated: queue.data?.meta.truncated === true,
        refetch: () => {
            void queue.refetch();
        },
    };
}

/**
 * Every order on a day up to today that is not cancelled and still owes money — open or closed,
 * however old, the rule the row's "To collect" is drawn by. Read whole, up to the book's page cap.
 */
export function useToCollectOrders(today: string, enabled = true): BookRead {
    const filters = useMemo<KitchenOrderFilters>(
        () => ({
            to: today,
            limit: BOOK_PAGE_LIMIT,
        }),
        [today],
    );
    const book = useKitchenOrdersWholeQuery(filters, enabled, usePoll(FIGURE_POLL_MS));
    const rows = useMemo(() => (book.data?.items ?? []).filter(isToCollect), [book.data]);
    return {
        rows,
        pending: book.isPending,
        fetching: book.isFetching,
        failure: toFailure(book.error),
        truncated: book.data?.truncated === true,
        refetch: () => {
            void book.refetch();
        },
    };
}

export interface BookPageRead extends BookRead {
    readonly totalCount: number | null;
    readonly totalPages: number;
}

/** One numbered page of the whole book, newest first, narrowed on the server. */
export function useBookPage(
    {
        dates,
        status,
        slot,
        kind,
        query,
        today,
        page,
        perPage,
    }: {
        readonly dates: DatesFilter;
        readonly status: StatusFilter;
        readonly slot: SlotFilter;
        readonly kind: KindFilter;
        readonly query: string;
        readonly today: string;
        readonly page: number;
        readonly perPage: number;
    },
    enabled = true,
): BookPageRead {
    const trimmed = query.trim();
    const filters = useMemo<KitchenOrderFilters>(() => {
        const span = datesSpan(dates, today);
        return {
            ...(span === null ? {} : { from: span.from, to: span.to }),
            ...(status === 'all' ? {} : { status }),
            ...bookNarrowing(slot, kind),
            ...(trimmed === '' ? {} : { query: trimmed }),
            page,
            limit: perPage,
        };
    }, [dates, today, status, slot, kind, trimmed, page, perPage]);
    const book = useKitchenOrdersQuery(filters, enabled, usePoll());
    return {
        rows: book.data?.items ?? [],
        totalCount: book.data?.totalCount ?? null,
        totalPages: Math.max(1, book.data?.totalPages ?? 1),
        pending: book.isPending,
        fetching: book.isFetching,
        failure: toFailure(book.error),
        truncated: false,
        refetch: () => {
            void book.refetch();
        },
    };
}
