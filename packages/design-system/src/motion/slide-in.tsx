import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Animated } from 'react-native';

import { cx } from '../internal/class-names.ts';
import { useMotion } from './use-motion.ts';
import type { DurationName, MotionDistanceName } from './use-motion.ts';

export const SLIDE_EDGES = ['start', 'end', 'bottom'] as const;
export type SlideEdge = (typeof SLIDE_EDGES)[number];

export interface SlideInProps {
    readonly children: ReactNode;
    /** The edge the content travels *from*. `start` and `end` are logical, never physical. */
    readonly edge?: SlideEdge | undefined;
    readonly distance?: MotionDistanceName | undefined;
    readonly duration?: DurationName | undefined;
    readonly delayMs?: number | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Slides its children in from a logical edge, fading as it travels.
 *
 * The horizontal offset is `edgeSign × axisSign × distance`. `axisSign` comes from the resolved
 * text direction, so `edge="start"` enters from the left in English and from the right in Arabic
 * without a mirrored stylesheet, a `rtl:` variant or a physical inset — none of which survive a
 * live `dir` change on the web.
 *
 * With motion disabled the transform is a literal zero translation and the opacity a literal 1: the
 * component cannot leave content parked off-screen or invisible.
 */
export function SlideIn({
    children,
    edge = 'bottom',
    distance = 'medium',
    duration = 'normal',
    delayMs = 0,
    className,
    testID,
}: SlideInProps) {
    const { enabled, durations, distances, axisSign, easing } = useMotion();
    const progress = useRef(new Animated.Value(0)).current;

    const travel = distances[distance];
    const horizontal = edge !== 'bottom';
    const offset = horizontal ? (edge === 'start' ? -1 : 1) * axisSign * travel : travel;

    useEffect(() => {
        if (!enabled) {
            progress.setValue(1);
            return;
        }

        progress.setValue(0);
        const animation = Animated.timing(progress, {
            toValue: 1,
            duration: durations[duration],
            delay: delayMs,
            easing: easing.decelerate,
            useNativeDriver: true,
        });
        animation.start();
        return () => {
            animation.stop();
        };
    }, [enabled, progress, durations, duration, delayMs, easing, offset]);

    const translate = enabled
        ? progress.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] })
        : 0;

    return (
        <Animated.View
            testID={testID}
            className={cx(className)}
            style={{
                opacity: enabled ? progress : 1,
                transform: [horizontal ? { translateX: translate } : { translateY: translate }],
            }}
        >
            {children}
        </Animated.View>
    );
}
