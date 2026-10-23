import type { TFunction } from 'i18next';

import { DAYS_PER_WEEK } from './plan-catalogue.ts';

/**
 * How a run length reads: "5 days", "1 week", "4 weeks".
 *
 * A duration is a count of delivery days (`PlanDuration`), and a kitchen may configure any count.
 * Whole weeks read as weeks because that is how the shorter marketed runs are sold and spoken of;
 * anything else reads as days, so a five-day plan is never rounded up to "1 week" on a card and
 * then down to five deliveries at checkout.
 */
export function durationLabel(
    days: number,
    t: TFunction,
    formatNumber: (value: number) => string,
): string {
    if (days % DAYS_PER_WEEK === 0) {
        const weeks = days / DAYS_PER_WEEK;
        return t('catalogue:plans.durationWeeks', { count: weeks, weeks: formatNumber(weeks) });
    }
    return t('catalogue:plans.durationDays', { count: days, days: formatNumber(days) });
}

/**
 * The length with the balance it buys: "4 weeks · 28 delivery days". A length already counted in
 * days says it once — "5 days", not "5 days · 5 delivery days".
 */
export function durationWithBalance(
    days: number,
    t: TFunction,
    formatNumber: (value: number) => string,
): string {
    const label = durationLabel(days, t, formatNumber);
    if (days % DAYS_PER_WEEK !== 0) return label;
    return `${label} · ${t('commerce:configurator.summary.balance', { count: days })}`;
}

/** The compact form for a segmented control: "5 d", "4 wk". */
export function durationShortLabel(
    days: number,
    t: TFunction,
    formatNumber: (value: number) => string,
): string {
    if (days % DAYS_PER_WEEK === 0) {
        return t('catalogue:plans.durationWeeksShort', {
            weeks: formatNumber(days / DAYS_PER_WEEK),
        });
    }
    return t('catalogue:plans.durationDaysShort', { days: formatNumber(days) });
}
