import { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';

import { useMotion } from './use-motion.ts';
import type { DurationName } from './use-motion.ts';

export interface UseAnimatedNumberOptions {
    readonly duration?: DurationName | undefined;
    /** Decimal places kept while the value travels. Defaults to whole numbers. */
    readonly decimals?: number | undefined;
}

function round(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

/**
 * Eases a displayed number towards its target.
 *
 * A subtotal or a calorie total that changes silently is easy to miss, and a figure that appears to
 * have been recalculated without being seen to change undermines trust in the calculation
 * (07-animation-and-motion-inventory.md, MOT-04). The travel is the feedback.
 *
 * The first value is *not* animated — a page that counts every figure up from zero on load is a
 * gimmick, not feedback. Under reduced motion the target is returned directly on the same render,
 * so a caller never sees a stale figure.
 */
export function useAnimatedNumber(value: number, options: UseAnimatedNumberOptions = {}): number {
    const { duration = 'normal', decimals = 0 } = options;
    const { enabled, durations, easing } = useMotion();
    const animated = useRef(new Animated.Value(value)).current;
    const [display, setDisplay] = useState(value);

    useEffect(() => {
        if (!enabled) {
            animated.setValue(value);
            setDisplay(value);
            return;
        }

        const listener = animated.addListener((state) => {
            setDisplay(round(state.value, decimals));
        });
        const animation = Animated.timing(animated, {
            toValue: value,
            duration: durations[duration],
            easing: easing.standard,
            // A number is read, not composited: it has to come back to JavaScript every frame.
            useNativeDriver: false,
        });
        animation.start(({ finished }) => {
            if (finished) setDisplay(value);
        });

        return () => {
            animation.stop();
            animated.removeListener(listener);
        };
    }, [value, enabled, animated, durations, duration, decimals, easing]);

    return enabled ? display : value;
}
