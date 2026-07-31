/**
 * Calendar arithmetic for delivery scheduling.
 *
 * Every date the commerce surfaces handle is a `YYYY-MM-DD` calendar day rather than an instant: a
 * delivery happens on a day, and modelling it as a timestamp is how a subscription starting on the
 * first of the month arrives on the thirty-first for anybody east of Greenwich.
 *
 * Two rules keep that honest:
 *
 * 1. **Arithmetic is UTC.** `addDays` and `isoWeekday` parse at midnight UTC, so adding seven days
 *    to a date never lands on a different weekday because a daylight-saving boundary was crossed.
 * 2. **"Today" is local.** {@link todayIso} reads the wall clock's own year, month and day. A person
 *    in Dubai at 01:00 is on tomorrow's date, and telling them the earliest start is yesterday
 *    because UTC has not caught up is the sort of defect nobody reports and everybody notices.
 *
 * The prototype fixture world is pinned to a fixed instant, but these helpers deliberately are not:
 * a start-date bound computed from a frozen fixture date would be wrong on the day after the fixture
 * was written, and the constraint the interface enforces has to be true of the real calendar.
 */

const MILLISECONDS_PER_DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Seven, and named, because `% 7` in a scheduling loop reads as a magic number six months later. */
export const DAYS_PER_WEEK = 7;

/** ISO weekdays, Monday first. The order every weekday selector renders in. */
export const ISO_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

export function isIsoDate(value: string): boolean {
    if (!ISO_DATE.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** `YYYY-MM-DD` plus `days`. Returns `null` rather than throwing on a value that is not a date. */
export function addDays(date: string, days: number): string | null {
    if (!isIsoDate(date)) return null;
    const parsed = Date.parse(`${date}T00:00:00.000Z`);
    return new Date(parsed + days * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

/** ISO weekday: `1` Monday through `7` Sunday. `null` when the input is not a date. */
export function isoWeekday(date: string): number | null {
    if (!isIsoDate(date)) return null;
    const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    return day === 0 ? DAYS_PER_WEEK : day;
}

/** Whole days from `from` to `to`; negative when `to` precedes `from`. */
export function daysBetween(from: string, to: string): number | null {
    if (!isIsoDate(from) || !isIsoDate(to)) return null;
    const start = Date.parse(`${from}T00:00:00.000Z`);
    const end = Date.parse(`${to}T00:00:00.000Z`);
    return Math.round((end - start) / MILLISECONDS_PER_DAY);
}

/** The local calendar day. `now` is injectable so a test never depends on when it runs. */
export function todayIso(now: Date = new Date()): string {
    const year = String(now.getFullYear()).padStart(4, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * The earliest day a subscription may start.
 *
 * Tomorrow, never today: a kitchen that has already started cooking today's deliveries cannot add
 * one, and offering a start date the operation cannot honour is the interface promising on the
 * kitchen's behalf.
 */
export function earliestStartDate(now: Date = new Date()): string {
    return addDays(todayIso(now), 1) ?? todayIso(now);
}

/**
 * The delivery dates a configuration produces, mirroring the repository's own rule: every day from
 * the start date across `weeks` whole weeks whose weekday is in the delivery set.
 *
 * It is derived here as well as server-side because the interface has to show a person which days
 * they have chosen *before* it asks for a priced preview — and a preview that arrives after the
 * decision is not what the decision was made on.
 */
export function deliveryDatesFor(
    startDate: string,
    weekdays: readonly number[],
    weeks: number,
): readonly string[] {
    if (!isIsoDate(startDate) || weekdays.length === 0 || weeks <= 0) return [];
    const dates: string[] = [];
    for (let offset = 0; offset < weeks * DAYS_PER_WEEK; offset += 1) {
        const date = addDays(startDate, offset);
        if (date === null) break;
        const weekday = isoWeekday(date);
        if (weekday !== null && weekdays.includes(weekday)) dates.push(date);
    }
    return dates;
}

export interface UpcomingDeliveryOptions {
    /** Dates already skipped, which are not offered again. */
    readonly skipped?: readonly string[] | undefined;
    /** How far ahead to look. Four weeks by default — a subscription's usual visible horizon. */
    readonly horizonDays?: number | undefined;
}

/**
 * The next `count` delivery days at or after `from`.
 *
 * Inclusive of `from` because the caller passes the subscription's own `nextDeliveryDate`, which is
 * a delivery day and is exactly the one a person most often wants to skip.
 */
export function upcomingDeliveryDates(
    from: string,
    weekdays: readonly number[],
    count: number,
    options: UpcomingDeliveryOptions = {},
): readonly string[] {
    if (!isIsoDate(from) || weekdays.length === 0 || count <= 0) return [];
    const skipped = new Set(options.skipped ?? []);
    const horizon = options.horizonDays ?? 28;
    const dates: string[] = [];

    for (let offset = 0; offset <= horizon && dates.length < count; offset += 1) {
        const date = addDays(from, offset);
        if (date === null) break;
        const weekday = isoWeekday(date);
        if (weekday !== null && weekdays.includes(weekday) && !skipped.has(date)) dates.push(date);
    }
    return dates;
}

/**
 * The first date on or after `from` whose weekday the plan delivers on.
 *
 * The repair offered beside a rejected start date: the interface says "that Sunday is not a delivery
 * day" and then offers the Monday, rather than leaving the person to work the calendar out.
 */
export function nextAllowedDate(from: string, weekdays: readonly number[]): string | null {
    const [first] = upcomingDeliveryDates(from, weekdays, 1, { horizonDays: DAYS_PER_WEEK });
    return first ?? null;
}
