import type {
    OrderDeskCalendarCounts,
    OrderDeskCalendarDay,
} from '@healthy360/api-client/contracts';

import { isoWeekday, mondayOf, todayIso, weekDates } from '../planner/format.ts';
import {
    CALENDAR_WEEK_DAYS,
    UNSLOTTED_SLOT_KEY,
    calendarDayFor,
    calendarSlots,
    calendarWeek,
    countsReadings,
    dayReadings,
    isEmpty,
    isUnknown,
    slotReadings,
} from './order-desk-calendar.ts';

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/order-desk/calendar',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * The order-desk calendar: the arithmetic first, then the squares it draws.
 *
 * Two things this file exists to pin, and neither is about layout.
 *
 * 1. **The three bases are never added.** Every rendered cell is checked for the sum as well as for
 *    the parts, because a total is the one mistake here that produces a plausible-looking screen and
 *    a kitchen that over-buys. The check is deliberately written as "the sum does not appear" rather
 *    than "the three appear", because only the first of those fails when somebody adds a helpful
 *    subtotal underneath.
 * 2. **A zero and an em dash are different answers.** A slot the server omitted from a day it
 *    answered is a true zero; a *date* the answer did not carry at all is unknown. The fixtures
 *    below author both, because the difference is invisible in any single case.
 */

/**
 * The week the screen opens on, derived the way the screen derives it rather than written down.
 *
 * A pinned Monday would stop being this week the day after it was written, and pinning the clock
 * instead costs more than it buys here: the gate's session restore runs on a timer, so a fake clock
 * has to be threaded past three unrelated pieces of machinery to hold one date still. The
 * *arithmetic* is tested against fixed dates below, where it belongs; the screen is tested against
 * whichever week today falls in, which is also the week a person opening it would see.
 */
const MONDAY = mondayOf(todayIso());

/** A Wednesday, for the arithmetic that must not depend on when it is run. */
const FIXED_WEDNESDAY = '2026-08-19';
const FIXED_MONDAY = '2026-08-17';
const FIXED_SUNDAY = '2026-08-23';

function counts(order: number, scheduled: number, projected: number): OrderDeskCalendarCounts {
    return { order, scheduled, projected };
}

const NOTHING = counts(0, 0, 0);

function day(
    date: string,
    total: OrderDeskCalendarCounts = NOTHING,
    windows: OrderDeskCalendarDay['windows'] = [],
): OrderDeskCalendarDay {
    return { date, counts: total, windows };
}

/** Every day of a week, empty unless the caller replaced one. */
function week(overrides: readonly OrderDeskCalendarDay[] = []): readonly OrderDeskCalendarDay[] {
    return weekDates(MONDAY).map(
        (date) => overrides.find((candidate) => candidate.date === date) ?? day(date),
    );
}

/* ------------------------------------------------------------------------------------------------
 * The arithmetic
 * ---------------------------------------------------------------------------------------------- */

describe('order desk calendar — deriving the week', () => {
    /**
     * The derivation is UTC arithmetic with no locale in it at all, which is the whole reason it is
     * safe under Arabic. `CalendarGrid` lays its day columns out as flex children in source order,
     * so the *same* Monday-first sequence renders right-to-left without a mirrored coordinate
     * anywhere — and the visible weekday names come from the locale's own formatter, not from this
     * module. A `dir === 'rtl'` branch here would be a second, worse copy of what the layout does.
     */
    it('normalises any day of a week to the same Monday-first seven, in every locale', () => {
        const fromWednesday = calendarWeek(FIXED_WEDNESDAY, null);
        const fromSunday = calendarWeek(FIXED_SUNDAY, null);
        const fromMonday = calendarWeek(FIXED_MONDAY, null);

        expect(fromWednesday.dates).toEqual(weekDates(FIXED_MONDAY));
        // Three different anchors inside one ISO week are one week — a deep link typed by a person
        // and a "next" press from a Sunday must not disagree about which seven days those are.
        expect(fromSunday.dates).toEqual(fromWednesday.dates);
        expect(fromMonday.dates).toEqual(fromWednesday.dates);

        expect(fromWednesday.from).toBe(FIXED_MONDAY);
        expect(fromWednesday.to).toBe(FIXED_SUNDAY);
        expect(isoWeekday(fromWednesday.from)).toBe(1);
        expect(fromWednesday.dates).toHaveLength(CALENDAR_WEEK_DAYS);
    });

    it('leaves the week alone while the ceiling is unknown', () => {
        // Before the first answer there is no ceiling to clamp by, and seven days is under every
        // one this endpoint has ever declared — so the first request is how the ceiling is learned
        // rather than something to be blocked on.
        expect(calendarWeek(FIXED_WEDNESDAY, null).dates).toHaveLength(7);
        expect(calendarWeek(FIXED_WEDNESDAY, 60).dates).toHaveLength(7);
    });

    it('shortens the week to a ceiling below it rather than asking for a refusal', () => {
        const bounded = calendarWeek(FIXED_WEDNESDAY, 3);

        expect(bounded.dates).toEqual(['2026-08-17', '2026-08-18', '2026-08-19']);
        expect(bounded.from).toBe(FIXED_MONDAY);
        expect(bounded.to).toBe('2026-08-19');
        // A range with no days in it is not a range, whatever a server says.
        expect(calendarWeek(FIXED_WEDNESDAY, 0).dates).toHaveLength(1);
    });
});

describe('order desk calendar — the slot rows', () => {
    const MEAL_ROWS = ['slot-breakfast', 'slot-lunch', 'slot-snack', 'slot-dinner'];

    it('draws a sitting only when some day of the week carries something in it', () => {
        const slots = calendarSlots([
            day('2026-08-17', counts(1, 0, 0), [{ code: 'morning', counts: counts(1, 0, 0) }]),
            day('2026-08-18', counts(0, 0, 1), [{ code: 'evening', counts: counts(0, 0, 1) }]),
        ]);

        // Lunch and Snack carry nothing this week, so they have no row. Dinner carries only a
        // forecast and keeps its row: any book counts, never only orders.
        expect(slots.map((slot) => slot.key)).toEqual(['slot-breakfast', 'slot-dinner']);
        expect(slots.map((slot) => slot.meal)).toEqual(['breakfast', 'dinner']);
        // A quiet week has no rows at all.
        expect(calendarSlots(week())).toEqual([]);
        // All four, in the order a kitchen day runs, when every sitting carries something.
        expect(
            calendarSlots([
                day('2026-08-17', counts(4, 0, 0), [
                    { code: 'dinner', counts: counts(1, 0, 0) },
                    { code: 'snack', counts: counts(1, 0, 0) },
                    { code: 'lunch', counts: counts(1, 0, 0) },
                    { code: 'breakfast', counts: counts(1, 0, 0) },
                ]),
            ]).map((slot) => slot.key),
        ).toEqual(MEAL_ROWS);
    });

    it('folds both names for a sitting into its one row', () => {
        const slots = calendarSlots([
            day('2026-08-17', counts(4, 0, 0), [
                { code: 'midday', counts: counts(1, 0, 0) },
                { code: 'lunch', counts: counts(1, 0, 0) },
                { code: 'afternoon', counts: counts(1, 0, 0) },
                { code: 'snack', counts: counts(1, 0, 0) },
            ]),
        ]);

        expect(slots.map((slot) => slot.key)).toEqual(['slot-lunch', 'slot-snack']);
        expect(slots[0]?.codes).toEqual(['midday', 'lunch']);
    });

    it('puts any other code after the sittings, sorted as a string', () => {
        const slots = calendarSlots([
            day('2026-08-17', counts(1, 0, 0), [
                { code: 'late', counts: counts(1, 0, 0) },
                { code: '2', counts: counts(1, 0, 0) },
                { code: '12', counts: counts(1, 0, 0) },
                { code: 'morning', counts: counts(1, 0, 0) },
            ]),
        ]);

        // `12` before `2`, which is what alphabetical means and what the server already answered.
        // A client that coerced the codes to numbers would disagree with it.
        expect(slots.map((slot) => slot.key)).toEqual([
            'slot-breakfast',
            'slot-12',
            'slot-2',
            'slot-late',
        ]);
        expect(slots[1]?.meal).toBeNull();
    });

    it('puts the unslotted bucket last, and only when a day actually has one', () => {
        const withUnslotted = calendarSlots([
            day('2026-08-17', counts(2, 0, 0), [
                { code: null, counts: counts(1, 0, 0) },
                { code: 'morning', counts: counts(1, 0, 0) },
            ]),
        ]);

        expect(withUnslotted.map((slot) => slot.key)).toEqual([
            'slot-breakfast',
            UNSLOTTED_SLOT_KEY,
        ]);
        expect(withUnslotted[1]?.codes).toEqual([null]);
        // Prefixed, so a kitchen whose own code is literally `unslotted` cannot collide with it.
        const literal = calendarSlots([
            day('2026-08-17', counts(1, 0, 0), [{ code: 'unslotted', counts: counts(1, 0, 0) }]),
        ]);
        expect(literal.map((slot) => slot.key)).toEqual(['slot-unslotted']);

        // A kitchen that names every slot gets no permanent row of zeroes about a bucket it does
        // not use.
        const named = calendarSlots([
            day('2026-08-17', counts(1, 0, 0), [{ code: 'morning', counts: counts(1, 0, 0) }]),
        ]);
        expect(named.map((slot) => slot.key)).toEqual(['slot-breakfast']);

        // No days at all draws no rows.
        expect(calendarSlots([])).toEqual([]);
    });
});

describe('order desk calendar — a square’s three readings', () => {
    it('marks exactly one basis as a forecast, and never returns a total', () => {
        const readings = countsReadings(counts(2, 3, 4));

        expect(readings.map((reading) => reading.basis)).toEqual([
            'order',
            'scheduled',
            'projected',
        ]);
        expect(readings.map((reading) => reading.count)).toEqual([2, 3, 4]);
        // The flag is what drives the dashed drawing and the "forecast" sentence — a screen that
        // hard-coded the word `projected` would stop labelling it the day a fourth basis lands.
        expect(readings.map((reading) => reading.forecast)).toEqual([false, false, true]);
        expect(readings).toHaveLength(3);
    });

    it('answers a true zero for a slot the server omitted from a day it walked', () => {
        const answered = day('2026-08-17', counts(1, 0, 0), [
            { code: 'morning', counts: counts(1, 0, 0) },
        ]);

        const evening = slotReadings(answered, ['evening', 'dinner']);

        // The server sends only the slots carrying something, so absence is knowledge.
        expect(evening.map((reading) => reading.count)).toEqual([0, 0, 0]);
        expect(isEmpty(evening)).toBe(true);
        expect(isUnknown(evening)).toBe(false);
    });

    it('adds a sitting’s two names per basis, never across bases', () => {
        const answered = day('2026-08-17', counts(3, 3, 1), [
            { code: 'midday', counts: counts(1, 2, 0) },
            { code: 'lunch', counts: counts(2, 1, 1) },
            { code: 'evening', counts: counts(9, 9, 9) },
        ]);

        expect(slotReadings(answered, ['midday', 'lunch']).map((reading) => reading.count)).toEqual(
            [3, 3, 1],
        );
        // One of the two names answered is enough to make the row known.
        expect(slotReadings(answered, ['evening', 'dinner']).map((r) => r.count)).toEqual([
            9, 9, 9,
        ]);
    });

    it('answers unknown for a date the calendar never carried', () => {
        const missing = calendarDayFor([day('2026-08-17')], '2026-08-18');
        expect(missing).toBeNull();

        const readings = slotReadings(missing, ['morning', 'breakfast']);

        // Not zero. A zero here would be the calendar claiming nothing is due on a day nobody
        // asked about.
        expect(readings.map((reading) => reading.count)).toEqual([null, null, null]);
        expect(isUnknown(readings)).toBe(true);
        expect(isEmpty(readings)).toBe(false);
        expect(isUnknown(dayReadings(null))).toBe(true);
    });
});

/* ------------------------------------------------------------------------------------------------
 * The screen
 * ---------------------------------------------------------------------------------------------- */
