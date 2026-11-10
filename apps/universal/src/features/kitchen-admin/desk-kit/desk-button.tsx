import { useMotion } from '@healthy360/design-system';
import { easings } from '@healthy360/design-tokens';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Platform, Pressable, Text as RNText, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

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
 *
 * **Loading is a sweep, not a spinner.** A soft band runs across the pill in the reading direction
 * while the write is on its way; the label stays put, so the button never changes width. Under
 * reduced motion the band stands still, half across. A loading button keeps its full colour — it is
 * busy, not off — and a disabled filled pill is drawn sunken and grey rather than as a faded green
 * one, so "not yet" never reads as "broken".
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

/** The band's tint: light on a filled pill, a wash of the pill's own ink on an outlined one. */
const SWEEP: Readonly<Record<DeskButtonVariant, string>> = {
    primary: 'bg-surface-raised opacity-40',
    secondary: 'bg-surface-brand opacity-20',
    quiet: 'bg-surface-brand opacity-20',
    next: 'bg-surface-brand opacity-20',
    danger: 'bg-surface-raised opacity-40',
    dangerOutline: 'bg-danger opacity-20',
};

/** A filled pill that cannot be pressed yet: sunken and grey, not a faded fill. */
const FILLED: ReadonlySet<DeskButtonVariant> = new Set(['primary', 'danger']);
const FILLED_OFF = '!border-stroke-subtle !bg-surface-sunken !shadow-none';

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
    // As `Button`: a loading button must not fire again.
    const inert = disabled || loading;
    const rounded = variant === 'quiet' ? '' : 'rounded-full';
    const off = disabled && !loading;
    const filledOff = off && FILLED.has(variant);

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
                'relative flex-row items-center justify-center gap-1.5 overflow-hidden border web:transition-colors',
                rounded,
                CONTAINER[variant],
                // The ticket's one action: a 44px pill that never gives its height up to a column.
                size === 'lg' ? '!h-11 shrink-0 !px-5' : '',
                // `flex-1` shares a row; in a column (the lg pill's only home) it would squeeze.
                block ? (size === 'lg' ? 'self-stretch' : 'flex-1 self-stretch') : 'self-start',
                filledOff ? FILLED_OFF : off ? 'opacity-50' : '',
                className ?? '',
            ].join(' ')}
        >
            {loading ? (
                <LoadingSweep
                    tint={SWEEP[variant]}
                    {...(testID === undefined ? {} : { testID: `${testID}-loading` })}
                />
            ) : null}
            {iconStart}
            <RNText
                numberOfLines={1}
                className={`${size === 'lg' ? 'text-base font-bold' : 'text-role-strong'} text-center ${
                    filledOff ? 'text-content-disabled' : LABEL[variant]
                }`}
            >
                {label}
            </RNText>
            {iconEnd}
        </Pressable>
    );
}

const SWEEP_MS = 1100;

/*
 * As `Shimmer`: on the web the band is a CSS animation, so a busy button costs no JavaScript per
 * frame. The band is half the pill, and a percentage translation is relative to the band, so
 * -100% → 200% runs it from just off the start edge to just off the end.
 */
const WEB_SWEEP = StyleSheet.create({
    band: {
        animationTimingFunction: easings.standard.css,
        animationIterationCount: 'infinite',
        animationDuration: `${String(SWEEP_MS)}ms`,
        willChange: 'transform',
    } as unknown as ViewStyle,
    ltr: {
        // @ts-expect-error -- web-only style key, absent from React Native's style types.
        animationKeyframes: [
            {
                '0%': { transform: 'translateX(-100%)' },
                '100%': { transform: 'translateX(200%)' },
            },
        ],
    },
    rtl: {
        // @ts-expect-error -- web-only style key, absent from React Native's style types.
        animationKeyframes: [
            {
                '0%': { transform: 'translateX(100%)' },
                '100%': { transform: 'translateX(-200%)' },
            },
        ],
    },
});

/**
 * The loading band: a soft fill sweeping across the pill, behind the label. Decorative — the pill
 * carries `aria-busy`. Under reduced motion it stands still, filling the first half.
 */
function LoadingSweep({ tint, testID }: { readonly tint: string; readonly testID?: string }) {
    const { enabled, axisSign, easing } = useMotion();
    const [progress] = useState(() => new Animated.Value(0));
    const native = Platform.OS !== 'web';

    useEffect(() => {
        if (!native || !enabled) return;
        progress.setValue(0);
        const loop = Animated.loop(
            Animated.timing(progress, {
                toValue: 1,
                duration: SWEEP_MS,
                easing: easing.standard,
                useNativeDriver: true,
            }),
        );
        loop.start();
        return () => {
            loop.stop();
        };
    }, [native, enabled, progress, easing]);

    const hidden = {
        testID,
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
        'aria-hidden': true,
    };
    if (!enabled) {
        return <View {...hidden} className={`absolute inset-y-0 start-0 w-1/2 ${tint}`} />;
    }
    if (!native) {
        return (
            <View
                {...hidden}
                className={`absolute inset-y-0 start-0 w-1/2 rounded-full ${tint}`}
                style={
                    [
                        WEB_SWEEP.band,
                        axisSign === 1 ? WEB_SWEEP.ltr : WEB_SWEEP.rtl,
                    ] as unknown as StyleProp<ViewStyle>
                }
            />
        );
    }
    return (
        <Animated.View
            {...hidden}
            className={`absolute inset-y-0 start-0 w-1/2 rounded-full ${tint}`}
            style={{
                transform: [
                    {
                        translateX: progress.interpolate({
                            inputRange: [0, 1],
                            // A percentage is not a native transform: run it in points instead.
                            outputRange: [-120 * axisSign, 300 * axisSign],
                        }),
                    },
                ],
            }}
        />
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
