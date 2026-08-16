import type {
    CalendarBasis,
    OrderDeskCalendarCounts,
    OrderDeskCalendarDay,
} from '@healthy360/api-client/contracts';
import { CALENDAR_BASES, CALENDAR_FORECAST_BASIS } from '@healthy360/api-client/contracts';

import { mondayOf, weekDates } from '../planner/format.ts';

/**
 * The Order Desk calendar's arithmetic — which week, which rows, and what each square says.
 *
 * Everything here is pure and has no React in it, for the reason `features/planner/format.ts` gives:
 * the parts of a calendar that are easy to get subtly wrong are the parts that never throw. A week
 * derived one day out, a slot row that disappears when it happens to be empty, a missing day
 * rendered as "nothing due" — none of those produce an error, all of them produce a screen that
 * quietly says something false.
 *
 * ## The one rule the whole module exists to protect
 *
 * **The three bases are never added together.** `order` is what exists, `scheduled` is what has been
 * claimed, `projected` is what is merely expected, and they overlap by construction: a projected day
 * becomes a claimed one, a claimed one becomes an order. Nothing in this file returns a total,
 * offers a sum, or reduces the three to one — not as a convenience, not for a badge, not for sorting
 * — because the moment such a function exists it is the one a screen reaches for.
 *
 * ## Zero and unknown are different answers, and the difference is where the day came from
 *
 * The wire promises **every day of the requested range**, and within a day it sends **only the slots
 * carrying something**. Those two promises together decide the whole rule:
 *
 * - a slot absent from a day that *was* answered is a **true zero** — the server walked it and found
 *   nothing, so `0` is the honest figure;
 * - a **date absent from the answer entirely** is **unknown** — the screen derived that column
 *   itself, and a zero there would be the calendar claiming nothing is due on a day nobody asked
 *   about. That is the em dash, and it is why {@link CalendarReading.count} is nullable.
 *
 * The second case is not hypothetical: the grid draws the week it navigated to, and a response for
 * the previous week is in cache for a frame while the next one is in flight.
 *
 * ## The week starts on Monday, and nothing here knows about Arabic
 *
 * {@link calendarWeek} is `mondayOf` + `weekDates` from the planner, unchanged — one ISO week-start
 * convention across the application rather than two that could disagree. Direction is not this
 * module's business and there is no locale branch anywhere in it: `CalendarGrid` lays its day
 * columns out as flex children in source order, so the first day sits on the right in Arabic for
 * free, and the visible weekday names come from the locale's own formatter at the call site.
 */

/* ── the week ────────────────────────────────────────────────────────────────────────────────── */

/** How many days one press of "next" moves, and how many columns the grid has. */
export const CALENDAR_WEEK_DAYS = 7;

export interface CalendarRange {
    /** `YYYY-MM-DD`, inclusive. */
    readonly from: string;
    /** `YYYY-MM-DD`, inclusive. */
    readonly to: string;
    /** Every date from `from` to `to`, in order. One column each. */
    readonly dates: readonly string[];
}

/**
 * The week `anchor` falls in, bounded by what the server said it would answer.
 *
 * `maxWindowDays` is `meta.maxWindowDays` from the last answer, or `null` before the first one. Two
 * things follow, and the second is the point:
 *
 * - **Before any answer the week stands as asked.** Seven days is the smallest useful range and no
 *   plausible ceiling is under it, so the first request is how the ceiling is learned rather than
 *   something to be blocked on.
 * - **Afterwards the range is clamped to the ceiling.** Nothing today comes near sixty days, and
 *   that is exactly why the clamp is worth writing: it means a server that tightened its cap, or a
 *   later slice that widened the view to a month, gets a shorter grid rather than a `422` in front
 *   of somebody. A calendar that discovers its own limit by failing is a calendar that fails in
 *   front of a customer on the telephone.
 *
 * The floor is one day, because a range with no days in it is not a range.
 */
export function calendarWeek(anchor: string, maxWindowDays: number | null): CalendarRange {
    const weekStart = mondayOf(anchor);
    const allowed =
        maxWindowDays === null
            ? CALENDAR_WEEK_DAYS
            : Math.max(1, Math.min(CALENDAR_WEEK_DAYS, maxWindowDays));
    const dates = weekDates(weekStart).slice(0, allowed);
    // `weekDates` answers seven and `allowed` is at least one, so the ends are always present; the
    // fallbacks exist for the compiler rather than for a case this function can reach.
    return {
        from: dates[0] ?? weekStart,
        to: dates[dates.length - 1] ?? weekStart,
        dates,
    };
}

/* ── the rows ────────────────────────────────────────────────────────────────────────────────── */

/** The grid key of the row that carries work no slot was named for. */
export const UNSLOTTED_SLOT_KEY = 'unslotted';

export interface CalendarSlotDescriptor {
    /**
     * Stable within a week and safe as a test id — named slots are prefixed, so a kitchen whose own
     * slot code is literally `unslotted` still gets `slot-unslotted` and cannot collide with the
     * bucket below it.
     */
    readonly key: string;
    /** The kitchen's own code, or `null` for the unslotted bucket. */
    readonly code: string | null;
}

/**
 * The rows the visible week needs: every slot that carries something on any of its days.
 *
 * **A union across the week rather than per day**, because a grid whose rows changed from column to
 * column would not be a grid. A kitchen that delivers in the morning on Monday and the evening on
 * Tuesday gets both rows on both days, and Monday's evening square reads `0` — which is true, and
 * is the comparison the week view exists to make.
 *
 * Named codes are sorted, which reproduces the order the server already uses within a day; taking
 * first-seen order instead would put Tuesday's `evening` above Monday's `morning` purely because
 * Monday was quiet. The unslotted bucket is **last and only when some day has one**: a permanent
 * empty row on a kitchen that names every slot would be a row of zeroes about a bucket it does not
 * use.
 *
 * An empty result is a real answer — a week with nothing on any book — and the screen renders the
 * day columns without slot rows rather than inventing a row to put dashes in.
 */
export function calendarSlots(
    days: readonly OrderDeskCalendarDay[],
): readonly CalendarSlotDescriptor[] {
    const named = new Set<string>();
    let unslotted = false;

    for (const day of days) {
        for (const window of day.windows) {
            if (window.code === null) unslotted = true;
            else named.add(window.code);
        }
    }

    // Code-unit order, which is what the server's own alphabetical sort produces for the ASCII
    // codes a slot vocabulary uses — and a slot named `12` stays the string `12` rather than
    // becoming a number that would sort before `2`.
    const rows: CalendarSlotDescriptor[] = [...named]
        .sort()
        .map((code) => ({ key: `slot-${code}`, code }));

    if (unslotted) rows.push({ key: UNSLOTTED_SLOT_KEY, code: null });
    return rows;
}

/* ── the squares ─────────────────────────────────────────────────────────────────────────────── */

export interface CalendarReading {
    readonly basis: CalendarBasis;
    /**
     * `null` when the day was not in the answer at all. **Never a substituted zero** — see the
     * module note on why the two are different facts.
     */
    readonly count: number | null;
    /** True for the one basis that is a forecast rather than a record. Drives the dashed styling. */
    readonly forecast: boolean;
}

const ZERO_COUNTS: OrderDeskCalendarCounts = { order: 0, scheduled: 0, projected: 0 };

/**
 * The three books of one square, in reading order.
 *
 * `null` counts means the square is unknown, and every basis is unknown together: there is no state
 * in which a day was half-answered.
 */
export function countsReadings(counts: OrderDeskCalendarCounts | null): readonly CalendarReading[] {
    return CALENDAR_BASES.map((basis) => ({
        basis,
        count: counts === null ? null : counts[basis],
        forecast: basis === CALENDAR_FORECAST_BASIS,
    }));
}

/** The day the answer holds for `date`, or `null` when the answer did not carry that day. */
export function calendarDayFor(
    days: readonly OrderDeskCalendarDay[],
    date: string,
): OrderDeskCalendarDay | null {
    return days.find((day) => day.date === date) ?? null;
}

/** The whole day, on all three books. Unknown when the day was not answered. */
export function dayReadings(day: OrderDeskCalendarDay | null): readonly CalendarReading[] {
    return countsReadings(day === null ? null : day.counts);
}

/**
 * One slot on one day.
 *
 * Three outcomes, and telling them apart is the whole job:
 *
 * - the **day** is missing → unknown, every basis `null`;
 * - the day is present and the **slot** is missing → a true zero, because the server sends only the
 *   slots carrying something;
 * - both present → the counts as they arrived.
 */
export function slotReadings(
    day: OrderDeskCalendarDay | null,
    code: string | null,
): readonly CalendarReading[] {
    if (day === null) return countsReadings(null);
    const window = day.windows.find((candidate) => candidate.code === code);
    return countsReadings(window === undefined ? ZERO_COUNTS : window.counts);
}

/**
 * Whether a square has nothing on any book.
 *
 * Used to render one quiet `0` instead of three, and **only** for a square that is known: an
 * unknown square answers `false` here, because "we did not ask" is not "there is nothing". A caller
 * therefore checks {@link isUnknown} first, and the two predicates are deliberately not one
 * three-valued function — the day that returned `'empty' | 'unknown' | 'busy'` is the day a screen
 * stopped distinguishing them.
 */
export function isEmpty(readings: readonly CalendarReading[]): boolean {
    return readings.every((reading) => reading.count === 0);
}

/** Whether the day behind a square was answered at all. */
export function isUnknown(readings: readonly CalendarReading[]): boolean {
    return readings.every((reading) => reading.count === null);
}
