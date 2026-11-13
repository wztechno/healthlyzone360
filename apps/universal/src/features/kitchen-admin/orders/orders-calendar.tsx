import type { OrderDeskCalendarDay, OrderDeskPlanMeal } from '@healthy360/api-client/contracts';
import { ErrorState, Icon, Skeleton, Text, useBreakpoint } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { toFailure } from '../../../data/hooks.ts';
import {
    useOrderDeskCalendarQuery,
    useOrderDeskPlanMealsQuery,
} from '../../../data/order-desk-hooks.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { addDays, dateInstant, mondayOf, weekDates } from '../../planner/format.ts';
import { LensBar } from '../catalogue/lens-bar.tsx';
import { DeskButton, DeskChip, DeskIconButton, DeskSelect, DeskTabs } from '../desk-kit/index.ts';
import type { LensFigure } from '../catalogue/lens-bar.tsx';
import { kitchenOrderFulfilmentTypeKey, kitchenOrderRowTestId } from '../ops-format.ts';
import { windowCodesOfMeal } from '../order-desk-calendar.ts';
import type { CalendarMeal } from '../order-desk-calendar.ts';
import { longDay, orderStatusLabel, orderStatusTone, shortDay } from './order-columns.tsx';
import {
    daysBetween,
    firstOfMonth,
    groupBySlot,
    isLateOrder,
    lastOfMonth,
    matchesSlot,
    monthGrid,
    monthOf,
    orderDay,
    shiftMonth,
    slotKeyOf,
    windowHours,
} from './order-book.ts';
import type { BookRow, SlotFilter, SlotKey } from './order-book.ts';
import type { CalendarMode, OrdersQuery } from './orders-url.ts';
import { SLOT_MEALS } from './orders-url.ts';
import {
    useDayOrders,
    useDeliveryWindows,
    useOpenOrdersBetween,
    useOrdersBetween,
} from './use-order-book.ts';

/**
 * The Calendar tab: a month or a week of days, each with how many orders it holds, its plan meals,
 * and what on it still needs somebody — and, beside the grid, the chosen day opened up: its orders
 * by slot, and the ways on to that day.
 *
 * The counts are the order-desk calendar's (every order but a cancelled one, on its requested day
 * or the day it was placed), and the day's list is read on the same rule, so the two agree. Plan
 * meals are the subscription days the generator has claimed — or, further out, the ones it is only
 * expected to, which the square says are expected. The two are never added to the orders.
 */

const EM_DASH = '—';

type Formatter = ReturnType<typeof useFormatter>;

/** The day's count of orders, or of one sitting's, on the calendar's books. `null`: not answered. */
function slotCount(
    day: OrderDeskCalendarDay | null,
    slot: SlotFilter,
    basis: 'order' | 'scheduled' | 'projected',
): number | null {
    if (day === null) return null;
    if (slot === 'all') return day.counts[basis];
    const codes = windowCodesOfMeal(slot);
    return day.windows
        .filter((window) => window.code !== null && codes.includes(window.code))
        .reduce((sum, window) => sum + window.counts[basis], 0);
}

/** Plan meals: claimed where there are any, otherwise what is expected — said as such. */
function planMeals(
    day: OrderDeskCalendarDay | null,
    slot: SlotFilter,
): { readonly count: number; readonly expected: boolean } | null {
    const scheduled = slotCount(day, slot, 'scheduled');
    const projected = slotCount(day, slot, 'projected');
    if (scheduled === null || projected === null) return null;
    return scheduled > 0
        ? { count: scheduled, expected: false }
        : { count: projected, expected: true };
}

export function CalendarTab({
    query,
    update,
    today,
    now,
    figures,
    actions,
    onOpenOrder,
    onNewOrder,
}: {
    readonly query: OrdersQuery;
    readonly update: (patch: Partial<OrdersQuery>) => void;
    readonly today: string;
    readonly now: Date;
    readonly figures: readonly LensFigure[];
    readonly actions?: ReactNode;
    readonly onOpenOrder: (order: BookRow, list?: readonly BookRow[]) => void;
    readonly onNewOrder: (day: string) => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { atLeast } = useBreakpoint();
    const sel = query.sel ?? today;
    const month = query.month ?? monthOf(sel);
    const mode = query.mode;

    const grid = useMemo(() => monthGrid(month), [month]);
    const week = useMemo(() => weekDates(mondayOf(sel)), [sel]);
    // Today view: one day, the selected one, drawn as a single wide column.
    const shown = useMemo(() => (mode === 'day' ? [sel] : week), [mode, sel, week]);
    const from = mode === 'month' ? (grid[0] ?? firstOfMonth(month)) : (shown[0] ?? sel);
    const to =
        mode === 'month'
            ? (grid[grid.length - 1] ?? lastOfMonth(month))
            : (shown[shown.length - 1] ?? sel);

    /*
     * The counts are always read for a whole month's grid — in Week view, the grid of the month
     * its Monday is in, which holds the whole week. The plan-meal forecast walks a subscription's
     * remaining meals from the first day asked about, so a week read on its own would forecast
     * different numbers for the same day than the month around it.
     */
    const countsGrid = useMemo(
        () => (mode === 'month' ? grid : monthGrid(monthOf(shown[0] ?? sel))),
        [mode, grid, shown, sel],
    );
    const calendarFilters = useMemo(
        () => ({
            from: countsGrid[0] ?? from,
            to: countsGrid[countsGrid.length - 1] ?? to,
        }),
        [countsGrid, from, to],
    );
    const calendar = useOrderDeskCalendarQuery(calendarFilters);
    const open = useOpenOrdersBetween(from, to);
    const weekOrders = useOrdersBetween(from, to, mode !== 'month');
    const windows = useDeliveryWindows();

    const days = calendar.data?.days ?? null;
    const dayOf = (date: string): OrderDeskCalendarDay | null =>
        days === null ? null : (days.find((candidate) => candidate.date === date) ?? null);

    const marks = useMemo(() => {
        const byDay = new Map<string, { confirm: number; late: number }>();
        for (const row of open.rows) {
            if (!matchesSlot(row, query.slot)) continue;
            const key = orderDay(row);
            const held = byDay.get(key) ?? { confirm: 0, late: 0 };
            if (row.status === 'placed') held.confirm += 1;
            if (isLateOrder(row, now, windows)) held.late += 1;
            byDay.set(key, held);
        }
        return byDay;
    }, [open.rows, query.slot, now, windows]);

    const shownDays = mode === 'month' ? grid.filter((day) => monthOf(day) === month) : shown;
    const shownCount =
        days === null
            ? null
            : shownDays.reduce(
                  (sum, day) => sum + (slotCount(dayOf(day), query.slot, 'order') ?? 0),
                  0,
              );

    const failure = toFailure(calendar.error);
    const title =
        mode === 'month'
            ? formatter.formatDate(dateInstant(firstOfMonth(month)), {
                  month: 'long',
                  year: 'numeric',
              })
            : mode === 'day'
              ? longDay(sel, formatter)
              : t('kitchen:orders.calendar.weekRange', {
                    from: shortDay(week[0] ?? sel, formatter),
                    to: shortDay(week[6] ?? sel, formatter),
                });

    function step(delta: number) {
        if (mode === 'month') {
            update({ month: shiftMonth(month, delta) });
        } else {
            const next = addDays(sel, delta * (mode === 'day' ? 1 : 7));
            update({ sel: next, month: monthOf(next) });
        }
    }

    const wide = atLeast('lg');

    return (
        <View className="z-auto flex-col gap-4">
            <LensBar
                testID="kitchen-orders-calendar-toolbar"
                layout="split"
                compactSearch
                label={t('kitchen:orders.calendar.label')}
                figures={figures}
                actions={actions}
                scope={
                    <>
                        <View className="flex-row items-center gap-1">
                            <DeskIconButton
                                testID="kitchen-orders-calendar-previous"
                                label={t(
                                    mode === 'month'
                                        ? 'kitchen:orders.calendar.previousMonth'
                                        : mode === 'day'
                                          ? 'kitchen:orders.day.previous'
                                          : 'kitchen:orders.calendar.previousWeek',
                                )}
                                icon={<Icon name="chevronBackward" size="md" />}
                                onPress={() => {
                                    step(-1);
                                }}
                            />
                            <Text
                                variant="strong"
                                align="center"
                                className="min-w-[170px] font-display !text-[17px] !font-bold"
                                testID="kitchen-orders-calendar-title"
                            >
                                {title}
                            </Text>
                            <DeskIconButton
                                testID="kitchen-orders-calendar-next"
                                label={t(
                                    mode === 'month'
                                        ? 'kitchen:orders.calendar.nextMonth'
                                        : mode === 'day'
                                          ? 'kitchen:orders.day.next'
                                          : 'kitchen:orders.calendar.nextWeek',
                                )}
                                icon={<Icon name="chevronForward" size="md" />}
                                onPress={() => {
                                    step(1);
                                }}
                            />
                        </View>
                        <DeskTabs<CalendarMode>
                            testID="kitchen-orders-calendar-mode"
                            size="sm"
                            label={t('kitchen:orders.calendar.modeLabel')}
                            value={mode}
                            onChange={(next) => {
                                if (next === 'day') {
                                    // Today opens on today, whichever day was chosen before.
                                    update({ mode: next, sel: null, month: null });
                                    return;
                                }
                                update({
                                    mode: next,
                                    month: next === 'month' ? monthOf(sel) : month,
                                });
                            }}
                            items={[
                                {
                                    value: 'month',
                                    label: t('kitchen:orders.calendar.month'),
                                    testID: 'kitchen-orders-calendar-mode-month',
                                },
                                {
                                    value: 'week',
                                    label: t('kitchen:orders.calendar.week'),
                                    testID: 'kitchen-orders-calendar-mode-week',
                                },
                                {
                                    value: 'day',
                                    label: t('kitchen:orders.day.today'),
                                    testID: 'kitchen-orders-calendar-mode-day',
                                },
                            ]}
                        />
                        <View aria-hidden className="mx-1 h-[22px] w-px bg-stroke-subtle" />
                        <SlotScope
                            testID="kitchen-orders-calendar-slot"
                            value={query.slot}
                            onChange={(slot) => {
                                update({ slot });
                            }}
                        />
                    </>
                }
                result={
                    shownCount === null
                        ? null
                        : t(
                              mode === 'month'
                                  ? 'kitchen:orders.calendar.monthCount'
                                  : mode === 'day'
                                    ? 'kitchen:orders.count'
                                    : 'kitchen:orders.calendar.weekCount',
                              { count: shownCount },
                          )
                }
                clearLabel={t('kitchen:orders.clearFilters')}
                {...(query.slot === 'all'
                    ? {}
                    : {
                          onClear: () => {
                              update({ slot: 'all' });
                          },
                      })}
            />

            <View className={wide ? 'z-auto flex-row items-start gap-3' : 'z-auto flex-col gap-3'}>
                {}
                <View className="min-w-0 flex-1">
                    {calendar.isPending ? (
                        <Skeleton testID="kitchen-orders-calendar-loading" heightClassName="h-96" />
                    ) : failure !== null ? (
                        <ErrorState
                            testID="kitchen-orders-calendar-error"
                            title={t('kitchen:calendar.loadErrorTitle')}
                            failure={failure}
                            onRetry={() => {
                                void calendar.refetch();
                            }}
                            retrying={calendar.isFetching}
                        />
                    ) : mode === 'month' ? (
                        <MonthGrid
                            days={grid}
                            month={month}
                            today={today}
                            sel={sel}
                            slot={query.slot}
                            dayOf={dayOf}
                            marks={marks}
                            onPick={(day) => {
                                update({ sel: day });
                            }}
                        />
                    ) : (
                        <WeekColumns
                            days={shown}
                            today={today}
                            sel={sel}
                            slot={query.slot}
                            dayOf={dayOf}
                            rows={weekOrders.rows}
                            pending={weekOrders.pending}
                            now={now}
                            hl={query.hl}
                            onPick={(day) => {
                                update({ sel: day });
                            }}
                            onOpenOrder={onOpenOrder}
                        />
                    )}
                </View>
                <DayPanel
                    day={sel}
                    today={today}
                    now={now}
                    slot={query.slot}
                    calendarDay={dayOf(sel)}
                    wide={wide}
                    hl={query.hl}
                    formatter={formatter}
                    onOpenOrder={onOpenOrder}
                    onNewOrder={onNewOrder}
                    onOpenDay={() => {
                        update({ tab: 'today', day: sel === today ? null : sel });
                    }}
                />
            </View>
        </View>
    );
}

/** "Slot  All ▾" — the four sittings, as the kitchen runs them. */
export function SlotScope({
    value,
    onChange,
    testID,
}: {
    readonly value: SlotFilter;
    readonly onChange: (slot: SlotFilter) => void;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    return (
        <DeskSelect<SlotFilter>
            testID={testID}
            label={t('kitchen:orders.filter.slot')}
            value={value}
            onChange={onChange}
            options={[
                { value: 'all', label: t('kitchen:orders.filter.all'), testID: `${testID}-all` },
                ...SLOT_MEALS.map((meal: CalendarMeal) => ({
                    value: meal,
                    label: t(`kitchen:calendar.slot.${meal}`),
                    testID: `${testID}-${meal}`,
                })),
            ]}
        />
    );
}

/* ── the month ───────────────────────────────────────────────────────────────────────────────── */

function MonthGrid({
    days,
    month,
    today,
    sel,
    slot,
    dayOf,
    marks,
    onPick,
}: {
    readonly days: readonly string[];
    readonly month: string;
    readonly today: string;
    readonly sel: string;
    readonly slot: SlotFilter;
    readonly dayOf: (day: string) => OrderDeskCalendarDay | null;
    readonly marks: ReadonlyMap<string, { readonly confirm: number; readonly late: number }>;
    readonly onPick: (day: string) => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const weeks: (readonly string[])[] = [];
    for (let index = 0; index < days.length; index += 7) weeks.push(days.slice(index, index + 7));

    return (
        <View testID="kitchen-orders-calendar-month" className="flex-col gap-1.5">
            <View className="flex-row gap-1.5" aria-hidden>
                {(weeks[0] ?? []).map((day) => (
                    <View key={day} className="flex-1 ps-2.5">
                        <Text
                            variant="micro"
                            tone="secondary"
                            className="!text-[11px] font-bold uppercase tracking-wider"
                        >
                            {formatter.formatDate(dateInstant(day), { weekday: 'short' })}
                        </Text>
                    </View>
                ))}
            </View>
            {weeks.map((weekDays) => (
                <View key={weekDays[0]} className="flex-row gap-1.5">
                    {weekDays.map((day) => {
                        const count = slotCount(dayOf(day), slot, 'order');
                        const plan = planMeals(dayOf(day), slot);
                        const mark = marks.get(day);
                        const outside = monthOf(day) !== month;
                        const chosen = day === sel;
                        return (
                            <Pressable
                                key={day}
                                testID={`kitchen-orders-calendar-day-${day}`}
                                role="button"
                                accessibilityRole="button"
                                accessibilityState={{ selected: chosen }}
                                accessibilityLabel={t('kitchen:orders.calendar.dayA11y', {
                                    day: longDay(day, formatter),
                                    count: count ?? 0,
                                })}
                                onPress={() => {
                                    onPick(day);
                                }}

                                className={`min-h-[112px] flex-1 flex-col items-start gap-[3px] rounded-[14px] border bg-surface-raised p-2.5 web:transition-transform hover:-translate-y-px ${
                                    chosen
                                        ? `border-surface-brand ${SELECTED_RING}`
                                        : 'border-stroke-subtle hover:border-stroke'
                                } ${outside ? 'opacity-45' : ''}`}
                            >
                                <View
                                    className={`h-7 min-w-7 items-center justify-center rounded-full px-1.5 ${
                                        day === today ? 'bg-surface-brand' : ''
                                    }`}
                                >
                                    <Text
                                        variant="strong"
                                        className={`!text-sm !font-bold tabular-nums ${day === today ? '!text-content-on-brand' : ''}`}
                                        tone={count === 0 ? 'secondary' : 'primary'}
                                    >
                                        {formatter.formatNumber(Number(day.slice(8, 10)))}
                                    </Text>
                                </View>
                                {count === null ? (
                                    <Text tone="secondary">{EM_DASH}</Text>
                                ) : count === 0 ? null : (
                                    <Text
                                        variant="label"
                                        className="font-display !text-[15px] !font-bold tabular-nums"
                                        testID={`kitchen-orders-calendar-day-${day}-orders`}
                                    >
                                        {t('kitchen:orders.count', { count })}
                                    </Text>
                                )}
                                {plan === null || plan.count === 0 ? null : (
                                    <Text
                                        variant="label"
                                        tone="secondary"
                                        className="!text-xs"
                                        testID={`kitchen-orders-calendar-day-${day}-plan`}
                                    >
                                        {t(
                                            plan.expected
                                                ? 'kitchen:orders.calendar.planExpected'
                                                : 'kitchen:orders.calendar.plan',
                                            { count: plan.count },
                                        )}
                                    </Text>
                                )}
                                <View className="mt-auto flex-row flex-wrap gap-[3px]">
                                    {mark === undefined || mark.confirm === 0 ? null : (
                                        <DeskChip
                                            testID={`kitchen-orders-calendar-day-${day}-confirm`}
                                            tone="warning"
                                            size="sm"
                                            label={t('kitchen:orders.calendar.toConfirm', {
                                                count: mark.confirm,
                                            })}
                                        />
                                    )}
                                    {mark === undefined || mark.late === 0 ? null : (
                                        <DeskChip
                                            testID={`kitchen-orders-calendar-day-${day}-late`}
                                            tone="danger"
                                            size="sm"
                                            label={t('kitchen:orders.calendar.late', {
                                                count: mark.late,
                                            })}
                                        />
                                    )}
                                </View>
                            </Pressable>
                        );
                    })}
                </View>
            ))}
        </View>
    );
}

/** The chosen day's 2px brand ring, outside its 1px border (`.mc.sel`, `.wc.sel`). */
const SELECTED_RING = 'shadow-[0_0_0_2px_rgb(var(--h360-color-brand-surface))]';

/* ── the week ────────────────────────────────────────────────────────────────────────────────── */

const DOT_CLASS: Readonly<Record<string, string>> = {
    warning: 'bg-warning-border',
    info: 'bg-info',
    success: 'bg-success',
    neutral: 'bg-stroke-strong',
    danger: 'bg-danger',
    brand: 'bg-surface-brand',
};

function WeekColumns({
    days,
    today,
    sel,
    slot,
    dayOf,
    rows,
    pending,
    now,
    hl,
    onPick,
    onOpenOrder,
}: {
    readonly days: readonly string[];
    readonly today: string;
    readonly sel: string;
    readonly slot: SlotFilter;
    readonly dayOf: (day: string) => OrderDeskCalendarDay | null;
    readonly rows: readonly BookRow[];
    readonly pending: boolean;
    readonly now: Date;
    readonly hl: string | null;
    readonly onPick: (day: string) => void;
    readonly onOpenOrder: (order: BookRow, list?: readonly BookRow[]) => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const windows = useDeliveryWindows();
    const slotName = useSlotName();

    return (
        <View testID="kitchen-orders-calendar-week" className="flex-row gap-1.5">
            {days.map((day) => {
                const dayRows = rows.filter(
                    (row) =>
                        orderDay(row) === day &&
                        row.status !== 'cancelled' &&
                        matchesSlot(row, slot),
                );
                const count = slotCount(dayOf(day), slot, 'order');
                const plan = planMeals(dayOf(day), slot);
                const groups = groupBySlot(dayRows);
                return (
                    <View
                        key={day}
                        testID={`kitchen-orders-calendar-week-${day}`}

                        className={`min-w-0 flex-1 flex-col gap-1.5 rounded-xl border bg-surface-raised p-1.5 ${
                            day === sel
                                ? `border-surface-brand ${SELECTED_RING}`
                                : 'border-stroke-subtle'
                        }`}
                    >
                        <Pressable
                            testID={`kitchen-orders-calendar-week-${day}-pick`}
                            role="button"
                            accessibilityRole="button"
                            accessibilityState={{ selected: day === sel }}
                            onPress={() => {
                                onPick(day);
                            }}
                            className="flex-col gap-0.5 rounded-[10px] px-2 py-1.5 hover:bg-surface-sunken"
                        >
                            <Text
                                variant="strong"
                                className="!text-sm !font-bold"
                                tone={day === today ? 'brand' : 'primary'}
                            >
                                {shortDay(day, formatter)}
                            </Text>
                            <Text variant="label" tone="secondary" className="!font-semibold">
                                {[
                                    count === null ? EM_DASH : t('kitchen:orders.count', { count }),
                                    plan === null || plan.count === 0
                                        ? null
                                        : t('kitchen:orders.calendar.planShort', {
                                              count: plan.count,
                                          }),
                                ]
                                    .filter((part): part is string => part !== null)
                                    .join(' · ')}
                            </Text>
                        </Pressable>
                        {pending ? (
                            <Skeleton heightClassName="h-16" />
                        ) : groups.length === 0 ? (
                            <Text variant="caption" tone="secondary" className="px-1.5">
                                {t('kitchen:orders.calendar.noOrders')}
                            </Text>
                        ) : (
                            groups.map((group) => (
                                <View key={group.key} className="flex-col gap-1">
                                    <Text
                                        variant="micro"
                                        tone="secondary"
                                        className="px-2 pt-1 !text-[10px] font-bold uppercase tracking-wider"
                                    >
                                        {slotName(group.key)}
                                    </Text>
                                    {group.rows.map((row) => {
                                        const late = isLateOrder(row, now, windows);
                                        return (
                                            <Pressable
                                                key={String(row.id)}
                                                testID={`${kitchenOrderRowTestId(String(row.id))}-chip`}
                                                role="button"
                                                accessibilityRole="button"
                                                accessibilityLabel={t('kitchen:orders.openOrder', {
                                                    number: row.orderNumber,
                                                })}
                                                onPress={() => {
                                                    onOpenOrder(
                                                        row,
                                                        groups.flatMap((entry) => entry.rows),
                                                    );
                                                }}
                                                className={`min-h-8 flex-row items-center gap-1.5 rounded-[10px] border px-2 py-1 ${
                                                    hl === String(row.id)
                                                        ? 'border-surface-brand bg-surface-brand-subtle'
                                                        : 'border-stroke-subtle bg-surface-base hover:border-stroke hover:bg-surface-sunken'
                                                }`}
                                            >
                                                <View
                                                    aria-hidden
                                                    className={`h-2 w-2 rounded-full ${
                                                        DOT_CLASS[
                                                            late ? 'danger' : orderStatusTone(row)
                                                        ] ?? ''
                                                    }`}
                                                />
                                                {}
                                                <Text
                                                    variant="caption"
                                                    numberOfLines={1}
                                                    className="min-w-0 flex-1 !text-xs font-medium"
                                                >
                                                    {row.customer?.displayName ?? row.orderNumber}
                                                </Text>
                                                <Text
                                                    variant="caption"
                                                    className="!text-xs font-bold tabular-nums"
                                                >
                                                    {formatMoney(formatter, {
                                                        amount: row.totalMinor,
                                                        currency: row.currencyCode,
                                                    })}
                                                </Text>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            ))
                        )}
                    </View>
                );
            })}
        </View>
    );
}

/** A slot group's name: the kitchen's own name for its window, a sitting's word, or "No slot". */
export function useSlotName(): (key: SlotKey) => string {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const windows = useDeliveryWindows();
    return (key) => {
        if (key === 'none') return t('kitchen:orders.slot.none');
        if (key.startsWith('code:')) {
            const code = key.slice(5);
            const window = windows.find((candidate) => candidate.code === code);
            if (window === undefined) return code;
            return locale === 'ar' && window.nameAr !== '' ? window.nameAr : window.nameEn;
        }
        return t(`kitchen:calendar.slot.${key}`);
    };
}

/** A slot group's hours, from whichever of its codes the kitchen gave hours. */
export function useSlotHours(): (key: SlotKey) => string | null {
    const windows = useDeliveryWindows();
    return (key) => {
        const codes =
            key === 'none'
                ? []
                : key.startsWith('code:')
                  ? [key.slice(5)]
                  : windowCodesOfMeal(key as CalendarMeal);
        for (const code of codes) {
            const hours = windowHours(windows.find((window) => window.code === code) ?? null);
            if (hours !== null) return hours;
        }
        return null;
    };
}

/* ── the day panel ───────────────────────────────────────────────────────────────────────────── */

function DayPanel({
    day,
    today,
    now,
    slot,
    calendarDay,
    wide,
    hl,
    formatter,
    onOpenOrder,
    onNewOrder,
    onOpenDay,
}: {
    readonly day: string;
    readonly today: string;
    readonly now: Date;
    readonly slot: SlotFilter;
    readonly calendarDay: OrderDeskCalendarDay | null;
    readonly wide: boolean;
    readonly hl: string | null;
    readonly formatter: Formatter;
    readonly onOpenOrder: (order: BookRow, list?: readonly BookRow[]) => void;
    readonly onNewOrder: (day: string) => void;
    readonly onOpenDay: () => void;
}) {
    const { t } = useTranslation();
    const read = useDayOrders(day);
    const windows = useDeliveryWindows();
    const slotName = useSlotName();
    const slotHours = useSlotHours();

    const rows = read.rows.filter((row) => row.status !== 'cancelled' && matchesSlot(row, slot));
    const groups = groupBySlot(rows);
    const plan = planMeals(calendarDay, slot);
    const sales = rows.reduce((sum, row) => sum + row.totalMinor, 0);
    const currency = rows[0]?.currencyCode ?? null;
    const confirm = rows.filter((row) => row.status === 'placed').length;
    const late = rows.filter((row) => isLateOrder(row, now, windows)).length;
    const offset = daysBetween(today, day);
    const eyebrow =
        offset === 0
            ? t('kitchen:orders.day.today')
            : offset === 1
              ? t('kitchen:orders.day.tomorrow')
              : offset === -1
                ? t('kitchen:orders.day.yesterday')
                : t(offset < 0 ? 'kitchen:orders.day.past' : 'kitchen:orders.day.coming');

    /*
     * The day's plan meals, read by subscriber: orders not made yet, each with the dishes its
     * customer picked. They stand after the orders, as their own list — never added to them.
     */
    const planDays = useOrderDeskPlanMealsQuery(day);
    const plans = (planDays.data ?? []).filter(
        (entry) =>
            slot === 'all' ||
            entry.meals.length === 0 ||
            entry.meals.some((meal) => meal.slot === slot),
    );

    return (
        <View
            testID="kitchen-orders-day-panel"
            role="region"
            aria-label={longDay(day, formatter)}
            className={`flex-col gap-2.5 rounded-[22px] border border-stroke-subtle bg-surface-raised p-4 ${
                wide ? 'w-[392px] web:sticky web:top-0' : ''
            }`}
        >
            <View className="flex-col">
                <Text
                    variant="micro"
                    tone="secondary"
                    className="!text-xs font-bold uppercase tracking-widest"
                    testID="kitchen-orders-day-panel-eyebrow"
                >
                    {eyebrow}
                </Text>
                <Text
                    variant="section"
                    className="mt-0.5 font-display !text-[22px] !font-bold !leading-7"
                    testID="kitchen-orders-day-panel-title"
                >
                    {longDay(day, formatter)}
                </Text>
            </View>

            <View className="flex-row gap-1.5">
                <PanelFigure
                    label={t('kitchen:orders.panel.orders')}
                    value={read.pending ? null : formatter.formatNumber(rows.length)}
                    testID="kitchen-orders-day-panel-orders"
                />
                <PanelFigure
                    label={t('kitchen:orders.panel.plan')}
                    value={plan === null ? null : formatter.formatNumber(plan.count)}
                    testID="kitchen-orders-day-panel-plan"
                />
                <PanelFigure
                    label={t('kitchen:orders.panel.sales')}
                    value={
                        read.pending
                            ? null
                            : currency === null
                              ? EM_DASH
                              : formatMoney(formatter, { amount: sales, currency })
                    }
                    testID="kitchen-orders-day-panel-sales"
                />
            </View>

            {confirm + late === 0 ? null : (
                <View className="flex-row flex-wrap gap-1.5">
                    {confirm === 0 ? null : (
                        <DeskChip
                            tone="warning"
                            size="lg"
                            label={t('kitchen:orders.calendar.toConfirm', { count: confirm })}
                        />
                    )}
                    {late === 0 ? null : (
                        <DeskChip
                            tone="danger"
                            size="lg"
                            label={t('kitchen:orders.calendar.late', { count: late })}
                        />
                    )}
                </View>
            )}

            {read.pending ? (
                <Skeleton heightClassName="h-32" />
            ) : read.failure !== null ? (
                <ErrorState
                    testID="kitchen-orders-day-panel-error"
                    title={t('kitchen:orders.loadErrorTitle')}
                    failure={read.failure}
                    onRetry={read.refetch}
                    retrying={read.fetching}
                />
            ) : (
                <ScrollView
                    testID="kitchen-orders-day-panel-thin-scroll"
                    className={wide ? 'max-h-[56vh]' : ''}
                    contentContainerClassName="flex-col gap-2.5"
                >
                    {groups.map((group) => (
                        <View
                            key={group.key}
                            testID={`kitchen-orders-day-panel-slot-${group.key}`}
                            className="flex-col gap-0.5"
                        >
                            <View className="min-h-8 flex-row items-center gap-2 px-1">
                                <Text variant="strong" className="!text-sm !font-bold">
                                    {slotName(group.key)}
                                </Text>
                                {slotHours(group.key) === null ? null : (
                                    <Text
                                        variant="label"
                                        tone="secondary"
                                        className="!font-semibold"
                                    >
                                        {slotHours(group.key)}
                                    </Text>
                                )}
                                <Text
                                    variant="label"
                                    tone="secondary"
                                    className="ms-auto !font-semibold"
                                >
                                    {t('kitchen:orders.count', { count: group.rows.length })}
                                </Text>
                            </View>
                            {group.rows.map((row) => {
                                const isLate = isLateOrder(row, now, windows);
                                return (
                                    <Pressable
                                        key={String(row.id)}
                                        testID={`${kitchenOrderRowTestId(String(row.id))}-panel`}
                                        role="button"
                                        accessibilityRole="button"
                                        accessibilityLabel={t('kitchen:orders.openOrder', {
                                            number: row.orderNumber,
                                        })}
                                        onPress={() => {
                                            onOpenOrder(
                                                row,
                                                groups.flatMap((entry) => entry.rows),
                                            );
                                        }}
                                        className={`min-h-[46px] flex-row items-center gap-2.5 rounded-xl px-2 py-1 hover:bg-surface-sunken ${
                                            hl === String(row.id) ? 'bg-surface-brand-subtle' : ''
                                        }`}
                                    >
                                        {}
                                        <View className="min-w-0 flex-1 flex-col">
                                            <Text
                                                variant="strong"
                                                numberOfLines={1}
                                                className="!text-sm"
                                            >
                                                {row.customer?.displayName ?? EM_DASH}
                                            </Text>
                                            <Text
                                                variant="label"
                                                tone="secondary"
                                                numberOfLines={1}
                                                className="tabular-nums"
                                            >
                                                {`${row.orderNumber} · ${t(kitchenOrderFulfilmentTypeKey(row.fulfilmentType))}`}
                                            </Text>
                                        </View>
                                        <DeskChip
                                            tone={isLate ? 'danger' : orderStatusTone(row)}
                                            label={
                                                isLate
                                                    ? t('kitchen:orders.late')
                                                    : orderStatusLabel(row, t)
                                            }
                                        />
                                        <Text
                                            variant="strong"
                                            className="w-16 !font-bold text-end tabular-nums"
                                        >
                                            {formatMoney(formatter, {
                                                amount: row.totalMinor,
                                                currency: row.currencyCode,
                                            })}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </View>
                    ))}
                    {plans.length === 0 ? null : (
                        <View
                            testID="kitchen-orders-day-panel-plans"
                            role="region"
                            aria-label={t('kitchen:orders.panel.planTitle')}
                            className="flex-col gap-0.5"
                        >
                            <View className="min-h-8 flex-row items-center gap-2 px-1">
                                <Text variant="strong" className="!text-sm !font-bold">
                                    {t('kitchen:orders.panel.planTitle')}
                                </Text>
                                <Text
                                    variant="label"
                                    tone="secondary"
                                    className="ms-auto !font-semibold"
                                >
                                    {t('kitchen:orders.panel.planCount', { count: plans.length })}
                                </Text>
                            </View>
                            {plans.map((entry) => (
                                <PlanRow key={entry.subscriptionId} entry={entry} />
                            ))}
                        </View>
                    )}
                    {groups.length === 0 && plans.length === 0 ? (
                        <Text tone="secondary" testID="kitchen-orders-day-panel-empty">
                            {t('kitchen:orders.calendar.noOrdersOnDay')}
                        </Text>
                    ) : null}
                </ScrollView>
            )}

            <View className="flex-row flex-wrap gap-2 border-t border-stroke-subtle pt-1.5">
                {offset < 0 ? null : (
                    <DeskButton
                        testID="kitchen-orders-day-panel-new"
                        block
                        variant="secondary"
                        label={t('kitchen:orders.newForDay')}
                        onPress={() => {
                            onNewOrder(day);
                        }}
                    />
                )}
                <DeskButton
                    testID="kitchen-orders-day-panel-open"
                    variant="primary"
                    block
                    label={t('kitchen:orders.panel.openDay')}
                    onPress={onOpenDay}
                />
            </View>
        </View>
    );
}

/**
 * A plan day on the day panel, drawn like the order rows above it: who, which plan, and what they
 * picked for each sitting — with "Planned" (claimed, an order tomorrow) or "Expected" (the plan's
 * weekdays say so) where an order's status would be.
 */
function PlanRow({ entry }: { readonly entry: OrderDeskPlanMeal }) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const slotName = useSlotName();
    const name = (en: string | null, ar: string | null): string =>
        (locale === 'ar' && ar !== null && ar !== '' ? ar : en) ?? EM_DASH;
    const servings = (entry.mealsPerDay ?? 0) + (entry.snacksPerDay ?? 0);
    const unchosen = Math.max(0, servings - entry.meals.length);
    const dishes = entry.meals
        .map((meal) => `${slotName(meal.slot)}: ${name(meal.nameEn, meal.nameAr)}`)
        .join(' · ');
    const title = entry.customer?.displayName ?? name(entry.plan.nameEn, entry.plan.nameAr);

    return (
        <View
            testID={`kitchen-orders-day-panel-plan-${entry.subscriptionId}`}
            className="min-h-[46px] flex-row items-center gap-2.5 rounded-xl px-2 py-1.5"
        >
            <View className="min-w-0 flex-1 flex-col">
                <Text variant="strong" numberOfLines={1} className="!text-sm">
                    {title}
                </Text>
                {entry.customer === undefined ? null : (
                    <Text variant="label" tone="secondary" numberOfLines={1}>
                        {name(entry.plan.nameEn, entry.plan.nameAr)}
                    </Text>
                )}
                <Text variant="label" tone="secondary" numberOfLines={2}>
                    {entry.meals.length === 0
                        ? t('kitchen:orders.panel.planNotChosen')
                        : unchosen === 0
                          ? dishes
                          : `${dishes} · ${t('kitchen:orders.panel.planMoreNotChosen', { count: unchosen })}`}
                </Text>
            </View>
            <DeskChip
                tone={entry.basis === 'scheduled' ? 'info' : 'neutral'}
                label={t(
                    entry.basis === 'scheduled'
                        ? 'kitchen:orders.panel.planned'
                        : 'kitchen:orders.panel.expected',
                )}
            />
        </View>
    );
}

function PanelFigure({
    label,
    value,
    testID,
}: {
    readonly label: string;
    readonly value: string | null;
    readonly testID: string;
}) {
    return (
        <View className="min-w-0 flex-1 flex-col rounded-[14px] bg-surface-sunken px-3 py-2.5">
            <Text variant="label" tone="secondary" numberOfLines={1} className="!font-semibold">
                {label}
            </Text>
            {value === null ? (
                <Skeleton heightClassName="h-6" widthClassName="w-10" />
            ) : (
                <Text
                    variant="title"
                    className="mt-0.5 font-display !text-xl !font-bold tabular-nums"
                    testID={testID}
                >
                    {value}
                </Text>
            )}
        </View>
    );
}

export { slotKeyOf };
