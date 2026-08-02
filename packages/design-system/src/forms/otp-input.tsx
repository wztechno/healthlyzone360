import { useState } from 'react';
import { TextInput as RNTextInput, View } from 'react-native';
import type { TextInputProps as RNTextInputProps } from 'react-native';

import { neutral } from '@healthy360/design-tokens';

import { FormField } from './form-field.tsx';
import type { FieldControlProps } from './form-field.tsx';
import { inputFrameClassName } from './text-input.tsx';

/**
 * One-time-code input.
 *
 * ## Why one field and not six boxes
 *
 * Six single-character boxes are the familiar pattern and they are the wrong one here. They break
 * platform autofill (iOS and Android hand the *whole* code to one field, and Chrome's WebOTP does
 * the same), they break paste, they make backspace ambiguous, and they present six labelled
 * controls to a screen reader where a person has one thing to do. A single field with
 * `autoComplete="one-time-code"` gets the code filled in automatically on both platforms, pastes
 * cleanly, and reads as "Verification code, edit text".
 *
 * What the boxes were actually buying — the sense that this is a short numeric code rather than a
 * sentence — is bought here instead with letter spacing, centring and a hard `maxLength`.
 *
 * ## Why the digits are normalised
 *
 * An Arabic keyboard produces `٠١٢٣٤٥٦٧٨٩` (Arabic-Indic) and a Persian or Urdu one produces
 * `۰۱۲۳۴۵۶۷۸۹` (Extended Arabic-Indic). They are digits to the person typing and to `Intl`, but
 * they are not the characters the server compares against, so a code typed on an Arabic keyboard
 * would be rejected as wrong — a failure that costs the person one of three attempts and tells them
 * nothing. {@link normaliseOtpDigits} maps both families to ASCII and drops everything else, which
 * also handles the spaces and dashes that come with a pasted code.
 *
 * ## Why the field is forced to LTR
 *
 * Numbers read left-to-right in Arabic too, but a numeric string in an RTL container can have its
 * caret and its bidi resolution flip around punctuation. `writingDirection: 'ltr'` pins the field
 * without pinning the *layout*, which stays logical and mirrors normally.
 */

/** Arabic-Indic `٠`–`٩` (U+0660) and Extended Arabic-Indic `۰`–`۹` (U+06F0). */
const ARABIC_INDIC_START = 0x0660;
const EXTENDED_ARABIC_INDIC_START = 0x06f0;

/**
 * Everything that is a digit to a person → ASCII `0`–`9`; everything else dropped.
 *
 * Exported because it is the part worth testing on its own, and because a screen that receives a
 * code from somewhere other than this field (a deep link, a Playwright fixture) should normalise it
 * the same way rather than inventing a second rule.
 */
export function normaliseOtpDigits(value: string): string {
    let out = '';
    for (const character of value) {
        const code = character.codePointAt(0);
        if (code === undefined) continue;
        if (code >= 0x30 && code <= 0x39) {
            out += character;
        } else if (code >= ARABIC_INDIC_START && code <= ARABIC_INDIC_START + 9) {
            out += String(code - ARABIC_INDIC_START);
        } else if (code >= EXTENDED_ARABIC_INDIC_START && code <= EXTENDED_ARABIC_INDIC_START + 9) {
            out += String(code - EXTENDED_ARABIC_INDIC_START);
        }
    }
    return out;
}

export interface OtpInputProps extends Omit<
    RNTextInputProps,
    | 'className'
    | 'style'
    | 'editable'
    | 'accessibilityLabel'
    | 'nativeID'
    | 'onChange'
    | 'onChangeText'
    | 'value'
    | 'maxLength'
    | 'keyboardType'
    | 'inputMode'
    | 'autoComplete'
    | 'textContentType'
    | 'secureTextEntry'
> {
    readonly label: string;
    readonly value: string;
    /** Receives normalised digits only — never raw keystrokes. */
    readonly onChangeText: (next: string) => void;
    /** How many digits the code has. Comes from the challenge, not from a constant. */
    readonly length: number;
    readonly hint?: string | undefined;
    readonly error?: string | undefined;
    readonly disabled?: boolean | undefined;
    readonly id?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function OtpInput({
    label,
    value,
    onChangeText,
    length,
    hint,
    error,
    disabled = false,
    id,
    className,
    testID,
    onFocus,
    onBlur,
    ...rest
}: OtpInputProps) {
    const [focused, setFocused] = useState(false);

    return (
        <FormField
            label={label}
            hint={hint}
            error={error}
            required
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
                        value={value}
                        editable={!disabled}
                        maxLength={length}
                        // `inputMode` gives the web a numeric keypad and native a number pad;
                        // `keyboardType` is what React Native still reads on iOS.
                        inputMode="numeric"
                        keyboardType="number-pad"
                        // The whole reason this is one field: both platforms fill a one-time code
                        // into a single control and nothing else.
                        autoComplete="one-time-code"
                        textContentType="oneTimeCode"
                        autoCapitalize="none"
                        autoCorrect={false}
                        spellCheck={false}
                        className="flex-1 text-lg font-semibold text-content-primary"
                        placeholderTextColor={neutral[600]}
                        style={{
                            textAlign: 'center',
                            // Digits read left-to-right in every locale this ships in.
                            writingDirection: 'ltr',
                            letterSpacing: 8,
                        }}
                        onChangeText={(next) => {
                            onChangeText(normaliseOtpDigits(next).slice(0, length));
                        }}
                        onFocus={(event) => {
                            setFocused(true);
                            onFocus?.(event);
                        }}
                        onBlur={(event) => {
                            setFocused(false);
                            onBlur?.(event);
                        }}
                    />
                </View>
            )}
        </FormField>
    );
}
