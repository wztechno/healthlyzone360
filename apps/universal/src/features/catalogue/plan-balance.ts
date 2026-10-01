import type {
    PlanDurationOption,
    PlanVariant,
    SubscriptionPlan,
} from '@healthy360/api-client/contracts';
import { PLAN_DURATION_WEEKS } from '@healthy360/domain-types';
import type { Money, PlanDuration } from '@healthy360/domain-types';

import { DAYS_PER_WEEK } from './plan-catalogue.ts';

/**
 * The balance model, as arithmetic the plan pages can show before anybody has bought anything.
 *
 * ## What a plan is, according to the platform
 *
 * A subscription is a **consumable balance of delivery days**, not a calendar range
 * (`docs/s1-subscription-semantics-proposal.md` §1, approved as D-077). A run of N days is N
 * deliveries; each delivery uses one day when its order is generated at the change cut-off; skips
 * and pauses use nothing and simply stretch the balance into the future. The per-day price is
 * captured at purchase and holds for the whole balance (§5), and cancelling credits the unused days
 * at that captured per-day price (§3).
 *
 * ## Why the arithmetic is duplicated here
 *
 * The authoritative figure is the server's quote (`GET /subscriptions/quote`), and it needs a
 * signed-in customer. The explainer at `/plans/how-it-works` is public, so it computes the same
 * numbers from the published plan, **with the server's own rounding**: `SubscriptionPricing`
 * rounds the per-day price half up after the duration discount, and `PlanQuote` multiplies that
 * rounded figure by the days — it never rounds a total and divides back. Doing it in the other
 * order would print a total the per-day price does not multiply up to.
 *
 * A run's length comes from the closed duration vocabulary: the client maps a wire duration onto
 * `1w | 2w | 4w | 12w` *by its day count* (`plan-mappers.ts`), so 7, 14, 28 and 84 delivery days are
 * the only balances a consumer surface can name.
 */

/** How many delivery days a duration buys — the balance a purchase would create. */
export function balanceDaysFor(duration: PlanDuration): number {
    return PLAN_DURATION_WEEKS[duration] * DAYS_PER_WEEK;
}

/**
 * The list price of one delivery day for a configuration.
 *
 * The consumer contract publishes a weekly figure, and the server builds that figure as the
 * confirmed daily price × 7 (`MarketplacePlans::perWeek`), so dividing back is exact for the plans
 * that can be subscribed to at all — the per-day basis is the only one the subscription quote
 * accepts.
 */
export function listDayPrice(variant: PlanVariant): Money {
    return {
        amount: Math.round(variant.pricePerWeek.amount / DAYS_PER_WEEK),
        currency: variant.pricePerWeek.currency,
    };
}

/** The per-day price after the duration discount, rounded the way `SubscriptionPricing` does. */
export function effectiveDayPrice(variant: PlanVariant, discountPercent: number): Money {
    const list = listDayPrice(variant);
    if (discountPercent <= 0) return list;
    return {
        amount: Math.round((list.amount * (100 - discountPercent)) / 100),
        currency: list.currency,
    };
}

/** What a whole balance costs: the rounded per-day price times the days, as `PlanQuote` does. */
export function balanceTotal(variant: PlanVariant, option: PlanDurationOption): Money {
    const perDay = effectiveDayPrice(variant, option.discountPercent);
    return { amount: perDay.amount * balanceDaysFor(option.duration), currency: perDay.currency };
}

/** The largest duration discount a plan offers, `0` when it offers none. */
export function maxDiscountPercent(plan: SubscriptionPlan): number {
    return plan.durations.reduce((max, option) => Math.max(max, option.discountPercent), 0);
}

/** The fewest and most meals a day across the plan's configurations, or `null` with none. */
export function mealsPerDayRange(
    plan: SubscriptionPlan,
): { readonly min: number; readonly max: number } | null {
    if (plan.variants.length === 0) return null;
    const counts = plan.variants.map((variant) => variant.mealsPerDay);
    return { min: Math.min(...counts), max: Math.max(...counts) };
}

/* ── the balance simulation ──────────────────────────────────────────────────────────────────── */

/**
 * What one weekday cell of the simulation shows.
 *
 * - `delivery` — a chosen weekday that uses a day of the balance.
 * - `skipped` — a chosen weekday in a skipped week. Uses nothing (§1).
 * - `ended` — a chosen weekday in the last week, after the balance has run out.
 * - `none` — not a delivery weekday.
 */
export type BalanceCellKind = 'delivery' | 'skipped' | 'ended' | 'none';

export interface BalanceCell {
    readonly date: Date;
    /** ISO weekday, 1 = Monday … 7 = Sunday. */
    readonly weekday: number;
    readonly kind: BalanceCellKind;
}

export interface BalanceWeek {
    /** Zero-based. */
    readonly index: number;
    readonly start: Date;
    readonly end: Date;
    readonly skipped: boolean;
    readonly cells: readonly BalanceCell[];
    /** Deliveries this week used. */
    readonly used: number;
    /** Days still in the balance once this week is over. */
    readonly remaining: number;
}

export interface BalanceSimulation {
    readonly weeks: readonly BalanceWeek[];
    readonly lastDelivery: Date | null;
    /** Skipped weeks that fall inside the run — a skip after the last delivery changes nothing. */
    readonly skippedWeeks: number;
}

export interface BalanceSimulationInput {
    readonly days: number;
    /** ISO weekdays, 1 = Monday … 7 = Sunday. */
    readonly weekdays: readonly number[];
    /** Zero-based week indexes the person has skipped. */
    readonly skippedWeeks: readonly number[];
    /** The Monday the simulation starts on. */
    readonly start: Date;
    /**
     * A ceiling on the weeks walked, so a pathological input cannot loop for ever. Two years is far
     * beyond any balance this build can sell (84 days at one delivery a week is 84 weeks).
     */
    readonly maxWeeks?: number | undefined;
}

function addDays(date: Date, days: number): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** The Monday of the week after `today`, at local midnight — where the simulation starts. */
export function nextMonday(today: Date): Date {
    const mondayBased = (today.getDay() + 6) % 7;
    return addDays(
        new Date(today.getFullYear(), today.getMonth(), today.getDate()),
        7 - mondayBased,
    );
}

/**
 * Walks a balance forward week by week: each chosen weekday uses one day, a skipped week uses none
 * and pushes the end out, and the walk stops the week the balance reaches zero.
 */
export function simulateBalance(input: BalanceSimulationInput): BalanceSimulation {
    const weekdays = new Set(input.weekdays);
    const skipped = new Set(input.skippedWeeks);
    const maxWeeks = input.maxWeeks ?? 104;

    if (weekdays.size === 0 || input.days <= 0) {
        return { weeks: [], lastDelivery: null, skippedWeeks: 0 };
    }

    const weeks: BalanceWeek[] = [];
    let remaining = input.days;
    let lastDelivery: Date | null = null;
    let skippedInRun = 0;

    for (let index = 0; remaining > 0 && index < maxWeeks; index += 1) {
        const start = addDays(input.start, index * DAYS_PER_WEEK);
        const isSkipped = skipped.has(index);
        if (isSkipped) skippedInRun += 1;
        let used = 0;

        const cells: BalanceCell[] = [];
        for (let offset = 0; offset < DAYS_PER_WEEK; offset += 1) {
            const date = addDays(start, offset);
            const weekday = offset + 1;
            let kind: BalanceCellKind = 'none';
            if (weekdays.has(weekday)) {
                if (isSkipped) {
                    kind = 'skipped';
                } else if (remaining > 0) {
                    kind = 'delivery';
                    remaining -= 1;
                    used += 1;
                    lastDelivery = date;
                } else {
                    kind = 'ended';
                }
            }
            cells.push({ date, weekday, kind });
        }

        weeks.push({
            index,
            start,
            end: addDays(start, DAYS_PER_WEEK - 1),
            skipped: isSkipped,
            cells,
            used,
            remaining,
        });
    }

    return { weeks, lastDelivery, skippedWeeks: skippedInRun };
}

/**
 * What cancelling after a given number of weeks would credit back (§3): the unused days at the
 * per-day price actually paid. The discount already enjoyed on delivered days is not taken back,
 * which is why the multiplier is the *effective* price and not the list one.
 */
export function cancellationCredit(
    simulation: BalanceSimulation,
    days: number,
    afterWeeks: number,
    perDay: Money,
): { readonly usedDays: number; readonly unusedDays: number; readonly credit: Money } {
    const usedDays = simulation.weeks
        .slice(0, afterWeeks)
        .reduce((total, week) => total + week.used, 0);
    const unusedDays = Math.max(0, days - usedDays);
    return {
        usedDays,
        unusedDays,
        credit: { amount: unusedDays * perDay.amount, currency: perDay.currency },
    };
}
