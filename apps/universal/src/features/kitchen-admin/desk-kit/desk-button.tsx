import { themes } from '@healthy360/design-tokens';
import type { ThemeTokens } from '@healthy360/design-tokens';
import { useColorScheme } from 'nativewind';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text as RNText } from 'react-native';

/**
 * The desk's buttons — the Orders canvas's `.btn.sm`, `.nx`, `.lnk` and `.ib.sm` (2026-11-10).
 *
 * ```
 * ( Pause kitchen )  (( + New order ))   ( Mark delivered )   Clear filters    (‹)
 *   secondary          primary, glows       next — brand ring    quiet link       DeskIconButton
 * ```
 *
 * Every one is a 34px pill on the admin's toolbar height (`h-desk-toolbar`) except `next`, the row's
 * step, at 32px so a two-line row stays two lines; `quiet` is a link-weight word in the brand ink.
 * The primary carries the brand glow — the one lifted control in a toolbar or a pop-up header.
 * `danger` is the filled confirm of a destructive dialog; `dangerOutline` the same command where it
 * is one of several at the foot of a record (Cancel order).
 *
 * The props are `Button`'s own, so a screen moves to the desk look by changing the import.
 */

export type DeskButtonVariant =
    'primary' | 'secondary' | 'quiet' | 'next' | 'danger' | 'dangerOutline';

export interface DeskButtonProps {
    readonly label: string;
    readonly variant?: DeskButtonVariant | undefined;
    /**
     * `lg`: a 44px pill for the one action a panel ends in — a ticket's Place order. `sm` and `md`
     * are accepted for `Button` parity and draw the toolbar's 34px.
     */
    readonly size?: 'sm' | 'md' | 'lg' | undefined;
    readonly loading?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    readonly iconStart?: ReactNode | undefined;
    readonly iconEnd?: ReactNode | undefined;
    /** Stretch across the row — the day panel's two footer buttons. */
    readonly block?: boolean | undefined;
    readonly onPress?: (() => void) | undefined;
    readonly accessibilityLabel?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

const CONTAINER: Readonly<Record<DeskButtonVariant, string>> = {
    primary:
        'h-desk-toolbar px-4 border-surface-brand bg-surface-brand shadow-elevation-brand-glow hover:border-surface-canopy hover:bg-surface-canopy',
    secondary:
        'h-desk-toolbar px-3 border-stroke-subtle bg-surface-raised hover:border-stroke hover:bg-surface-brand-subtle',
    quiet: 'h-control-sm rounded px-2 border-transparent bg-transparent hover:bg-surface-brand-subtle',
    next: 'h-8 px-3 border-surface-brand bg-surface-raised hover:bg-surface-brand-subtle',
    danger: 'h-desk-toolbar px-4 border-danger bg-danger hover:border-danger-strong hover:bg-danger-strong',
    dangerOutline:
        'h-desk-toolbar px-3 border-danger-border bg-surface-raised hover:bg-danger-subtle',
};

const LABEL: Readonly<Record<DeskButtonVariant, string>> = {
    primary: 'text-content-on-brand',
    secondary: 'text-content-primary',
    quiet: 'text-content-on-brand-subtle',
    next: 'text-content-on-brand-subtle',
    danger: 'text-danger-on-default',
    dangerOutline: 'text-danger-strong',
};

const SPINNER: Readonly<Record<DeskButtonVariant, (theme: ThemeTokens) => string>> = {
    primary: (theme) => theme.colours.textOnBrand,
    secondary: (theme) => theme.colours.brandSurface,
    quiet: (theme) => theme.colours.brandSurface,
    next: (theme) => theme.colours.brandSurface,
    danger: (theme) => theme.semantic.danger.onDefault,
    dangerOutline: (theme) => theme.semantic.danger.strong,
};

export function DeskButton({
    label,
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    iconStart,
    iconEnd,
    block = false,
    onPress,
    accessibilityLabel,
    className,
    testID,
}: DeskButtonProps) {
    const { colorScheme } = useColorScheme();
    // As `Button`: a loading button must not fire again.
    const inert = disabled || loading;
    const rounded = variant === 'quiet' ? '' : 'rounded-full';

    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityState={{ disabled: inert, busy: loading }}
            aria-disabled={inert}
            aria-busy={loading}
            disabled={inert}
            onPress={inert || onPress === undefined ? undefined : onPress}
            className={[
                'flex-row items-center justify-center gap-1.5 border web:transition-colors',
                rounded,
                CONTAINER[variant],
                size === 'lg' ? '!h-11 !px-5' : '',
                block ? 'flex-1 self-stretch' : 'self-start',
                inert ? 'opacity-50' : '',
                className ?? '',
            ].join(' ')}
        >
            {loading ? (
                <ActivityIndicator
                    testID={testID === undefined ? undefined : `${testID}-spinner`}
                    size="small"
                    color={SPINNER[variant](themes[colorScheme === 'dark' ? 'dark' : 'light'])}
                    accessibilityElementsHidden
                    aria-hidden
                />
            ) : (
                iconStart
            )}
            <RNText
                numberOfLines={1}
                className={`${size === 'lg' ? 'text-sm font-bold' : 'text-role-strong'} text-center ${LABEL[variant]}`}
            >
                {label}
            </RNText>
            {iconEnd}
        </Pressable>
    );
}

/** `.ib.sm` — a 34px round bordered glyph button: the day stepper's ‹ ›, a pop-up's ✕. */
export function DeskIconButton({
    label,
    icon,
    onPress,
    disabled = false,
    flat = false,
    testID,
}: {
    /** Translated — the button's name, since only its glyph is drawn. */
    readonly label: string;
    readonly icon: ReactNode;
    readonly onPress?: (() => void) | undefined;
    readonly disabled?: boolean | undefined;
    /** Borderless on a sunken tray — the pop-up's ‹ › stepper (`.pnav`). */
    readonly flat?: boolean | undefined;
    readonly testID?: string | undefined;
}) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled }}
            aria-disabled={disabled}
            disabled={disabled}
            onPress={disabled || onPress === undefined ? undefined : onPress}
            className={
                flat
                    ? `h-desk-step aspect-square items-center justify-center rounded-lg ${
                          disabled ? 'opacity-40' : 'hover:bg-surface-raised'
                      }`
                    : `h-desk-toolbar aspect-square items-center justify-center rounded-full border border-stroke-subtle bg-surface-raised text-content-primary web:transition-colors ${
                          disabled ? 'opacity-50' : 'hover:bg-surface-brand-subtle'
                      }`
            }
        >
            {icon}
        </Pressable>
    );
}
