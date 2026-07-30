import { useTranslation } from 'react-i18next';
import { TextInput as RNTextInput, Text as RNText, View } from 'react-native';

import { neutral } from '@healthy360/design-tokens';

import { IconButton } from '../actions/button.tsx';
import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { KEYS, keyDownProps } from '../internal/web-props.ts';
import type { WebKeyEvent } from '../internal/web-props.ts';
import { FormField } from './form-field.tsx';
import type { FieldControlProps } from './form-field.tsx';
import { inputFrameClassName } from './text-input.tsx';

export interface NumberStepperProps {
    readonly label: string;
    /** `null` means "not answered yet" — distinct from zero, which is an answer. */
    readonly value: number | null;
    readonly onChange: (value: number | null) => void;
    readonly min?: number | undefined;
    readonly max?: number | undefined;
    readonly step?: number | undefined;
    /** Shown inside the frame after the number: `g`, `kcal`, `AED`. */
    readonly unit?: string | undefined;
    readonly hint?: string | undefined;
    readonly error?: string | undefined;
    readonly required?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    readonly id?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/** Rounds to the nearest multiple of `step` measured from `min`, then clamps. */
export function clampToStep(
    value: number,
    options: {
        readonly min?: number | undefined;
        readonly max?: number | undefined;
        readonly step: number;
    },
): number {
    const { min, max, step } = options;
    const origin = min ?? 0;
    const snapped = origin + Math.round((value - origin) / step) * step;
    const decimals = String(step).includes('.') ? String(step).split('.')[1]!.length : 0;
    const rounded = Number(snapped.toFixed(decimals));
    if (min !== undefined && rounded < min) return min;
    if (max !== undefined && rounded > max) return max;
    return rounded;
}

/**
 * A number field with increment and decrement controls.
 *
 * This is the design system's answer to a slider, and the substitution is deliberate. A drag rail
 * cannot be operated without a pointer, needs a bespoke keyboard implementation to be reachable at
 * all, is impossible to hit accurately on a 360 px screen, and would mean a gesture dependency. A
 * stepper is a real text input for people who know the number they want, two 44 dp buttons for
 * people who do not, and Arrow Up / Arrow Down for people on a keyboard — with no new dependency
 * and no bespoke accessibility.
 *
 * The input announces itself as a `spinbutton` carrying its own bounds, so a screen reader user
 * hears the permitted range rather than discovering it by being refused.
 */
export function NumberStepper({
    label,
    value,
    onChange,
    min,
    max,
    step = 1,
    unit,
    hint,
    error,
    required = false,
    disabled = false,
    id,
    className,
    testID,
}: NumberStepperProps) {
    const { t } = useTranslation();

    const atMin = value !== null && min !== undefined && value <= min;
    const atMax = value !== null && max !== undefined && value >= max;

    const nudge = (delta: number) => {
        const base = value ?? min ?? 0;
        onChange(clampToStep(base + delta * step, { min, max, step }));
    };

    const commit = (text: string) => {
        const normalised = text.replace(/[^0-9.-]/g, '');
        if (normalised.length === 0) {
            onChange(null);
            return;
        }
        const parsed = Number(normalised);
        if (Number.isNaN(parsed)) return;
        onChange(parsed);
    };

    const blur = () => {
        if (value === null) return;
        const clamped = clampToStep(value, { min, max, step });
        if (clamped !== value) onChange(clamped);
    };

    const onKeyDown = (event: WebKeyEvent) => {
        if (event.key === KEYS.arrowUp) {
            event.preventDefault();
            nudge(1);
        } else if (event.key === KEYS.arrowDown) {
            event.preventDefault();
            nudge(-1);
        }
    };

    return (
        <FormField
            label={label}
            hint={hint}
            error={error}
            required={required}
            disabled={disabled}
            id={id}
            className={className}
            testID={testID}
        >
            {(control: FieldControlProps) => (
                <View className="flex-row items-center gap-2">
                    <IconButton
                        testID={testID === undefined ? undefined : `${testID}-decrement`}
                        variant="secondary"
                        label={t('designSystem:numberStepper.decrease', { label })}
                        icon={<Icon name="minus" />}
                        disabled={disabled || atMin}
                        onPress={() => {
                            nudge(-1);
                        }}
                    />

                    <View
                        className={cx(
                            inputFrameClassName({
                                invalid: error !== undefined,
                                focused: false,
                                disabled,
                            }),
                            'flex-1',
                        )}
                    >
                        <RNTextInput
                            {...control}
                            testID={testID === undefined ? undefined : `${testID}-input`}
                            role="spinbutton"
                            aria-valuenow={value ?? undefined}
                            aria-valuemin={min}
                            aria-valuemax={max}
                            accessibilityValue={{
                                ...(value === null ? {} : { now: value }),
                                ...(min === undefined ? {} : { min }),
                                ...(max === undefined ? {} : { max }),
                            }}
                            editable={!disabled}
                            inputMode="numeric"
                            keyboardType="numeric"
                            value={value === null ? '' : String(value)}
                            onChangeText={commit}
                            onBlur={blur}
                            {...keyDownProps(onKeyDown)}
                            className="flex-1 text-base text-content-primary"
                            placeholderTextColor={neutral[600]}
                            style={{ textAlign: 'auto' }}
                        />
                        {unit === undefined ? null : (
                            <RNText
                                testID={testID === undefined ? undefined : `${testID}-unit`}
                                aria-hidden
                                accessibilityElementsHidden
                                className="text-sm text-content-secondary"
                            >
                                {unit}
                            </RNText>
                        )}
                    </View>

                    <IconButton
                        testID={testID === undefined ? undefined : `${testID}-increment`}
                        variant="secondary"
                        label={t('designSystem:numberStepper.increase', { label })}
                        icon={<Icon name="plus" />}
                        disabled={disabled || atMax}
                        onPress={() => {
                            nudge(1);
                        }}
                    />
                </View>
            )}
        </FormField>
    );
}
