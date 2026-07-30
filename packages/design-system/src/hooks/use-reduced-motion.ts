import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the platform asks for reduced motion.
 *
 * `AccessibilityInfo` is implemented by both React Native and react-native-web (which reads
 * `prefers-reduced-motion`), so one code path covers every target. Components must *not* merely
 * shorten an animation when this is true — `Skeleton`, for example, stops shimmering entirely,
 * because a slower pulse is still a pulse.
 */
export function useReducedMotion(): boolean {
    const [reduced, setReduced] = useState(false);

    useEffect(() => {
        let cancelled = false;

        void AccessibilityInfo.isReduceMotionEnabled()
            .then((enabled) => {
                if (!cancelled) setReduced(enabled === true);
            })
            .catch(() => {
                /* Platform without the query: motion stays on, which is the safe default visually. */
            });

        const subscription = AccessibilityInfo.addEventListener(
            'reduceMotionChanged',
            (enabled: boolean) => {
                setReduced(enabled === true);
            },
        );

        return () => {
            cancelled = true;
            subscription.remove();
        };
    }, []);

    return reduced;
}
