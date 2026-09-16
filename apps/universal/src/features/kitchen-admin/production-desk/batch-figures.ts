import type { ProductionOrder, ProductionOrderStatus } from '@healthy360/api-client/contracts';

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
 * Whether a batch is still somebody's work — what the desk shows by default.
 *
 * `draft` counts: a batch nobody has confirmed is still a decision waiting to be made, and leaving
 * it off the working surface is how a kitchen finds a fortnight-old draft in the register.
 */
export function isOpenBatch(status: ProductionOrderStatus): boolean {
    return status === 'draft' || status === 'confirmed' || status === 'in_production';
}

/**
 * The edge a batch takes next from a list row, or `null` when it needs a form or is finished.
 *
 * `in_production` is `null` here and **not** an oversight: completing a batch needs what actually
 * came out — produced, rejected, what went in the pot and what went on the floor — and a one-click
 * complete would have to invent a produced quantity. The detail screen asks.
 */
export function quickEdge(status: ProductionOrderStatus): 'confirm' | 'start' | null {
    if (status === 'draft') return 'confirm';
    if (status === 'confirmed') return 'start';

    return null;
}
