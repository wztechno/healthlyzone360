import { Dropdown, Icon, SlideIn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { dateInstant } from '../../planner/format.ts';
import { firstOfMonth, monthGrid, monthOf, shiftMonth } from '../orders/order-book.ts';
import { todayIso } from '../../commerce/dates.ts';
import { DeskButton, DeskIconButton } from './desk-button.tsx';
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
    min,
    max,
    caption,
    onClear,
    testID,
}: {
    /** `YYYY-MM-DD`, or `''` for no day yet — the month then opens on today's. */
    readonly value: string;
    /** `YYYY-MM-DD` — the first day that may be picked; the ones before it are drawn and inert. */
    readonly min?: string | undefined;
    /** `YYYY-MM-DD` — the last day that may be picked; the ones after it are drawn and inert. */
    readonly max?: string | undefined;
    /** Translated — a label drawn over the pill, as a form field's ("Day"). */
    readonly caption?: string | undefined;
    readonly today: string;
    /** Translated — what the pill says, "Today · Tue 10 Nov". */
    readonly valueLabel: string;
    /** Translated — the picker's accessible name, "Pick a day". */
    readonly label: string;
    readonly onChange: (day: string) => void;
    readonly marked?: ((day: string) => boolean) | undefined;
    readonly onMonthShown?: ((month: string) => void) | undefined;
    /** A Clear link under the month, for a window that may be left open-ended. */
    readonly onClear?: (() => void) | undefined;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const anchor = value === '' ? today : value;
    const [shown, setShown] = useState(monthOf(anchor));

    function show(month: string) {
        setShown(month);
        onMonthShown?.(month);
    }

    const picker = (
        <Dropdown
            testID={testID}
            label={label}
            role="dialog"
            panelClassName="w-[296px] !rounded-[18px] !shadow-elevation-bar p-3"
            onOpenChange={(open) => {
                // Opens on the chosen day's month, wherever it was left.
                if (open) show(monthOf(anchor));
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
                        min={min}
                        max={max}
                        onMonth={show}
                        onPick={(day) => {
                            onChange(day);
                            close();
                        }}
                        testID={testID}
                    />
                    {onClear === undefined || value === '' ? null : (
                        <View className="mt-2 flex-row justify-end border-t border-stroke-subtle pt-2">
                            <DeskButton
                                testID={`${testID}-clear`}
                                variant="quiet"
                                label={t('common:action.clear')}
                                onPress={() => {
                                    onClear();
                                    close();
                                }}
                            />
                        </View>
                    )}
                </SlideIn>
            )}
        </Dropdown>
    );

    return caption === undefined ? (
        picker
    ) : (
        <View className="z-auto flex-col gap-1.5">
            <RNText className="text-role-strong font-medium text-content-secondary">
                {caption}
            </RNText>
            {picker}
        </View>
    );
}

/**
 * `DatePickerButton`'s props over the mini month — a toolbar's From / To moves to the desk look by
 * changing the component. The pill reads "Tue 10 Nov", or the placeholder while no day is set;
 * `onClear` adds the month's Clear link.
 */
export function DeskDateButton({
    label,
    labelVisible = false,
    value,
    min,
    max,
    placeholder,
    onChange,
    onClear,
    testID,
}: {
    /** Translated — the field's name; drawn over the pill when `labelVisible`. */
    readonly label: string;
    readonly labelVisible?: boolean | undefined;
    /** `YYYY-MM-DD`, or `''`. */
    readonly value: string;
    readonly min?: string | undefined;
    readonly max?: string | undefined;
    /** Translated — the pill's words while `value` is empty. */
    readonly placeholder?: string | undefined;
    readonly onChange: (day: string) => void;
    readonly onClear?: (() => void) | undefined;
    readonly testID: string;
}) {
    const formatter = useFormatter();
    const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
    return (
        <MiniMonthPicker
            testID={testID}
            label={label}
            caption={labelVisible ? label : undefined}
            value={day}
            valueLabel={
                day === ''
                    ? (placeholder ?? label)
                    : formatter.formatDate(dateInstant(day), {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          timeZone: 'UTC',
                      })
            }
            today={todayIso()}
            min={min}
            max={max}
            onChange={onChange}
            onClear={onClear}
        />
    );
}

function MonthPanel({
    month,
    value,
    today,
    marked,
    min,
    max,
    onMonth,
    onPick,
    testID,
}: {
    readonly month: string;
    readonly value: string;
    readonly today: string;
    readonly marked: ((day: string) => boolean) | undefined;
    readonly min: string | undefined;
    readonly max: string | undefined;
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
                            disabled={
                                (min !== undefined && day < min) || (max !== undefined && day > max)
                            }
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
    disabled,
    onPick,
    testID,
}: {
    readonly day: string;
    readonly outside: boolean;
    readonly isToday: boolean;
    readonly chosen: boolean;
    readonly dot: boolean;
    readonly disabled: boolean;
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
            accessibilityState={{ selected: chosen, disabled }}
            aria-disabled={disabled}
            disabled={disabled}
            onPress={() => {
                onPick(day);
            }}
            className={`h-9 flex-1 items-center justify-center rounded-[10px] ${
                chosen
                    ? 'bg-surface-brand'
                    : isToday
                      ? 'border-[1.5px] border-surface-brand hover:bg-surface-sunken'
                      : 'hover:bg-surface-sunken'
            } ${(outside || disabled) && !chosen ? 'opacity-40' : ''}`}
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
