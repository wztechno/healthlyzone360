import { money } from '@healthy360/domain-types';
import type { CurrencyCode, Money } from '@healthy360/domain-types';

import type {
    SubscriptionDays,
    SubscriptionDelivery,
    SubscriptionDeliveryStatus,
    SubscriptionSkipReason,
} from '../../contracts/commerce.ts';
import { PROTOTYPE_NOW, addDays, isoWeekday } from './constants.ts';

/**
 * The S1 delivery ledger, as arithmetic.
 *
 * Kept out of `./store.ts` because none of it needs the mutable world: given a start date, a set of
 * weekdays and a day count you get a ledger, and given a ledger you get a balance. The store owns
 * the map; this file owns the rules, and the rules are the part the tests are actually about.
 *
 * ## The one rule everything else follows from
 *
 * **A skip consumes nothing.** The approved semantics call a subscription "a consumable balance of
 * delivery days" (§1), which only means anything if the balance is spent by *deliveries* and not by
 * the calendar. So `consumed` is a field on the row, written when the row is generated or delivered
 * and never when it is skipped — the same shape the backend enforces with a CHECK constraint. A
 * store that derived `consumed` from `status` would be a second copy of that rule, and the two would
 * eventually disagree about somebody's money.
 *
 * ## The cut-off is a deadline, not a duration
 *
 * `cutOffAt` is the instant a delivery day closes for changes: midnight at the start of that day,
 * minus the plan's cut-off hours. Everything else — whether a weekday change may touch a given row,
 * which date a change becomes effective from — is a comparison against that instant. Expressing it
 * as "24 hours from now" instead would make the answer depend on when a screen happened to ask.
 */

/** The plan's default. Real plans carry `change_cutoff_hours`; nothing in this world overrides it. */
export const DEFAULT_CHANGE_CUTOFF_HOURS = 24;

/**
 * The fixture plans that let the customer choose each meal.
 *
 * A **declaration of the mock world**, exactly like its service areas and its consent texts. The
 * real source is `subscription_plan_profiles.allows_free_selection`, which `SubscriptionPlan` does
 * not publish — so rather than infer free selection from a plan's shape (and be wrong the moment a
 * fixture changes), the world says which of its plans has it.
 */
export const FREE_SELECTION_PLAN_KEYS: ReadonlySet<string> = new Set(['balanced_week']);

/** What the purchase captured. Grandfathered for the life of the balance (semantics §5). */
export interface SubscriptionEconomics {
    readonly totalDays: number;
    /** Effective, post-discount, in minor units. The number a refund is computed from. */
    readonly perDayMinor: number;
    readonly currencyCode: CurrencyCode;
    readonly discountPercent: number;
    readonly changeCutoffHours: number;
    readonly allowsFreeSelection: boolean;
}

export interface LedgerRow {
    id: string;
    date: string;
    status: SubscriptionDeliveryStatus;
    consumed: boolean;
    skipReason: SubscriptionSkipReason | null;
    slotCode: string;
}

/** `YYYY-MM-DD` dates a start date and a weekday set produce, until `days` of them exist. */
export function planDeliveryDates(
    startDate: string,
    weekdays: readonly number[],
    days: number,
    { horizon = 400 }: { horizon?: number } = {},
): readonly string[] {
    if (weekdays.length === 0 || days <= 0) return [];
    const dates: string[] = [];
    for (let offset = 0; offset < horizon && dates.length < days; offset += 1) {
        const date = addDays(startDate, offset);
        if (weekdays.includes(isoWeekday(date))) dates.push(date);
    }
    return dates;
}

/**
 * The instant a delivery day stops accepting changes.
 *
 * Midnight UTC at the start of the day, minus the cut-off. The prototype world has one timezone, so
 * "start of the delivery day in the branch's timezone" collapses to UTC midnight here; the backend
 * does the same arithmetic against a real branch timezone.
 */
export function cutOffAt(date: string, cutOffHours: number): number {
    return Date.parse(`${date}T00:00:00.000Z`) - cutOffHours * 3_600_000;
}

/** Whether a change may still touch this delivery day. */
export function isChangeable(date: string, cutOffHours: number, now: number): boolean {
    return now < cutOffAt(date, cutOffHours);
}

/**
 * The first date a change can take effect.
 *
 * Not "tomorrow": it is the first *scheduled* day whose cut-off has not passed. A subscription
 * delivering Monday/Wednesday/Friday, changed on a Thursday morning, cannot move Friday — so the
 * answer is the following Monday, and the screen says so instead of implying the change is instant.
 */
export function firstChangeableDate(
    rows: readonly LedgerRow[],
    cutOffHours: number,
    now: number,
): string | null {
    for (const row of rows) {
        if (row.status !== 'scheduled') continue;
        if (isChangeable(row.date, cutOffHours, now)) return row.date;
    }
    return null;
}

export function buildLedger(
    dates: readonly string[],
    slotCode: string,
    idAt: (index: number) => string,
): LedgerRow[] {
    return dates.map((date, index) => ({
        id: idAt(index),
        date,
        status: 'scheduled',
        consumed: false,
        skipReason: null,
        slotCode,
    }));
}

/**
 * Marks the days that are already in the past as delivered.
 *
 * The seeded subscription started before "today", and a prototype whose balance reads 20 of 20 on a
 * subscription with two deliveries behind it teaches nothing about what a balance *is*. Only
 * `scheduled` rows are touched, so a skipped day stays skipped and stays free.
 */
export function settlePastDeliveries(rows: readonly LedgerRow[], today: string): LedgerRow[] {
    return rows.map((row) =>
        row.status === 'scheduled' && row.date < today
            ? { ...row, status: 'delivered' as const, consumed: true }
            : row,
    );
}

export function daysFrom(rows: readonly LedgerRow[], total: number): SubscriptionDays {
    const consumed = rows.filter((row) => row.consumed).length;
    return { total, consumed, remaining: Math.max(0, total - consumed) };
}

export function skippedCount(rows: readonly LedgerRow[]): number {
    return rows.filter((row) => row.status.startsWith('skipped_')).length;
}

/** The next day that is still going to happen, or `null` when the balance is spent. */
export function nextScheduled(rows: readonly LedgerRow[], from: string): string | null {
    for (const row of rows) {
        if (row.status === 'scheduled' && row.date >= from) return row.date;
    }
    return null;
}

export function toDelivery(row: LedgerRow): SubscriptionDelivery {
    return {
        id: row.id,
        date: row.date,
        status: row.status,
        consumed: row.consumed,
        skipReason: row.skipReason,
        slotCode: row.slotCode,
    };
}

/**
 * The refund, as the semantics define it: unused days × the effective per-day price actually paid.
 *
 * The discount already enjoyed on delivered days is **not** clawed back (§3), which is why this
 * multiplies by `perDayMinor` — the post-discount rate — rather than reconstructing a list price and
 * apportioning it. Returns `null` below one unused day, matching the backend's refusal to write a
 * memo it would have to round to zero.
 */
export function creditMemoAmount(
    days: SubscriptionDays,
    economics: SubscriptionEconomics,
): { readonly unusedDays: number; readonly amount: Money; readonly perDay: Money } | null {
    if (days.remaining < 1) return null;
    return {
        unusedDays: days.remaining,
        perDay: money(economics.perDayMinor, economics.currencyCode),
        amount: money(days.remaining * economics.perDayMinor, economics.currencyCode),
    };
}

/** The world's fixed clock, as milliseconds. Nothing under `prototype/` reads the wall clock. */
export const PROTOTYPE_INSTANT = Date.parse(PROTOTYPE_NOW);
