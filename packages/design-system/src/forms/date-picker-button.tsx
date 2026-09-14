import { useLocale } from '@healthy360/i18n';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { Text } from '../primitives/text.tsx';
import { KEYS } from '../internal/web-props.ts';
import {
    daysInMonth,
    isoFromParts,
    monthNames,
    partsFromIso,
    withinBounds,
} from './date-field-shared.ts';

export interface DatePickerButtonProps {
    /** Accessible name of the trigger, and the panel's heading. */
    readonly label: string;
    /** ISO `YYYY-MM-DD`. */
    readonly value: string;
    readonly onChange: (value: string) => void;
    /** Inclusive ISO bounds; days outside them are drawn but cannot be chosen. */
    readonly min?: string | undefined;
    readonly max?: string | undefined;
    readonly align?: 'start' | 'end' | undefined;
    readonly testID?: string | undefined;
}

/** Weekday columns start on Monday — ISO 8601, the planner's and the order-desk calendar's own week. */
const WEEK_START_OFFSET = 1;

/**
 * Date picker button — a control that shows the chosen day and opens a month table to choose another.
 *
 * For desk toolbars, where a day is picked often and typed never: the trigger is a 32px control
 * (`control.ts` default, not `min-touch` — this lives on mouse-driven surfaces) carrying the date
 * formatted for the locale, and the panel is a seven-column month grid. Choosing a day closes it.
 *
 * Non-modal, on `Popover`'s terms: Escape and a press outside close it on the web. The grid is built
 * from rows of flex children in source order, so under RTL Monday sits on the right with no branch.
 * Weekday and month names come from `Intl`, never a catalogue.
 */
export function DatePickerButton({
    label,
    value,
    onChange,
    min,
    max,
    align = 'start',
    testID,
}: DatePickerButtonProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const generated = useId();
    const base = testID ?? `date-picker-${generated.replace(/:/g, '')}`;
    const panelId = `${base}-panel`;

    const selected = partsFromIso(value);
    const [open, setOpen] = useState(false);
    const [view, setView] = useState(() => ({
        year: selected.year ?? new Date().getUTCFullYear(),
        month: selected.month ?? new Date().getUTCMonth() + 1,
    }));
    const containerRef = useRef<View | null>(null);

    useEffect(() => {
        if (Platform.OS !== 'web' || !open || typeof document === 'undefined') return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === KEYS.escape) setOpen(false);
        };
        const onPointerDown = (event: Event) => {
            const node = containerRef.current as unknown as {
                readonly contains?: (target: unknown) => boolean;
            } | null;
            if (node?.contains?.(event.target) === true) return;
            setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onPointerDown);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onPointerDown);
        };
    }, [open]);

    const toggle = () => {
        if (!open && selected.year !== null && selected.month !== null) {
            setView({ year: selected.year, month: selected.month });
        }
        setOpen((current) => !current);
    };

    const step = (delta: number) => {
        setView((current) => {
            const index = current.year * 12 + (current.month - 1) + delta;
            return { year: Math.floor(index / 12), month: (index % 12) + 1 };
        });
    };

    const triggerText = formatDay(locale, value);
    const monthTitle = `${monthNames(locale)[view.month - 1] ?? ''} ${String(view.year)}`;
    const weekdays = weekdayNames(locale);
    const today = new Date().toISOString().slice(0, 10);

    const firstWeekday = new Date(Date.UTC(view.year, view.month - 1, 1)).getUTCDay();
    const leading = (firstWeekday - WEEK_START_OFFSET + 7) % 7;
    const count = daysInMonth(view.year, view.month);
    const cells: (number | null)[] = [
        ...Array.from({ length: leading }, () => null),
        ...Array.from({ length: count }, (_unused, index) => index + 1),
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks = Array.from({ length: cells.length / 7 }, (_unused, index) =>
        cells.slice(index * 7, index * 7 + 7),
    );

    return (
        <View ref={containerRef} testID={testID} className="flex-col">
            <Pressable
                testID={`${base}-trigger`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={`${label}: ${triggerText}`}
                aria-expanded={open}
                aria-controls={panelId}
                aria-haspopup="dialog"
                onPress={toggle}
                className="h-control-sm flex-row items-center gap-tight self-start rounded border border-stroke bg-surface-raised px-control-sm"
            >
                <Icon name="calendar" size="sm" className="text-content-secondary" />
                <Text variant="mono" testID={`${base}-value`}>
                    {triggerText}
                </Text>
            </Pressable>

            {open ? (
                <View
                    testID={panelId}
                    nativeID={panelId}
                    role="dialog"
                    aria-label={label}
                    accessibilityLabel={label}
                    className={cx(
                        'absolute top-full z-tooltip mt-1 w-[280px] flex-col gap-2 rounded-lg border border-stroke-subtle bg-surface-raised p-3 shadow-elevation-3',
                        align === 'end' ? 'end-0' : null,
                    )}
                >
                    <View className="flex-row items-center justify-between">
                        <Pressable
                            testID={`${base}-previous`}
                            role="button"
                            accessibilityRole="button"
                            accessibilityLabel={t('designSystem:datePicker.previousMonth')}
                            onPress={() => {
                                step(-1);
                            }}
                            className="h-control-sm w-control-sm items-center justify-center rounded"
                        >
                            <Icon
                                name="chevronBackward"
                                size="sm"
                                className="text-content-primary"
                            />
                        </Pressable>
                        <RNText
                            testID={`${base}-month`}
                            accessibilityRole="header"
                            aria-live="polite"
                            className="text-sm font-semibold text-content-primary"
                        >
                            {monthTitle}
                        </RNText>
                        <Pressable
                            testID={`${base}-next`}
                            role="button"
                            accessibilityRole="button"
                            accessibilityLabel={t('designSystem:datePicker.nextMonth')}
                            onPress={() => {
                                step(1);
                            }}
                            className="h-control-sm w-control-sm items-center justify-center rounded"
                        >
                            <Icon
                                name="chevronForward"
                                size="sm"
                                className="text-content-primary"
                            />
                        </Pressable>
                    </View>

                    <View className="flex-row" aria-hidden>
                        {weekdays.map((name, index) => (
                            <View key={index} className="flex-1 items-center">
                                <RNText className="text-xs text-content-secondary">{name}</RNText>
                            </View>
                        ))}
                    </View>

                    {weeks.map((week, weekIndex) => (
                        <View key={weekIndex} className="flex-row">
                            {week.map((day, dayIndex) => {
                                if (day === null) {
                                    return (
                                        <View
                                            key={`blank-${String(dayIndex)}`}
                                            className="h-8 flex-1"
                                        />
                                    );
                                }
                                const iso =
                                    isoFromParts({ year: view.year, month: view.month, day }) ?? '';
                                const isSelected = iso === value;
                                const enabled = withinBounds(iso, min, max);
                                return (
                                    <Pressable
                                        key={iso}
                                        testID={`${base}-day-${iso}`}
                                        role="button"
                                        accessibilityRole="button"
                                        accessibilityLabel={formatDay(locale, iso)}
                                        accessibilityState={{
                                            selected: isSelected,
                                            disabled: !enabled,
                                        }}
                                        aria-selected={isSelected}
                                        aria-disabled={!enabled}
                                        disabled={!enabled}
                                        onPress={() => {
                                            onChange(iso);
                                            setOpen(false);
                                        }}

                                        className={cx(
                                            'h-8 flex-1 items-center justify-center rounded',
                                            isSelected ? 'bg-surface-brand-subtle' : null,
                                            iso === today ? 'border border-stroke-strong' : null,
                                        )}
                                    >
                                        {/* The table's own numeral face — `Text` `mono` — so a
                                            date reads like the figures it filters. */}
                                        <Text
                                            variant="mono"
                                            tone={
                                                isSelected
                                                    ? 'brand'
                                                    : enabled
                                                      ? 'primary'
                                                      : 'disabled'
                                            }
                                        >
                                            {String(day)}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </View>
                    ))}
                </View>
            ) : null}
        </View>
    );
}

function formatDay(locale: string, iso: string): string {
    const parts = partsFromIso(iso);
    if (parts.year === null || parts.month === null || parts.day === null) return iso;
    try {
        return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
            new Date(Date.UTC(parts.year, parts.month - 1, parts.day)),
        );
    } catch {
        return iso;
    }
}

/** Short weekday names, Monday first. 2024-01-01 was a Monday. */
function weekdayNames(locale: string): readonly string[] {
    try {
        const formatter = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' });
        return Array.from({ length: 7 }, (_unused, index) =>
            formatter.format(new Date(Date.UTC(2024, 0, 1 + index))),
        );
    } catch {
        return ['1', '2', '3', '4', '5', '6', '7'];
    }
}
