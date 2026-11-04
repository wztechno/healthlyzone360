import { cx } from '@healthy360/design-system';
import type { DimensionValue } from 'react-native';
import type { Kitchen } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { TINT_FILL, TINT_INK } from '../../catalogue/shelf-tints.ts';
import type { ShelfTint } from '../../catalogue/shelf-tints.ts';
import { hoursToday } from '../storefront-facts.ts';

import type { KitchenClock, ScheduleEvent, ScheduleStatus } from './storefront-today.ts';
import {
    daySchedule,
    minutesUntil,
    scheduleStatus,
    toMinutes,
    windowsOn,
} from './storefront-today.ts';

/**
 * The storefront's Today tab, as the accepted shop board draws it: one card for the day — its name
 * and opening hours, a track across the open hours with each delivery window laid on it and a
 * marker at the kitchen's time — and under the track a card per step of the day, each saying
 * whether it is done, now, next or later. Then a card for the week.
 *
 * ## Drawn from what the kitchen publishes
 *
 * Opening and closing, the same-day cut-off and the delivery windows, each step marked against the
 * kitchen's own clock (`storefront-today.ts`). Where that clock cannot be read on this device there
 * is no "now" marker and no step is called done or now — the steps are listed, nothing more.
 */
export interface StorefrontTodayTabProps {
    readonly kitchen: Kitchen;
    readonly clock: KitchenClock | null;
    /** The weekday the page is reading — the kitchen's, or the viewer's when its clock is unknown. */
    readonly weekday: number;
    /** Today's date in the kitchen's zone, already formatted; `null` when it cannot be. */
    readonly dateLabel: string | null;
    /** Today's same-day cut-off, `HH:mm`. */
    readonly cutOff: string | null;
}

/** The windows' colours on the track and in their cards, in turn. */
const WINDOW_TINTS: readonly ShelfTint[] = ['orange', 'green', 'yellow', 'blue', 'violet'];

/** How many time labels sit under the track. */
const TICKS = 6;

function eventTitle(t: TFunction, event: ScheduleEvent): string {
    if (event.kind === 'window') {
        return event.window?.label ?? t('marketplace:storefront.today.events.window');
    }
    return t(`marketplace:storefront.today.events.${event.kind}`);
}

/** `HH:mm` for a minute of the day. */
function clockTime(minutes: number): string {
    const whole = Math.max(0, Math.round(minutes));
    return `${String(Math.floor(whole / 60) % 24).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

/** A share of the track, as a style value. */
function percent(value: number): DimensionValue {
    return `${String(Math.max(0, Math.min(100, value)))}%` as DimensionValue;
}

export function StorefrontTodayTab({
    kitchen,
    clock,
    weekday,
    dateLabel,
    cutOff,
}: StorefrontTodayTabProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const events = daySchedule(kitchen, weekday);
    const statuses = scheduleStatus(events, clock);
    const windows = windowsOn(kitchen, weekday);
    const hours = hoursToday(kitchen, weekday);

    // The track spans the open hours, else the windows, else the day.
    const start =
        hours !== null
            ? toMinutes(hours.opensAt)
            : windows.length > 0
              ? Math.min(...windows.map((window) => toMinutes(window.startsAt)))
              : 0;
    const end =
        hours !== null
            ? toMinutes(hours.closesAt)
            : windows.length > 0
              ? Math.max(...windows.map((window) => toMinutes(window.endsAt)))
              : 24 * 60;
    const span = Math.max(1, end - start);
    const at = (minutes: number) => ((minutes - start) / span) * 100;
    const now = clock === null ? null : toMinutes(clock.time);

    const stateOf = (event: ScheduleEvent, status: ScheduleStatus): string => {
        if (clock !== null && event.kind === 'window' && event.window !== undefined) {
            const opens = minutesUntil(event.window.startsAt, clock);
            const closes = minutesUntil(event.window.endsAt, clock);
            if (opens <= 0 && closes > 0) return t('marketplace:storefront.today.state.now');
        }
        if (clock === null) return '';
        return status === 'done'
            ? t('marketplace:storefront.today.state.done')
            : status === 'next'
              ? t('marketplace:storefront.today.state.next')
              : t('marketplace:storefront.today.state.later');
    };

    const weekdayName = (day: number, style: 'long' | 'short') =>
        formatter.formatDate(`2024-01-0${String(day)}`, { weekday: style, timeZone: 'UTC' });

    return (
        <View className="flex-col gap-4" testID="kitchen-today-tab">
            <View
                testID="kitchen-today-timeline"
                className="rounded-3xl border border-stroke-subtle bg-surface-raised p-[22px]"
            >
                <View className="flex-row flex-wrap items-baseline justify-between gap-3">
                    <RNText
                        accessibilityRole="header"
                        aria-level={2}
                        className="font-display text-xl font-bold text-content-primary text-start"
                    >
                        {dateLabel === null
                            ? t('marketplace:storefront.today.dayTitle', {
                                  day: weekdayName(weekday, 'long'),
                              })
                            : t('marketplace:storefront.today.dayTitle', { day: dateLabel })}
                    </RNText>
                    <RNText className="text-sm tabular-nums text-content-secondary">
                        {hours === null
                            ? t('marketplace:storefront.closedToday')
                            : t('marketplace:storefront.today.openRange', {
                                  opensAt: hours.opensAt,
                                  closesAt: hours.closesAt,
                              })}
                    </RNText>
                </View>

                {events.length === 0 ? (
                    <RNText
                        testID="kitchen-today-none"
                        className="mt-6 text-sm text-content-secondary text-start"
                    >
                        {t('marketplace:storefront.today.none')}
                    </RNText>
                ) : (
                    <>
                        <View
                            aria-label={t('marketplace:storefront.today.cutoff.windowsLabel')}
                            className="relative mt-[22px] h-16"
                        >
                            <View className="absolute end-0 start-0 top-[26px] h-3 rounded-full bg-surface-base" />
                            {windows.map((window, index) => {
                                const tint = WINDOW_TINTS[index % WINDOW_TINTS.length] ?? 'green';
                                const from = at(toMinutes(window.startsAt));
                                const to = at(toMinutes(window.endsAt));
                                return (
                                    <View
                                        key={window.code}
                                        className={cx(
                                            'absolute top-5 h-6 items-center justify-center overflow-hidden rounded-[9px]',
                                            TINT_FILL[tint],
                                        )}
                                        style={{ start: percent(from), width: percent(to - from) }}
                                    >
                                        <RNText
                                            numberOfLines={1}
                                            className={cx('text-xs font-bold', TINT_INK[tint])}
                                        >
                                            {window.label}
                                        </RNText>
                                    </View>
                                );
                            })}
                            {now === null || now < start || now > end ? null : (
                                <View
                                    testID="kitchen-today-clock"
                                    className="absolute bottom-0 top-1.5 w-0.5 bg-content-primary"
                                    style={{ start: percent(at(now)) }}
                                >
                                    <View className="absolute -start-[22px] -top-[22px] h-5 justify-center rounded-md bg-content-primary px-1.5">
                                        <RNText className="text-xs font-bold tabular-nums text-surface-base">
                                            {clock?.time}
                                        </RNText>
                                    </View>
                                </View>
                            )}
                        </View>
                        <View aria-hidden className="mt-1 flex-row justify-between">
                            {Array.from({ length: TICKS }, (_, index) => (
                                <RNText
                                    key={index}
                                    className="text-xs font-medium tabular-nums text-content-secondary"
                                >
                                    {clockTime(start + (span * index) / (TICKS - 1))}
                                </RNText>
                            ))}
                        </View>

                        <View
                            testID="kitchen-today-steps"
                            className="mt-5 flex-row flex-wrap gap-2.5"
                        >
                            {events.map((event, index) => {
                                const status = statuses[index] ?? 'todo';
                                const windowIndex =
                                    event.window === undefined
                                        ? -1
                                        : windows.findIndex(
                                              (window) => window.code === event.window?.code,
                                          );
                                const tint: ShelfTint =
                                    windowIndex >= 0
                                        ? (WINDOW_TINTS[windowIndex % WINDOW_TINTS.length] ??
                                          'green')
                                        : event.kind === 'cutoff'
                                          ? 'pink'
                                          : 'neutral';
                                const state = stateOf(event, status);
                                return (
                                    <View
                                        key={event.key}
                                        testID={`kitchen-today-step-${event.key}`}
                                        className={cx(
                                            'min-w-[130px] flex-1 basis-[22%] flex-col rounded-2xl px-3.5 py-3',
                                            TINT_FILL[tint],
                                            status === 'done' ? 'opacity-70' : '',
                                        )}
                                    >
                                        <RNText
                                            className={cx(
                                                'font-display text-base font-bold text-start',
                                                TINT_INK[tint],
                                            )}
                                        >
                                            {eventTitle(t, event)}
                                        </RNText>
                                        <RNText
                                            {...(event.window === undefined
                                                ? {}
                                                : {
                                                      testID: `kitchen-today-window-${event.window.code}`,
                                                  })}
                                            className={cx(
                                                'mt-0.5 text-sm tabular-nums text-start',
                                                TINT_INK[tint],
                                            )}
                                        >
                                            {event.window === undefined
                                                ? event.kind === 'cutoff' && cutOff !== null
                                                    ? cutOff
                                                    : event.time
                                                : t('marketplace:storefront.today.cutoff.window', {
                                                      startsAt: event.window.startsAt,
                                                      endsAt: event.window.endsAt,
                                                  })}
                                        </RNText>
                                        {state === '' ? null : (
                                            <RNText
                                                className={cx(
                                                    'mt-2 text-xs font-semibold uppercase tracking-wider opacity-85 text-start',
                                                    TINT_INK[tint],
                                                )}
                                            >
                                                {state}
                                            </RNText>
                                        )}
                                    </View>
                                );
                            })}
                        </View>
                    </>
                )}
            </View>

            <View
                testID="kitchen-today-week"
                className="rounded-3xl border border-stroke-subtle bg-surface-raised p-[22px]"
            >
                <RNText
                    accessibilityRole="header"
                    aria-level={2}
                    className="font-display text-lg font-bold text-content-primary text-start"
                >
                    {t('marketplace:storefront.today.week')}
                </RNText>
                <View className="mt-4 flex-row flex-wrap gap-2">
                    {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                        const open = hoursToday(kitchen, day);
                        const isToday = day === weekday;
                        return (
                            <View
                                key={day}
                                testID={`kitchen-today-week-${String(day)}`}
                                className={cx(
                                    'min-w-[76px] flex-1 items-center rounded-2xl px-1.5 py-3',
                                    isToday ? 'bg-surface-brand-subtle' : 'bg-surface-base',
                                    open === null ? 'opacity-55' : '',
                                )}
                            >
                                <RNText
                                    className={cx(
                                        'mb-1 font-display text-sm font-bold',
                                        isToday
                                            ? 'text-content-on-brand-subtle'
                                            : 'text-content-primary',
                                    )}
                                >
                                    {weekdayName(day, 'short')}
                                </RNText>
                                <RNText
                                    className={cx(
                                        'text-center text-xs tabular-nums',
                                        isToday
                                            ? 'text-content-on-brand-subtle'
                                            : 'text-content-secondary',
                                    )}
                                >
                                    {open === null
                                        ? t('marketplace:storefront.today.closed')
                                        : t('marketplace:storefront.today.cutoff.window', {
                                              startsAt: open.opensAt,
                                              endsAt: open.closesAt,
                                          })}
                                </RNText>
                            </View>
                        );
                    })}
                </View>
            </View>
        </View>
    );
}
