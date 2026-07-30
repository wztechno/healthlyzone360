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

/**
 * How far a thing travels while it moves, in dp.
 *
 * Distance is a motion token, not a spacing token: an entrance offset of 16dp says "this arrived
 * from somewhere" without ever implying a 16dp gap in the finished layout, and the two scales are
 * tuned independently. Like durations, every distance has a reduced-motion counterpart of exactly
 * zero, so a component that reads `motionDistancesFor(...)` cannot animate a translation it was
 * asked not to.
 */
export const MOTION_DISTANCE_NAMES = ['none', 'subtle', 'small', 'medium', 'large'] as const;
export type MotionDistanceName = (typeof MOTION_DISTANCE_NAMES)[number];

export const motionDistances: Readonly<Record<MotionDistanceName, number>> = {
    none: 0,
    subtle: 4,
    small: 8,
    medium: 16,
    large: 24,
};

export const reducedMotionDistances: Readonly<Record<MotionDistanceName, number>> = {
    none: 0,
    subtle: 0,
    small: 0,
    medium: 0,
    large: 0,
};

export function motionDistancesFor(
    prefersReducedMotion: boolean,
): Readonly<Record<MotionDistanceName, number>> {
    return prefersReducedMotion ? reducedMotionDistances : motionDistances;
}

/** Delay between consecutive items in a staggered entrance, in milliseconds. */
export const STAGGER_STEP_MS = 40;

/**
 * The stagger cap.
 *
 * A weekly planner can hold dozens of entries, and an uncapped stagger turns a list into a wait:
 * item 30 would start more than a second after item 1. Beyond this many items every further item
 * shares the last delay.
 */
export const MAX_STAGGERED_ITEMS = 8;

/** The delay an item at `index` waits before entering, in milliseconds. */
export function staggerDelay(index: number, prefersReducedMotion = false): number {
    if (prefersReducedMotion || index <= 0) return 0;
    return Math.min(index, MAX_STAGGERED_ITEMS - 1) * STAGGER_STEP_MS;
}
