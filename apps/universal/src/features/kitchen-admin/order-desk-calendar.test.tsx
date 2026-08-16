import { ApiError, apiFailure } from '@healthy360/api-client';
import type {
    OrderDeskCalendar,
    OrderDeskCalendarCounts,
    OrderDeskCalendarDay,
    OrderDeskCalendarFilters,
} from '@healthy360/api-client/contracts';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { addDays, isoWeekday, mondayOf, todayIso, weekDates } from '../planner/format.ts';
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
import { OrderDeskCalendarScreen } from './screens/order-desk-calendar-screen.tsx';

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
const DATES = weekDates(MONDAY);
const SUNDAY = DATES[6] ?? MONDAY;
/** Monday and Tuesday of the visible week — the two days these fixtures put anything on. */
const FIRST = DATES[0] ?? MONDAY;
const SECOND = DATES[1] ?? MONDAY;

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

/** Monday of the visible week, carrying a single order in a named slot. */
function mondayWithOneOrder(): OrderDeskCalendarDay {
    return day(FIRST, counts(1, 0, 0), [{ code: 'morning', counts: counts(1, 0, 0) }]);
}

function calendar(days: readonly OrderDeskCalendarDay[]): OrderDeskCalendar {
    return {
        days,
        meta: { from: MONDAY, to: SUNDAY, dayCount: days.length, maxWindowDays: 60 },
    };
}

async function renderCalendar(
    listCalendar: (filters: OrderDeskCalendarFilters) => Promise<OrderDeskCalendar>,
) {
    return renderStubScreen(<OrderDeskCalendarScreen />, {
        session: kitchenManagerSession(),
        repositories: { orderDesk: { listCalendar } },
    });
}

async function settled() {
    await waitFor(
        () => {
            expect(screen.getByTestId('kitchen-order-desk-calendar-grid')).toBeTruthy();
        },
        { timeout: 5000 },
    );
}

describe('order desk calendar — who may read it', () => {
    /**
     * Two codes, because the endpoint requires two: `order.view_organisation` for the orders and
     * `subscription.view_organisation` for the two bases that are subscription arithmetic.
     *
     * The hub card is offered on the order code alone — `EntityFamily` carries one permission per
     * family — so this is the case where the card is reachable and the screen behind it is not, and
     * the right answer is the workspace's own refusal page rather than a calendar with two silently
     * empty books or a raw `403` from the first fetch.
     */
    it('refuses a reader who holds the orders but not the subscriptions', async () => {
        const session = kitchenManagerSession();
        const context = session.activeContext;
        if (context === null) throw new Error('the fixture has no active context');

        const { repositories } = await renderStubScreen(<OrderDeskCalendarScreen />, {
            session: {
                ...session,
                activeContext: {
                    ...context,
                    permissions: context.permissions.filter(
                        (code) => code !== 'subscription.view_organisation',
                    ),
                },
            },
            repositories: { orderDesk: { listCalendar: async () => calendar(week()) } },
        });

        await waitFor(
            () => {
                expect(screen.queryByTestId('kitchen-order-desk-calendar-screen')).toBeNull();
            },
            { timeout: 5000 },
        );
        // And nothing was asked for: a refusal that still spent a request would be a screen
        // learning its own permissions from the network.
        expect(repositories.orderDesk.listCalendar).not.toHaveBeenCalled();
    });
});

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
    it('unions the slots across the week so one grid has one set of rows', () => {
        const slots = calendarSlots([
            day('2026-08-17', counts(1, 0, 0), [{ code: 'morning', counts: counts(1, 0, 0) }]),
            day('2026-08-18', counts(1, 0, 0), [{ code: 'evening', counts: counts(1, 0, 0) }]),
        ]);

        // Both rows on both days: Monday's evening square then reads `0`, which is true, and is the
        // comparison a week view exists to make.
        expect(slots.map((slot) => slot.code)).toEqual(['evening', 'morning']);
    });

    it('sorts named codes rather than taking them in first-seen order', () => {
        const slots = calendarSlots([
            day('2026-08-17', counts(1, 0, 0), [{ code: 'evening', counts: counts(1, 0, 0) }]),
            day('2026-08-18', counts(1, 0, 0), [
                { code: 'morning', counts: counts(1, 0, 0) },
                { code: 'afternoon', counts: counts(1, 0, 0) },
            ]),
        ]);

        // First-seen order would put `evening` first purely because Monday was quiet.
        expect(slots.map((slot) => slot.code)).toEqual(['afternoon', 'evening', 'morning']);
    });

    it('keeps a slot named like a number a string, and sorts it as one', () => {
        const slots = calendarSlots([
            day('2026-08-17', counts(1, 0, 0), [
                { code: '2', counts: counts(1, 0, 0) },
                { code: '12', counts: counts(1, 0, 0) },
            ]),
        ]);

        // `12` before `2`, which is what alphabetical means and what the server already answered.
        // A client that coerced the codes to numbers would disagree with it.
        expect(slots.map((slot) => slot.code)).toEqual(['12', '2']);
    });

    it('puts the unslotted bucket last, and only when a day actually has one', () => {
        const withUnslotted = calendarSlots([
            day('2026-08-17', counts(2, 0, 0), [
                { code: null, counts: counts(1, 0, 0) },
                { code: 'morning', counts: counts(1, 0, 0) },
            ]),
        ]);

        expect(withUnslotted.map((slot) => slot.code)).toEqual(['morning', null]);
        expect(withUnslotted[1]?.key).toBe(UNSLOTTED_SLOT_KEY);
        // Prefixed, so a kitchen whose own code is literally `unslotted` cannot collide with it.
        expect(withUnslotted[0]?.key).toBe('slot-morning');

        // A kitchen that names every slot gets no permanent row of zeroes about a bucket it does
        // not use.
        const named = calendarSlots([
            day('2026-08-17', counts(1, 0, 0), [{ code: 'morning', counts: counts(1, 0, 0) }]),
        ]);
        expect(named.map((slot) => slot.code)).toEqual(['morning']);

        expect(calendarSlots(week())).toEqual([]);
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

        const evening = slotReadings(answered, 'evening');

        // The server sends only the slots carrying something, so absence is knowledge.
        expect(evening.map((reading) => reading.count)).toEqual([0, 0, 0]);
        expect(isEmpty(evening)).toBe(true);
        expect(isUnknown(evening)).toBe(false);
    });

    it('answers unknown for a date the calendar never carried', () => {
        const missing = calendarDayFor([day('2026-08-17')], '2026-08-18');
        expect(missing).toBeNull();

        const readings = slotReadings(missing, 'morning');

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

describe('order desk calendar — the ladder', () => {
    it('shows skeletons, then the grid', async () => {
        let release: (value: OrderDeskCalendar) => void = () => undefined;
        const held = new Promise<OrderDeskCalendar>((resolve) => {
            release = resolve;
        });

        await renderCalendar(async () => held);

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-calendar-loading')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(screen.queryByTestId('kitchen-order-desk-calendar-grid')).toBeNull();

        release(calendar(week([mondayWithOneOrder()])));
        await settled();
    });

    it('shows the failure with a retry rather than an empty week', async () => {
        await renderCalendar(async () => {
            throw new ApiError(apiFailure('server'));
        });

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-calendar-error')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(screen.queryByTestId('kitchen-order-desk-calendar-grid')).toBeNull();
    });

    it('says a week the server answered and found nothing in, rather than drawing zeroes', async () => {
        await renderCalendar(async () => calendar(week()));

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-calendar-empty')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(screen.queryByTestId('kitchen-order-desk-calendar-grid')).toBeNull();
    });
});

describe('order desk calendar — the squares', () => {
    /** A Monday carrying all three books at once, so a total would be visible if one existed. */
    function busyWeek() {
        return calendar(
            week([
                day(FIRST, counts(2, 3, 4), [
                    { code: 'morning', counts: counts(2, 3, 4) },
                    { code: null, counts: counts(0, 0, 0) },
                ]),
            ]),
        );
    }

    it('never renders the three bases summed, in a cell or in a day header', async () => {
        await renderCalendar(async () => busyWeek());
        await settled();

        const cell = screen.getByTestId(`kitchen-order-desk-calendar-${FIRST}-slot-morning`);
        const header = screen.getByTestId(`kitchen-order-desk-calendar-day-${FIRST}`);

        for (const node of [cell, header]) {
            // The parts, each on its own.
            expect(node).toHaveTextContent(/2/);
            expect(node).toHaveTextContent(/3/);
            expect(node).toHaveTextContent(/4/);
            // And not the sum, anywhere. Written as an absence on purpose: asserting the three are
            // present would still pass if somebody added a helpful subtotal underneath them.
            expect(node).not.toHaveTextContent(/\b9\b/);
        }
        // Nothing in the whole grid is a total either.
        expect(screen.queryAllByText('9')).toHaveLength(0);
    });

    it('draws the forecast dashed and labels it, rather than colouring it', async () => {
        await renderCalendar(async () => busyWeek());
        await settled();

        const cell = `kitchen-order-desk-calendar-${FIRST}-slot-morning`;
        // The flag reaches the DOM as its own node, which is what carries the dashed outline.
        expect(screen.getByTestId(`${cell}-projected-forecast`)).toBeTruthy();
        // The two records are plain figures with no such wrapper — the drawing is the difference.
        expect(screen.queryByTestId(`${cell}-order-forecast`)).toBeNull();
        expect(screen.queryByTestId(`${cell}-scheduled-forecast`)).toBeNull();

        // And the meaning survives greyscale, a monochrome display and being read aloud. Twice,
        // because the day header carries the same figure as the square below it: the header is the
        // day's own total *per basis*, which is the one addition that is safe.
        expect(
            screen.getAllByLabelText(
                'Forecast: 4. Worked out from subscription patterns, not a booking.',
            ),
        ).toHaveLength(2);
    });

    it('renders the unslotted row last, and a true zero as a zero', async () => {
        await renderCalendar(async () => busyWeek());
        await settled();

        const legend = screen.getByTestId('kitchen-order-desk-calendar-grid-slot-legend', {
            includeHiddenElements: true,
        });
        expect(legend).toHaveTextContent(/Morning.*No slot named/s);

        // The unslotted bucket carries nothing on this day and the server said so by sending it
        // with three zeroes — so the square reads `0`, not a dash.
        const unslotted = screen.getByTestId(
            `kitchen-order-desk-calendar-${FIRST}-${UNSLOTTED_SLOT_KEY}`,
        );
        expect(screen.getByTestId(`${unslotted.props.testID as string}-empty`)).toHaveTextContent(
            '0',
        );
    });

    it('renders an em dash for a day the answer did not carry, never a zero', async () => {
        // The wire promises every day of the range; this authors the case where it did not keep
        // that promise, which is also what a week's grid looks like for a frame while the answer
        // for that week is in flight.
        await renderCalendar(async () => calendar([mondayWithOneOrder()]));
        await settled();

        const missing = `kitchen-order-desk-calendar-${SECOND}-slot-morning`;
        expect(screen.getByTestId(`${missing}-unknown`)).toHaveTextContent('—');
        // The dash is silent, so the square says in words that nobody asked about this day.
        expect(screen.getAllByLabelText('This day was not answered.').length).toBeGreaterThan(0);

        // The answered day is not a dash.
        expect(
            screen.queryByTestId(`kitchen-order-desk-calendar-${FIRST}-slot-morning-unknown`),
        ).toBeNull();
    });
});

describe('order desk calendar — moving through the weeks', () => {
    it('asks for one week at a time and announces the range it moved to', async () => {
        const asked: OrderDeskCalendarFilters[] = [];
        await renderCalendar(async (filters) => {
            asked.push(filters);
            return calendar(week([mondayWithOneOrder()]));
        });
        await settled();

        expect(asked[0]).toEqual({ from: MONDAY, to: SUNDAY });
        // The header states the range the screen drew, spelled by the locale's own formatter.
        expect(screen.getByTestId('kitchen-order-desk-calendar-range').props.children).toBeTruthy();

        fireEvent.press(screen.getByTestId('kitchen-order-desk-calendar-next'));

        await waitFor(
            () => {
                expect(asked).toHaveLength(2);
            },
            { timeout: 5000 },
        );
        expect(asked[1]).toEqual({ from: addDays(MONDAY, 7), to: addDays(SUNDAY, 7) });
        // Announced from the range the screen is about to draw rather than from the one that
        // eventually arrives: a live region that waited for a round trip would leave somebody with
        // no idea whether the press had registered. The message may carry a trailing zero-width
        // space — the parity trick that makes two identical announcements two text changes — so the
        // assertion is anchored at the front and left open at the back.
        expect(screen.getByTestId('kitchen-order-desk-calendar-announcer')).toHaveTextContent(
            /^Showing .+ to .+/,
        );

        fireEvent.press(screen.getByTestId('kitchen-order-desk-calendar-previous'));
        await waitFor(
            () => {
                expect(asked).toHaveLength(3);
            },
            { timeout: 5000 },
        );
        expect(asked[2]).toEqual({ from: MONDAY, to: SUNDAY });

        // Whatever week it is on, "this week" is the one containing today — derived from the same
        // Monday rule as everything else, never from a remembered starting point.
        fireEvent.press(screen.getByTestId('kitchen-order-desk-calendar-next'));
        await waitFor(() => {
            expect(asked).toHaveLength(4);
        });
        fireEvent.press(screen.getByTestId('kitchen-order-desk-calendar-today'));
        await waitFor(() => {
            expect(asked).toHaveLength(5);
        });
        expect(asked[4]).toEqual({ from: mondayOf(todayIso()), to: SUNDAY });
    });

    it('states the three books are not one, in words rather than by layout alone', async () => {
        await renderCalendar(async () => calendar(week([mondayWithOneOrder()])));
        await settled();

        expect(screen.getByTestId('kitchen-order-desk-calendar-bases')).toHaveTextContent(
            /never totalled/,
        );
        // The server's own count of squares — of days, never of work.
        expect(screen.getByTestId('kitchen-order-desk-calendar-day-count')).toHaveTextContent(
            /7 days/,
        );
    });
});
