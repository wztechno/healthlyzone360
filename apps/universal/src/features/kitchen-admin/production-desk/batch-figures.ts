import type { ProductionOrder, ProductionOrderStatus } from '@healthy360/api-client/contracts';
import { isMeasureUnit } from '@healthy360/nutrition';

import { unitDimension } from '../format.ts';

/**
 * The pure arithmetic behind the production desk (PROD1), out of the screens so the interesting
 * cases can be asserted without rendering anything.
 *
 * There is one idea here and every function is a consequence of it: **a count over a page is not a
 * count over the queue.** The desk pages at fifty, and a stat card that counted what happened to be
 * on screen would read as a fact about the kitchen. So every figure returns `null` the moment the
 * server says there is more, and the tile renders an em dash — the same treatment the hub gives a
 * count it could not fetch. A reassuring number nobody earned is worse than no number.
 */

/**
 * How many of a page's batches are in one state, or `null` when the page is not the whole queue.
 */
export function countByStatus(
    orders: readonly ProductionOrder[],
    status: ProductionOrderStatus,
    hasMore: boolean,
): number | null {
    if (hasMore) return null;

    return orders.filter((order) => order.status === status).length;
}

/**
 * Batches whose cost nobody could compute, or `null` over a partial page.
 *
 * Counted off `actualCostStatus`, which is **absent** without
 * `production.view_costs_organisation` — so a chef sees `null` here for the same reason they see no
 * money anywhere else, and the tile says nothing rather than zero.
 */
export function countUnvalued(orders: readonly ProductionOrder[], hasMore: boolean): number | null {
    if (hasMore) return null;

    const known = orders.filter((order) => order.actualCostStatus !== undefined);
    if (known.length === 0) return null;

    // `null` counts, exactly as `partial` does, and matching what the server's own
    // ledger counts: a settled batch that never reached a valuation is as
    // untrustworthy as one that reached it and failed. Only `complete` is a cost.
    return known.filter((order) => order.actualCostStatus !== 'complete').length;
}

/**
 * Batches on the shelf past their date, or `null` over a partial page.
 *
 * A batch with **no** expiry date is never counted. That is "nobody recorded one", which is not the
 * same as "it is fine" and not the same as "it has gone off" — and a register that quietly treated
 * the unknown as safe is the one that poisons somebody.
 */
export function countExpired(orders: readonly ProductionOrder[], hasMore: boolean): number | null {
    if (hasMore) return null;

    return orders.filter((order) => order.isExpired).length;
}

/**
 * What a batch made, as one string, or `null` when there is nothing to say yet.
 *
 * Produced **and** usable where they differ, because they differ exactly when something was thrown
 * away and that is the case worth seeing. Where nothing was rejected the two are the same number and
 * saying it twice is noise.
 */
export function yieldSummary(order: ProductionOrder): string | null {
    const produced = order.producedQuantity;
    if (produced === null) return null;

    const usable = order.usableYieldQuantity;
    const unit = order.plannedYieldUnitCode ?? '';

    if (usable === null || Number(usable) === Number(produced)) {
        return `${produced} ${unit}`.trim();
    }

    return `${usable} / ${produced} ${unit}`.trim();
}

/**
 * A lot as people read it: `2609250077` → `260925-007-7` — date, daily sequence, check digit.
 *
 * Anything that is not the ten digits the server mints comes back as it was, rather than cut into
 * the wrong shape. `null` stays `null`, so a caller can fall back to the legacy label.
 */
export function formatLot(lot: string | null): string | null {
    if (lot === null) return null;
    if (!/^\d{10}$/.test(lot)) return lot;

    return `${lot.slice(0, 6)}-${lot.slice(6, 9)}-${lot.slice(9)}`;
}

// ponytail: 200 is the print-preview ceiling — past that the browser's preview crawls. A paged
// print (or ZPL straight to the printer) is the way past it.
export const MAX_LABEL_COPIES = 200;

/**
 * How many labels to print: what was typed, when it is a positive whole number, else the default.
 *
 * The default is one label per usable unit for **counted** units — pieces, packs, bottles — the same
 * `count`/`package` rule `scalePackaging` rounds by, because each of those is a thing somebody
 * sticks a label on. Anything measured (twenty litres of dressing) is one container and one label.
 * Clamped to 1…{@link MAX_LABEL_COPIES} either way.
 */
export function labelCopies(order: ProductionOrder, typed: string | null): number {
    const asked = typed === null ? Number.NaN : Number(typed.trim());
    const copies = Number.isInteger(asked) && asked > 0 ? asked : defaultLabelCopies(order);

    return Math.min(Math.max(copies, 1), MAX_LABEL_COPIES);
}

function defaultLabelCopies(order: ProductionOrder): number {
    const unit = order.plannedYieldUnitCode;
    if (unit === null || !isMeasureUnit(unit)) return 1;

    const dimension = unitDimension(unit);
    if (dimension !== 'count' && dimension !== 'package') return 1;

    const usable = Number(order.usableYieldQuantity ?? '');

    return Number.isFinite(usable) ? Math.floor(usable) : 1;
}
