import { easings } from '@healthy360/design-tokens';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';

import { AnimatedView } from '../internal/animated-view.ts';
import { cx } from '../internal/class-names.ts';
import { useMotion } from './use-motion.ts';

export interface ShimmerProps {
    readonly children?: ReactNode | undefined;
    /** Milliseconds for one full sweep. Defaults to a deliberately unhurried 1.4 s. */
    readonly cycleMs?: number | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

const DEFAULT_CYCLE_MS = 1400;

/*
 * On the web the sweep is a CSS animation. React Native Web has no native driver, so an `Animated`
 * loop writes the band's transform from JavaScript on every frame — and a loading page carries a
 * dozen bands at once, which measured ~680 style writes a second on /meals. The browser runs
 * keyframes off the main thread.
 *
 * The band is a third of its container, and a percentage translation is relative to the band
 * itself, so ±300% is the native path's ±container width — no measuring needed.
 */
const WEB_SWEEP = StyleSheet.create({
    // react-native-web runs these as CSS keyframes (its ActivityIndicator spins the same way). Cast,
    // not `@ts-expect-error`: the app's react-native-web types know these keys, React Native's do not.
    band: {
        width: '33.333%',
        animationTimingFunction: easings.standard.css,
        animationIterationCount: 'infinite',
        willChange: 'transform',
    } as unknown as ViewStyle,
    ltr: {
        // @ts-expect-error -- web-only style key, absent from React Native's style types.
        animationKeyframes: [
            {
                '0%': { transform: 'translateX(-300%)' },
                '100%': { transform: 'translateX(300%)' },
            },
        ],
    },
    rtl: {
        // @ts-expect-error -- web-only style key, absent from React Native's style types.
        animationKeyframes: [
            {
                '0%': { transform: 'translateX(300%)' },
                '100%': { transform: 'translateX(-300%)' },
            },
        ],
    },
});

/**
 * A highlight band that sweeps across its container, in the reading direction.
 *
 * The sweep is a translation of a single tinted band rather than an animated gradient, because a
 * gradient would mean a native module and this design system adds none. The band is decorative and
 * hidden from assistive technology; the surrounding region carries `aria-busy`.
 *
 * Under reduced motion the band is **not rendered at all**. A slowed shimmer is still a moving
 * highlight, and vestibular triggers are about movement, not speed.
 */
export function Shimmer(props: ShimmerProps) {
    return Platform.OS === 'web' ? <ShimmerWeb {...props} /> : <ShimmerNative {...props} />;
}

function ShimmerWeb({ children, cycleMs = DEFAULT_CYCLE_MS, className, testID }: ShimmerProps) {
    const { enabled, axisSign } = useMotion();
    return (
        <View testID={testID} className={cx('relative overflow-hidden', className)}>
            {children}
            {enabled ? (
                <View
                    testID={testID === undefined ? undefined : `${testID}-band`}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    aria-hidden
                    className="absolute inset-y-0 bg-surface-raised opacity-60"
                    style={
                        // `animationDuration` is react-native-web's, outside React Native's style types.
                        [
                            WEB_SWEEP.band,
                            axisSign === 1 ? WEB_SWEEP.ltr : WEB_SWEEP.rtl,
                            { animationDuration: `${String(cycleMs)}ms` },
                        ] as unknown as StyleProp<ViewStyle>
                    }
                />
            ) : null}
        </View>
    );
}

function ShimmerNative({ children, cycleMs = DEFAULT_CYCLE_MS, className, testID }: ShimmerProps) {
    const { enabled, axisSign, easing } = useMotion();
    const progress = useRef(new Animated.Value(0)).current;
    const [width, setWidth] = useState(0);

    useEffect(() => {
        if (!enabled || width === 0) return;

        progress.setValue(0);
        const loop = Animated.loop(
            Animated.timing(progress, {
                toValue: 1,
                duration: cycleMs,
                easing: easing.standard,
                useNativeDriver: true,
            }),
        );
        loop.start();
        return () => {
            loop.stop();
        };
    }, [enabled, width, cycleMs, progress, easing]);

    const onLayout = (event: LayoutChangeEvent) => {
        const next = Math.round(event.nativeEvent.layout.width);
        if (next > 0 && next !== width) setWidth(next);
    };

    return (
        <View
            testID={testID}
            onLayout={onLayout}
            className={cx('relative overflow-hidden', className)}
        >
            {children}
            {enabled && width > 0 ? (
                <AnimatedView
                    testID={testID === undefined ? undefined : `${testID}-band`}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    aria-hidden
                    className="absolute inset-y-0 bg-surface-raised opacity-60"
                    style={{
                        width: Math.max(Math.round(width / 3), 24),
                        transform: [
                            {
                                translateX: progress.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [-width * axisSign, width * axisSign],
                                }),
                            },
                        ],
                    }}
                />
            ) : null}
        </View>
    );
}
