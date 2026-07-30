import { useLocale } from '@healthy360/i18n';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import {
    clampIso,
    daysInMonth,
    isoFromParts,
    monthNames,
    partsFromIso,
    withinBounds,
    yearRange,
} from './date-field-shared.ts';
import type { DateFieldProps, DateParts } from './date-field-shared.ts';
import { Select } from './select.tsx';

export type { DateFieldProps } from './date-field-shared.ts';

/**
 * Date field — native.
 *
 * Three selects: day, month, year. Not a calendar grid, and not a native date-picker module.
 *
 * A calendar grid is the wrong instrument for the dates this application asks for. The two common
 * cases are a birth date (which can be a hundred years back — dozens of swipes through a month
 * grid) and a subscription start date (which is a small number of days ahead). Three selects reach
 * both in three taps, are already keyboard- and screen-reader-operable because {@link Select} is,
 * and add no native module — which the platform decision in `docs/architecture` forbids anyway.
 *
 * A day that does not exist in the chosen month is never offered: the day list is recomputed from
 * the month and year, so February can only be 28 or 29 days long.
 */
export function DateField({
    label,
    value,
    onChange,
    min,
    max,
    hint,
    error,
    required = false,
    disabled = false,
    id,
    className,
    testID,
}: DateFieldProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const generated = useId();
    const base = id ?? `date-${generated.replace(/:/g, '')}`;
    const labelId = `${base}-label`;
    const errorId = `${base}-error`;

    const parts = partsFromIso(value);
    const months = monthNames(locale);
    const years = yearRange(min, max);
    const dayCount =
        parts.year === null || parts.month === null ? 31 : daysInMonth(parts.year, parts.month);

    const emit = (next: DateParts) => {
        const iso = isoFromParts(next);
        if (iso === null) {
            onChange(null);
            return;
        }
        onChange(withinBounds(iso, min, max) ? iso : clampIso(iso, min, max));
    };

    return (
        <View
            testID={testID}
            role="group"
            aria-labelledby={labelId}
            accessibilityLabel={label}
            className={cx('flex-col gap-1', className)}
        >
            <RNText
                nativeID={labelId}
                testID={testID === undefined ? undefined : `${testID}-label`}
                className={cx(
                    'text-sm font-medium text-start',
                    disabled ? 'text-content-disabled' : 'text-content-primary',
                )}
            >
                {label}
                {required ? <RNText className="text-danger-strong">{' *'}</RNText> : null}
            </RNText>

            {hint === undefined ? null : (
                <RNText className="text-xs text-content-secondary text-start">{hint}</RNText>
            )}

            <View className="flex-row items-end gap-2">
                <Select
                    testID={testID === undefined ? undefined : `${testID}-day`}
                    id={`${base}-day`}
                    className="flex-1"
                    label={t('designSystem:dateField.day')}
                    disabled={disabled}
                    value={parts.day === null ? null : String(parts.day)}
                    options={Array.from({ length: dayCount }, (_unused, index) => ({
                        value: String(index + 1),
                        label: String(index + 1),
                    }))}
                    onChange={(next) => {
                        emit({ ...parts, day: Number(next) });
                    }}
                />
                <Select
                    testID={testID === undefined ? undefined : `${testID}-month`}
                    id={`${base}-month`}
                    className="flex-[2]"
                    label={t('designSystem:dateField.month')}
                    disabled={disabled}
                    value={parts.month === null ? null : String(parts.month)}
                    options={months.map((name, index) => ({
                        value: String(index + 1),
                        label: name,
                    }))}
                    onChange={(next) => {
                        const month = Number(next);
                        const cap = parts.year === null ? 31 : daysInMonth(parts.year, month);
                        emit({
                            ...parts,
                            month,
                            day: parts.day === null ? null : Math.min(parts.day, cap),
                        });
                    }}
                />
                <Select
                    testID={testID === undefined ? undefined : `${testID}-year`}
                    id={`${base}-year`}
                    className="flex-1"
                    label={t('designSystem:dateField.year')}
                    disabled={disabled}
                    value={parts.year === null ? null : String(parts.year)}
                    options={years.map((year) => ({ value: String(year), label: String(year) }))}
                    onChange={(next) => {
                        emit({ ...parts, year: Number(next) });
                    }}
                />
            </View>

            {error === undefined ? null : (
                <View className="flex-row items-center gap-1">
                    <Icon name="warning" size="sm" className="text-danger-strong" />
                    <RNText
                        nativeID={errorId}
                        testID={testID === undefined ? undefined : `${testID}-error`}
                        role="alert"
                        accessibilityRole="alert"
                        className="flex-1 text-xs text-danger-strong text-start"
                    >
                        {error}
                    </RNText>
                </View>
            )}
        </View>
    );
}
