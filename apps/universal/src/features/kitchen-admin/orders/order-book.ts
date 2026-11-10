import type {
    KitchenOrder,
    KitchenOrderFulfilmentType,
    KitchenOrderStatus,
    OrderDeskCustomerContact,
    OrderDeskDeliveryJob,
    OrderDeskDeliveryWindow,
    OrderDeskPaymentSummary,
} from '@healthy360/api-client/contracts';

import { addDays, mondayOf } from '../../planner/format.ts';
import { canAssignDeliveryJob } from '../ops-format.ts';
import { CALENDAR_MEALS, mealOfWindowCode, windowCodesOfMeal } from '../order-desk-calendar.ts';
import type { CalendarMeal } from '../order-desk-calendar.ts';

/**
 * The Orders page's rules (`/kitchen/orders`, Option A of the Orders redesign): which day an order
 * is on, which slot, whether it is late, what its next step is and what is still to collect.
 *
 * Pure and React-free, for the reason `order-desk-calendar.ts` gives: these are the parts that
 * never throw and quietly say something false when they are one day out.
 *
 * ## An order's day is the calendar's day
 *
 * The day the customer asked for, or — for an order with none, which is every counter sale — the
 * (UTC) day it was placed. That is `COALESCE(requested_delivery_date, placed_at::date)`, the rule
 * `CalendarComposition` counts by, so a day's list and the calendar's count for it agree.
 */

/**
 * One order as the page draws it: the order, plus the facts the desk's rows carry beside it. Each
 * extra is optional because not every read serves it — absent means *not known*, never zero.
 */
export type BookRow = KitchenOrder & {
    readonly payment?: OrderDeskPaymentSummary | undefined;
    /** `null`: the order has no run. Absent: the read did not say. */
    readonly deliveryJob?: OrderDeskDeliveryJob | null | undefined;
    /** Absent without the contact permission. */
    readonly customer?: OrderDeskCustomerContact | undefined;
};

/* ── the day ─────────────────────────────────────────────────────────────────────────────────── */

/** `YYYY-MM-DD` of an instant, on UTC — the calendar's own clock for a dateless order. */
function utcDay(instant: string): string {
    const parsed = Date.parse(instant);
    return Number.isNaN(parsed)
        ? instant.slice(0, 10)
        : new Date(parsed).toISOString().slice(0, 10);
}

/** The day an order is on: the one asked for, else the day it was placed. */
export function orderDay(order: Pick<KitchenOrder, 'delivery' | 'placedAt'>): string {
    return order.delivery.requestedDate ?? utcDay(order.placedAt);
}

/** Today on this device's clock — the kitchen's — as `YYYY-MM-DD`. */
export function localToday(now: Date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `YYYY-MM` of a day. */
export function monthOf(day: string): string {
    return day.slice(0, 7);
}

/** The first day of a month, `YYYY-MM-01`. */
export function firstOfMonth(month: string): string {
    return `${month}-01`;
}

/** The month `delta` months from `month`. */
export function shiftMonth(month: string, delta: number): string {
    const year = Number(month.slice(0, 4));
    const index = Number(month.slice(5, 7)) - 1 + delta;
    const shiftedYear = year + Math.floor(index / 12);
    const shiftedMonth = (((index % 12) + 12) % 12) + 1;
    return `${String(shiftedYear).padStart(4, '0')}-${String(shiftedMonth).padStart(2, '0')}`;
}

/** The last day of a month. */
export function lastOfMonth(month: string): string {
    return addDays(firstOfMonth(shiftMonth(month, 1)), -1);
}

/**
 * The days a month grid draws: whole weeks from the Monday on or before the 1st to the Sunday on or
 * after the last day — five or six rows of seven.
 */
export function monthGrid(month: string): readonly string[] {
    const start = mondayOf(firstOfMonth(month));
    const end = addDays(mondayOf(lastOfMonth(month)), 6);
    const days: string[] = [];
    for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
    return days;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
    return Math.round(
        (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
    );
}

/* ── the slot ────────────────────────────────────────────────────────────────────────────────── */

/** A slot filter: one of the four sittings, or all of them. */
export type SlotFilter = CalendarMeal | 'all';
export const SLOT_FILTERS: readonly SlotFilter[] = ['all', ...CALENDAR_MEALS];

/** The key a slot group is held under: a sitting, `code:<code>` for any other code, or `none`. */
export type SlotKey = string;

export const NO_SLOT_KEY: SlotKey = 'none';

export function slotKeyOf(order: Pick<KitchenOrder, 'delivery'>): SlotKey {
    const code = order.delivery.windowCode;
    if (code === null) return NO_SLOT_KEY;
    return mealOfWindowCode(code) ?? `code:${code}`;
}

/** The sittings in the order a day runs, then any other code, then the orders with no slot. */
export function compareSlotKeys(left: SlotKey, right: SlotKey): number {
    const rank = (key: SlotKey) => {
        const meal = CALENDAR_MEALS.indexOf(key as CalendarMeal);
        if (meal >= 0) return meal;
        return key === NO_SLOT_KEY ? CALENDAR_MEALS.length + 1 : CALENDAR_MEALS.length;
    };
    const byRank = rank(left) - rank(right);
    if (byRank !== 0) return byRank;
    return left < right ? -1 : left > right ? 1 : 0;
}

export function matchesSlot(order: Pick<KitchenOrder, 'delivery'>, slot: SlotFilter): boolean {
    if (slot === 'all') return true;
    return (
        order.delivery.windowCode !== null &&
        windowCodesOfMeal(slot).includes(order.delivery.windowCode)
    );
}

/** The window an order's slot is, when the kitchen still has it. */
export function windowOf(
    order: Pick<KitchenOrder, 'delivery'>,
    windows: readonly OrderDeskDeliveryWindow[],
): OrderDeskDeliveryWindow | null {
    const code = order.delivery.windowCode;
    return code === null ? null : (windows.find((window) => window.code === code) ?? null);
}

/** `"12:00"` from a `"12:00:00"` time, or `null`. */
export function shortTime(time: string | null): string | null {
    return time === null ? null : time.slice(0, 5);
}

/** A window's hours, `"12:00–14:00"`, or `null` when the kitchen gave it none. */
export function windowHours(window: OrderDeskDeliveryWindow | null): string | null {
    if (window === null) return null;
    const starts = shortTime(window.startsAt);
    const ends = shortTime(window.endsAt);
    if (starts === null) return null;
    return ends === null ? starts : `${starts}–${ends}`;
}

/* ── kind ────────────────────────────────────────────────────────────────────────────────────── */

export type KindFilter = KitchenOrderFulfilmentType | 'all';

export function matchesKind(
    order: Pick<KitchenOrder, 'fulfilmentType'>,
    kind: KindFilter,
): boolean {
    return kind === 'all' || order.fulfilmentType === kind;
}

/* ── open, late ──────────────────────────────────────────────────────────────────────────────── */

export function isOpenOrder(order: Pick<KitchenOrder, 'status'>): boolean {
    return order.status === 'placed' || order.status === 'confirmed';
}

/**
 * When the order is due, as epoch milliseconds: the server's `dueAt` where the read carried one,
 * else the start of its slot on its day, else the end of its day (the queue's own fall-through).
 * Read on this device's clock — the kitchen's — which is what a person at the desk means by "late".
 */
export function dueInstant(order: BookRow, windows: readonly OrderDeskDeliveryWindow[]): number {
    if (order.dueAt != null) {
        const parsed = Date.parse(order.dueAt);
        if (!Number.isNaN(parsed)) return parsed;
    }
    const day = orderDay(order);
    const starts = windowOf(order, windows)?.startsAt ?? '23:59:59';
    const [year, month, date] = day.split('-').map(Number);
    const [hours, minutes, seconds] = starts.split(':').map(Number);
    return new Date(
        year ?? 1970,
        (month ?? 1) - 1,
        date ?? 1,
        hours ?? 0,
        minutes ?? 0,
        seconds ?? 0,
    ).getTime();
}

/** Still open and past the time it was due. Never true of a delivered or cancelled order. */
export function isLateOrder(
    order: BookRow,
    now: Date,
    windows: readonly OrderDeskDeliveryWindow[],
): boolean {
    return isOpenOrder(order) && dueInstant(order, windows) < now.getTime();
}

/* ── money and the run ───────────────────────────────────────────────────────────────────────── */

/** What is still owed, or `null` when the read did not say what has arrived. */
export function owedMinor(order: BookRow): number | null {
    if (order.status === 'cancelled') return 0;
    if (order.payment === undefined) return null;
    return Math.max(0, order.totalMinor - order.payment.receivedMinor);
}

/** Delivered or picked up, and money still to come in. */
export function isToCollect(order: BookRow): boolean {
    return order.status === 'fulfilled' && (owedMinor(order) ?? 0) > 0;
}

/** A courier company has it: nobody on the kitchen's own sheet will be given it. */
export function withCourier(order: KitchenOrder): boolean {
    return (order.deliveryRun?.courierName ?? null) !== null;
}

/** A confirmed delivery whose run nobody has been given yet. */
export function needsDriver(order: BookRow): boolean {
    const job = order.deliveryJob;
    return (
        order.status === 'confirmed' &&
        order.fulfilmentType === 'delivery' &&
        job != null &&
        job.driverUserId === null &&
        canAssignDeliveryJob(job.status) &&
        !withCourier(order)
    );
}

/** Who carries it, as the row says it. */
export type DriverCell =
    | { readonly kind: 'pickup' }
    | { readonly kind: 'counter' }
    | { readonly kind: 'named'; readonly name: string }
    | { readonly kind: 'needed' }
    | { readonly kind: 'none' };

export function driverCell(order: BookRow, nameOf: (userId: string) => string | null): DriverCell {
    if (order.fulfilmentType === 'pickup') return { kind: 'pickup' };
    if (order.fulfilmentType === 'counter') return { kind: 'counter' };
    const run = order.deliveryRun ?? null;
    const named =
        run?.courierName ??
        run?.driverName ??
        (order.deliveryJob?.driverUserId == null ? null : nameOf(order.deliveryJob.driverUserId));
    if (named !== null && named !== undefined) return { kind: 'named', name: named };
    if (needsDriver(order)) return { kind: 'needed' };
    return { kind: 'none' };
}

/* ── the next step ───────────────────────────────────────────────────────────────────────────── */

export type NextStep = 'confirm' | 'driver' | 'deliver' | 'pickup' | 'payment';

/**
 * The one thing to do next, by the rules the order's own buttons follow: confirm a placed order;
 * give a delivery to a driver; close a delivery once it is cooked (the server refuses before then,
 * HA-29) and its run has not failed; hand a pickup over; take the money still owed on a closed one.
 */
export function nextStep(order: BookRow): NextStep | null {
    if (order.status === 'placed') return 'confirm';
    if (order.status === 'confirmed') {
        if (order.fulfilmentType !== 'delivery') return 'pickup';
        if (order.deliveryRun?.status === 'failed') return null;
        if (needsDriver(order)) return 'driver';
        return (order.readyAt ?? null) !== null ? 'deliver' : null;
    }
    if (isToCollect(order)) return 'payment';
    return null;
}

/* ── search, sort, group ─────────────────────────────────────────────────────────────────────── */

/** Order number, customer name, or three or more digits of the phone. */
export function matchesSearch(order: BookRow, query: string): boolean {
    const needle = query.trim().toLocaleLowerCase();
    if (needle === '') return true;
    if (order.orderNumber.toLocaleLowerCase().includes(needle)) return true;
    const name = order.customer?.displayName ?? null;
    if (name !== null && name.toLocaleLowerCase().includes(needle)) return true;
    const digits = needle.replace(/[^0-9]/g, '');
    const phone = order.customer?.phone ?? null;
    return digits.length >= 3 && phone !== null && phone.replace(/[^0-9]/g, '').includes(digits);
}

/** Earliest day first, then by slot; cancelled orders last within a slot. */
export function compareByDue(left: BookRow, right: BookRow): number {
    const byDay = orderDay(left).localeCompare(orderDay(right));
    if (byDay !== 0) return byDay;
    const bySlot = compareSlotKeys(slotKeyOf(left), slotKeyOf(right));
    if (bySlot !== 0) return bySlot;
    const cancelled = Number(left.status === 'cancelled') - Number(right.status === 'cancelled');
    if (cancelled !== 0) return cancelled;
    return left.placedAt.localeCompare(right.placedAt);
}

export interface SlotGroup<Row extends BookRow = BookRow> {
    readonly key: SlotKey;
    readonly rows: readonly Row[];
}

/** One day's orders, by slot in the order the day runs. */
export function groupBySlot<Row extends BookRow>(rows: readonly Row[]): readonly SlotGroup<Row>[] {
    const groups = new Map<SlotKey, Row[]>();
    for (const row of [...rows].sort(compareByDue)) {
        const key = slotKeyOf(row);
        const group = groups.get(key);
        if (group === undefined) groups.set(key, [row]);
        else group.push(row);
    }
    return [...groups.entries()]
        .sort(([left], [right]) => compareSlotKeys(left, right))
        .map(([key, grouped]) => ({ key, rows: grouped }));
}

/* ── what to cook ────────────────────────────────────────────────────────────────────────────── */

export interface CookLine {
    readonly key: string;
    readonly nameEn: string;
    readonly nameAr: string;
    readonly variantLabel: string | null;
    readonly quantity: number;
}

/**
 * Every dish the day's orders hold, added up — most first. Cancelled orders cook nothing, and a
 * subscription day's own plan line is the day at its price, not a dish, so it is left out; the
 * day's meals are lines of their own.
 */
export function cookList(orders: readonly KitchenOrder[]): readonly CookLine[] {
    const lines = new Map<string, { -readonly [K in keyof CookLine]: CookLine[K] }>();
    for (const order of orders) {
        if (order.status === 'cancelled') continue;
        const planLine = order.planDay?.planLineId ?? null;
        for (const line of order.lines) {
            if (line.id === planLine) continue;
            const key = `${line.catalogueItemId}:${line.catalogueItemVariantId ?? ''}`;
            const quantity = Number(line.quantity);
            const held = lines.get(key);
            if (held === undefined) {
                lines.set(key, {
                    key,
                    nameEn: line.nameEn,
                    nameAr: line.nameAr,
                    variantLabel: line.variantLabel,
                    quantity: Number.isFinite(quantity) ? quantity : 0,
                });
            } else if (Number.isFinite(quantity)) {
                held.quantity += quantity;
            }
        }
    }
    return [...lines.values()].sort(
        (left, right) => right.quantity - left.quantity || left.nameEn.localeCompare(right.nameEn),
    );
}

/* ── All orders' date ranges ─────────────────────────────────────────────────────────────────── */

export const DATES_FILTERS = ['all', 'week', 'next7', 'last7', 'month'] as const;
export type DatesFilter = (typeof DATES_FILTERS)[number];

export interface DaySpan {
    readonly from: string;
    readonly to: string;
}

/** The span a Dates choice covers, inclusive, or `null` for all of them. */
export function datesSpan(dates: DatesFilter, today: string): DaySpan | null {
    switch (dates) {
        case 'all':
            return null;
        case 'week': {
            const monday = mondayOf(today);
            return { from: monday, to: addDays(monday, 6) };
        }
        case 'next7':
            return { from: today, to: addDays(today, 6) };
        case 'last7':
            return { from: addDays(today, -6), to: today };
        case 'month':
            return { from: firstOfMonth(monthOf(today)), to: lastOfMonth(monthOf(today)) };
    }
}

export function inSpan(day: string, span: DaySpan | null): boolean {
    return span === null || (day >= span.from && day <= span.to);
}

/* ── the four figures ────────────────────────────────────────────────────────────────────────── */

export const QUICK_FILTERS = ['confirm', 'late', 'driver', 'collect'] as const;
export type QuickFilter = (typeof QUICK_FILTERS)[number];

/** Whether an order is one a figure counts. `late` needs the clock and the slots. */
export function matchesQuick(
    order: BookRow,
    quick: QuickFilter,
    now: Date,
    windows: readonly OrderDeskDeliveryWindow[],
): boolean {
    switch (quick) {
        case 'confirm':
            return order.status === 'placed';
        case 'late':
            return isLateOrder(order, now, windows);
        case 'driver':
            return needsDriver(order);
        case 'collect':
            return isToCollect(order);
    }
}

/** A status filter: one of the four, or all of them. */
export type StatusFilter = KitchenOrderStatus | 'all';
