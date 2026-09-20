import type { CalendarBasis, OrderDeskCalendarFilters } from '@healthy360/api-client/contracts';
import {
    Button,
    CalendarGrid,
    EmptyState,
    ErrorState,
    Icon,
    IconButton,
    Skeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { CalendarCell, CalendarDay } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useOrderDeskCalendarQuery } from '../../../data/order-desk-hooks.ts';
import { addDays, dateInstant, todayIso } from '../../planner/format.ts';
import { ORDER_VIEW_PERMISSION, SUBSCRIPTION_VIEW_PERMISSION } from '../entity-registry.ts';
import { humaniseCode } from '../format.ts';
import type { CalendarReading, CalendarSlotDescriptor } from '../order-desk-calendar.ts';
import {
    CALENDAR_WEEK_DAYS,
    calendarDayFor,
    calendarSlots,
    calendarWeek,
    dayReadings,
    isEmpty,
    isUnknown,
    slotReadings,
} from '../order-desk-calendar.ts';

/**
 * `/kitchen/order-desk/calendar` — the week the desk is about to work, counted three ways.
 *
 * ## Why a second view of orders the queue already lists
 *
 * The queue answers "what is next?" and is sorted by how close an hour is. This answers "what is
 * *coming*?", which is a different question with a different unit: a day. And it reaches two books
 * the queue cannot see at all — subscription deliveries the generator has already claimed, and days
 * an active subscription is merely *expected* to produce. Neither of those is an order yet, so
 * neither appears in an order queue, and both are exactly what somebody ordering ingredients on a
 * Thursday needs to know about next week.
 *
 * ## The three numbers are never added, on screen or anywhere behind it
 *
 * They overlap by construction — a projected day becomes a claimed one, a claimed one becomes an
 * order — so a total over-counts, and a kitchen buying from that total over-buys quietly. Nothing in
 * `order-desk-calendar.ts` returns a sum, and this screen renders three separately labelled figures
 * per square. The forecast column is the one that most invites addition, which is why it is also the one
 * that is drawn differently.
 *
 * ## `projected` is drawn as a forecast, and the drawing is not colour
 *
 * A dashed outline and its own label, never a filled accent surface: a solid violet block beside two
 * plain numbers reads as *emphasis* — "this is the important one" — when the meaning is the
 * opposite, that this figure is the least load-bearing thing on the square. Dashes are the
 * conventional drawing for "not committed", they survive greyscale and colour blindness, and the
 * label carries the meaning on its own for anybody reading the square aloud.
 *
 * ## Em dash and zero are different squares
 *
 * The wire sends **every day of the range** and, within a day, **only the slots carrying
 * something**. So a slot missing from an answered day is a true zero and prints `0`; a *date*
 * missing from the answer was never walked and prints an em dash. The second case is reachable — the
 * grid draws the week it navigated to while the answer for that week is still in flight — and a zero
 * there would be the calendar claiming nothing is due on a day nobody asked about. The rule lives in
 * `order-desk-calendar.ts` and is tested as arithmetic.
 *
 * ## The grid announces itself, because `CalendarGrid` deliberately does not
 *
 * The component claims no `role="grid"`: its DOM is column-major (every square of Monday, then every
 * square of Tuesday), and asserting a grid role over that would promise a screen reader a
 * row-by-row reading it cannot deliver. Each day is an honest labelled `group` instead, every square
 * carries its own slot name and its own accessible sentence, and week navigation — which changes the
 * entire grid without a navigation event — speaks through this screen's own polite live region,
 * modelled on the planner's (`features/planner/announcer.tsx`).
 *
 * ## Weekday order is the caller's, and there is no Arabic branch in this file
 *
 * The week starts on Monday (ISO 8601, the planner's own `mondayOf`) and the columns are rendered in
 * that order. Direction is handled by nothing at all: `CalendarGrid` lays day columns out as flex
 * children in source order, so Monday sits on the right under Arabic for free, and every visible
 * weekday name comes from the locale's own formatter. A `dir === 'rtl'` test anywhere in here would
 * be a second, worse copy of what the layout already does.
 *
 * ## No branch filter, on the queue's terms
 *
 * The endpoint takes one and this screen does not send it, for the reason the queue screen records
 * at length: an order delivered through an organisation-wide zone carries `branch_id: NULL`, so
 * narrowing by the active branch would not scope the calendar, it would delete unattributed work
 * from a planning surface whose whole job is that nothing is missed. A picker belongs to a later
 * slice, where somebody chooses to narrow and can see that they have.
 */

/* ── the live region ─────────────────────────────────────────────────────────────────────────── */

/** Zero-width space, written as an escape so it is visible in a diff. Invisible, and not spoken. */
const INVISIBLE = '\u200B';

interface AnnouncementState {
    readonly text: string;
    /** Flipped on every announcement so two identical messages are still two text changes. */
    readonly parity: 0 | 1;
}

/**
 * Holds the current announcement.
 *
 * A local copy of the planner's `usePlannerAnnouncement` rather than an import of it: that hook and
 * its component are named for the planner, carry the planner's test id, and live in a feature this
 * workspace's chunk has no other reason to reach into. The parity suffix is the part worth copying —
 * two identical successive announcements ("Showing 17 to 23 August", pressed forward then back then
 * forward) are one unchanged text node to a live region, and the second is silently dropped.
 */
function useCalendarAnnouncement(): {
    readonly message: string;
    readonly announce: (message: string) => void;
} {
    const [state, setState] = useState<AnnouncementState>({ text: '', parity: 0 });

    const announce = useCallback((next: string) => {
        setState((current) => ({ text: next, parity: current.parity === 0 ? 1 : 0 }));
    }, []);

    return {
        message: state.text === '' ? '' : `${state.text}${state.parity === 1 ? INVISIBLE : ''}`,
        announce,
    };
}

/* ── the squares ─────────────────────────────────────────────────────────────────────────────── */

/** What a square with nothing to say renders as — the workspace's one character for an unknown. */
const EM_DASH = '—';

const BASIS_LABEL_KEYS: Readonly<Record<CalendarBasis, string>> = {
    order: 'kitchen:calendar.basis.order',
    scheduled: 'kitchen:calendar.basis.scheduled',
    projected: 'kitchen:calendar.basis.projected',
};

/** The kitchen's own words for the day's three slots; any other code is humanised as sent. */
const SLOT_LABEL_KEYS: Readonly<Record<string, string>> = {
    morning: 'kitchen:calendar.slot.breakfast',
    breakfast: 'kitchen:calendar.slot.breakfast',
    midday: 'kitchen:calendar.slot.lunch',
    lunch: 'kitchen:calendar.slot.lunch',
    afternoon: 'kitchen:calendar.slot.snack',
    snack: 'kitchen:calendar.slot.snack',
    evening: 'kitchen:calendar.slot.dinner',
    dinner: 'kitchen:calendar.slot.dinner',
};

/**
 * One book's figure.
 *
 * The forecast wears a dashed box **and** says so in its accessible sentence, because the box is
 * invisible to somebody listening and the difference between "four orders" and "four expected" is
 * the difference between cooking and not.
 */
function Reading({
    reading,
    emphasis = false,
    testID,
}: {
    readonly reading: CalendarReading;
    /** The day's own figures, at the head of its column, read larger than the slots under them. */
    readonly emphasis?: boolean | undefined;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const label = t(BASIS_LABEL_KEYS[reading.basis]);
    // Only ever called for a known square: the unknown branch is taken whole, above.
    const count = reading.count ?? 0;

    const line = (
        <View className="flex-row items-center justify-between gap-hair">
            <Text variant="micro" tone="secondary">
                {label}
            </Text>
            <Text
                // Orders is the book that exists, so it is the one figure a day's head sets large.
                // A zero is a true zero and reads quieter than a count, never as a dash.
                variant={emphasis && reading.basis === 'order' ? 'display' : 'strong'}
                tone={
                    count === 0 ? 'secondary' : reading.basis === 'scheduled' ? 'brand' : 'primary'
                }
                className="tabular-nums"
                testID={testID}
            >
                {String(count)}
            </Text>
        </View>
    );

    if (!reading.forecast) return line;

    return (
        <View
            testID={`${testID}-forecast`}
            // Dashed, never a filled accent surface — see the file header. `border-stroke-strong` is
            // the plain token; nothing here is a brand colour, because this figure is the *least*
            // emphatic thing on the square.
            className="rounded-sm border border-dashed border-stroke-strong px-control-xs"
            accessibilityLabel={t('kitchen:calendar.a11y.projected', { count })}
        >
            {line}
        </View>
    );
}

/**
 * A square: the slot it belongs to, and its three books.
 *
 * The slot name is repeated inside every square rather than sitting once at the head of a row,
 * because this grid has no row headers to put it in — `CalendarGrid`'s DOM is column-major and its
 * slot list is a decorative legend. A square that named no slot would be four numbers with nothing
 * to attach them to, for a sighted reader as much as for a screen reader.
 */
function CalendarSquare({
    label,
    readings,
    today,
    testID,
}: {
    readonly label: string;
    readonly readings: readonly CalendarReading[];
    readonly today: boolean;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const unknown = isUnknown(readings);
    const empty = !unknown && isEmpty(readings);

    return (
        <View
            testID={testID}
            // No outline: structure comes from alignment and the gap between squares. Today's
            // column takes the brand tint so the eye finds it without reading a date.
            className={
                today
                    ? 'rounded bg-surface-brand-subtle px-tight py-tight'
                    : 'rounded bg-surface-raised px-tight py-tight'
            }
        >
            <View className="flex-col gap-hair">
                <Text variant="strong">{label}</Text>

                {unknown ? (
                    <Text
                        tone="secondary"
                        testID={`${testID}-unknown`}
                        accessibilityLabel={t('kitchen:calendar.a11y.unknown')}
                    >
                        {EM_DASH}
                    </Text>
                ) : empty ? (
                    // A single figure rather than three zeroes: they are all the same zero, and
                    // seven columns of "0 0 0" would bury the days that carry something. It is a
                    // *zero* and not a dash, because the server walked this day and found nothing.
                    <Text
                        tone="secondary"
                        testID={`${testID}-empty`}
                        accessibilityLabel={t('kitchen:calendar.a11y.nothing')}
                    >
                        {'0'}
                    </Text>
                ) : (
                    readings.map((reading) => (
                        <Reading
                            key={reading.basis}
                            reading={reading}
                            testID={`${testID}-${reading.basis}`}
                        />
                    ))
                )}
            </View>
        </View>
    );
}

/* ── the screen ──────────────────────────────────────────────────────────────────────────────── */

export function OrderDeskCalendarScreen() {
    return (
        <Gate
            area="kitchen"
            // Both codes, because the endpoint requires both: two of the three bases are
            // subscription arithmetic. The hub card is offered on the order code alone — the
            // registry carries one permission per family — so a role composed with only that half
            // reaches the workspace's own refusal page here, which is what that page is for.
            requirement={{ allOf: [ORDER_VIEW_PERMISSION, SUBSCRIPTION_VIEW_PERMISSION] }}
            testID="kitchen-order-desk-calendar"
        >
            <OrderDeskCalendarWeek />
        </Gate>
    );
}

function OrderDeskCalendarWeek() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { message, announce } = useCalendarAnnouncement();

    const [anchor, setAnchor] = useState(() => todayIso());

    /**
     * What is asked for, and what is drawn — deliberately two ranges rather than one.
     *
     * The **requested** range is the whole week and is never clamped, because it is the query key:
     * a clamp applied here would change the key, land on an entry that has no answer in it, lose
     * the ceiling it clamped by, and un-clamp — a loop built out of a safety check. Seven days is
     * inside every ceiling this endpoint has ever declared, so the request needs no guard.
     *
     * The **drawn** range is clamped by `meta.maxWindowDays` from the answer in hand. That is where
     * the bound belongs and where it costs nothing: it reads a number the server *sent*, it feeds
     * only the grid, and if a later slice widens this view to a month it inherits a calendar that
     * shortens itself rather than one that fails in front of somebody. Nothing today comes near
     * sixty, so the two ranges are the same seven days — which is exactly the state a guard should
     * be in.
     */
    const requested = useMemo(() => calendarWeek(anchor, null), [anchor]);

    /** One object, memoised, because it *is* the query key (query-key shape rule 3). */
    const filters = useMemo<OrderDeskCalendarFilters>(
        () => ({ from: requested.from, to: requested.to }),
        [requested],
    );

    const calendar = useOrderDeskCalendarQuery(filters);
    const ceiling = calendar.data?.meta.maxWindowDays ?? null;
    const range = useMemo(() => calendarWeek(anchor, ceiling), [anchor, ceiling]);

    const days = useMemo(() => calendar.data?.days ?? [], [calendar.data]);
    const meta = calendar.data?.meta ?? null;
    const failure = toFailure(calendar.error);
    const slots = useMemo<readonly CalendarSlotDescriptor[]>(() => calendarSlots(days), [days]);

    /** A week the server answered and found nothing in — not the same as one it has not answered. */
    const quiet = days.length > 0 && days.every((day) => isEmpty(dayReadings(day)));

    const today = todayIso();

    const rangeLabel = t('kitchen:calendar.range', {
        from: formatter.formatDate(dateInstant(range.from), { day: 'numeric', month: 'long' }),
        to: formatter.formatDate(dateInstant(range.to), {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        }),
    });

    /**
     * Move the week, and say so.
     *
     * The announcement is made from the range the screen is *about* to draw rather than from the
     * one that eventually arrives: the person pressed a button and a live region that waited for a
     * network round trip would leave them with no idea whether the press had registered. The
     * counts filling in afterwards are not announced — a second utterance per navigation would be
     * noise, and the squares are readable on their own.
     */
    const goTo = (nextAnchor: string) => {
        setAnchor(nextAnchor);
        const next = calendarWeek(nextAnchor, ceiling);
        announce(
            t('kitchen:calendar.a11y.showing', {
                from: formatter.formatDate(dateInstant(next.from), {
                    day: 'numeric',
                    month: 'long',
                }),
                to: formatter.formatDate(dateInstant(next.to), {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                }),
            }),
        );
    };

    const calendarDays: readonly CalendarDay[] = range.dates.map((date) => ({
        key: date,
        label: formatter.formatDate(dateInstant(date), {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
        }),
        shortLabel: formatter.formatDate(dateInstant(date), { weekday: 'short' }),
        sublabel: formatter.formatDate(dateInstant(date), { day: 'numeric', month: 'short' }),
        today: date === today,
    }));

    const renderDayHeader = (day: CalendarDay) => {
        const testID = `kitchen-order-desk-calendar-day-${day.key}`;
        const isToday = day.today === true;
        // The date and nothing else — the figures live in the slot squares below. Today's column
        // keeps its brand tint so the eye still finds it.
        return (
            <View
                testID={testID}
                className={
                    isToday
                        ? 'rounded bg-surface-brand-subtle px-tight py-tight'
                        : 'rounded bg-surface-sunken px-tight py-tight'
                }
            >
                <Text variant="section" tone={isToday ? 'brand' : 'primary'}>
                    {day.sublabel === undefined
                        ? (day.shortLabel ?? day.label)
                        : `${day.shortLabel ?? day.label} ${day.sublabel}`}
                </Text>
            </View>
        );
    };

    const renderCell = (cell: CalendarCell) => {
        if (cell.slot === null) return null;
        const descriptor = slots.find((candidate) => candidate.key === cell.slot?.key);
        if (descriptor === undefined) return null;
        const day = calendarDayFor(days, cell.day.key);
        return (
            <CalendarSquare
                label={cell.slot.label}
                readings={slotReadings(day, descriptor.code)}
                today={cell.day.today === true}
                testID={`kitchen-order-desk-calendar-${cell.day.key}-${cell.slot.key}`}
            />
        );
    };

    return (
        <Stack space="md" testID="kitchen-order-desk-calendar-screen">
            {/*
             * The live region. Week navigation changes the whole grid without a navigation
             * event, so the move is spoken here — see `useCalendarAnnouncement`. Always mounted: a
             * region inserted with its text already in it is not announced. Visually hidden.
             */}
            <Text
                testID="kitchen-order-desk-calendar-announcer"
                role="status"
                aria-live="polite"
                accessibilityLiveRegion="polite"
                variant="caption"
                tone="secondary"
                className="absolute h-px w-px overflow-hidden opacity-0"
            >
                {message}
            </Text>

            {/* One 28px row: the week stepper and the range it is on. */}
            <View
                testID="kitchen-order-desk-calendar-toolbar"
                className="min-h-control-sm flex-row flex-wrap items-center gap-tight rounded-panel border border-brand-100 bg-surface-raised p-tight shadow-elevation-card"
            >
                <View className="flex-row items-center gap-hair">
                    <IconButton
                        testID="kitchen-order-desk-calendar-previous"
                        size="sm"
                        variant="secondary"
                        label={t('kitchen:calendar.previousWeek')}
                        icon={<Icon name="chevronBackward" size="sm" />}
                        onPress={() => {
                            goTo(addDays(range.from, -CALENDAR_WEEK_DAYS));
                        }}
                    />
                    <Button
                        testID="kitchen-order-desk-calendar-today"
                        size="sm"
                        variant="secondary"
                        label={t('kitchen:calendar.thisWeek')}
                        onPress={() => {
                            goTo(today);
                        }}
                    />
                    <IconButton
                        testID="kitchen-order-desk-calendar-next"
                        size="sm"
                        variant="secondary"
                        label={t('kitchen:calendar.nextWeek')}
                        icon={<Icon name="chevronForward" size="sm" />}
                        onPress={() => {
                            goTo(addDays(range.from, CALENDAR_WEEK_DAYS));
                        }}
                    />
                </View>
                <Text variant="mono" testID="kitchen-order-desk-calendar-range">
                    {rangeLabel}
                </Text>
                {meta === null ? null : (
                    // How many squares the server actually walked. A count of *days*, never of
                    // work: there is no count of work anywhere in this response, because that
                    // would be the total the three books must not have.
                    <Text
                        variant="caption"
                        tone="secondary"
                        role="status"
                        aria-live="polite"
                        testID="kitchen-order-desk-calendar-day-count"
                    >
                        {t('kitchen:calendar.dayCount', { count: meta.dayCount })}
                    </Text>
                )}
            </View>

            {calendar.isPending ? (
                <View testID="kitchen-order-desk-calendar-loading" className="flex-row gap-tight">
                    {Array.from({ length: CALENDAR_WEEK_DAYS }, (_, index) => (
                        // eslint-disable-next-line no-restricted-syntax -- each skeleton column is a share of the row.
                        <View key={index} className="flex-1">
                            <Skeleton
                                testID={`kitchen-order-desk-calendar-skeleton-${String(index + 1)}`}
                                heightClassName="h-40"
                            />
                        </View>
                    ))}
                </View>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-order-desk-calendar-error"
                    title={t('kitchen:calendar.loadErrorTitle')}
                    failure={failure}
                    onRetry={() => {
                        void calendar.refetch();
                    }}
                    retrying={calendar.isFetching}
                />
            ) : quiet ? (
                <EmptyState
                    testID="kitchen-order-desk-calendar-empty"
                    title={t('kitchen:calendar.emptyTitle')}
                    body={t('kitchen:calendar.emptyBody')}
                />
            ) : (
                <View className="flex-col gap-snug">
                    <CalendarGrid
                        testID="kitchen-order-desk-calendar-grid"
                        label={t('kitchen:calendar.gridLabel', { range: rangeLabel })}
                        days={calendarDays}
                        // `undefined` rather than an invented row when no slot carries anything:
                        // the day headers already say what the week holds, and a row of dashes
                        // about a bucket nobody used would be furniture.
                        slots={
                            slots.length === 0
                                ? undefined
                                : slots.map((slot) => ({
                                      key: slot.key,
                                      label:
                                          slot.code === null
                                              ? t('kitchen:calendar.noSlot')
                                              : slot.code in SLOT_LABEL_KEYS
                                                ? t(SLOT_LABEL_KEYS[slot.code] as string)
                                                : humaniseCode(slot.code),
                                  }))
                        }
                        showSlotLegend={false}
                        renderDayHeader={renderDayHeader}
                        renderCell={renderCell}
                    />
                </View>
            )}
        </Stack>
    );
}
