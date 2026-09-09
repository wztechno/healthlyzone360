import { useState } from 'react';
import { neutral } from '@healthy360/design-tokens';
import { TextInput as RNTextInput, Text as RNText, View } from 'react-native';

import { useDensity } from '../hooks/use-density.tsx';
import { cx } from '../internal/class-names.ts';
import { FormField } from './form-field.tsx';
import type { FieldControlProps } from './form-field.tsx';
import { inputFrameClassName } from './text-input.tsx';
import type { InputSize } from './text-input.tsx';

/**
 * QuantityInput — a number with a unit, set in the mono role and aligned to the trailing edge.
 *
 * Three properties, and each of them is the reason a plain `TextInputField` will not do for a
 * recipe line:
 *
 * 1. **Mono.** Every quantity, cost, reference and version renders in `IBM Plex Mono` (§1.2). In a
 *    column of twenty line totals a proportional font puts `1.110` and `7.186` at different widths,
 *    so the decimal points wander and the column cannot be scanned. Tabular figures fix the column
 *    without anyone having to align anything.
 * 2. **End-aligned.** Numbers line up on their last digit, which is what makes a magnitude
 *    difference visible — `0.35` under `7.186` reads as a tenth at a glance only when the two are
 *    flush to the same edge. Alignment is `text-end`, the logical utility, so it is the *trailing*
 *    edge in both writing directions and the column mirrors as a whole under RTL.
 * 3. **Unit-aware.** The unit sits inside the frame as a static suffix rather than in the value. A
 *    unit typed into the value is a string the cost cascade cannot multiply, and `7.186 kg` parsed
 *    back out is a bug waiting for a locale with a different decimal separator.
 *
 * ## The value is a string, and that is deliberate
 *
 * `1.` and `1.0` and `1.00` are all the same number and three different things to type through. A
 * controlled `number` reformats the field under the caret mid-entry — the classic "I cannot type a
 * decimal point" bug. So the caller holds the text, `onChangeText` reports it, and `onCommit` fires
 * on blur with the parsed value (or `null` when the text is not a number). Round at render, store
 * full precision — §6.1 depends on it.
 */

export interface QuantityInputProps {
    readonly label: string;
    readonly value: string;
    readonly onChangeText: (value: string) => void;
    /** Fires on blur with the parsed value, or `null` when the text does not parse. */
    readonly onCommit?: ((value: number | null) => void) | undefined;
    /** Static suffix inside the frame — `kg`, `g`, `pcs`. Never part of the value. */
    readonly unit?: string | undefined;
    readonly hint?: string | undefined;
    readonly error?: string | undefined;
    readonly required?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    /** Read-only, on the sunken fill — a derived total in the cost cascade (§6.2). */
    readonly readOnly?: boolean | undefined;
    readonly size?: InputSize | undefined;
    readonly placeholder?: string | undefined;
    readonly id?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/** Parses the field's text. Returns `null` for anything that is not a finite number. */
export function parseQuantity(text: string): number | null {
    const trimmed = text.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
}

export function QuantityInput({
    label,
    value,
    onChangeText,
    onCommit,
    unit,
    hint,
    error,
    required = false,
    disabled = false,
    readOnly = false,
    size = 'sm',
    placeholder,
    id,
    className,
    testID,
}: QuantityInputProps) {
    const [focused, setFocused] = useState(false);
    const density = useDensity();
    const inert = disabled || readOnly;

    return (
        <FormField
            label={label}
            {...(hint === undefined ? {} : { hint })}
            {...(error === undefined ? {} : { error })}
            required={required}
            disabled={disabled}
            {...(id === undefined ? {} : { id })}
            {...(className === undefined ? {} : { className })}
            {...(testID === undefined ? {} : { testID })}
        >
            {(control: FieldControlProps) => (
                <View
                    className={inputFrameClassName({
                        invalid: error !== undefined,
                        focused,
                        // A derived total takes the sunken fill and the lighter border for the same
                        // reason a disabled field does — it is not editable — but it is *not*
                        // disabled: its value still has to clear 4.5:1, because a cost is the thing
                        // the reader opened the record to read.
                        disabled: inert,
                        density,
                        size,
                    })}
                >
                    <RNTextInput
                        {...control}
                        testID={testID === undefined ? undefined : `${testID}-input`}
                        value={value}
                        onChangeText={onChangeText}
                        editable={!inert}
                        {...(readOnly ? { 'aria-readonly': true } : {})}
                        inputMode="decimal"
                        keyboardType="decimal-pad"
                        {...(placeholder === undefined ? {} : { placeholder })}
                        placeholderTextColor={neutral[600]}
                        // `text-end`, and no inline `textAlign` at all. React Native's own
                        // `textAlign` has no logical `end` value — its vocabulary is left/right —
                        // so an inline style here could only pin the digits to a physical edge, and
                        // it would win over the class besides. The logical utility is the one route
                        // to "the trailing edge, whichever side that is today".
                        className={cx(
                            'flex-1 border-0 bg-transparent font-mono text-end outline-none',
                            density === 'compact' ? 'text-role-body' : 'text-base',
                            inert ? 'text-content-secondary' : 'text-content-primary',
                        )}
                        onFocus={() => {
                            setFocused(true);
                        }}
                        onBlur={() => {
                            setFocused(false);
                            onCommit?.(parseQuantity(value));
                        }}
                    />

                    {unit === undefined ? null : (
                        <RNText
                            testID={testID === undefined ? undefined : `${testID}-unit`}
                            // Decorative in the accessibility tree: the field's own label carries
                            // the unit for assistive technology ("Yield, kilograms"), and reading
                            // the suffix as well announces it twice.
                            aria-hidden
                            accessibilityElementsHidden
                            className={cx(
                                'font-mono text-content-secondary',
                                density === 'compact' ? 'text-role-caption' : 'text-sm',
                            )}
                        >
                            {unit}
                        </RNText>
                    )}
                </View>
            )}
        </FormField>
    );
}
