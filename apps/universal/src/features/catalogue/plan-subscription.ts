import type { Subscription } from '@healthy360/api-client/contracts';
import type { Formatter } from '@healthy360/i18n';

/**
 * Small rules about a held plan that the plan pages share. Managing a subscription — its week,
 * skips, pauses and balance — lives on the subscription's own page, not on the plan pages.
 */

/** States in which a subscription still delivers, or will again — the plan a person is "on". */
const LIVE_STATES: ReadonlySet<Subscription['state']> = new Set([
    'active',
    'paused',
    'skipped_today',
]);

/**
 * Whether a subscription is one a person currently holds. The plan list marks its card "Current" and
 * the plan page offers "Manage plan" by this one rule, so the two never disagree about it.
 */
export function isLiveSubscription(subscription: Subscription): boolean {
    return LIVE_STATES.has(subscription.state);
}

/** A Monday, so `REFERENCE_MONDAY + (n − 1)` is ISO weekday `n` for the weekday-name formatter. */
const REFERENCE_MONDAY = new Date(2024, 0, 1);

export function weekdayName(formatter: Formatter, isoWeekday: number, width: 'short' | 'long') {
    const date = new Date(
        REFERENCE_MONDAY.getFullYear(),
        REFERENCE_MONDAY.getMonth(),
        REFERENCE_MONDAY.getDate() + isoWeekday - 1,
    );
    return formatter.formatDate(date, { weekday: width });
}

/** "Oct 5–11", or "Sep 28–Oct 4" across a month boundary. */
export function weekRangeLabel(formatter: Formatter, start: Date, end: Date): string {
    const from = formatter.formatDate(start, { month: 'short', day: 'numeric' });
    const to =
        start.getMonth() === end.getMonth()
            ? formatter.formatNumber(end.getDate())
            : formatter.formatDate(end, { month: 'short', day: 'numeric' });
    return `${from}–${to}`;
}
