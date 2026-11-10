import { Dropdown, Icon, SlideIn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { dateInstant } from '../../planner/format.ts';
import { firstOfMonth, monthGrid, monthOf, shiftMonth } from '../orders/order-book.ts';
import { DeskIconButton } from './desk-button.tsx';
import { DropTrigger } from './desk-select.tsx';

/**
 * `.mm` — the desk's day picker: a soft-green day pill that opens a small month (Orders canvas,
 * 2026-11-10). It replaces the browser's own date field on a desk toolbar.
 *
 * ```
 * ( 📅 Today · Tue 10 Nov ⌄ )
 *  ┌──────────────────────────────┐
 *  │ (‹)    November 2026     (›) │
 *  │  Mon Tue Wed Thu Fri Sat Sun │
 *  │  26  27  28  29  30  31   1  │   other months faded
 *  │   2   3   4   5   6   7   8  │   · a dot under a day with orders
 *  │   9 [10] 11  12  13  14  15  │   today ringed, the chosen day filled
 *  └──────────────────────────────┘
 * ```
 *
 * Picking a day closes it. `marked` says which days carry a dot; the month on show is reported
 * through `onMonthShown`, so the page can read just that month's counts.
 */
export function MiniMonthPicker({
    value,
    today,
    valueLabel,
    label,
    onChange,
    marked,
    onMonthShown,
    testID,
}: {
    /** `YYYY-MM-DD`. */
    readonly value: string;
    readonly today: string;
    /** Translated — what the pill says, "Today · Tue 10 Nov". */
    readonly valueLabel: string;
    /** Translated — the picker's accessible name, "Pick a day". */
    readonly label: string;
    readonly onChange: (day: string) => void;
    readonly marked?: ((day: string) => boolean) | undefined;
    readonly onMonthShown?: ((month: string) => void) | undefined;
    readonly testID: string;
}) {
    const [shown, setShown] = useState(monthOf(value));

    function show(month: string) {
        setShown(month);
        onMonthShown?.(month);
    }

    return (
        <Dropdown
            testID={testID}
            label={label}
            role="dialog"
            panelClassName="w-[296px] !rounded-[18px] !shadow-elevation-bar p-3"
            onOpenChange={(open) => {
                // Opens on the chosen day's month, wherever it was left.
                if (open) show(monthOf(value));
            }}
            trigger={({ triggerProps, toggle, open }) => (
                <DropTrigger
                    triggerProps={triggerProps}
                    onPress={toggle}
                    open={open}
                    filled
                    icon={
                        <Icon name="calendar" size="md" className="text-content-on-brand-subtle" />
                    }
                    value={valueLabel}
                    accessibilityLabel={`${label}: ${valueLabel}`}
                    testID={`${testID}-trigger`}
                />
            )}
        >
            {({ close }) => (
                <SlideIn edge="bottom" distance="small" duration="normal">
                    <MonthPanel
                        month={shown}
                        value={value}
                        today={today}
                        marked={marked}
                        onMonth={show}
                        onPick={(day) => {
                            onChange(day);
                            close();
                        }}
                        testID={testID}
                    />
                </SlideIn>
            )}
        </Dropdown>
    );
}

function MonthPanel({
    month,
    value,
    today,
    marked,
    onMonth,
    onPick,
    testID,
}: {
    readonly month: string;
    readonly value: string;
    readonly today: string;
    readonly marked: ((day: string) => boolean) | undefined;
    readonly onMonth: (month: string) => void;
    readonly onPick: (day: string) => void;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const days = monthGrid(month);
    const weeks: (readonly string[])[] = [];
    for (let index = 0; index < days.length; index += 7) weeks.push(days.slice(index, index + 7));

    return (
        <View className="flex-col">
            <View className="mb-2 flex-row items-center justify-between">
                <DeskIconButton
                    testID={`${testID}-previous-month`}
                    label={t('kitchen:orders.calendar.previousMonth')}
                    icon={<Icon name="chevronBackward" size="sm" />}
                    onPress={() => {
                        onMonth(shiftMonth(month, -1));
                    }}
                />
                <RNText
                    testID={`${testID}-month`}
                    className="text-sm font-bold text-content-primary"
                >
                    {formatter.formatDate(dateInstant(firstOfMonth(month)), {
                        month: 'long',
                        year: 'numeric',
                    })}
                </RNText>
                <DeskIconButton
                    testID={`${testID}-next-month`}
                    label={t('kitchen:orders.calendar.nextMonth')}
                    icon={<Icon name="chevronForward" size="sm" />}
                    onPress={() => {
                        onMonth(shiftMonth(month, 1));
                    }}
                />
            </View>
            <View className="flex-row gap-0.5" aria-hidden>
                {(weeks[0] ?? []).map((day) => (
                    <View key={day} className="h-6 flex-1 items-center justify-center">
                        <RNText className="text-role-caption font-bold text-content-secondary">
                            {formatter.formatDate(dateInstant(day), { weekday: 'short' })}
                        </RNText>
                    </View>
                ))}
            </View>
            {weeks.map((week) => (
                <View key={week[0]} className="mt-0.5 flex-row gap-0.5">
                    {week.map((day) => (
                        <DayCell
                            key={day}
                            day={day}
                            outside={monthOf(day) !== month}
                            isToday={day === today}
                            chosen={day === value}
                            dot={marked?.(day) === true}
                            onPick={onPick}
                            testID={`${testID}-day-${day}`}
                        />
                    ))}
                </View>
            ))}
        </View>
    );
}

function DayCell({
    day,
    outside,
    isToday,
    chosen,
    dot,
    onPick,
    testID,
}: {
    readonly day: string;
    readonly outside: boolean;
    readonly isToday: boolean;
    readonly chosen: boolean;
    readonly dot: boolean;
    readonly onPick: (day: string) => void;
    readonly testID: string;
}): ReactNode {
    const formatter = useFormatter();
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={formatter.formatDate(dateInstant(day), {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
            })}
            accessibilityState={{ selected: chosen }}
            onPress={() => {
                onPick(day);
            }}
            className={`h-9 flex-1 items-center justify-center rounded-[10px] ${
                chosen
                    ? 'bg-surface-brand'
                    : isToday
                      ? 'border-[1.5px] border-surface-brand hover:bg-surface-sunken'
                      : 'hover:bg-surface-sunken'
            } ${outside && !chosen ? 'opacity-50' : ''}`}
        >
            <RNText
                className={`text-role-strong tabular-nums ${
                    chosen
                        ? 'text-content-on-brand'
                        : outside
                          ? 'text-content-secondary'
                          : 'text-content-primary'
                }`}
            >
                {formatter.formatNumber(Number(day.slice(8, 10)))}
            </RNText>
            {dot ? (
                <View
                    aria-hidden
                    className={`absolute bottom-1 h-1 w-1 rounded-full ${
                        chosen ? 'bg-content-on-brand' : 'bg-surface-brand'
                    }`}
                />
            ) : null}
        </Pressable>
    );
}
