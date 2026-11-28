import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { Button, IconButton } from '../actions/button.tsx';
import { useDensity } from '../hooks/use-density.tsx';
import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { SlideIn } from '../motion/slide-in.tsx';
import { Dropdown } from '../overlays/dropdown.tsx';
import type { DropdownRenderState } from '../overlays/dropdown.tsx';
import { FormField } from './form-field.tsx';
import type { FieldControlProps } from './form-field.tsx';
import { inputFrameClassName } from './text-input.tsx';

/**
 * The admin's one date picker (2026-11-26): every day picked in the kitchen, corporate and platform
 * admin opens this small month — the Orders canvas's `.mm` (2026-11-10).
 *
 * ```
 * ( 📅 Today · Thu, Nov 26 ⌄ )         trigger="pill"  — a toolbar's day or From / To
 * [ 📅 Nov 26, 2026          ]          trigger="field" — a form's date, label above
 *  ┌──────────────────────────────┐
 *  │ (‹)    November 2026     (›) │
 *  │  Mon Tue Wed Thu Fri Sat Sun │
 *  │  26  27  28  29  30  31   1  │   other months faded
 *  │   2   3   4   5   6   7   8  │   · a dot under a `marked` day
 *  │   9 [10] 11  12  13  14  15  │   today ringed, the chosen day filled
 *  │ Today                  Clear │   Today on a field; Clear with `onClear`
 *  └──────────────────────────────┘
 * ```
 *
 * It replaces the desk kit's `MiniMonthPicker`, `DeskDateButton` and `DeskDateField`, and the
 * design system's `DatePickerButton`; a form in the admin no longer shows the browser's own
 * "dd-----yyyy" box. The web shop keeps `DateField`.
 *
 * Values are ISO `YYYY-MM-DD`; `''` or `null` is no day. Picking a day closes the month.
 */
export interface DatePickerProps {
    /** Translated. The field's label, and the picker's accessible name. */
    readonly label: string;
    /** `YYYY-MM-DD`, or `''` / `null` for no day. */
    readonly value: string | null;
    readonly onChange: (day: string) => void;
    /** Adds Clear under the month while a day is chosen — for a date that may be left empty. */
    readonly onClear?: (() => void) | undefined;
    /** `field` (default) — a form's date; `pill` — a toolbar's soft-green day pill. */
    readonly trigger?: 'field' | 'pill' | undefined;
    /** Translated. What the trigger says while there is no day. */
    readonly placeholder?: string | undefined;
    /** Translated. The trigger's own words for the chosen day — Orders' "Today · Thu, Nov 26". */
    readonly valueLabel?: string | undefined;
    /** `YYYY-MM-DD` — the day drawn as today. Defaults to the device's today. */
    readonly today?: string | undefined;
    /** Inclusive bounds; the days outside them are drawn and cannot be picked. */
    readonly min?: string | undefined;
    readonly max?: string | undefined;
    /** Which days carry a dot — a day with orders. */
    readonly marked?: ((day: string) => boolean) | undefined;
    /** Told the month on show, `YYYY-MM`, so a page can read just that month's dots. */
    readonly onMonthShown?: ((month: string) => void) | undefined;
    /** Which edge of the trigger the month lines up with. */
    readonly align?: 'start' | 'end' | undefined;
    /** `pill` only: draws `label` above the pill, as a field's. */
    readonly labelVisible?: boolean | undefined;
    /** `field` only: keeps `label` as the name without drawing it. */
    readonly labelHidden?: boolean | undefined;
    readonly hint?: string | undefined;
    readonly error?: string | undefined;
    readonly required?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    readonly id?: string | undefined;
    readonly className?: string | undefined;
    readonly testID: string;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today on the device, `YYYY-MM-DD` — the day the person in front of the screen is living. */
function deviceToday(now: Date = new Date()): string {
    const year = String(now.getFullYear()).padStart(4, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/** Noon UTC of a day — formatted, it is that day in every time zone a kitchen sits in. */
function instant(day: string): string {
    return `${day}T12:00:00.000Z`;
}

function addDays(day: string, delta: number): string {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + delta);
    return date.toISOString().slice(0, 10);
}

function shiftMonth(month: string, delta: number): string {
    const year = Number(month.slice(0, 4));
    const index = Number(month.slice(5, 7)) - 1 + delta;
    const shiftedYear = year + Math.floor(index / 12);
    const shiftedMonth = (((index % 12) + 12) % 12) + 1;
    return `${String(shiftedYear).padStart(4, '0')}-${String(shiftedMonth).padStart(2, '0')}`;
}

/** The Monday on or before a day. */
function mondayOf(day: string): string {
    const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
    return addDays(day, -((weekday + 6) % 7));
}

/** Whole weeks, Monday first, from the week of the 1st to the week of the last day. */
function monthGrid(month: string): readonly string[] {
    const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
    const end = addDays(mondayOf(last), 6);
    const days: string[] = [];
    for (let day = mondayOf(`${month}-01`); day <= end; day = addDays(day, 1)) days.push(day);
    return days;
}

export function DatePicker({
    label,
    value,
    onChange,
    onClear,
    trigger: triggerKind = 'field',
    placeholder,
    valueLabel,
    today: todayProp,
    min,
    max,
    marked,
    onMonthShown,
    align = 'start',
    labelVisible = false,
    labelHidden = false,
    hint,
    error,
    required = false,
    disabled = false,
    id,
    className,
    testID,
}: DatePickerProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const density = useDensity();
    const pill = triggerKind === 'pill';
    const today = todayProp ?? deviceToday();
    const day = value !== null && ISO_DAY.test(value) ? value : '';
    const anchor = day === '' ? today : day;
    const [shown, setShown] = useState(anchor.slice(0, 7));
    const todayAllowed = (min === undefined || today >= min) && (max === undefined || today <= max);
    // An empty pill names itself ("From"); an empty field asks for a day under its drawn label.
    const empty = placeholder ?? (pill ? label : t('designSystem:datePicker.placeholder'));
    // The pill's days are short ("Thu, Nov 26"); a field writes the whole date ("Nov 26, 2026").
    const shownValue =
        day === ''
            ? null
            : (valueLabel ??
              formatter.formatDate(
                  instant(day),
                  pill
                      ? { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }
                      : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' },
              ));
    const words = shownValue ?? (pill ? (valueLabel ?? empty) : empty);
    // The pill's panel and day ids keep the desk kit's: the picker's own id, then `-day-{iso}`.
    const panelID = pill ? testID : `${testID}-picker`;

    function show(month: string) {
        setShown(month);
        onMonthShown?.(month);
    }

    const panel = ({ close }: DropdownRenderState) => (
        <SlideIn edge="bottom" distance="small" duration="normal">
            <MonthPanel
                month={shown}
                value={day}
                today={today}
                marked={marked}
                min={min}
                max={max}
                onMonth={show}
                onPick={(picked) => {
                    onChange(picked);
                    close();
                }}
                testID={panelID}
            />
            {pill && (onClear === undefined || day === '') ? null : (
                <View className="mt-2 flex-row items-center justify-between border-t border-stroke-subtle pt-2">
                    {pill ? (
                        <View />
                    ) : (
                        <Button
                            testID={`${testID}-today`}
                            variant="quiet"
                            label={t('designSystem:datePicker.today')}
                            disabled={!todayAllowed}
                            onPress={() => {
                                onChange(today);
                                close();
                            }}
                        />
                    )}
                    {onClear !== undefined && day !== '' ? (
                        <Button
                            testID={`${testID}-clear`}
                            variant="quiet"
                            label={t('designSystem:datePicker.clear')}
                            onPress={() => {
                                onClear();
                                close();
                            }}
                        />
                    ) : null}
                </View>
            )}
        </SlideIn>
    );

    const dropdown = (renderTrigger: (state: DropdownRenderState) => ReactNode) => (
        <Dropdown
            testID={panelID}
            label={label}
            align={align}
            role="dialog"
            panelClassName="w-[296px] !rounded-[18px] !shadow-elevation-bar p-3"
            onOpenChange={(open) => {
                // Opens on the chosen day's month, wherever it was left.
                if (open) show(anchor.slice(0, 7));
            }}
            trigger={renderTrigger}
        >
            {panel}
        </Dropdown>
    );

    if (pill) {
        const picker = dropdown(({ triggerProps, toggle, open }) => (
            <Pressable
                {...triggerProps}
                testID={`${testID}-trigger`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={`${label}: ${words}`}
                aria-label={`${label}: ${words}`}
                accessibilityState={{ disabled, expanded: open }}
                disabled={disabled}
                onPress={toggle}
                className={cx(
                    'h-desk-toolbar flex-row items-center gap-1.5 self-start rounded-full border border-stroke bg-surface-brand-subtle pe-2.5 ps-3 web:transition-colors',
                    disabled ? 'opacity-50' : null,
                )}
            >
                <Icon name="calendar" size="md" className="text-content-on-brand-subtle" />
                <RNText
                    testID={`${testID}-value`}
                    numberOfLines={1}
                    className={cx(
                        'text-role-strong font-bold',
                        shownValue === null && valueLabel === undefined
                            ? 'text-content-secondary'
                            : 'text-content-on-brand-subtle',
                    )}
                >
                    {words}
                </RNText>
                <View
                    aria-hidden
                    className={cx('web:transition-transform', open ? 'rotate-180' : null)}
                >
                    <Icon name="chevronDown" size="md" className="text-content-secondary" />
                </View>
            </Pressable>
        ));
        return labelVisible ? (
            <View className={cx('z-auto flex-col gap-1.5', className)}>
                <RNText aria-hidden className="text-role-strong font-medium text-content-secondary">
                    {label}
                </RNText>
                {picker}
            </View>
        ) : className === undefined ? (
            picker
        ) : (
            <View className={className}>{picker}</View>
        );
    }

    return (
        <FormField
            label={label}
            labelHidden={labelHidden}
            {...(hint === undefined ? {} : { hint })}
            {...(error === undefined ? {} : { error })}
            required={required}
            disabled={disabled}
            {...(id === undefined ? {} : { id })}
            {...(className === undefined ? {} : { className })}
            testID={testID}
        >
            {(control: FieldControlProps) =>
                dropdown(({ triggerProps, toggle, open }) => (
                    <Pressable
                        {...triggerProps}
                        nativeID={control.nativeID}
                        testID={`${testID}-trigger`}
                        role="button"
                        accessibilityRole="button"
                        accessibilityLabel={`${label}: ${words}`}
                        aria-label={`${label}: ${words}`}
                        {...(control['aria-describedby'] === undefined
                            ? {}
                            : { 'aria-describedby': control['aria-describedby'] })}
                        aria-invalid={control['aria-invalid']}
                        accessibilityState={{ disabled, expanded: open }}
                        disabled={disabled}
                        onPress={toggle}
                        className={cx(
                            inputFrameClassName({
                                invalid: error !== undefined,
                                focused: open,
                                disabled,
                                density,
                                size: 'sm',
                            }),
                            'gap-2 web:cursor-pointer',
                        )}
                    >
                        <Icon name="calendar" size="sm" className="text-content-secondary" />
                        <RNText
                            numberOfLines={1}
                            testID={`${testID}-value`}
                            className={cx(
                                'min-w-0 flex-1 text-role-body tabular-nums',
                                shownValue === null
                                    ? 'text-content-secondary'
                                    : 'text-content-primary',
                            )}
                        >
                            {words}
                        </RNText>
                    </Pressable>
                ))
            }
        </FormField>
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
                <IconButton
                    variant="secondary"
                    testID={`${testID}-previous-month`}
                    label={t('designSystem:datePicker.previousMonth')}
                    icon={<Icon name="chevronBackward" size="sm" />}
                    onPress={() => {
                        onMonth(shiftMonth(month, -1));
                    }}
                />
                <RNText
                    testID={`${testID}-month`}
                    className="text-sm font-bold text-content-primary"
                >
                    {formatter.formatDate(instant(`${month}-01`), {
                        month: 'long',
                        year: 'numeric',
                    })}
                </RNText>
                <IconButton
                    variant="secondary"
                    testID={`${testID}-next-month`}
                    label={t('designSystem:datePicker.nextMonth')}
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
                            {formatter.formatDate(instant(day), { weekday: 'short' })}
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
                            outside={day.slice(0, 7) !== month}
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
}) {
    const formatter = useFormatter();
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={formatter.formatDate(instant(day), {
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
            className={cx(
                'h-9 flex-1 items-center justify-center rounded-[10px]',
                chosen
                    ? 'bg-surface-brand'
                    : isToday
                      ? 'border-[1.5px] border-surface-brand hover:bg-surface-sunken'
                      : 'hover:bg-surface-sunken',
                (outside || disabled) && !chosen ? 'opacity-40' : null,
            )}
        >
            <RNText
                className={cx(
                    'text-role-strong tabular-nums',
                    chosen
                        ? 'text-content-on-brand'
                        : outside
                          ? 'text-content-secondary'
                          : 'text-content-primary',
                )}
            >
                {formatter.formatNumber(Number(day.slice(8, 10)))}
            </RNText>
            {dot ? (
                <View
                    aria-hidden
                    className={cx(
                        'absolute bottom-1 h-1 w-1 rounded-full',
                        chosen ? 'bg-content-on-brand' : 'bg-surface-brand',
                    )}
                />
            ) : null}
        </Pressable>
    );
}
