import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Animated } from 'react-native';

import { cx } from '../internal/class-names.ts';
import { useMotion } from './use-motion.ts';
import type { DurationName } from './use-motion.ts';

export interface FadeInProps {
    readonly children: ReactNode;
    readonly duration?: DurationName | undefined;
    /** Milliseconds to wait before starting. Use `useMotion().stagger(index)` for lists. */
    readonly delayMs?: number | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Fades its children in on mount.
 *
 * When motion is disabled the opacity is the **literal number 1**, not an animated value parked at
 * 1. That distinction is the whole point: the classic reduced-motion defect is content that starts
 * at `opacity: 0`, has its animation suppressed, and is therefore never revealed at all. Rendering
 * the final style directly makes that state unreachable, and the test asserts the literal.
 */
export function FadeIn({
    children,
    duration = 'normal',
    delayMs = 0,
    className,
    testID,
}: FadeInProps) {
    const { enabled, durations, easing } = useMotion();
    const progress = useRef(new Animated.Value(0)).current;

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
    }, [enabled, progress, durations, duration, delayMs, easing]);

    return (
        <Animated.View
            testID={testID}
            className={cx(className)}
            style={{ opacity: enabled ? progress : 1 }}
        >
            {children}
        </Animated.View>
    );
}
