import type { DeliveryZone, Kitchen, KitchenBranch } from '@healthy360/api-client/contracts';
import type { Money } from '@healthy360/domain-types';

/**
 * The standing facts a kitchen storefront opens with, derived from `Kitchen` alone.
 *
 * Kept apart from the screen for the reason `kds-board.ts` gives: every function here is a small
 * arguable reading of the contract, and a reading that can only be exercised by rendering a screen
 * is a reading nobody re-reads.
 *
 * ## The design asks for four figures; the contract answers three and a half
 *
 * HealthZone's storefront (`HealthZone.dc.html` §isStorefront) draws a fact row, an order panel
 * with a next-slot time, a minimum and a delivery fee, and an "OPEN · UNTIL 21:30" pill. Two of
 * those have no source and are not invented here:
 *
 * * **Next slot.** Nothing in `CommerceRepository` or `MarketplaceRepository` answers slot
 *   availability for a kitchen ahead of checkout. A time in that row would be a promise the
 *   product cannot keep.
 * * **"free over $45".** `DeliveryZone` publishes a fee and a minimum order; it carries no
 *   free-delivery threshold. The fee is shown, the second clause is dropped.
 *
 * ## Why the pill states the day's hours rather than "open now"
 *
 * "Open" is a claim about *this instant in the kitchen's time zone*, and `KitchenBranch.timeZone`
 * would have to be resolved through `Intl.DateTimeFormat`'s `timeZone` option to make it. Hermes
 * ships a reduced ICU on Android, so that comparison is not reliably available on native — and a
 * pill that reads "Open" against a kitchen that shut two hours ago is worse than no pill.
 *
 * So the pill states what the kitchen published: today's window, or that today is a closed day.
 * That needs no clock and cannot go stale within the day.
 */

/** ISO 8601 weekday for the viewer's current day — `1` is Monday, matching `OpeningHours`. */
export function isoWeekdayToday(now: Date = new Date()): number {
    const day = now.getDay();
    return day === 0 ? 7 : day;
}

/** Only active branches are consumer information; an inactive one is a record, not a place. */
export function activeBranches(kitchen: Kitchen): readonly KitchenBranch[] {
    return kitchen.branches.filter((branch) => branch.isActive);
}

export function deliveryZones(kitchen: Kitchen): readonly DeliveryZone[] {
    return activeBranches(kitchen).flatMap((branch) => branch.deliveryZones);
}

export function pickupBranches(kitchen: Kitchen): readonly KitchenBranch[] {
    return activeBranches(kitchen).filter((branch) => branch.supportsPickup);
}

/**
 * Today's published window across the kitchen, as `{ opensAt, closesAt }`.
 *
 * A kitchen with several branches has several windows, and the storefront has room for one. The
 * widest is taken — earliest opening, latest closing — because the pill answers "can I order from
 * this kitchen today", not "is this particular branch open". `null` means every branch is closed
 * today (or publishes no hours at all), which the caller renders as the closed pill.
 */
export function hoursToday(kitchen: Kitchen, weekday = isoWeekdayToday()): OpeningWindow | null {
    let opensAt: string | null = null;
    let closesAt: string | null = null;

    for (const branch of activeBranches(kitchen)) {
        for (const hours of branch.openingHours) {
            if (hours.weekday !== weekday || hours.opensAt === null || hours.closesAt === null) {
                continue;
            }
            // `HH:mm` is zero-padded and fixed-width, so lexical order is chronological order.
            if (opensAt === null || hours.opensAt < opensAt) opensAt = hours.opensAt;
            if (closesAt === null || hours.closesAt > closesAt) closesAt = hours.closesAt;
        }
    }

    return opensAt === null || closesAt === null ? null : { opensAt, closesAt };
}

export interface OpeningWindow {
    readonly opensAt: string;
    readonly closesAt: string;
}

/**
 * The shortest delivery estimate the kitchen advertises anywhere, in minutes.
 *
 * The lowest rather than an average: the row is read as "how fast can this be here", and averaging
 * a fast central zone with a slow outlying one describes neither.
 */
export function fastestDeliveryMinutes(kitchen: Kitchen): number | null {
    const minutes = deliveryZones(kitchen)
        .map((zone) => zone.estimatedMinutes)
        .filter((value): value is number => value !== null);
    return minutes.length === 0 ? null : Math.min(...minutes);
}

/**
 * The lowest of a set of `Money`, ignoring any that is priced in another currency.
 *
 * A kitchen's zones are all billed in one currency in practice, but the contract does not say so,
 * and picking a minimum across currencies would compare integers that mean different things. The
 * first value's currency wins and the rest are skipped rather than converted — there is no rate
 * here, and inventing one would be worse than showing a slightly high floor.
 */
export function lowestMoney(values: readonly (Money | null)[]): Money | null {
    let lowest: Money | null = null;

    for (const value of values) {
        if (value === null) continue;
        if (lowest === null) {
            lowest = value;
            continue;
        }
        if (value.currency === lowest.currency && value.amount < lowest.amount) {
            lowest = value;
        }
    }

    return lowest;
}

export interface DeliveryTerms {
    readonly minimumOrder: Money | null;
    readonly deliveryFee: Money | null;
    /**
     * Whether the figures above are a floor rather than the price. True when more than one zone
     * publishes a figure, which is what makes "from £3.49" the honest rendering.
     */
    readonly varies: boolean;
}

export function deliveryTerms(kitchen: Kitchen): DeliveryTerms {
    const zones = deliveryZones(kitchen);
    const fees = zones.map((zone) => zone.deliveryFee).filter((fee) => fee !== null);
    const minimums = zones.map((zone) => zone.minimumOrder).filter((minimum) => minimum !== null);

    return {
        minimumOrder: lowestMoney(minimums),
        deliveryFee: lowestMoney(fees),
        varies: fees.length > 1 || minimums.length > 1,
    };
}
