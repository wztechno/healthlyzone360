import { easings } from '@healthy360/design-tokens';
import { useEffect, useState } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { AnimatedView } from '../internal/animated-view.ts';
import { cx } from '../internal/class-names.ts';
import { useMotion } from './use-motion.ts';

export interface LoadingSweepProps {
    /**
     * The band's fill and strength, as classes: light on a filled button
     * (`bg-surface-raised opacity-40`), a wash of the button's own ink on an outlined one
     * (`bg-surface-brand opacity-20`).
     */
    readonly tint: string;
    readonly testID?: string | undefined;
}

const SWEEP_MS = 1100;

/*
 * As `Shimmer`: on the web the band is a CSS animation, so a busy button costs no JavaScript per
 * frame. The band is half the button, and a percentage translation is relative to the band, so
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
 * A busy button's loading state: a soft band sweeping across it in the reading direction, behind
 * the label — the desk's Save (2026-11) and, since 2026-11-22, every button that used to swap its
 * glyph or label for a spinning circle. The label stays put, so the button never changes width.
 *
 * The button must be `relative overflow-hidden`, and the sweep goes first among its children so
 * the label paints over it. Decorative: the button carries `aria-busy`. Under reduced motion the
 * band stands still, filling the first half.
 */
export function LoadingSweep({ tint, testID }: LoadingSweepProps) {
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
        return <View {...hidden} className={cx('absolute inset-y-0 start-0 w-1/2', tint)} />;
    }
    if (!native) {
        return (
            <View
                {...hidden}
                className={cx('absolute inset-y-0 start-0 w-1/2 rounded-full', tint)}
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
        <AnimatedView
            {...hidden}
            className={cx('absolute inset-y-0 start-0 w-1/2 rounded-full', tint)}
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
