import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

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
export function Shimmer({ children, cycleMs = DEFAULT_CYCLE_MS, className, testID }: ShimmerProps) {
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
                <Animated.View
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
