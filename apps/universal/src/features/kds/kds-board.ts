import type { KitchenOrder } from '@healthy360/api-client/contracts';
import type { BadgeTone } from '@healthy360/design-system';
import type { BranchId } from '@healthy360/domain-types';

import { todayIso } from '../commerce/dates.ts';

/**
 * How the order book becomes a ticket board.
 *
 * Pure functions over `KitchenOrder`, kept apart from the screen for the usual reason: the bucketing
 * rule below is the one genuinely arguable decision on this surface, and an arguable decision that
 * can only be exercised by rendering a screen is a decision nobody re-reads.
 *
 * ## The three columns are the status machine, not a KDS vocabulary of its own
 *
 * `placed → confirmed → fulfilled` is the whole contract (`contracts/kitchen-orders.ts`), so the
 * board is Incoming / In preparation / Ready and nothing else. There are no production stages here —
 * the order has never carried any, and inventing "plating" or "on the pass" would be the display
 * claiming a fact no endpoint answers. `cancelled` appears in no column at all: it is terminal work
 * nobody is doing, and a cook does not need to read it on a wall.
 *
 * ## Which fulfilled tickets stay on the board
 *
 * A fulfilled ticket is finished work, so the Ready column is a short receipt rather than an
 * archive — "did we just hand that off?" — and something has to bound it. Two readings were
 * available and the data decides between them:
 *
 * * **`delivery.requestedDate === today`** — the day the kitchen cooks against, and the endpoint's
 *   own first-class filter. But it is nullable, and it answers the wrong question here: a ticket
 *   bumped thirty seconds ago for tomorrow's delivery would never appear, so the cook who pressed
 *   Ready would watch it vanish rather than move.
 * * **`fulfilledAt` falls on today** — the moment *this kitchen acted*, which is precisely what the
 *   Ready column is a receipt of, and which the state machine guarantees is set on every fulfilled
 *   order.
 *
 * The second one is what this board uses. `fulfilledAt` is nullable on the contract even though the
 * machine always writes it, so a fulfilled order without one falls back to its requested delivery
 * day rather than being silently dropped.
 *
 * "Today" is the local calendar day via {@link todayIso} — the same helper the commerce surfaces
 * use, and local for the same reason: a kitchen in Dubai at 01:00 is on today's board, not
 * yesterday's, whatever UTC thinks.
 *
 * ## Oldest first
 *
 * The endpoint answers newest first, which is right for a book somebody is reading and wrong for a
 * queue somebody is working: the ticket that has waited longest is the one that needs starting.
 * Incoming and In preparation are therefore reversed into oldest-first. Ready keeps newest first —
 * the thing just bumped is the thing being looked for.
 *
 * ## Which branch's tickets — and why the answer is not the endpoint's `branch_id` filter
 *
 * An order's `branchId` is **nullable on the wire and in life**. A delivery resolved through an
 * organisation-wide zone is not attributed to any one kitchen, and the live database says so: real
 * COD orders placed against Verdant's emirates-wide zone carry `branch_id: NULL`. Sending
 * `filters.branchId` therefore does not narrow the board to this kitchen's work — it *deletes* every
 * unattributed order from it, and a display that hides real tickets is worse than no display: the
 * food is still ordered, and nobody is cooking it.
 *
 * So the board asks the endpoint for the book and decides here, with {@link ticketBelongsToBranch}:
 *
 * * `branchId === null` — nobody has said which kitchen. Whoever is looking at this wall is a
 *   kitchen that may cook it, so it is shown.
 * * `branchId === the active branch` — this kitchen's own work. Shown.
 * * anything else — attributed to a *different* kitchen, which has its own wall. Hidden.
 *
 * The server-side filter stays exactly where it is meaningful: `/kitchen/orders`, where a manager
 * explicitly asks "what did the Al Quoz branch take?" and an unattributed order genuinely is not an
 * answer to that question.
 */

export const KDS_COLUMN_KEYS = ['incoming', 'preparing', 'done'] as const;
export type KdsColumnKey = (typeof KDS_COLUMN_KEYS)[number];

export interface KdsBoard {
    readonly incoming: readonly KitchenOrder[];
    readonly preparing: readonly KitchenOrder[];
    readonly done: readonly KitchenOrder[];
}

/** The local calendar day an instant falls on, or `null` when there is no instant to read. */
function localDayOf(value: string | null): string | null {
    if (value === null) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : todayIso(parsed);
}

/** Milliseconds since the epoch, or `null` for a timestamp that is absent or unreadable. */
function instantOf(value: string | null): number | null {
    if (value === null) return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}

/** See the file header: today's own work, by the moment the kitchen finished it. */
export function isDoneToday(order: KitchenOrder, now: Date): boolean {
    const today = todayIso(now);
    const fulfilledDay = localDayOf(order.fulfilledAt);
    if (fulfilledDay !== null) return fulfilledDay === today;
    // The machine always stamps `fulfilledAt`; the contract types it nullable anyway, so a record
    // without one is placed by the day it was cooked for rather than dropped without a word.
    return order.delivery.requestedDate === today;
}

function byPlacedAscending(left: KitchenOrder, right: KitchenOrder): number {
    return (instantOf(left.placedAt) ?? 0) - (instantOf(right.placedAt) ?? 0);
}

function byFulfilledDescending(left: KitchenOrder, right: KitchenOrder): number {
    return (instantOf(right.fulfilledAt) ?? 0) - (instantOf(left.fulfilledAt) ?? 0);
}

/**
 * Whether a ticket belongs on the wall of the kitchen currently displaying the board. See the file
 * header — unattributed work is everybody's, attributed work is one branch's.
 *
 * A `null` active branch excludes attributed tickets rather than admitting them: the area requires a
 * branch, so this is unreachable, and the conservative reading is the one that cannot put another
 * kitchen's order on a screen by accident.
 */
export function ticketBelongsToBranch(order: KitchenOrder, branchId: BranchId | null): boolean {
    if (order.branchId === null) return true;
    return order.branchId === branchId;
}

/**
 * Splits one page of orders into the three columns, keeping only what this branch should see.
 *
 * `cancelled` reaches none of them, and neither does another kitchen's attributed work.
 */
export function bucketTickets(
    orders: readonly KitchenOrder[],
    now: Date,
    branchId: BranchId | null,
): KdsBoard {
    const mine = orders.filter((order) => ticketBelongsToBranch(order, branchId));

    return {
        incoming: mine.filter((order) => order.status === 'placed').sort(byPlacedAscending),
        preparing: mine.filter((order) => order.status === 'confirmed').sort(byPlacedAscending),
        done: mine
            .filter((order) => order.status === 'fulfilled' && isDoneToday(order, now))
            .sort(byFulfilledDescending),
    };
}

/** Whole minutes between an order being placed and `now`; never negative. */
export function minutesSincePlaced(order: KitchenOrder, now: Date): number {
    const placed = instantOf(order.placedAt);
    if (placed === null) return 0;
    return Math.max(0, Math.floor((now.getTime() - placed) / 60_000));
}

/** A ticket goes amber at a quarter of an hour and red at half of one. */
export const KDS_WARNING_MINUTES = 15;
export const KDS_LATE_MINUTES = 30;

/**
 * The tone the age badge carries.
 *
 * Colour never carries it alone: the badge's label is the elapsed time itself, spelled out by the
 * locale's own relative-time formatter, so a board read by somebody who cannot separate amber from
 * red loses nothing.
 */
export function ticketAgeTone(minutes: number): BadgeTone {
    if (minutes >= KDS_LATE_MINUTES) return 'danger';
    if (minutes >= KDS_WARNING_MINUTES) return 'warning';
    return 'neutral';
}

/* ── identifiers used by tests and Playwright ────────────────────────────────────────────────── */

export function kdsColumnTestId(column: KdsColumnKey): string {
    return `kds-column-${column}`;
}

export function kdsTicketTestId(orderId: string): string {
    return `kds-ticket-${orderId}`;
}
