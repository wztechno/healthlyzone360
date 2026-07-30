import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { NumberStepper } from './number-stepper.tsx';

export interface RangeValue {
    readonly min: number | null;
    readonly max: number | null;
}

export interface RangeFilterProps {
    /** Group name, e.g. "Calories per meal". */
    readonly label: string;
    readonly value: RangeValue;
    readonly onChange: (value: RangeValue) => void;
    /** Outer limits offered to each end of the range. */
    readonly bounds?:
        { readonly min?: number | undefined; readonly max?: number | undefined } | undefined;
    readonly step?: number | undefined;
    readonly unit?: string | undefined;
    readonly minLabel?: string | undefined;
    readonly maxLabel?: string | undefined;
    readonly hint?: string | undefined;
    readonly disabled?: boolean | undefined;
    readonly id?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/** True when both ends are answered and the lower one exceeds the upper one. */
export function isInvertedRange(value: RangeValue): boolean {
    return value.min !== null && value.max !== null && value.min > value.max;
}

/**
 * A two-ended numeric filter.
 *
 * Built from two {@link NumberStepper}s rather than a dual-thumb drag rail. A rail with two thumbs
 * is the least accessible control in common use — the thumbs are indistinguishable to a screen
 * reader without bespoke labelling, they cross over, and on a narrow viewport the two targets sit
 * closer together than the 44 dp minimum. Two labelled numeric fields say the same thing, are
 * typeable, and are already keyboard-operable.
 *
 * Crossed values are *reported*, not silently corrected: swapping the numbers behind the user's
 * back loses the value they were part-way through typing.
 */
export function RangeFilter({
    label,
    value,
    onChange,
    bounds,
    step = 1,
    unit,
    minLabel,
    maxLabel,
    hint,
    disabled = false,
    id,
    className,
    testID,
}: RangeFilterProps) {
    const { t } = useTranslation();
    const generated = useId();
    const base = id ?? `range-${generated.replace(/:/g, '')}`;
    const labelId = `${base}-label`;
    const errorId = `${base}-error`;
    const inverted = isInvertedRange(value);

    return (
        <View
            testID={testID}
            role="group"
            aria-labelledby={labelId}
            accessibilityLabel={label}
            className={cx('flex-col gap-2', className)}
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
            </RNText>

            {hint === undefined ? null : (
                <RNText className="text-xs text-content-secondary text-start">{hint}</RNText>
            )}

            <View className="flex-row items-start gap-3">
                <NumberStepper
                    testID={testID === undefined ? undefined : `${testID}-min`}
                    id={`${base}-min`}
                    className="flex-1"
                    label={minLabel ?? t('designSystem:rangeFilter.min')}
                    value={value.min}
                    onChange={(next) => {
                        onChange({ min: next, max: value.max });
                    }}
                    min={bounds?.min}
                    max={bounds?.max}
                    step={step}
                    unit={unit}
                    disabled={disabled}
                />
                <NumberStepper
                    testID={testID === undefined ? undefined : `${testID}-max`}
                    id={`${base}-max`}
                    className="flex-1"
                    label={maxLabel ?? t('designSystem:rangeFilter.max')}
                    value={value.max}
                    onChange={(next) => {
                        onChange({ min: value.min, max: next });
                    }}
                    min={bounds?.min}
                    max={bounds?.max}
                    step={step}
                    unit={unit}
                    disabled={disabled}
                />
            </View>

            {inverted ? (
                <View className="flex-row items-center gap-1">
                    <Icon name="warning" size="sm" className="text-danger-strong" />
                    <RNText
                        nativeID={errorId}
                        testID={testID === undefined ? undefined : `${testID}-error`}
                        role="alert"
                        accessibilityRole="alert"
                        aria-live="polite"
                        className="flex-1 text-xs text-danger-strong text-start"
                    >
                        {t('designSystem:rangeFilter.inverted')}
                    </RNText>
                </View>
            ) : null}
        </View>
    );
}
