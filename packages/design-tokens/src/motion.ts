/**
 * Motion.
 *
 * Every duration has a reduced-motion counterpart of exactly zero. Reduced motion is not "a bit
 * faster": animation is removed, and the design system reads `durations(prefersReducedMotion)`
 * rather than branching per component, so no component can forget.
 */

export const DURATION_NAMES = ['instant', 'fast', 'normal', 'slow', 'deliberate'] as const;
export type DurationName = (typeof DURATION_NAMES)[number];

/** Milliseconds. */
export const durations: Readonly<Record<DurationName, number>> = {
    instant: 0,
    fast: 120,
    normal: 200,
    slow: 320,
    deliberate: 480,
};

/** All zero. Used whenever the platform reports a reduced-motion preference. */
export const reducedDurations: Readonly<Record<DurationName, number>> = {
    instant: 0,
    fast: 0,
    normal: 0,
    slow: 0,
    deliberate: 0,
};

export function durationsFor(
    prefersReducedMotion: boolean,
): Readonly<Record<DurationName, number>> {
    return prefersReducedMotion ? reducedDurations : durations;
}

export const EASING_NAMES = ['standard', 'decelerate', 'accelerate', 'emphasised'] as const;
export type EasingName = (typeof EASING_NAMES)[number];

export interface EasingToken {
    /** Cubic-bezier control points, for `Easing.bezier(...)` on native. */
    readonly bezier: readonly [number, number, number, number];
    /** The same curve as a CSS `transition-timing-function` value. */
    readonly css: string;
}

export const easings: Readonly<Record<EasingName, EasingToken>> = {
    standard: { bezier: [0.2, 0, 0, 1], css: 'cubic-bezier(0.2, 0, 0, 1)' },
    decelerate: { bezier: [0, 0, 0, 1], css: 'cubic-bezier(0, 0, 0, 1)' },
    accelerate: { bezier: [0.3, 0, 1, 1], css: 'cubic-bezier(0.3, 0, 1, 1)' },
    emphasised: { bezier: [0.2, 0, 0, 1.2], css: 'cubic-bezier(0.2, 0, 0, 1.2)' },
};
