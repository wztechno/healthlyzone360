import type { BranchId, IsoDateTime } from '@healthy360/domain-types';

import type { KitchenOrder, KitchenOrderStatus } from './kitchen-orders.ts';

/**
 * The Order Desk's queue — the open order book in the order somebody at a desk has to work it.
 *
 * ## Why this is not a filter on `KitchenOrdersRepository.listOrders`
 *
 * The order book is a *book*: every order, newest first, walked with a cursor, and the question it
 * answers is "what did we take last Tuesday?" or "where is H360-…?". This is the *queue*, and the
 * question is "what is next?" — which is a different sort, and on this wire it is a computed one:
 * `due_at` is derived in SQL from the requested day, the delivery window's opening time and the
 * branch's timezone. `CursorPage` re-sorts whatever it constrains (`pagination.ts`), so a cursor and
 * this ordering cannot both be true of one query. The endpoint is therefore **bounded rather than
 * paged** — two hundred rows, with {@link OrderDeskQueueMeta.truncated} when more matched — and this
 * contract carries no cursor for the same reason `KitchenQuotationsRepository.listQuotations`
 * carries none: a `nextCursor: null` field would promise paging that cannot exist here.
 *
 * ## The row is the kitchen's order, plus what the desk needs and the kitchen did not
 *
 * {@link OrderDeskQueueRow} extends {@link KitchenOrder} rather than restating it, because it *is*
 * that order — the same identifier, the same lines, the same `lockVersion` the lifecycle writes
 * send. Three things are added, and each one is a fact the order book has no column for.
 *
 * ## `dueAt` is never null, and that is the whole point of the endpoint
 *
 * An order with no requested day is not scheduled for nothing; it is scheduled for as soon as
 * possible. The server falls through the end of the requested day when the window has no hours,
 * through UTC when no branch was named, and through `placedAt` when the customer named no day at
 * all — so every row sorts, and nothing lands in a silent "unknown" bucket at the bottom. A client
 * must never re-derive it from `delivery.requestedDate`: it would not have the branch's clock.
 *
 * ## `payment` and `deliveryJob` are declared now and always null in this phase
 *
 * They are the seats a payment receipt and a delivery job take once the desk can take money and
 * confirming a delivery order creates a run. Declared here rather than added later so the row does
 * not change shape under a screen: a client written today branches on `payment === null` and reads a
 * receipt tomorrow, where one written against an absent key would have to change twice. Their
 * contents are deliberately untyped (`Record<string, unknown>`) — the wire declares them the same
 * way, and inventing a shape for a block nothing has ever populated would be a promise this
 * contract cannot keep.
 *
 * ## `customer` is optional, and its optionality is the disclosure boundary
 *
 * The block is present **only when the caller holds `order.view_customer_contact_organisation`**,
 * and *absent* — not null — without it. That difference is load-bearing: `displayName: null` is a
 * fact about the customer ("this account has been anonymised"), and a screen could not tell that
 * apart from a fact about the reader ("you may not see names") unless the two cases differed in
 * shape. So the field is `?:` here rather than `| null`, and a screen renders an em dash for both —
 * see the queue screen, which must not look broken to a reader who simply is not permitted.
 *
 * That is the whole of the disclosure: a name and a number. No email, no address beyond the delivery
 * snapshot the order book already serves, no allergen declaration, no account identifier to pivot
 * on, and no order history.
 */

/**
 * Which slice of the open book the desk is looking at.
 *
 * Three questions somebody at a desk actually asks, rather than a date range that could express a
 * hundred nobody does. `today` **also carries every order with no requested date at all** — an order
 * whose customer named no day is scheduled for as soon as possible, and a plain range would drop
 * exactly the set nobody has committed to a day yet. `overdue` does not inherit that rule: a
 * dateless order is never late, because there is no day it has missed. `next_7` runs from today to
 * seven days after it, inclusive at both ends.
 */
export const ORDER_DESK_WINDOWS = ['today', 'overdue', 'next_7'] as const;
export type OrderDeskWindow = (typeof ORDER_DESK_WINDOWS)[number];

/**
 * The two statuses the queue lists, as its own union rather than as `KitchenOrderStatus`.
 *
 * `fulfilled` and `cancelled` are not accepted by the endpoint at all — they are finished with, and
 * they are the order book's business. The `satisfies` keeps this narrowing honest: these two are
 * order statuses, and the day the order machine renames one, this line stops compiling.
 */
export const ORDER_DESK_QUEUE_STATUSES = [
    'placed',
    'confirmed',
] as const satisfies readonly KitchenOrderStatus[];
export type OrderDeskQueueStatus = (typeof ORDER_DESK_QUEUE_STATUSES)[number];

/**
 * The customer's name, and the number somebody can ring them on.
 *
 * Either field may be null on its own — an anonymised account has no name, and a customer who never
 * gave a number has no number. The number is served **verified or not**: a courier ringing about
 * tonight's delivery needs the number the customer gave, not one the platform has proved.
 */
export interface OrderDeskCustomerContact {
    readonly displayName: string | null;
    /** E.164, as the contact point stores it. */
    readonly phone: string | null;
}

/**
 * The receipt seat. **Always `null` in this phase** — see the file header for why it is declared
 * before anything fills it, and why its contents are not typed until they exist.
 */
export type OrderDeskPayment = Readonly<Record<string, unknown>>;

/** The delivery-run seat. **Always `null` in this phase**, on `OrderDeskPayment`'s terms. */
export type OrderDeskDeliveryJob = Readonly<Record<string, unknown>>;

export interface OrderDeskQueueRow extends KitchenOrder {
    /**
     * The instant this order is actually due, as a UTC timestamp, and **never null**. It is what the
     * queue is sorted by and what an ageing badge is measured against. Never re-derived on the
     * client: the fall-through chain runs on the branch's clock, which no screen holds.
     */
    readonly dueAt: IsoDateTime;
    readonly payment: OrderDeskPayment | null;
    readonly deliveryJob: OrderDeskDeliveryJob | null;
    /** Absent — not null — without `order.view_customer_contact_organisation`. See the header. */
    readonly customer?: OrderDeskCustomerContact | undefined;
}

/**
 * What the server measured the queue against, echoed because the client did not choose it and
 * cannot derive it.
 */
export interface OrderDeskQueueMeta {
    /** Rows in this response. */
    readonly count: number;
    /** The most rows this operation will ever return. There is no second page. */
    readonly limit: number;
    /**
     * More orders matched than were returned. A screen showing a truncated queue **has to say so**:
     * a silent truncation would hide exactly the backlog the queue exists to surface.
     */
    readonly truncated: boolean;
    readonly window: OrderDeskWindow;
    /** `YYYY-MM-DD` — the day the window was measured from. */
    readonly today: string;
    /** The IANA zone that day was computed in: the named branch's, or `UTC` when none was named. */
    readonly timezone: string;
}

/** One bounded queue read. Not a page — see the file header. */
export interface OrderDeskQueue {
    readonly rows: readonly OrderDeskQueueRow[];
    readonly meta: OrderDeskQueueMeta;
}

export interface OrderDeskQueueFilters {
    /** Defaults to `today` server-side when omitted, which is why this is not required here. */
    readonly window?: OrderDeskWindow | undefined;
    /**
     * Narrow to one production site — **and** name the clock `today` is read on. A branch is a
     * place and a place has a working day; unnamed, the day boundary is UTC.
     *
     * A query parameter rather than the `X-Branch-Id` header the stock surfaces use, and
     * deliberately: an organisation-wide desk agent selects no branch at all, so a header that had
     * to be present could not express the organisation-wide read this queue exists to serve.
     */
    readonly branchId?: BranchId | undefined;
    /** Omitted, both open statuses are listed. An empty array means the same thing. */
    readonly statuses?: readonly OrderDeskQueueStatus[] | undefined;
    /** One named delivery slot, by the window's own code. */
    readonly deliveryWindowCode?: string | undefined;
    /**
     * A partial order number, matched case-insensitively — **and nothing else**. Not a name, not a
     * phone number: the queue is reachable by people who may not read either, so a search that
     * matched them would leak the fields the permission gate exists to withhold.
     */
    readonly query?: string | undefined;
}

export interface OrderDeskRepository {
    /**
     * The open queue in due order, capped, with the day and clock it was measured against.
     *
     * Answers {@link OrderDeskQueue} rather than a bare array because `meta.truncated` is not
     * decoration — a screen that dropped it would show a capped list as if it were the whole one.
     */
    listQueue(filters?: OrderDeskQueueFilters): Promise<OrderDeskQueue>;
}
