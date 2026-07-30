import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

import { cx } from '../internal/class-names.ts';
import { useMotion } from './use-motion.ts';
import type { DurationName } from './use-motion.ts';

export interface CollapseProps {
    readonly open: boolean;
    readonly children: ReactNode;
    readonly duration?: DurationName | undefined;
    /** Stable id so a disclosure trigger can point `aria-controls` at this region. */
    readonly nativeID?: string | undefined;
    readonly role?: 'region' | undefined;
    readonly 'aria-labelledby'?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Reveals and hides a region by animating its height.
 *
 * Height is animated rather than opacity because the defect this fixes is *positional*: content
 * below the region jumps when the region's height changes instantly, and the reader loses their
 * place (07-animation-and-motion-inventory.md, MOT-02). Height cannot go through the native driver,
 * which is why this is the one component in the module that animates on the JavaScript thread.
 *
 * The container element is always rendered even when closed, so an `aria-controls` reference from
 * the trigger always resolves; the *children* are unmounted once the closing animation finishes, so
 * a collapsed panel never holds focusable controls in the tab order.
 */
export function Collapse({
    open,
    children,
    duration = 'normal',
    nativeID,
    role,
    'aria-labelledby': labelledBy,
    className,
    testID,
}: CollapseProps) {
    const { enabled, durations, easing } = useMotion();
    const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
    const [mounted, setMounted] = useState(open);
    const [measured, setMeasured] = useState<number | null>(null);

    useEffect(() => {
        if (open) setMounted(true);
    }, [open]);

    useEffect(() => {
        if (!enabled) {
            progress.setValue(open ? 1 : 0);
            setMounted(open);
            return;
        }

        const animation = Animated.timing(progress, {
            toValue: open ? 1 : 0,
            duration: durations[duration],
            easing: open ? easing.decelerate : easing.accelerate,
            useNativeDriver: false,
        });
        animation.start(({ finished }) => {
            if (finished && !open) setMounted(false);
        });
        return () => {
            animation.stop();
        };
    }, [open, enabled, progress, durations, duration, easing]);

    const onLayout = (event: LayoutChangeEvent) => {
        const next = Math.round(event.nativeEvent.layout.height);
        if (next > 0 && next !== measured) setMeasured(next);
    };

    // Before the first measurement the region lays out freely — constraining it to a guessed height
    // would clip the very content we are about to measure.
    const animatedHeight =
        enabled && measured !== null
            ? progress.interpolate({ inputRange: [0, 1], outputRange: [0, measured] })
            : null;

    return (
        <Animated.View
            testID={testID}
            nativeID={nativeID}
            role={role}
            aria-labelledby={labelledBy}
            aria-hidden={mounted ? undefined : true}
            className={cx('overflow-hidden', className)}
            style={animatedHeight === null ? undefined : { height: animatedHeight }}
        >
            {mounted ? (
                <View
                    testID={testID === undefined ? undefined : `${testID}-content`}
                    onLayout={onLayout}
                >
                    {children}
                </View>
            ) : null}
        </Animated.View>
    );
}
