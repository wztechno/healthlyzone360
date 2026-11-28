import {
    KITCHEN_ORDER_FULFILMENT_TYPES,
    KITCHEN_ORDER_STATUSES,
} from '@healthy360/api-client/contracts';
import type { KitchenOrder } from '@healthy360/api-client/contracts';

import { pathnameOf, queryOf } from '../../../navigation/return-to.ts';
import { isPlannerDate } from '../../planner/format.ts';
import { CALENDAR_MEALS } from '../order-desk-calendar.ts';
import type { CalendarMeal } from '../order-desk-calendar.ts';
import { DATES_FILTERS, QUICK_FILTERS, monthOf, orderDay } from './order-book.ts';
import type {
    DatesFilter,
    KindFilter,
    QuickFilter,
    SlotFilter,
    StatusFilter,
} from './order-book.ts';

/**
 * The Orders page's state, as an address.
 *
 * Every choice on the page — the tab, the day, the filters, the open order — lives in the URL, so
 * a detour (New order, Edit order, an order's ticket) comes back to exactly the view it left, and a
 * refresh or a shared link opens the same thing. The page writes it with `router.setParams`, which
 * replaces the entry: moving around the page never fills Back with its own states.
 *
 * Defaults are left out of the address, so `/kitchen/orders` is Today on today. One legacy address
 * keeps its meaning: `/kitchen/orders?view=<id>` — the old order book's link to one order, used by
 * Activity, Complaints, a customer's page and the staff alerts — opens All orders with that order.
 */

export const ORDERS_HREF = '/kitchen/orders';

export const ORDERS_TABS = ['today', 'calendar', 'all'] as const;
export type OrdersTab = (typeof ORDERS_TABS)[number];

export const CALENDAR_MODES = ['month', 'week', 'day'] as const;
export type CalendarMode = (typeof CALENDAR_MODES)[number];

export interface OrdersQuery {
    readonly tab: OrdersTab;
    /** Today's day stepper. `null` is today. */
    readonly day: string | null;
    /** The calendar's month, `YYYY-MM`. `null` is the selected day's (or today's) month. */
    readonly month: string | null;
    readonly mode: CalendarMode;
    /** The calendar's chosen day. `null` is today. */
    readonly sel: string | null;
    readonly slot: SlotFilter;
    readonly kind: KindFilter;
    readonly q: string;
    readonly dates: DatesFilter;
    readonly status: StatusFilter;
    readonly quick: QuickFilter | null;
    /** The open order. */
    readonly view: string | null;
    /** The order to light up — the one just placed or saved. */
    readonly hl: string | null;
}

export const DEFAULT_ORDERS_QUERY: OrdersQuery = {
    tab: 'today',
    day: null,
    month: null,
    mode: 'month',
    sel: null,
    slot: 'all',
    kind: 'all',
    q: '',
    dates: 'all',
    status: 'all',
    quick: null,
    view: null,
    hl: null,
};

/** The names the page's params go by, for `router.setParams`. */
export const ORDERS_PARAMS = [
    'tab',
    'day',
    'month',
    'mode',
    'sel',
    'slot',
    'kind',
    'q',
    'dates',
    'status',
    'quick',
    'view',
    'hl',
] as const satisfies readonly (keyof OrdersQuery)[];

type RawParams = Readonly<Record<string, string | readonly string[] | undefined>>;

function first(raw: string | readonly string[] | undefined): string | undefined {
    return typeof raw === 'string' ? raw : raw?.[0];
}

function oneOf<T extends string>(values: readonly T[], raw: string | undefined, fallback: T): T {
    return values.find((value) => value === raw) ?? fallback;
}

function isMonth(value: string | undefined): value is string {
    return value !== undefined && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** The page's state, read from its params. Anything malformed falls back to its default. */
export function readOrdersQuery(params: RawParams): OrdersQuery {
    const view = first(params.view);
    const tabParam = first(params.tab);
    const day = first(params.day);
    const sel = first(params.sel);
    const month = first(params.month);
    const quick = first(params.quick);
    const hl = first(params.hl);
    const viewId = view === undefined || view === '' ? null : view;
    return {
        // `?view=` alone is the old order book's link: All orders, with the order open.
        tab: oneOf(ORDERS_TABS, tabParam, viewId === null ? 'today' : 'all'),
        day: isPlannerDate(day) ? day : null,
        month: isMonth(month) ? month : null,
        mode: oneOf(CALENDAR_MODES, first(params.mode), 'month'),
        sel: isPlannerDate(sel) ? sel : null,
        slot: oneOf<SlotFilter>(['all', ...CALENDAR_MEALS], first(params.slot), 'all'),
        kind: oneOf<KindFilter>(
            ['all', ...KITCHEN_ORDER_FULFILMENT_TYPES],
            first(params.kind),
            'all',
        ),
        q: first(params.q) ?? '',
        dates: oneOf(DATES_FILTERS, first(params.dates), 'all'),
        status: oneOf<StatusFilter>(
            ['all', ...KITCHEN_ORDER_STATUSES],
            first(params.status),
            'all',
        ),
        quick: QUICK_FILTERS.find((value) => value === quick) ?? null,
        view: viewId,
        hl: hl === undefined || hl === '' ? null : hl,
    };
}

/**
 * Params for `router.setParams`: every key of the page, each set to its value or `undefined` when it
 * is the default — which is what takes a param off the address.
 */
export function ordersParams(query: OrdersQuery): Record<string, string | undefined> {
    const params: Record<string, string | undefined> = {};
    for (const key of ORDERS_PARAMS) {
        const value = query[key];
        // The tab is always written: `?view=` with no tab would read as All orders.
        params[key] =
            key !== 'tab' && (value === DEFAULT_ORDERS_QUERY[key] || value === '')
                ? undefined
                : (value ?? undefined);
    }
    return params;
}

/** The page's address for a state, with the defaults left out. */
export function ordersHref(query: Partial<OrdersQuery>): string {
    const params = ordersParams({ ...DEFAULT_ORDERS_QUERY, ...query });
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) search.set(key, value);
    }
    const encoded = search.toString();
    return encoded === '' ? ORDERS_HREF : `${ORDERS_HREF}?${encoded}`;
}

/** The meal names a slot filter offers, in the order a day runs. */
export const SLOT_MEALS: readonly CalendarMeal[] = CALENDAR_MEALS;

/**
 * Where a placed or saved order lands: its own day, in the view the sale page was opened from,
 * lit up — with the filters cleared, so a filter cannot hide the order just made. A detour from
 * anywhere else goes back there as it was.
 */
export function landingHref(
    returnTo: string | null,
    order: Pick<KitchenOrder, 'id' | 'delivery' | 'placedAt'>,
    today: string,
): string {
    const day = orderDay(order);
    const hl = String(order.id);
    const fromOrders = returnTo !== null && pathnameOf(returnTo) === ORDERS_HREF;
    if (returnTo !== null && !fromOrders) return returnTo;
    const from = returnTo === null ? DEFAULT_ORDERS_QUERY : readOrdersQuery(queryOf(returnTo));
    const cleared: OrdersQuery = {
        ...from,
        slot: 'all',
        kind: 'all',
        q: '',
        quick: null,
        status: 'all',
        dates: 'all',
        view: null,
        hl,
    };
    if (from.tab === 'calendar') return ordersHref({ ...cleared, sel: day, month: monthOf(day) });
    if (from.tab === 'all') return ordersHref(cleared);
    return ordersHref({ ...cleared, tab: 'today', day: day === today ? null : day });
}
