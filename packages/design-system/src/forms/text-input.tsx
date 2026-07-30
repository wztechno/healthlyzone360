import { useState } from 'react';
import type { ReactNode } from 'react';
import { TextInput as RNTextInput, View } from 'react-native';
import type { TextInputProps as RNTextInputProps } from 'react-native';

import { neutral } from '@healthy360/design-tokens';

import { cx } from '../internal/class-names.ts';
import { FormField } from './form-field.tsx';
import type { FieldControlProps } from './form-field.tsx';

/**
 * Text input.
 *
 * `textAlign="auto"` is React Native's *logical* alignment: the caret and the text follow the
 * writing direction instead of being pinned to a physical side. It is one of the few places an
 * inline style prop is correct — there is no Tailwind utility for it on a `TextInput`.
 */

export interface TextInputFieldProps extends Omit<
    RNTextInputProps,
    'className' | 'style' | 'editable' | 'accessibilityLabel' | 'nativeID' | 'onChange'
> {
    readonly label: string;
    readonly hint?: string | undefined;
    readonly error?: string | undefined;
    readonly required?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    readonly id?: string | undefined;
    /** Rendered inside the input frame on the trailing edge — reveal toggles, unit suffixes. */
    readonly trailing?: ReactNode | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function inputFrameClassName(options: {
    readonly invalid: boolean;
    readonly focused: boolean;
    readonly disabled: boolean;
}): string {
    return cx(
        'flex-row items-center gap-2 rounded-lg border bg-surface-base px-3 min-h-touch',
        options.invalid ? 'border-danger-border' : 'border-stroke',
        // A visible focus ring is a WCAG 2.4.7 requirement, and on native there is no browser
        // default to fall back on, so it is drawn explicitly.
        options.focused ? 'border-stroke-focus border-focus' : null,
        options.disabled ? 'bg-surface-sunken opacity-60' : null,
    );
}

export function TextInputField({
    label,
    hint,
    error,
    required = false,
    disabled = false,
    id,
    trailing,
    className,
    testID,
    onFocus,
    onBlur,
    ...rest
}: TextInputFieldProps) {
    const [focused, setFocused] = useState(false);

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
                <View
                    className={inputFrameClassName({
                        invalid: error !== undefined,
                        focused,
                        disabled,
                    })}
                >
                    <RNTextInput
                        {...rest}
                        {...control}
                        testID={testID === undefined ? undefined : `${testID}-input`}
                        editable={!disabled}
                        className="flex-1 text-base text-content-primary"
                        // neutral.600: placeholder text is still text to WCAG - neutral.500 sits
                        // just below the 4.5:1 AA threshold on the base surface (axe caught it).
                        placeholderTextColor={neutral[600]}
                        style={{ textAlign: 'auto' }}
                        onFocus={(event) => {
                            setFocused(true);
                            onFocus?.(event);
                        }}
                        onBlur={(event) => {
                            setFocused(false);
                            onBlur?.(event);
                        }}
                    />
                    {trailing}
                </View>
            )}
        </FormField>
    );
}
