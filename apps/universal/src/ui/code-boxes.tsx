import { cx, normaliseOtpDigits, useMotion } from '@healthy360/design-system';
import { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Platform,
    Pressable,
    Text as RNText,
    TextInput,
    View,
} from 'react-native';

/**
 * A one-time code as the accepted boards draw it: a row of boxes, one per digit. The box to type
 * into wears the brand border with a blinking caret, filled boxes take the soft tint and pop in as
 * their digit lands, and a wrong code turns the row red.
 *
 * ## One real field under the boxes
 *
 * The boxes are a drawing. Under them sits one transparent input that takes the keystrokes, so the
 * two things a code field must never lose still work: the phone's "fill from Messages" and the
 * browser's one-time-code autofill both fill one control, and pasting all six digits lands all
 * six. Six separate inputs would break both. Pressing anywhere on the row focuses that field.
 *
 * Digits are normalised as the design system's `OtpInput` does them (Arabic-Indic digits typed on
 * an Arabic keyboard become 0–9), and the row always reads left to right — a code is not a word.
 *
 * Handles match `OtpInput`'s: the input is `${testID}-input` and the message `${testID}-error`.
 */

export interface CodeBoxesProps {
    /** What a screen reader hears for the field — "Code". */
    readonly label: string;
    readonly value: string;
    readonly onChangeText: (next: string) => void;
    readonly length: number;
    readonly error?: string | undefined;
    readonly disabled?: boolean | undefined;
    /** `md` is the sign-in boards' 52 × 60; `lg` the account pages' 56 × 64. */
    readonly size?: 'md' | 'lg';
    /** Left-aligned under a card's title, rather than centred. */
    readonly align?: 'center' | 'start';
    readonly autoFocus?: boolean | undefined;
    readonly onSubmitEditing?: (() => void) | undefined;
    readonly testID?: string | undefined;
}

function Caret() {
    const { enabled } = useMotion();
    const [blink] = useState(() => new Animated.Value(1));
    useEffect(() => {
        if (!enabled) return undefined;
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(blink, {
                    toValue: 0,
                    duration: 1,
                    delay: 500,
                    useNativeDriver: Platform.OS !== 'web',
                }),
                Animated.timing(blink, {
                    toValue: 1,
                    duration: 1,
                    delay: 500,
                    useNativeDriver: Platform.OS !== 'web',
                }),
            ]),
        );
        loop.start();
        return () => {
            loop.stop();
        };
    }, [blink, enabled]);
    return (
        <Animated.View
            aria-hidden
            className="h-7 w-0.5 rounded-full bg-surface-brand"
            style={{ opacity: blink }}
        />
    );
}

function Digit({ digit, invalid }: { readonly digit: string; readonly invalid: boolean }) {
    const { enabled } = useMotion();
    const [pop] = useState(() => new Animated.Value(enabled ? 0.4 : 1));
    useEffect(() => {
        if (!enabled) return undefined;
        const animation = Animated.timing(pop, {
            toValue: 1,
            duration: 300,
            easing: Easing.bezier(0.34, 1.4, 0.64, 1),
            useNativeDriver: Platform.OS !== 'web',
        });
        animation.start();
        return () => {
            animation.stop();
        };
    }, [enabled, pop]);
    return (
        <Animated.View style={{ transform: [{ scale: pop }] }}>
            <RNText
                className={cx(
                    'font-display text-2xl font-bold tabular-nums',
                    invalid ? 'text-danger-on-subtle' : 'text-content-on-brand-subtle',
                )}
            >
                {digit}
            </RNText>
        </Animated.View>
    );
}

export function CodeBoxes({
    label,
    value,
    onChangeText,
    length,
    error,
    disabled = false,
    size = 'md',
    align = 'center',
    autoFocus,
    onSubmitEditing,
    testID,
}: CodeBoxesProps) {
    const input = useRef<TextInput>(null);
    const [focused, setFocused] = useState(false);
    const large = size === 'lg';
    const digits = value.split('');
    const invalid = error !== undefined;

    return (
        <View className={cx('flex-col gap-2', align === 'center' ? 'items-center' : 'items-start')}>
            <Pressable
                testID={testID}
                accessible={false}
                disabled={disabled}
                onPress={() => {
                    input.current?.focus();
                }}
                // Digits read left-to-right in every locale this ships in.
                style={{ direction: 'ltr' }}
                className={cx(
                    'relative flex-row',
                    large ? 'gap-2.5' : 'gap-2',
                    disabled ? 'opacity-50' : '',
                )}
            >
                {Array.from({ length }, (_, index) => {
                    const digit = digits[index];
                    const here =
                        focused && !disabled && index === Math.min(value.length, length - 1);
                    return (
                        <View
                            key={index}
                            aria-hidden
                            className={cx(
                                'items-center justify-center border-[1.5px]',
                                large
                                    ? 'h-16 w-14 rounded-2xl'
                                    : 'h-[60px] w-[52px] rounded-[14px]',
                                invalid
                                    ? 'border-danger-border bg-danger-subtle'
                                    : digit !== undefined
                                      ? 'border-surface-brand bg-surface-brand-subtle'
                                      : here
                                        ? 'border-surface-brand bg-surface-raised'
                                        : 'border-stroke bg-surface-raised',
                            )}
                        >
                            {digit !== undefined ? (
                                <Digit
                                    key={`${String(index)}-${digit}`}
                                    digit={digit}
                                    invalid={invalid}
                                />
                            ) : here ? (
                                <Caret />
                            ) : null}
                        </View>
                    );
                })}
                <TextInput
                    ref={input}
                    testID={testID === undefined ? undefined : `${testID}-input`}
                    accessibilityLabel={label}
                    aria-invalid={invalid}
                    value={value}
                    editable={!disabled}
                    maxLength={length}
                    inputMode="numeric"
                    keyboardType="number-pad"
                    autoComplete="one-time-code"
                    textContentType="oneTimeCode"
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    autoFocus={autoFocus}
                    caretHidden
                    onChangeText={(next) => {
                        onChangeText(normaliseOtpDigits(next).slice(0, length));
                    }}
                    onFocus={() => {
                        setFocused(true);
                    }}
                    onBlur={() => {
                        setFocused(false);
                    }}
                    {...(onSubmitEditing === undefined
                        ? {}
                        : {
                              onSubmitEditing: () => {
                                  onSubmitEditing();
                              },
                          })}
                    // Laid over the boxes, invisible: it is the boxes' keyboard, not a field of
                    // its own.
                    className="absolute inset-0 text-transparent opacity-0 web:outline-none"
                />
            </Pressable>
            {error === undefined ? null : (
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-error`}
                    role="alert"
                    className={cx(
                        'text-sm font-medium text-danger-on-subtle',
                        align === 'center' ? 'text-center' : 'text-start',
                    )}
                >
                    {error}
                </RNText>
            )}
        </View>
    );
}
