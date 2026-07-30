import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Animated } from 'react-native';

import { cx } from '../internal/class-names.ts';
import { useMotion } from './use-motion.ts';

export interface PageTransitionProps {
    readonly children: ReactNode;
    /** Change this — usually to the route path — to replay the transition. */
    readonly transitionKey?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * A content-level transition for a screen change.
 *
 * Deliberately **content-level**: it wraps what a screen renders and touches no router
 * configuration. Animating the navigator itself would couple the design system to Expo Router's
 * screen options, would fight the native stack's own transitions on device, and would make every
 * shell in the application inherit a decision that belongs to one screen.
 *
 * The movement is a short rise plus a fade — enough to signal "this is a new page", not enough to
 * delay reading it. Under reduced motion it is a plain container with final styles.
 */
export function PageTransition({
    children,
    transitionKey,
    className,
    testID,
}: PageTransitionProps) {
    const { enabled, durations, distances, easing } = useMotion();
    const progress = useRef(new Animated.Value(0)).current;
    const offset = distances.small;

    useEffect(() => {
        if (!enabled) {
            progress.setValue(1);
            return;
        }

        progress.setValue(0);
        const animation = Animated.timing(progress, {
            toValue: 1,
            duration: durations.fast,
            easing: easing.decelerate,
            useNativeDriver: true,
        });
        animation.start();
        return () => {
            animation.stop();
        };
    }, [enabled, progress, durations, easing, transitionKey]);

    return (
        <Animated.View
            testID={testID}
            className={cx('flex-1', className)}
            style={{
                opacity: enabled ? progress : 1,
                transform: [
                    {
                        translateY: enabled
                            ? progress.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [offset, 0],
                              })
                            : 0,
                    },
                ],
            }}
        >
            {children}
        </Animated.View>
    );
}
