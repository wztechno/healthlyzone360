import { Icon, cx, useMotion } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Easing,
    Platform,
    Pressable,
    Text as RNText,
    TextInput,
    View,
} from 'react-native';
import type { TextInputProps } from 'react-native';

/**
 * The accepted sign-in boards' form pieces, for the pages drawn in `AuthFrame`: the round badge over
 * the title, the title, a labelled field with its leading icon (and, for a password, the eye), the
 * hint line, the error box, the big pill that submits, and the tick a finished step shows.
 *
 * Each keeps the handles the screens' tests already use: a field named `x` has its input at
 * `x-input` and its message at `x-error`, as the design system's own fields name them.
 */

/** The round-cornered badge over a pane's title — the boards' key, envelope, phone. */
export function AuthBadge({
    icon,
    tone = 'brand',
}: {
    readonly icon: IconName;
    readonly tone?: 'brand' | 'warning';
}) {
    return (
        <View
            aria-hidden
            className={cx(
                'mb-1 h-16 w-16 items-center justify-center self-start rounded-[20px]',
                tone === 'warning' ? 'bg-warning-subtle' : 'bg-surface-brand-subtle',
            )}
        >
            <Icon
                name={icon}
                size="lg"
                className={
                    tone === 'warning' ? 'text-warning-on-subtle' : 'text-content-on-brand-subtle'
                }
            />
        </View>
    );
}

export function AuthTitle({
    children,
    testID,
    centred = false,
}: {
    readonly children: string;
    readonly testID?: string | undefined;
    readonly centred?: boolean;
}) {
    return (
        <RNText
            testID={testID}
            accessibilityRole="header"
            aria-level={1}
            className={cx(
                'font-display text-3xl font-bold leading-[38px] text-content-primary',
                centred ? 'text-center' : 'text-start',
            )}
        >
            {children}
        </RNText>
    );
}

/** The boards' quiet paragraph under a title. */
export function AuthText({
    children,
    testID,
    centred = false,
}: {
    readonly children: string;
    readonly testID?: string | undefined;
    readonly centred?: boolean;
}) {
    return (
        <RNText
            testID={testID}
            className={cx(
                'text-base font-medium leading-6 text-content-secondary',
                centred ? 'text-center' : 'text-start',
            )}
        >
            {children}
        </RNText>
    );
}

export interface AuthFieldProps {
    readonly testID: string;
    readonly label: string;
    readonly icon: IconName;
    readonly value: string;
    readonly onChangeText: (text: string) => void;
    readonly onBlur?: (() => void) | undefined;
    readonly placeholder?: string | undefined;
    readonly error?: string | undefined;
    readonly autoComplete?: TextInputProps['autoComplete'];
    readonly keyboardType?: TextInputProps['keyboardType'];
    /** A password: drawn hidden, with the eye that shows it. */
    readonly secret?: boolean | undefined;
    /**
     * Whether a secret is shown. Passed when two fields share one eye (a new password and its
     * confirmation); otherwise the field keeps its own.
     */
    readonly revealed?: boolean | undefined;
    readonly onToggleReveal?: (() => void) | undefined;
    readonly showLabel?: string | undefined;
    readonly hideLabel?: string | undefined;
}

export function AuthField({
    testID,
    label,
    icon,
    value,
    onChangeText,
    onBlur,
    placeholder,
    error,
    autoComplete,
    keyboardType,
    secret = false,
    revealed,
    onToggleReveal,
    showLabel,
    hideLabel,
}: AuthFieldProps) {
    const [focused, setFocused] = useState(false);
    const [ownReveal, setOwnReveal] = useState(false);
    const shown = revealed ?? ownReveal;
    const toggle = onToggleReveal ?? (() => setOwnReveal((value_) => !value_));
    const hasEye = secret && showLabel !== undefined && hideLabel !== undefined;

    return (
        <View testID={testID} className="min-w-0 flex-col gap-1.5">
            <RNText className="text-sm font-semibold text-content-primary text-start">
                {label}
            </RNText>
            <View
                className={cx(
                    'h-[52px] flex-row items-center gap-2.5 rounded-[14px] border-[1.5px] bg-surface-raised pe-1.5 ps-3.5',
                    error !== undefined
                        ? 'border-danger-border'
                        : focused
                          ? 'border-surface-brand'
                          : 'border-stroke hover:border-surface-brand',
                )}
            >
                <Icon
                    name={icon}
                    size="md"
                    className={focused ? 'text-content-brand' : 'text-content-secondary'}
                />
                <TextInput
                    testID={`${testID}-input`}
                    accessibilityLabel={label}
                    value={value}
                    onChangeText={onChangeText}
                    onFocus={() => {
                        setFocused(true);
                    }}
                    onBlur={() => {
                        setFocused(false);
                        onBlur?.();
                    }}
                    placeholder={placeholder}
                    secureTextEntry={secret && !shown}
                    autoComplete={autoComplete}
                    autoCapitalize="none"
                    keyboardType={keyboardType}
                    aria-invalid={error !== undefined}
                    className="h-full min-w-0 flex-1 text-base font-medium text-content-primary web:outline-none"
                />
                {hasEye ? (
                    <Pressable
                        testID={`${testID}-reveal`}
                        role="button"
                        accessibilityRole="button"
                        accessibilityLabel={shown ? hideLabel : showLabel}
                        onPress={toggle}
                        className="h-11 w-11 items-center justify-center rounded-[10px] hover:bg-surface-sunken"
                    >
                        <Icon
                            name={shown ? 'hidden' : 'eye'}
                            size="md"
                            className="text-content-secondary"
                        />
                    </Pressable>
                ) : null}
            </View>
            {error === undefined ? null : (
                <RNText
                    testID={`${testID}-error`}
                    role="alert"
                    className="text-sm font-medium text-danger-on-subtle text-start"
                >
                    {error}
                </RNText>
            )}
        </View>
    );
}

/**
 * How strong a new password looks, 0 to 4: long enough, longer still, letters with digits, and a
 * mix of cases or a symbol. A guide drawn under the field, never a rule — the server's own length
 * rule is the one that refuses.
 */
export function passwordStrength(value: string, minimum: number): number {
    if (value === '') return 0;
    let score = 0;
    if (value.length >= minimum) score += 1;
    if (value.length >= minimum + 4) score += 1;
    if (/\d/.test(value) && /\p{L}/u.test(value)) score += 1;
    if ((/\p{Lu}/u.test(value) && /\p{Ll}/u.test(value)) || /[^\p{L}\d\s]/u.test(value)) {
        score += 1;
    }
    return score;
}

/** The boards' four-bar meter under a new password. */
export function AuthMeter({
    value,
    minimum,
}: {
    readonly value: string;
    readonly minimum: number;
}) {
    const score = passwordStrength(value, minimum);
    return (
        <View aria-hidden className="-mt-1 flex-row gap-1">
            {[1, 2, 3, 4].map((bar) => (
                <View
                    key={bar}
                    className={cx(
                        'h-1.5 flex-1 rounded-full transition-colors duration-300',
                        bar <= score ? 'bg-surface-brand' : 'bg-stroke-subtle',
                    )}
                />
            ))}
        </View>
    );
}

/** The boards' hint line, tucked under the field above it. */
export function AuthHint({ children }: { readonly children: string }) {
    return (
        <RNText className="-mt-1.5 text-sm font-medium text-content-secondary text-start">
            {children}
        </RNText>
    );
}

/** What went wrong, in a red box that shakes once when it appears. */
export function AuthError({
    testID,
    message,
}: {
    readonly testID: string;
    readonly message: string;
}) {
    const { enabled } = useMotion();
    const [shake] = useState(() => new Animated.Value(0));
    useEffect(() => {
        if (!enabled) return undefined;
        shake.setValue(0);
        const animation = Animated.timing(shake, {
            toValue: 1,
            duration: 450,
            easing: Easing.bezier(0.36, 0.07, 0.19, 0.97),
            useNativeDriver: Platform.OS !== 'web',
        });
        animation.start();
        return () => {
            animation.stop();
        };
    }, [enabled, message, shake]);

    return (
        <Animated.View
            className="flex-row items-center gap-2.5 rounded-[14px] border border-danger-border bg-danger-subtle px-3 py-2.5"
            style={{
                transform: [
                    {
                        translateX: shake.interpolate({
                            inputRange: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
                            outputRange: [0, -1, 2, -4, 4, -4, 4, -4, 2, -1, 0],
                        }),
                    },
                ],
            }}
        >
            <Icon name="warning" size="sm" className="text-danger-on-subtle" />
            <RNText
                testID={testID}
                role="alert"
                aria-live="assertive"
                className="flex-1 text-sm font-semibold text-danger-on-subtle text-start"
            >
                {message}
            </RNText>
        </Animated.View>
    );
}

/** The big brand pill that moves a step on: a spinner while it works, an arrow when it can go. */
export function AuthSubmit({
    testID,
    label,
    busy = false,
    disabled = false,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly busy?: boolean;
    readonly disabled?: boolean;
    readonly onPress: () => void;
}) {
    const inert = busy || disabled;
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={label}
            disabled={inert}
            aria-disabled={inert}
            aria-busy={busy}
            accessibilityState={{ disabled: inert, busy }}
            onPress={onPress}
            className={cx(
                'h-[54px] flex-row items-center justify-center gap-2.5 rounded-full bg-surface-brand shadow-elevation-3 transition duration-normal ease-standard',
                disabled ? 'opacity-45' : 'hover:-translate-y-px hover:opacity-90',
            )}
        >
            {busy ? (
                <ActivityIndicator size="small" />
            ) : (
                <>
                    <RNText className="text-base font-bold text-content-on-brand">{label}</RNText>
                    <Icon name="chevronForward" size="md" className="text-content-on-brand" />
                </>
            )}
        </Pressable>
    );
}

/** The quiet way out under a pane — Cancel, Back to sign in, Send a new code. */
export function AuthLink({
    testID,
    label,
    disabled = false,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly disabled?: boolean;
    readonly onPress: () => void;
}) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            disabled={disabled}
            aria-disabled={disabled}
            accessibilityState={{ disabled }}
            onPress={onPress}
            className="min-h-touch items-center justify-center self-center rounded-full px-3 hover:bg-surface-brand-subtle"
        >
            <RNText
                className={cx(
                    'text-sm font-semibold',
                    disabled ? 'text-content-secondary' : 'text-content-brand',
                )}
            >
                {label}
            </RNText>
        </Pressable>
    );
}

/** A short line in a soft box: news in the brand tint ("A new code is on its way"), a wait in amber. */
export function AuthNote({
    testID,
    tone,
    children,
}: {
    readonly testID?: string | undefined;
    readonly tone: 'brand' | 'warning';
    readonly children: string;
}) {
    return (
        <View
            role="status"
            aria-live="polite"
            className={cx(
                'flex-row items-center gap-2.5 rounded-[14px] px-3.5 py-3',
                tone === 'warning' ? 'bg-warning-subtle' : 'bg-surface-brand-subtle',
            )}
        >
            <Icon
                name={tone === 'warning' ? 'clock' : 'check'}
                size="sm"
                className={
                    tone === 'warning' ? 'text-warning-on-subtle' : 'text-content-on-brand-subtle'
                }
            />
            <RNText
                testID={testID}
                className={cx(
                    'flex-1 text-sm font-semibold text-start',
                    tone === 'warning' ? 'text-warning-on-subtle' : 'text-content-on-brand-subtle',
                )}
            >
                {children}
            </RNText>
        </View>
    );
}

/** A finished step's tick: the brand disc, ringed in its soft tint, popping in. */
export function AuthTick() {
    const { enabled } = useMotion();
    const [pop] = useState(() => new Animated.Value(enabled ? 0 : 1));
    useEffect(() => {
        if (!enabled) return undefined;
        const animation = Animated.timing(pop, {
            toValue: 1,
            duration: 500,
            easing: Easing.bezier(0.34, 1.4, 0.64, 1),
            useNativeDriver: Platform.OS !== 'web',
        });
        animation.start();
        return () => {
            animation.stop();
        };
    }, [enabled, pop]);

    return (
        <Animated.View
            aria-hidden
            className="h-[104px] w-[104px] items-center justify-center self-center rounded-full bg-surface-brand-subtle"
            style={{
                opacity: pop,
                transform: [
                    { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
                ],
            }}
        >
            <View className="h-[84px] w-[84px] items-center justify-center rounded-full bg-surface-brand">
                <Icon name="check" size="lg" className="text-content-on-brand" />
            </View>
        </Animated.View>
    );
}
