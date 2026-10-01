import { Button, cx, useBreakpoint } from '@healthy360/design-system';
import type { Kitchen } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { Eyebrow } from '../../../ui/eyebrow.tsx';
import { PillChip } from '../../../ui/pill-chip.tsx';

import type { KitchenClock, ScheduleEvent, ScheduleStatus } from './storefront-today.ts';
import { daySchedule, minutesUntil, scheduleStatus, windowsOn } from './storefront-today.ts';

/**
 * The storefront's "Today in the kitchen" tab — HealthZone `§isStorefront` `storeIsToday`: the
 * day's timeline card, then two cards side by side — what is on the line, and the cut-off.
 *
 * ## Drawn from what the kitchen publishes
 *
 * The public marketplace has no production endpoint, so the design's cook-to-door steps ("Prep
 * starts", "Grill fires", "Lunch cooked") and its batch progress cannot be drawn. What *is*
 * published — today's opening and closing, the same-day cut-off and the delivery windows — makes
 * the timeline instead, each step marked passed / next / later against the kitchen's own clock
 * (`storefront-today.ts`). The pill states that clock, not "LIVE": it is the time where the kitchen
 * is, which is true, rather than a claim that the card streams from the line.
 *
 * "On the line right now" keeps its card and says plainly that the line's progress is not
 * published. The cut-off card counts down to the published cut-off when the kitchen's clock can be
 * read, lists today's delivery windows (the next one marked, none selectable — a storefront cannot
 * book a slot), and "Pick from the menu" opens the Menu tab.
 *
 * Six columns on a wide page, as designed; a column per step rather than a fixed six, because a
 * kitchen publishes as many steps as it has. Below `md` the timeline runs down the card.
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
    readonly onPickFromMenu: () => void;
}

function eventTitle(t: TFunction, event: ScheduleEvent): string {
    if (event.kind === 'window') {
        return event.window?.label ?? t('marketplace:storefront.today.events.window');
    }
    return t(`marketplace:storefront.today.events.${event.kind}`);
}

function eventNote(t: TFunction, event: ScheduleEvent): string {
    if (event.kind === 'window' && event.window !== undefined) {
        return t('marketplace:storefront.today.events.windowNote', {
            startsAt: event.window.startsAt,
            endsAt: event.window.endsAt,
        });
    }
    return t(`marketplace:storefront.today.events.${event.kind}Note`);
}

/** A step's marker: filled when passed, ringed with a halo when next, hollow when later. */
function Dot({ status }: { readonly status: ScheduleStatus }) {
    const dot = (
        <View
            className={cx(
                'h-icon-sm w-icon-sm shrink-0 rounded-full',
                status === 'done' && 'bg-surface-brand',
                status === 'next' && 'border-[3px] border-surface-brand bg-surface-raised',
                status === 'todo' && 'border-2 border-stroke-strong bg-surface-raised',
            )}
        />
    );
    // The design's 4px halo, as a padded ring that gives its 4px back so the row does not shift.
    return status === 'next' ? (
        <View className="-m-1 shrink-0 rounded-full bg-surface-brand-subtle p-1">{dot}</View>
    ) : (
        dot
    );
}

export function StorefrontTodayTab({
    kitchen,
    clock,
    weekday,
    dateLabel,
    cutOff,
    onPickFromMenu,
}: StorefrontTodayTabProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { atLeast } = useBreakpoint();
    const across = atLeast('md');

    const events = daySchedule(kitchen, weekday);
    const statuses = scheduleStatus(events, clock);
    const windows = windowsOn(kitchen, weekday);
    const nextWindow =
        clock === null
            ? undefined
            : windows.find((window) => minutesUntil(window.startsAt, clock) > 0);

    const left = cutOff === null || clock === null ? null : minutesUntil(cutOff, clock);
    const headline =
        cutOff === null
            ? t('marketplace:storefront.today.cutoff.none')
            : left === null
              ? t('marketplace:storefront.today.cutoff.orderBy', { time: cutOff })
              : left <= 0
                ? t('marketplace:storefront.today.cutoff.passed')
                : left < 60
                  ? t('marketplace:storefront.today.cutoff.inMinutes', {
                        minutes: formatter.formatNumber(left),
                    })
                  : t('marketplace:storefront.today.cutoff.inHours', {
                        hours: formatter.formatNumber(Math.floor(left / 60)),
                        minutes: formatter.formatNumber(left % 60),
                    });
    const body =
        cutOff === null
            ? t('marketplace:storefront.today.cutoff.bodyNone')
            : left !== null && left <= 0
              ? t('marketplace:storefront.today.cutoff.bodyPassed', { time: cutOff })
              : t('marketplace:storefront.today.cutoff.body', { time: cutOff });

    return (
        <View className="flex-col gap-4" testID="kitchen-today-tab">
            <View
                testID="kitchen-today-timeline"
                className="rounded-xl border border-stroke bg-surface-raised px-6 py-6"
            >
                <View className="flex-row flex-wrap items-start justify-between gap-3">
                    <View className="min-w-0 shrink flex-col gap-2">
                        <Eyebrow>
                            {dateLabel === null
                                ? t('marketplace:storefront.today.eyebrow')
                                : t('marketplace:storefront.today.eyebrowDate', {
                                      date: dateLabel,
                                  })}
                        </Eyebrow>
                        <RNText
                            accessibilityRole="header"
                            aria-level={2}
                            className="max-w-[420px] font-display text-2xl font-bold leading-tight tracking-display text-content-primary text-start"
                        >
                            {t('marketplace:storefront.today.title')}
                        </RNText>
                    </View>
                    {clock === null ? null : (
                        <View
                            testID="kitchen-today-clock"
                            className="flex-row items-center gap-2 rounded-full bg-success-subtle px-3 py-1"
                        >
                            <View className="h-2 w-2 rounded-full bg-surface-brand" />
                            <RNText className="text-xs font-medium uppercase tracking-wide tabular-nums text-success-on-subtle">
                                {t('marketplace:storefront.today.clock', { time: clock.time })}
                            </RNText>
                        </View>
                    )}
                </View>

                {events.length === 0 ? (
                    <RNText
                        testID="kitchen-today-none"
                        className="mt-6 text-sm text-content-secondary text-start"
                    >
                        {t('marketplace:storefront.today.none')}
                    </RNText>
                ) : (
                    <View
                        testID="kitchen-today-steps"
                        className={cx('mt-6', across ? 'flex-row' : 'flex-col gap-4')}
                    >
                        {events.map((event, index) => {
                            const status = statuses[index] ?? 'todo';
                            const last = index === events.length - 1;
                            const text = (
                                <View className="flex-col gap-1">
                                    <RNText className="text-xs font-semibold tabular-nums text-content-secondary text-start">
                                        {event.time}
                                    </RNText>
                                    <RNText
                                        className={cx(
                                            'font-display text-base font-bold leading-tight text-start',
                                            status === 'todo'
                                                ? 'text-content-secondary'
                                                : 'text-content-primary',
                                        )}
                                    >
                                        {eventTitle(t, event)}
                                    </RNText>
                                    <RNText className="text-xs leading-snug text-content-secondary text-start">
                                        {eventNote(t, event)}
                                    </RNText>
                                </View>
                            );
                            return across ? (
                                <View
                                    key={event.key}
                                    testID={`kitchen-today-step-${event.key}`}
                                    className="min-w-0 flex-1 flex-col gap-2 pe-3"
                                >
                                    <View className="-me-3 flex-row items-center">
                                        <Dot status={status} />
                                        <View
                                            className={cx(
                                                'h-0.5 flex-1',
                                                last
                                                    ? 'bg-transparent'
                                                    : status === 'done'
                                                      ? 'bg-surface-brand'
                                                      : 'bg-stroke',
                                            )}
                                        />
                                    </View>
                                    {text}
                                </View>
                            ) : (
                                <View
                                    key={event.key}
                                    testID={`kitchen-today-step-${event.key}`}
                                    className="flex-row items-start gap-3"
                                >
                                    <Dot status={status} />
                                    <View className="min-w-0 flex-1">{text}</View>
                                </View>
                            );
                        })}
                    </View>
                )}
            </View>

            <View className="flex-row flex-wrap gap-4">
                <View
                    testID="kitchen-today-line"
                    className="min-w-[280px] flex-1 grow basis-[40%] flex-col gap-4 rounded-xl border border-stroke bg-surface-raised p-5"
                >
                    <Eyebrow>{t('marketplace:storefront.today.line.eyebrow')}</Eyebrow>
                    <RNText className="text-sm leading-normal text-content-secondary text-start">
                        {t('marketplace:storefront.today.line.empty')}
                    </RNText>
                </View>

                <View
                    testID="kitchen-today-cutoff"
                    className="min-w-[280px] flex-1 grow basis-[40%] flex-col gap-2.5 rounded-xl bg-surface-brand-subtle p-5"
                >
                    <Eyebrow tone="brand">
                        {cutOff === null
                            ? t('marketplace:storefront.today.cutoff.eyebrow')
                            : t('marketplace:storefront.today.cutoff.eyebrowTime', {
                                  time: cutOff,
                              })}
                    </Eyebrow>
                    <RNText
                        testID="kitchen-today-cutoff-headline"
                        className="font-display text-4xl font-bold leading-tight tracking-display tabular-nums text-content-on-brand-subtle text-start"
                    >
                        {headline}
                    </RNText>
                    <RNText className="text-sm leading-normal text-content-on-brand-subtle text-start">
                        {body}
                    </RNText>
                    {windows.length === 0 ? null : (
                        <View
                            testID="kitchen-today-windows"
                            role="list"
                            aria-label={t('marketplace:storefront.today.cutoff.windowsLabel')}
                            className="mt-1.5 flex-row flex-wrap gap-2"
                        >
                            {windows.map((window) => (
                                <PillChip
                                    key={window.code}
                                    size="sm"
                                    testID={`kitchen-today-window-${window.code}`}
                                    label={t('marketplace:storefront.today.cutoff.window', {
                                        startsAt: window.startsAt,
                                        endsAt: window.endsAt,
                                    })}
                                    selected={window === nextWindow}
                                />
                            ))}
                        </View>
                    )}
                    <View className="mt-auto pt-2">
                        <Button
                            testID="kitchen-today-pick"
                            block
                            size="lg"
                            label={t('marketplace:storefront.today.cutoff.pick')}
                            onPress={onPickFromMenu}
                        />
                    </View>
                </View>
            </View>
        </View>
    );
}
