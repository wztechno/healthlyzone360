import type { Subscription, SubscriptionDelivery } from '@healthy360/api-client/contracts';
import type { TFunction } from 'i18next';

import type { DeliverySlotOption } from './delivery.ts';
import { slotName } from './configurator-steps.tsx';
import { upcomingDeliveryDates } from './dates.ts';

/**
 * The small sums the Subscription board and the account's subscription card share: when the balance
 * runs out, what a window is called, which ledger tab a row belongs to.
 */

/**
 * The day the balance should run out — the `remaining`-th delivery day from the next one, on the
 * weekdays in effect, stepping over the days already skipped. "About", because a pause or a skip
 * moves it; `null` when there is no next delivery to count from.
 */
export function estimatedEndDate(subscription: Subscription): string | null {
    const from = subscription.nextDeliveryDate;
    const weekdays = subscription.configuration.deliveryWeekdays;
    const remaining = subscription.days.remaining;
    if (from === null || weekdays.length === 0 || remaining <= 0) return null;
    const dates = upcomingDeliveryDates(from, weekdays, remaining, {
        skipped: subscription.skippedDates,
        // Wide enough for the whole balance, whatever the weekdays: the default looks four weeks out.
        horizonDays: Math.ceil((remaining / weekdays.length) * 7) + 14,
    });
    return dates.at(-1) ?? null;
}

/** "Lunch · 12:00–15:00" — the window's name and its hours when the kitchen published them. */
export function windowLine(
    slots: readonly DeliverySlotOption[],
    code: string,
    t: TFunction,
    separator = ' · ',
): string {
    const slot = slots.find((each) => each.code === code);
    const name = slotName(slot, code, t);
    return slot === undefined ? name : `${name}${separator}${slot.startsAt}–${slot.endsAt}`;
}

/** The Deliveries card's three tabs. */
export const LEDGER_TABS = ['all', 'delivered', 'skipped'] as const;
export type LedgerTab = (typeof LEDGER_TABS)[number];

export function inLedgerTab(delivery: SubscriptionDelivery, tab: LedgerTab): boolean {
    if (tab === 'delivered') return delivery.status === 'delivered';
    if (tab === 'skipped') return delivery.status.startsWith('skipped_');
    return true;
}

/**
 * The tag at a ledger row's end: a day spent ("1 day"), a day still to come ("Next"), or a day that
 * cost nothing ("Free") — a skip, a cancellation. `consumed` decides, never the status alone.
 */
export function ledgerTag(delivery: SubscriptionDelivery): 'used' | 'next' | 'free' {
    if (delivery.consumed) return 'used';
    if (delivery.status === 'scheduled' || delivery.status === 'generated') return 'next';
    return 'free';
}
