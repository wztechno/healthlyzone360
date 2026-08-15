/**
 * Spacing, radius, breakpoints and z-index.
 *
 * Spacing is a strict 4-point scale: every value is a multiple of four so components stack without
 * producing half-pixel gaps on any density. Names are unitless multiples (`4` means 16dp) to match
 * Tailwind's convention, which keeps generated utility class names predictable.
 */

export const SPACING_STEPS = [
    0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32,
] as const;
export type SpacingStep = (typeof SPACING_STEPS)[number];

export const SPACING_BASE = 4;

export const spacing: Readonly<Record<`${SpacingStep}`, number>> = Object.fromEntries(
    SPACING_STEPS.map((step) => [String(step), step * SPACING_BASE]),
) as Record<`${SpacingStep}`, number>;

export const RADIUS_NAMES = ['none', 'xs', 'sm', 'md', 'lg', 'panel', 'xl', '2xl', 'full'] as const;
export type RadiusName = (typeof RADIUS_NAMES)[number];

export const radius: Readonly<Record<RadiusName, number>> = {
    none: 0,
    xs: 2,
    sm: 4,
    md: 8,
    lg: 12,
    /**
     * Panels, trays and editor frames — the boxes that *hold* content rather than being content.
     *
     * Named rather than sized because the scale has no free t-shirt slot between `lg` and `xl`,
     * and renumbering the whole ramp to open one would move every corner in the product to buy a
     * name. It is emitted exactly like its neighbours (`--h360-radius-panel`, `rounded-panel`), so
     * it is one entry in one scale rather than a second convention beside it.
     *
     * 14, deliberately below the 16 of a content card: a panel that holds cards should not be
     * rounder than the cards inside it. It replaces both an ad-hoc `rounded-[14px]` that had spread
     * to seven call sites and a `rounded-2xl` (24) that had become the loosest corner in the
     * product — on the densest screens, which is where it read worst. The product owner rejected 20
     * for that same reason; 24 was never argued for at all.
     */
    panel: 14,
    xl: 16,
    '2xl': 24,
    // Large enough to fully round any control the design system ships.
    full: 9999,
};

/** Minimum touch target, in dp (WCAG 2.2 target size / platform HIG guidance). */
export const MIN_TOUCH_TARGET = 44;

/** Focus ring geometry, shared by web outline and native border rendering. */
export const focusRing = {
    width: 2,
    offset: 2,
} as const;

export const BREAKPOINT_NAMES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
export type BreakpointName = (typeof BREAKPOINT_NAMES)[number];

/** Mobile-first minimum widths in dp. `xs` is 0: it is the default, not a media query. */
export const breakpoints: Readonly<Record<BreakpointName, number>> = {
    xs: 0,
    sm: 480,
    md: 768,
    lg: 1024,
    xl: 1280,
};

export const zIndex = {
    base: 0,
    raised: 10,
    sticky: 100,
    drawer: 200,
    dialog: 300,
    toast: 400,
    tooltip: 500,
} as const;
export type ZIndexName = keyof typeof zIndex;

/** Longest comfortable measure for body copy, in characters. */
export const CONTENT_MAX_MEASURE_CH = 72;
