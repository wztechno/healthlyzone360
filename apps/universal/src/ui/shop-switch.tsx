import { cx, useMotion } from '@healthy360/design-system';
import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, Pressable, View } from 'react-native';

/**
 * The web shop's switch, as the accepted Account board draws it ("Use as my default", the
 * notification toggles): a 48 × 28 pill, brand-filled when on, with a 22px knob that glides 20px on
 * the board's ease-out curve (`cubic-bezier(.22, 1, .36, 1)`, 250ms) while the track's colour fades.
 *
 * ## Why not the design system's `Switch`
 *
 * That one is the kitchen admin's desk control — 34px, compact, driven with a mouse. The shop is a
 * customer surface: the board's larger pill, and a 44px touch target around it. The admin keeps its
 * own.
 *
 * ## The slide mirrors itself
 *
 * The knob travels along `axisSign` (from `useMotion`), so in Arabic it slides the other way without
 * an `rtl:` variant, and it simply sits in place when the reader asked for reduced motion.
 *
 * `ShopSwitchTrack` is the drawing alone, for a control that is already a pressable switch of its
 * own (the plan comparison's "Only differences" pill).
 */

const TRAVEL = 20;

export function ShopSwitchTrack({ checked }: { readonly checked: boolean }) {
    const { enabled, axisSign } = useMotion();
    const [slide] = useState(() => new Animated.Value(checked ? 1 : 0));

    useEffect(() => {
        const to = checked ? 1 : 0;
        if (!enabled) {
            slide.setValue(to);
            return undefined;
        }
        const animation = Animated.timing(slide, {
            toValue: to,
            duration: 250,
            easing: Easing.bezier(0.22, 1, 0.36, 1),
            useNativeDriver: Platform.OS !== 'web',
        });
        animation.start();
        return () => {
            animation.stop();
        };
    }, [checked, enabled, slide]);

    return (
        <View
            aria-hidden
            className={cx(
                'h-7 w-12 shrink-0 rounded-full transition-colors duration-200',
                checked ? 'bg-surface-brand' : 'bg-stroke',
            )}
        >
            <Animated.View
                className="absolute start-[3px] top-[3px] h-[22px] w-[22px] rounded-full bg-surface-raised shadow-elevation-2"
                style={{
                    transform: [
                        {
                            translateX: slide.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0, TRAVEL * axisSign],
                            }),
                        },
                    ],
                }}
            />
        </View>
    );
}

export interface ShopSwitchProps {
    readonly checked: boolean;
    readonly onChange: (checked: boolean) => void;
    /** What a screen reader hears; the visible label is the caller's row. */
    readonly label: string;
    readonly disabled?: boolean | undefined;
    /**
     * The control itself is `${testID}-control`, as the design system's `Switch` names it, so a
     * screen moving onto this one keeps its tests' handles.
     */
    readonly testID?: string | undefined;
}

export function ShopSwitch({
    checked,
    onChange,
    label,
    disabled = false,
    testID,
}: ShopSwitchProps) {
    return (
        <View testID={testID}>
            <Pressable
                testID={testID === undefined ? undefined : `${testID}-control`}
                role="switch"
                accessibilityRole="switch"
                accessibilityLabel={label}
                aria-label={label}
                aria-checked={checked}
                aria-disabled={disabled}
                accessibilityState={{ checked, disabled }}
                disabled={disabled}
                onPress={() => {
                    if (!disabled) onChange(!checked);
                }}
                className={cx(
                    'min-h-touch min-w-touch items-center justify-center',
                    disabled ? 'opacity-50' : '',
                )}
            >
                <ShopSwitchTrack checked={checked} />
            </Pressable>
        </View>
    );
}
