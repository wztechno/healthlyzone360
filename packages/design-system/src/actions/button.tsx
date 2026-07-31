import { ActivityIndicator, Pressable, Text as RNText, View } from 'react-native';
import type { PressableProps } from 'react-native';
import type { ReactNode } from 'react';

import { cx } from '../internal/class-names.ts';

/**
 * Button.
 *
 * The leading/trailing slots are named `iconStart` / `iconEnd`, not left/right, and they are placed
 * by *source order* inside a `flex-row`. Flexbox rows follow the writing direction, so a start slot
 * ends up on the right in Arabic without a single mirrored style — which is the only mirroring
 * technique that survives a live `dir` flip on the web (notes/nativewind-spike.md §4).
 */

export const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost', 'danger'] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

export const BUTTON_SIZES = ['sm', 'md', 'lg'] as const;
export type ButtonSize = (typeof BUTTON_SIZES)[number];

const CONTAINER_VARIANT: Readonly<Record<ButtonVariant, string>> = {
    primary: 'bg-surface-brand border border-transparent',
    secondary: 'bg-surface-raised border border-stroke',
    ghost: 'bg-transparent border border-transparent',
    danger: 'bg-danger border border-transparent',
};

const LABEL_VARIANT: Readonly<Record<ButtonVariant, string>> = {
    primary: 'text-content-on-brand',
    secondary: 'text-content-primary',
    ghost: 'text-content-primary',
    danger: 'text-danger-on-default',
};

const CONTAINER_SIZE: Readonly<Record<ButtonSize, string>> = {
    sm: 'min-h-touch px-3 py-1.5 rounded-md gap-1.5',
    md: 'min-h-touch px-4 py-2 rounded-lg gap-2',
    lg: 'min-h-touch px-6 py-3 rounded-lg gap-2',
};

const LABEL_SIZE: Readonly<Record<ButtonSize, string>> = {
    sm: 'text-sm font-medium',
    md: 'text-base font-medium',
    lg: 'text-lg font-semibold',
};

const SPINNER_COLOUR: Readonly<Record<ButtonVariant, string>> = {
    primary: '#ffffff',
    secondary: '#4e8a37',
    ghost: '#4e8a37',
    danger: '#ffffff',
};

export interface ButtonProps extends Omit<
    PressableProps,
    'children' | 'className' | 'style' | 'disabled'
> {
    readonly label: string;
    readonly variant?: ButtonVariant | undefined;
    readonly size?: ButtonSize | undefined;
    readonly loading?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    /** Rendered on the leading edge — left in English, right in Arabic. */
    readonly iconStart?: ReactNode | undefined;
    /** Rendered on the trailing edge. */
    readonly iconEnd?: ReactNode | undefined;
    /** Stretch to the container width. */
    readonly block?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function Button({
    label,
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    iconStart,
    iconEnd,
    block = false,
    className,
    onPress,
    accessibilityLabel,
    testID,
    ...rest
}: ButtonProps) {
    // A loading button is not merely styled as busy — it must not fire again, or a double tap
    // submits the form twice while the first request is still in flight.
    const inert = disabled || loading;

    return (
        <Pressable
            {...rest}
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityState={{ disabled: inert, busy: loading }}
            aria-disabled={inert}
            aria-busy={loading}
            disabled={inert}
            onPress={inert ? undefined : onPress}
            className={cx(
                'flex-row items-center justify-center',
                CONTAINER_VARIANT[variant],
                CONTAINER_SIZE[size],
                block ? 'self-stretch' : 'self-start',
                inert ? 'opacity-50' : null,
                className,
            )}
        >
            {loading ? (
                // Hidden from assistive technology: the button itself already announces
                // `aria-busy`, and an unnamed nested progressbar is an axe serious violation.
                <ActivityIndicator
                    testID={testID === undefined ? undefined : `${testID}-spinner`}
                    size="small"
                    color={SPINNER_COLOUR[variant]}
                    accessibilityElementsHidden
                    aria-hidden
                />
            ) : (
                iconStart
            )}
            <RNText
                className={cx(LABEL_VARIANT[variant], LABEL_SIZE[size], 'text-center')}
                numberOfLines={1}
            >
                {label}
            </RNText>
            {iconEnd}
        </Pressable>
    );
}

export interface IconButtonProps extends Omit<
    PressableProps,
    'children' | 'className' | 'style' | 'disabled' | 'aria-label'
> {
    /** Required: an icon-only control has no visible text, so this *is* its accessible name. */
    readonly label: string;
    readonly icon: ReactNode;
    readonly variant?: ButtonVariant | undefined;
    readonly size?: ButtonSize | undefined;
    readonly disabled?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

const ICON_BUTTON_SIZE: Readonly<Record<ButtonSize, string>> = {
    sm: 'min-h-touch min-w-touch rounded-md',
    md: 'min-h-touch min-w-touch rounded-lg',
    lg: 'min-h-touch min-w-touch rounded-lg p-2',
};

export function IconButton({
    label,
    icon,
    variant = 'ghost',
    size = 'md',
    disabled = false,
    className,
    onPress,
    testID,
    ...rest
}: IconButtonProps) {
    return (
        <Pressable
            {...rest}
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={label}
            aria-label={label}
            accessibilityState={{ disabled }}
            aria-disabled={disabled}
            disabled={disabled}
            onPress={disabled ? undefined : onPress}
            className={cx(
                'items-center justify-center',
                CONTAINER_VARIANT[variant],
                ICON_BUTTON_SIZE[size],
                disabled ? 'opacity-50' : null,
                className,
            )}
        >
            <View className={LABEL_VARIANT[variant]}>{icon}</View>
        </Pressable>
    );
}
