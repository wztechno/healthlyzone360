import {
    MAX_STAGGERED_ITEMS,
    STAGGER_STEP_MS,
    durationsFor,
    easings,
    motionDistancesFor,
    staggerDelay,
} from '@healthy360/design-tokens';
import type { DurationName, EasingName, MotionDistanceName } from '@healthy360/design-tokens';
import { useDirection } from '@healthy360/i18n';
import type { TextDirection } from '@healthy360/domain-types';
import { Easing } from 'react-native';
import type { EasingFunction } from 'react-native';
import { useMemo } from 'react';

import { useReducedMotion } from '../hooks/use-reduced-motion.ts';

/**
 * The motion contract.
 *
 * Two facts decide every animation in this design system, and both of them are properties of the
 * *user*, not of the component: whether motion is wanted at all, and which way "forward" points.
 * `useMotion()` answers both once so no component has to ask twice, and so the reduced-motion
 * branch cannot be forgotten in one component while being honoured in the next.
 *
 * `axisSign` is the RTL correction. A panel that enters from the *start* edge travels along `-1 ×
 * axisSign` on the horizontal axis: in English that is a leftward offset resolving to zero, in
 * Arabic a rightward one. Multiplying by the sign is the only mirroring technique that survives a
 * live `dir` flip on the web, because the component re-renders when the locale changes
 * (`docs/architecture/notes/nativewind-spike.md` §4).
 */
export interface MotionTokens {
    /** False under `prefers-reduced-motion`. Every duration and distance is then zero. */
    readonly enabled: boolean;
    readonly durations: Readonly<Record<DurationName, number>>;
    readonly distances: Readonly<Record<MotionDistanceName, number>>;
    readonly direction: TextDirection;
    /** `1` in a left-to-right locale, `-1` in a right-to-left one. */
    readonly axisSign: 1 | -1;
    /** React Native easing functions, keyed by the token names. */
    readonly easing: Readonly<Record<EasingName, EasingFunction>>;
    /** Entrance delay for the item at `index`, already capped and already reduced-motion aware. */
    readonly stagger: (index: number) => number;
}

const EASING_FUNCTIONS: Readonly<Record<EasingName, EasingFunction>> = {
    standard: Easing.bezier(...easings.standard.bezier),
    decelerate: Easing.bezier(...easings.decelerate.bezier),
    accelerate: Easing.bezier(...easings.accelerate.bezier),
    emphasised: Easing.bezier(...easings.emphasised.bezier),
};

export function useMotion(): MotionTokens {
    const reduced = useReducedMotion();
    const direction = useDirection();

    return useMemo(() => {
        const enabled = !reduced;
        return {
            enabled,
            durations: durationsFor(reduced),
            distances: motionDistancesFor(reduced),
            direction,
            axisSign: direction === 'rtl' ? -1 : 1,
            easing: EASING_FUNCTIONS,
            stagger: (index: number) => staggerDelay(index, reduced),
        };
    }, [reduced, direction]);
}

export { MAX_STAGGERED_ITEMS, STAGGER_STEP_MS };
export type { DurationName, EasingName, MotionDistanceName };
